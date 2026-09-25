"use client"

import { Suspense, useMemo } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowRight, ClipboardCheck, FilePlus2, PackageSearch, ShieldAlert, Truck } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { useMrpCoverage } from "@/hooks/use-analytics"
import { useInventoryAging, useInventoryBalances, useInventoryValuationSummary } from "@/hooks/use-inventory"
import { displayPlantScope } from "@/lib/plant-scope"

const formatNumber = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

function normalizeRows(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

function availableQty(row: any) {
  return Number(row.available_qty ?? row.balance ?? row.qty_on_hand ?? row.qty_available ?? 0)
}

function reorderLevel(row: any) {
  const explicit = Number(row.reorder_level ?? row.min_qty ?? row.min_level ?? 0)
  return explicit > 0 ? explicit : 0
}

function safetyStock(row: any) {
  const explicit = Number(row.safety_stock ?? row.safety_qty ?? 0)
  return explicit > 0 ? explicit : 0
}

function leadDays(row: any) {
  const explicit = Number(row.lead_time_days ?? row.supplier_lead_days ?? 0)
  return explicit > 0 ? explicit : 0
}

function itemName(row: any) {
  return row.item_code || row.name || row.item_name || row.code || String(row.item_id || row.id || "").slice(0, 8)
}

function itemType(row: any) {
  return String(row.type || row.category || "UNKNOWN").toUpperCase()
}

function recommendationFor(row: any) {
  const available = availableQty(row)
  const reorder = reorderLevel(row)
  const safety = safetyStock(row)
  const lead_days = leadDays(row)
  const missingPolicy = reorder <= 0 || lead_days <= 0
  const target = Math.max(reorder + safety, reorder)
  const shortage = missingPolicy ? 0 : Math.max(0, target - available)
  const type = itemType(row)
  const lotSize = Math.max(0, Number(row.purchase_lot_size || 0))
  const orderQty = shortage > 0 ? (lotSize > 0 ? Math.ceil(shortage / lotSize) * lotSize : shortage) : 0
  const unitCost = Number(row.unit_cost ?? row.avg_rate ?? row.rate ?? 0)
  const status = missingPolicy ? "MISSING_POLICY" : shortage <= 0 ? "OK" : available <= safety ? "URGENT" : "WARNING"
  return {
    ...row,
    item_name: itemName(row),
    type,
    available,
    reorder,
    safety,
    target,
    shortage,
    order_qty: orderQty,
    unit_cost: unitCost,
    po_value: orderQty * unitCost,
    lead_days,
    policy_missing: missingPolicy,
    status,
  }
}

function ViewSwitcher({ view }: { view: "reorder" | "demand" }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="mrp-view-switcher">
      <Link
        href="/analytics/mrp?view=reorder"
        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${
          view === "reorder" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
        }`}
      >
        Reorder policy
      </Link>
      <Link
        href="/analytics/mrp?view=demand"
        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${
          view === "demand" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
        }`}
      >
        Demand / BOM coverage
      </Link>
    </div>
  )
}

function ReorderPolicyView() {
  const { activePlant } = useAuth()
  const balancesQuery = useInventoryBalances()
  const valuationQuery = useInventoryValuationSummary()
  const agingQuery = useInventoryAging()

  const inventoryRows = useMemo(() => {
    const valuationRows = normalizeRows(valuationQuery.data)
    const balanceRows = normalizeRows(balancesQuery.data)
    return valuationRows.length ? valuationRows : balanceRows
  }, [balancesQuery.data, valuationQuery.data])

  const recommendations = useMemo(
    () =>
      inventoryRows
        .map(recommendationFor)
        .filter((row) => ["RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKING", "UNKNOWN"].includes(row.type))
        .sort((left, right) => {
          const order = { URGENT: 0, WARNING: 1, OK: 2 } as Record<string, number>
          return (order[left.status] ?? 9) - (order[right.status] ?? 9) || right.shortage - left.shortage
        }),
    [inventoryRows],
  )

  const actionRows = recommendations.filter((row) => row.shortage > 0)
  const policyMissingRows = recommendations.filter((row) => row.policy_missing)
  const urgentRows = actionRows.filter((row) => row.status === "URGENT")
  const poValue = actionRows.reduce((sum, row) => sum + row.po_value, 0)
  const demandChart = recommendations.slice(0, 10).map((row) => ({
    item: row.item_name,
    available: row.available,
    reorder: row.reorder,
    order: row.order_qty,
  }))
  const staleRows = Array.isArray(agingQuery.data?.slow_rows) ? agingQuery.data.slow_rows : []

  return (
    <div className="space-y-5" data-testid="mrp-reorder-policy-view">
      {(balancesQuery.isError || valuationQuery.isError || agingQuery.isError) && <p role="alert" className="rounded-xl bg-signal-rose-soft p-4 text-signal-rose-ink">Some inventory data could not be loaded. Values marked unavailable must not be treated as zero. Refresh to retry.</p>}
      <PageIntro
        eyebrow="MRP · Reorder policy"
        title="Reorder policy review"
        description="Current stock compared with item reorder and safety policies only. This is not demand-driven BOM coverage. Open the Demand / BOM coverage view for pending sales-order material requirements."
        actions={
          <>
            <FilterChip>{displayPlantScope(activePlant, "No plant selected")}</FilterChip>
            <ViewSwitcher view="reorder" />
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selected PO value</p>
              <p className="mt-2 text-2xl font-semibold">{formatCompactCurrency(poValue)}</p>
            </div>
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Urgent lines</p>
              <p className="mt-2 text-2xl font-semibold">{formatCompactNumber(urgentRows.length)}</p>
            </div>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="At-risk Items" value={formatCompactNumber(actionRows.length)} detail="Need replenishment or deliberate acceptance of risk" icon={PackageSearch} tone={actionRows.length ? "rose" : "emerald"} />
        <KpiCard label="Below safety stock" value={formatCompactNumber(urgentRows.length)} detail="Current balance is at or below configured safety stock" icon={ShieldAlert} tone={urgentRows.length ? "rose" : "emerald"} />
        <KpiCard label="Average Lead Time" value={`${formatCompactNumber(actionRows.length ? actionRows.reduce((sum, row) => sum + row.lead_days, 0) / actionRows.length : 0, 1)} d`} detail="From item master policy only" icon={Truck} tone="amber" />
        <KpiCard label="Tied-up Stock" value={valuationQuery.isSuccess ? formatCompactCurrency(Number(valuationQuery.data?.totals?.inventory_value ?? 0)) : "Unavailable"} detail="Current stock value in the selected scope" icon={ClipboardCheck} tone="violet" />
        <KpiCard label="Suggested purchase value" value={formatCompactCurrency(poValue)} detail="Estimate only; no purchase order has been placed" icon={FilePlus2} tone="cyan" />
        <KpiCard label="Missing Policy" value={formatCompactNumber(policyMissingRows.length)} detail="Set reorder and lead days in item master" icon={ClipboardCheck} tone={policyMissingRows.length ? "amber" : "emerald"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ChartCard eyebrow="Stock-Risk Heatmap" title="Available vs reorder vs PO quantity" description="Current balances and configured reorder quantities by item. Check each item’s unit in the table.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={demandChart}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="item" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatNumber(value, 2)} contentStyle={{ borderRadius: 14, border: "1px solid hsl(var(--chart-grid))" }} />
                <Bar dataKey="available" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="reorder" fill="hsl(var(--chart-6))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="order" fill="hsl(var(--chart-5))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard eyebrow="Purchase orders" title="Create a saved purchase order" description="Select a supplier and review quantities in the purchasing workspace. Saved orders are shared with the team and follow approval controls.">
          <Link href="/purchase" className="inline-flex rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Open purchasing →</Link>
          <p className="mt-4 text-sm text-muted-foreground">Reorder suggestions are not committed orders and are not demand-driven shortages. Missing policy means a recommendation cannot be calculated.</p>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Planning coverage" title="This view does not compute sales-order demand" description="Reorder policy compared with current balances. Demand/BOM coverage is a separate view.">
          <p className="text-sm leading-6 text-muted-foreground">Pending-order material requirements are expanded from canonical recipes in the Demand / BOM coverage view. They are not mixed into these reorder numbers.</p>
          <Link href="/analytics/mrp?view=demand" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-signal-cyan-ink">
            Open demand / BOM coverage <ArrowRight className="h-4 w-4" />
          </Link>
        </ChartCard>

        <ChartCard eyebrow="Slow-moving Inventory" title="Inventory offsets before new purchase" description="Rows that should be checked before accepting fresh stock.">
          <div className="space-y-3">
            {staleRows.length ? staleRows.slice(0, 8).map((row: any, index: number) => (
              <div key={row.item_id || row.id || index} className="rounded-2xl border border-border bg-muted px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{row.item_code || row.item_name || row.name || "Inventory item"}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {`${formatNumber(row.qty_on_hand || row.available_qty || 0, 2)} ${row.uom || "units"}`} sitting for {row.days_since_movement || row.age_days || 0} days.
                </p>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
                No stale inventory rows were returned.
              </div>
            )}
          </div>
        </ChartCard>
      </section>

      <ChartCard eyebrow="Reorder policy table" title="Material recommendation table" description="Purchase candidates based on current inventory and item-master reorder targets. These numbers are not BOM shortfalls.">
        <CompactTable
          columns={[
            { key: "item_name", label: "Item" },
            { key: "type", label: "Type" },
            { key: "available", label: "Avail.", render: (row) => `${formatNumber(row.available, 2)} ${row.uom || "units"}` },
            { key: "target", label: "Reorder target", render: (row) => `${formatNumber(row.target, 2)} ${row.uom || "units"}` },
            { key: "lead_days", label: "Lead" },
            { key: "order_qty", label: "Policy qty", render: (row) => `${formatNumber(row.order_qty, 2)} ${row.uom || "units"}` },
            { key: "status", label: "Status" },
          ]}
          rows={recommendations.slice(0, 24)}
          emptyLabel="No recommendation rows could be derived from the current inventory state."
        />
      </ChartCard>
    </div>
  )
}

function DemandCoverageView() {
  const { activePlant } = useAuth()
  const coverageQuery = useMrpCoverage(activePlant || undefined)
  const coverage = coverageQuery.data || {}
  const materials = Array.isArray(coverage.materials) ? coverage.materials : []
  const demandSource = coverage.demand_source || {}
  const chartRows = materials.slice(0, 10).map((row: any) => ({
    item: row.item_code || row.label,
    required: Number(row.remaining_requirement_qty || 0),
    usable: Number(row.usable_qty || 0),
    shortfall: Number(row.shortfall_qty || 0),
  }))
  const shortfallRows = materials.filter((row: any) => Number(row.shortfall_qty || 0) > 0)
  const unknownCount = Number(coverage.unknown_line_count || 0)
  const completeness = String(coverage.completeness || "UNKNOWN")

  return (
    <div className="space-y-5" data-testid="mrp-demand-coverage-view">
      {coverageQuery.isError ? (
        <p role="alert" className="rounded-xl bg-signal-rose-soft p-4 text-signal-rose-ink">
          Demand/BOM coverage could not be loaded. Missing coverage is not a zero shortfall.
        </p>
      ) : null}
      <PageIntro
        eyebrow="MRP · Demand / BOM coverage"
        title="Pending-order material coverage"
        description="Gross remaining demand from every in-scope open sales line, expanded from canonical approved recipes. Usable stock is read from the inventory ledger. Reorder policy is shown for comparison and is not mixed into shortfall."
        actions={
          <>
            <FilterChip>{displayPlantScope(activePlant, "No plant selected")}</FilterChip>
            <ViewSwitcher view="demand" />
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Open sales lines</p>
              <p className="mt-2 text-2xl font-semibold">{formatCompactNumber(demandSource.total_open_lines || 0)}</p>
            </div>
            <div className="rounded-[1.15rem] border border-border/10 bg-card/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Coverage state</p>
              <p className="mt-2 text-2xl font-semibold">{completeness}</p>
            </div>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Open sales lines" value={formatCompactNumber(demandSource.total_open_lines || 0)} detail="All open lines, not the first sales page" icon={ClipboardCheck} tone="cyan" />
        <KpiCard label="Materials with shortfall" value={formatCompactNumber(shortfallRows.length)} detail="Remaining BOM requirement minus usable stock" icon={PackageSearch} tone={shortfallRows.length ? "rose" : "emerald"} />
        <KpiCard label="Unknown / unmapped lines" value={formatCompactNumber(unknownCount)} detail="Incomplete recipe or identity mapping — not treated as zero" icon={ShieldAlert} tone={unknownCount ? "amber" : "emerald"} />
      </section>

      <section className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        {(coverage.notes || []).join(" ")}
        {coverage.measure_set ? (
          <span className="mt-2 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Demand: {coverage.measure_set.demand}. Available: {coverage.measure_set.available}. Reorder policy is a separate measure.
          </span>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ChartCard eyebrow="Time-phased coverage" title="Required vs usable vs shortfall" description="Canonical BOM expansion versus unrestricted usable stock. Reorder levels are not plotted here.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="item" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatNumber(value, 2)} contentStyle={{ borderRadius: 14, border: "1px solid hsl(var(--chart-grid))" }} />
                <Bar dataKey="required" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="usable" fill="hsl(var(--chart-7))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="shortfall" fill="hsl(var(--chart-5))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard eyebrow="Purchase" title="Supplier commitments stay on Purchase" description="A calendar entry is a commitment, not a stock transaction. Create or receive POs in Purchase.">
          <Link href="/purchase" className="inline-flex rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Open purchasing →</Link>
          <p className="mt-4 text-sm text-muted-foreground">Open PO remainder is shown as supply due on each material row. It is not added into usable stock.</p>
        </ChartCard>
      </section>

      <ChartCard eyebrow="Material coverage panel" title="Required vs available vs shortfall by material" description="Each row keeps demand, usable stock, QC-held, supply due, and reorder policy as separate fields.">
        <CompactTable
          columns={[
            { key: "label", label: "Material", render: (row) => `${row.item_code || row.label || "-"}` },
            { key: "remaining_requirement_qty", label: "Required", render: (row) => `${formatNumber(row.remaining_requirement_qty, 2)} ${row.uom || "KG"}` },
            { key: "usable_qty", label: "Usable", render: (row) => `${formatNumber(row.usable_qty, 2)} ${row.uom || "KG"}` },
            { key: "qc_held_qty", label: "QC-held", render: (row) => `${formatNumber(row.qc_held_qty, 2)}` },
            { key: "supply_due_qty", label: "Supply due", render: (row) => `${formatNumber(row.supply_due_qty, 2)}` },
            { key: "shortfall_qty", label: "Shortfall", render: (row) => `${formatNumber(row.shortfall_qty, 2)}` },
            { key: "reorder_level", label: "Reorder (policy)", render: (row) => `${formatNumber(row.reorder_policy?.reorder_level, 2)}` },
            { key: "first_shortage_bucket", label: "First short week", render: (row) => row.first_shortage_bucket || "—" },
            { key: "confidence", label: "State" },
          ]}
          rows={materials}
          emptyLabel="No coverage rows yet. Confirm open sales lines and approved recipes exist in this plant."
        />
      </ChartCard>

      {unknownCount > 0 ? (
        <ChartCard eyebrow="Needs mapping" title="Lines that are not treated as zero demand" description="Incomplete recipe, missing length, or unmapped paper identity.">
          <CompactTable
            columns={[
              { key: "order_no", label: "Order" },
              { key: "product_code", label: "Product" },
              { key: "remaining_qty", label: "Remaining pcs", render: (row) => formatNumber(row.remaining_qty, 0) },
              { key: "reason", label: "Reason" },
            ]}
            rows={coverage.unknown_or_unmapped_lines || []}
            emptyLabel="No unknown lines."
          />
        </ChartCard>
      ) : null}
    </div>
  )
}

function MrpAnalyticsPageInner() {
  const searchParams = useSearchParams()
  const view = searchParams.get("view") === "demand" ? "demand" : "reorder"
  return (
    <div className="space-y-5" data-testid="mrp-analytics-page">
      {view === "demand" ? <DemandCoverageView /> : <ReorderPolicyView />}
    </div>
  )
}

export default function MrpAnalyticsPage() {
  return (
    <Suspense fallback={<div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading MRP views…</div>}>
      <MrpAnalyticsPageInner />
    </Suspense>
  )
}
