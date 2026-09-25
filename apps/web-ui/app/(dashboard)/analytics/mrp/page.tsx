"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useDeferredValue, useMemo, useState } from "react"
import { AlertTriangle, CalendarRange, CheckCircle2, ClipboardCheck, FilePlus2, Info, PackageSearch, Search, ShieldAlert, Truck, Warehouse } from "lucide-react"

import { MetricCard } from "@/components/erp/shell"
import { Donut } from "@/components/erp/viz"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useMrpCoverage } from "@/hooks/use-analytics"
import { useInventoryAging, useInventoryBalances, useInventoryValuationSummary } from "@/hooks/use-inventory"
import { displayPlantScope } from "@/lib/plant-scope"
import { cn } from "@/lib/utils"

const num = (value: unknown, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const inr = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0)

function rowsOf(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

/** Policy recommendation from item-master reorder/safety/lead settings only. */
function recommendationFor(row: any) {
  const available = Number(row.available_qty ?? row.balance ?? row.qty_on_hand ?? row.qty_available ?? 0)
  const reorder = Math.max(0, Number(row.reorder_level ?? row.min_qty ?? row.min_level ?? 0))
  const safety = Math.max(0, Number(row.safety_stock ?? row.safety_qty ?? 0))
  const leadDays = Math.max(0, Number(row.lead_time_days ?? row.supplier_lead_days ?? 0))
  const missingPolicy = reorder <= 0 || leadDays <= 0
  const target = Math.max(reorder + safety, reorder)
  const shortage = missingPolicy ? 0 : Math.max(0, target - available)
  const lotSize = Math.max(0, Number(row.purchase_lot_size || 0))
  const orderQty = shortage > 0 ? (lotSize > 0 ? Math.ceil(shortage / lotSize) * lotSize : shortage) : 0
  const unitCost = Number(row.unit_cost ?? row.avg_rate ?? row.rate ?? 0)
  const status = missingPolicy ? "MISSING_POLICY" : shortage <= 0 ? "OK" : available <= safety ? "URGENT" : "WARNING"
  return {
    ...row,
    item_label: row.item_code || row.name || row.item_name || row.code || String(row.item_id || row.id || "").slice(0, 8),
    type: String(row.type || row.category || "UNKNOWN").toUpperCase(),
    available, reorder, safety, target, shortage, order_qty: orderQty, po_value: orderQty * unitCost, lead_days: leadDays, status,
  }
}

/** One bullet bar: usable stock + incoming supply against the requirement, shortfall shaded. */
function CoverageBar({ required, usable, due, uom }: { required: number; usable: number; due: number; uom: string }) {
  const scale = Math.max(required, usable + due, 1)
  const usableW = (Math.min(usable, scale) / scale) * 100
  const dueW = (Math.min(due, Math.max(0, scale - usable)) / scale) * 100
  const reqX = (required / scale) * 100
  const covered = required > 0 ? Math.min(999, ((usable + due) / required) * 100) : 100
  return (
    <div className="min-w-[180px]" title={`Required ${num(required, 1)} · usable ${num(usable, 1)} · on order ${num(due, 1)} ${uom}`}>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-signal-rose-soft ring-1 ring-inset ring-signal-rose-line/60">
        <div className="absolute inset-y-0 left-0 origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-signal-emerald-ink/75" style={{ width: `${usableW}%` }} />
        <div className="absolute inset-y-0 origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-signal-blue-ink/45 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,hsl(0_0%_100%/.35)_3px_6px)]" style={{ left: `${usableW}%`, width: `${dueW}%`, animationDelay: "120ms" }} />
        <div className="absolute inset-y-[-2px] w-0.5 bg-foreground/70" style={{ left: `calc(${Math.min(100, reqX)}% - 1px)` }} aria-hidden="true" />
      </div>
      <p className={cn("mt-1 text-[11px] font-medium tabular-nums", covered >= 100 ? "text-signal-emerald-ink" : "text-signal-rose-ink")}>{covered >= 100 ? "Covered" : `${num(covered)}% covered`}</p>
    </div>
  )
}

function Tabs({ view }: { view: "demand" | "reorder" }) {
  return (
    <div className="tube-segment" role="tablist" aria-label="MRP view" data-testid="mrp-view-switcher">
      <Link role="tab" aria-selected={view === "demand"} data-state={view === "demand" ? "active" : undefined} href="/analytics/mrp?view=demand" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium">Open-order demand</Link>
      <Link role="tab" aria-selected={view === "reorder"} data-state={view === "reorder" ? "active" : undefined} href="/analytics/mrp?view=reorder" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium">Reorder policy</Link>
    </div>
  )
}

function Toolbar({ search, onSearch, filter, onFilter, filters }: { search: string; onSearch: (value: string) => void; filter: string; onFilter: (value: string) => void; filters: Array<[string, string, number]> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
      <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 sm:max-w-[320px] focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Search materials</span>
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search material…" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] shadow-none outline-none focus:shadow-none" />
      </label>
      <div className="tube-segment max-w-full overflow-x-auto" role="group" aria-label="Status filter">
        {filters.map(([value, label, count]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>{label} <span className="tabular-nums text-muted-foreground">{count}</span></button>
        ))}
      </div>
    </div>
  )
}

function DemandView() {
  const { activePlant } = useAuth()
  const coverageQuery = useMrpCoverage(activePlant || undefined)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const deferred = useDeferredValue(search.trim().toLowerCase())
  const coverage = coverageQuery.data || {}
  const materials: any[] = Array.isArray(coverage.materials) ? coverage.materials : []
  const unknown: any[] = coverage.unknown_or_unmapped_lines || []
  const statusOf = (row: any) => {
    const short = Number(row.shortfall_qty || 0)
    if (short <= 0.0001 && Number(row.usable_qty || 0) >= Number(row.remaining_requirement_qty || 0)) return "covered"
    if (short <= 0.0001) return "on_order"
    return "short"
  }
  const counts = materials.reduce((acc: Record<string, number>, row) => { const key = statusOf(row); acc[key] = (acc[key] || 0) + 1; return acc }, {})
  const shortfallTotal = materials.reduce((sum, row) => sum + Number(row.shortfall_qty || 0), 0)
  const requiredTotal = materials.reduce((sum, row) => sum + Number(row.remaining_requirement_qty || 0), 0)
  const dueTotal = materials.reduce((sum, row) => sum + Number(row.supply_due_qty || 0), 0)
  const visible = materials
    .filter((row) => filter === "all" || statusOf(row) === filter)
    .filter((row) => !deferred || `${row.item_code || ""} ${row.label || ""}`.toLowerCase().includes(deferred))
    .sort((a, b) => Number(b.shortfall_qty || 0) - Number(a.shortfall_qty || 0))

  if (coverageQuery.isLoading) return <LoadingState label="Expanding open orders through their recipes…" />
  if (coverageQuery.isError) return <ErrorState message="Coverage could not be loaded. Missing coverage is not a zero shortfall." onRetry={() => void coverageQuery.refetch()} />

  return (
    <div className="space-y-4" data-testid="mrp-demand-coverage-view">
      <section className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Open order lines" value={num(coverage.demand_source?.total_open_lines)} detail="Every open line in scope, not a page" icon={ClipboardCheck} tone="blue" />
        <MetricCard label="Material required" value={`${num(requiredTotal)} kg`} detail={`${materials.length} materials from approved recipes`} icon={Warehouse} tone="teal" />
        <MetricCard label="Materials short" value={num(counts.short || 0)} detail={`${num(shortfallTotal)} kg shortfall after stock and POs`} icon={PackageSearch} tone={counts.short ? "rose" : "emerald"} href="#coverage" />
        <MetricCard label="On order" value={`${num(dueTotal)} kg`} detail="Open PO balance due — not counted as stock" icon={Truck} tone="cyan" />
        <MetricCard label="Unmapped lines" value={num(coverage.unknown_line_count)} detail="Missing recipe or paper mapping — not treated as zero" icon={ShieldAlert} tone={Number(coverage.unknown_line_count) ? "amber" : "slate"} href="#unmapped" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section id="coverage" className="erp-panel min-w-0 overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div>
              <h3 className="text-[14.5px] font-semibold tracking-tight">Coverage by material</h3>
              <p className="text-[12.5px] text-muted-foreground">Green is usable stock, striped blue is on order, red is what&apos;s still missing. The line marks the requirement.</p>
            </div>
            <div className="flex gap-2">
              <Link href="/purchase/scheduler" className="erp-btn-secondary !h-8"><CalendarRange className="h-3.5 w-3.5" />Plan purchases</Link>
              <Link href="/purchase/new" className="erp-btn-primary !h-8"><FilePlus2 className="h-3.5 w-3.5" />Create PO</Link>
            </div>
          </div>
          <div className="mt-3">
            <Toolbar search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} filters={[["all", "All", materials.length], ["short", "Short", counts.short || 0], ["on_order", "Covered by POs", counts.on_order || 0], ["covered", "In stock", counts.covered || 0]]} />
          </div>
          {visible.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="tube-grid">
                <thead><tr><th>Material</th><th className="num">Required</th><th className="num">Usable</th><th className="num hidden md:table-cell">QC held</th><th className="num">On order</th><th className="num">Short</th><th>Coverage</th><th className="hidden lg:table-cell">First short</th></tr></thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.item_id || row.item_code}>
                      <td className="max-w-[220px]"><span className="block truncate font-medium">{row.item_code || row.label}</span><span className="block truncate text-[11.5px] text-muted-foreground">{row.label && row.label !== row.item_code ? row.label : row.uom || "KG"}</span></td>
                      <td className="num">{num(row.remaining_requirement_qty, 1)}</td>
                      <td className="num">{num(row.usable_qty, 1)}</td>
                      <td className="num hidden md:table-cell text-muted-foreground">{num(row.qc_held_qty, 1)}</td>
                      <td className="num">{num(row.supply_due_qty, 1)}</td>
                      <td className={cn("num font-semibold", Number(row.shortfall_qty) > 0 ? "text-signal-rose-ink" : "text-muted-foreground")}>{Number(row.shortfall_qty) > 0 ? num(row.shortfall_qty, 1) : "—"}</td>
                      <td><CoverageBar required={Number(row.remaining_requirement_qty || 0)} usable={Number(row.usable_qty || 0)} due={Number(row.supply_due_qty || 0)} uom={row.uom || "kg"} /></td>
                      <td className="hidden whitespace-nowrap lg:table-cell text-muted-foreground">{row.first_shortage_bucket || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">{materials.length ? "No material matches this filter." : "No open-order material requirement in this plant."}</p>}
        </section>

        <div className="space-y-4">
          <section className="erp-panel rounded-xl p-4">
            <h3 className="mb-3 text-[14.5px] font-semibold tracking-tight">Material status</h3>
            <Donut centerLabel="materials" slices={[
              { label: "In stock", value: counts.covered || 0, color: "hsl(var(--chart-7))" },
              { label: "Covered by POs", value: counts.on_order || 0, color: "hsl(var(--chart-2))" },
              { label: "Short", value: counts.short || 0, color: "hsl(var(--chart-5))" },
              { label: "Unmapped lines", value: Number(coverage.unknown_line_count || 0), color: "hsl(var(--chart-6))" },
            ]} />
          </section>
          <section className="erp-panel rounded-xl p-4">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Info className="h-4 w-4 text-muted-foreground" />How this is calculated</h3>
            <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">{coverage.measure_set ? `Demand: ${coverage.measure_set.demand}. Available: ${coverage.measure_set.available}.` : "Remaining open-order quantity expanded through approved recipes, against unrestricted stock."} Reorder levels are a separate view and aren&apos;t mixed in.</p>
          </section>
        </div>
      </div>

      {unknown.length ? (
        <section id="unmapped" className="erp-panel overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3"><AlertTriangle className="h-4 w-4 text-signal-amber-ink" /><h3 className="text-[14px] font-semibold">Lines that need a recipe or paper mapping</h3></div>
          <div className="overflow-x-auto"><table className="tube-grid"><thead><tr><th>Order</th><th>Product</th><th className="num">Remaining pcs</th><th>What&apos;s missing</th></tr></thead><tbody>{unknown.map((row: any, index: number) => <tr key={`${row.order_no}-${index}`}><td>{row.order_no}</td><td>{row.product_code}</td><td className="num">{num(row.remaining_qty)}</td><td className="text-signal-amber-ink">{row.reason}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}
    </div>
  )
}

function ReorderView() {
  const balancesQuery = useInventoryBalances()
  const valuationQuery = useInventoryValuationSummary()
  const agingQuery = useInventoryAging()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("action")
  const deferred = useDeferredValue(search.trim().toLowerCase())
  const rows = useMemo(() => {
    const valuation = rowsOf(valuationQuery.data)
    const source = valuation.length ? valuation : rowsOf(balancesQuery.data)
    return source.map(recommendationFor).filter((row: any) => ["RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKING", "UNKNOWN"].includes(row.type))
  }, [balancesQuery.data, valuationQuery.data])
  const counts = rows.reduce((acc: Record<string, number>, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc }, {})
  const action = rows.filter((row: any) => row.shortage > 0)
  const poValue = action.reduce((sum: number, row: any) => sum + row.po_value, 0)
  const slow: any[] = Array.isArray(agingQuery.data?.slow_rows) ? agingQuery.data.slow_rows : []
  const visible = rows
    .filter((row: any) => filter === "all" || (filter === "action" ? row.shortage > 0 : row.status === filter))
    .filter((row: any) => !deferred || String(row.item_label).toLowerCase().includes(deferred))
    .sort((a: any, b: any) => ({ URGENT: 0, WARNING: 1, MISSING_POLICY: 2, OK: 3 } as any)[a.status] - ({ URGENT: 0, WARNING: 1, MISSING_POLICY: 2, OK: 3 } as any)[b.status] || b.shortage - a.shortage)

  if (balancesQuery.isLoading && valuationQuery.isLoading) return <LoadingState label="Reading stock balances and reorder policies…" />

  return (
    <div className="space-y-4" data-testid="mrp-reorder-policy-view">
      {(balancesQuery.isError || valuationQuery.isError) ? <ErrorState message="Some stock data could not be loaded. Values shown may be incomplete — not zero." /> : null}
      <section className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Below safety stock" value={num(counts.URGENT || 0)} detail="Order now" icon={ShieldAlert} tone={counts.URGENT ? "rose" : "emerald"} />
        <MetricCard label="Below reorder level" value={num(counts.WARNING || 0)} detail="Order soon" icon={PackageSearch} tone={counts.WARNING ? "amber" : "emerald"} />
        <MetricCard label="Suggested buy value" value={inr(poValue)} detail="Estimate from policy quantities" icon={FilePlus2} tone="cyan" />
        <MetricCard label="Stock value" value={valuationQuery.isSuccess ? inr(Number(valuationQuery.data?.totals?.inventory_value ?? 0)) : "—"} detail="Current value in scope" icon={Warehouse} tone="violet" />
        <MetricCard label="Missing policy" value={num(counts.MISSING_POLICY || 0)} detail="Set reorder level and lead days" icon={ClipboardCheck} tone={counts.MISSING_POLICY ? "amber" : "slate"} href="/inventory/stock-alert-policies" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="erp-panel min-w-0 overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div><h3 className="text-[14.5px] font-semibold tracking-tight">Stock against reorder targets</h3><p className="text-[12.5px] text-muted-foreground">Reorder level + safety stock from the item master; the marker is the target.</p></div>
            <Link href="/purchase/new" className="erp-btn-primary !h-8"><FilePlus2 className="h-3.5 w-3.5" />Create PO</Link>
          </div>
          <div className="mt-3"><Toolbar search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} filters={[["action", "Needs buying", action.length], ["URGENT", "Urgent", counts.URGENT || 0], ["MISSING_POLICY", "No policy", counts.MISSING_POLICY || 0], ["all", "All", rows.length]]} /></div>
          {visible.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="tube-grid">
                <thead><tr><th>Material</th><th className="num">In stock</th><th className="num">Target</th><th>Level</th><th className="num">Suggested buy</th><th className="num hidden md:table-cell">Lead</th><th>Status</th></tr></thead>
                <tbody>
                  {visible.map((row: any) => (
                    <tr key={row.item_id || row.id || row.item_label}>
                      <td className="max-w-[220px]"><span className="block truncate font-medium">{row.item_label}</span><span className="text-[11.5px] text-muted-foreground">{row.type.toLowerCase().replace("_", " ")}</span></td>
                      <td className="num">{num(row.available, 1)} <span className="text-[11px] text-muted-foreground">{row.uom || ""}</span></td>
                      <td className="num">{row.status === "MISSING_POLICY" ? "—" : num(row.target, 1)}</td>
                      <td>{row.status === "MISSING_POLICY" ? <span className="text-[12px] text-muted-foreground">No policy</span> : <CoverageBar required={row.target} usable={row.available} due={0} uom={row.uom || ""} />}</td>
                      <td className="num font-semibold">{row.order_qty ? num(row.order_qty, 1) : "—"}</td>
                      <td className="num hidden md:table-cell">{row.lead_days ? `${row.lead_days}d` : "—"}</td>
                      <td><span className={cn("rounded-full border px-2 py-0.5 text-[11.5px] font-medium", row.status === "URGENT" ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : row.status === "WARNING" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : row.status === "OK" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : "border-border bg-muted text-muted-foreground")}>{row.status === "MISSING_POLICY" ? "No policy" : row.status.toLowerCase()}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-4 py-12 text-center text-[13px] text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-signal-emerald-ink" />Nothing needs buying for this filter.</p>}
        </section>

        <div className="space-y-4">
          <section className="erp-panel rounded-xl p-4">
            <h3 className="mb-3 text-[14.5px] font-semibold tracking-tight">Policy status</h3>
            <Donut centerLabel="materials" slices={[
              { label: "Healthy", value: counts.OK || 0, color: "hsl(var(--chart-7))" },
              { label: "Below reorder", value: counts.WARNING || 0, color: "hsl(var(--chart-6))" },
              { label: "Below safety", value: counts.URGENT || 0, color: "hsl(var(--chart-5))" },
              { label: "No policy", value: counts.MISSING_POLICY || 0, color: "hsl(var(--muted-foreground))" },
            ]} />
          </section>
          <section className="erp-panel rounded-xl p-4">
            <h3 className="text-[14.5px] font-semibold tracking-tight">Use slow stock first</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">Material that hasn&apos;t moved — check before buying more.</p>
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {slow.length ? slow.slice(0, 6).map((row: any, index: number) => (
                <div key={row.item_id || row.id || index} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-medium">{row.item_code || row.item_name || row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{num(row.qty_on_hand || row.available_qty, 1)} {row.uom || ""} · {row.days_since_movement || row.age_days || 0}d</span>
                </div>
              )) : <p className="px-3 py-4 text-[12.5px] text-muted-foreground">No slow-moving stock.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function MrpPageInner() {
  const { activePlant } = useAuth()
  const searchParams = useSearchParams()
  const view = searchParams.get("view") === "reorder" ? "reorder" : "demand"
  return (
    <div className="space-y-5" data-testid="mrp-analytics-page">
      <PageHeader
        badge="Material planning"
        title="MRP"
        description={`What open orders need against stock and incoming supply, and what the reorder policies say to buy — ${displayPlantScope(activePlant, "all plants")}.`}
        actions={<Tabs view={view} />}
      />
      {view === "demand" ? <DemandView /> : <ReorderView />}
    </div>
  )
}

export default function MrpAnalyticsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading MRP…" />}>
      <MrpPageInner />
    </Suspense>
  )
}
