"use client"

import Link from "next/link"
import { ArrowRight, Boxes, ClipboardCheck, FileCheck2, LineChart, PackageCheck, ReceiptText, Warehouse } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import {
  useInventoryAging,
  useInventoryBalances,
  useInventoryLocationOccupancy,
  useInventoryLocations,
  useInventoryStatusSummary,
  useInventoryTransactions,
  useInventoryValuationSummary,
  useReels,
} from "@/hooks/use-inventory"
import { PageHeader } from "@/components/workspace/page-header"
import { MetricCard, MetricRail } from "@/components/erp/shell"
import { Donut } from "@/components/erp/viz"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

const formatNumber = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatKg = (value: unknown) => `${formatNumber(value, 2)} kg`
const formatCurrency = (value: unknown) => `₹${formatNumber(value, 0)}`
const colors = ["hsl(var(--chart-1))", "hsl(var(--chart-6))", "hsl(var(--chart-1))", "hsl(var(--muted-foreground))", "hsl(var(--chart-5))", "hsl(var(--chart-3))"]

function rowQty(row: any) {
  return Number(row.available_qty ?? row.balance ?? row.qty_on_hand ?? row.qty_available ?? 0)
}

function rowValue(row: any) {
  const qty = rowQty(row)
  const unitCost = Number(row.unit_cost ?? row.avg_rate ?? row.rate ?? row.price ?? 0)
  return Number(row.inventory_value ?? qty * unitCost)
}

function itemType(row: any) {
  return String(row.type || row.category || "UNKNOWN").toUpperCase()
}

function normalizeRows(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

function Kpi({ label, value, hint, tone = "slate" }: { label: string; value: string; hint: string; tone?: string }) {
  const toneClass: Record<string, string> = {
    slate: "border-border bg-card text-foreground",
    cyan: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
    amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    rose: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
  }
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${toneClass[tone] || toneClass.slate}`}>
      <p className="text-[11.5px] font-semibold opacity-60">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-xs leading-5 opacity-70">{hint}</p>
    </div>
  )
}

export default function InventoryOverviewPage() {
  const balancesQuery = useInventoryBalances()
  const valuationQuery = useInventoryValuationSummary()
  const statusQuery = useInventoryStatusSummary()
  const locationQuery = useInventoryLocationOccupancy()
  const agingQuery = useInventoryAging()
  const locationsQuery = useInventoryLocations()
  const transactionsQuery = useInventoryTransactions()
  const reelsQuery = useReels({ limit: 100 }, true)

  const balanceRows = normalizeRows(balancesQuery.data)
  const valuationRows = normalizeRows(valuationQuery.data)
  const inventoryRows = valuationRows.length ? valuationRows : balanceRows
  const statusRows = normalizeRows(statusQuery.data)
  const locationRows = normalizeRows(locationQuery.data)
  const agingBuckets = Array.isArray(agingQuery.data?.buckets) ? agingQuery.data.buckets : []
  const recentTransactions = normalizeRows(transactionsQuery.data).slice(0, 8)
  const reels = normalizeRows(reelsQuery.data)
  const locations = normalizeRows(locationsQuery.data)

  const categoryRows = Object.values(
    inventoryRows.reduce((acc: Record<string, any>, row: any) => {
      const key = itemType(row)
      const current = acc[key] || { type: key, qty: 0, value: 0, count: 0 }
      current.qty += rowQty(row)
      current.value += rowValue(row)
      current.count += 1
      acc[key] = current
      return acc
    }, {}),
  ) as any[]

  const paperRows = inventoryRows
    .filter((row: any) => itemType(row) === "RAW_PAPER" || String(row.tracking_mode || "").toUpperCase() === "REEL")
    .map((row: any) => ({
      name: row.item_code || row.name || row.item_name || "Paper",
      kg: rowQty(row),
      value: rowValue(row),
    }))
    .sort((left, right) => right.kg - left.kg)
    .slice(0, 8)

  const totalKg = inventoryRows.reduce((sum: number, row: any) => sum + rowQty(row), 0)
  const totalValue = Number(valuationQuery.data?.totals?.inventory_value) || inventoryRows.reduce((sum: number, row: any) => sum + rowValue(row), 0)
  const blockedKg = statusRows
    .filter((row: any) => ["BLOCKED", "QC_HOLD", "SCRAP"].includes(String(row.stock_status || "").toUpperCase()))
    .reduce((sum: number, row: any) => sum + Number(row.weight_kg || row.batch_qty || 0), 0)
  const occupiedLocations = Number(locationQuery.data?.summary?.occupied_locations || 0)
  const totalLocations = Number(locationQuery.data?.summary?.total_locations || locations.length || 0)
  const criticalRows = inventoryRows.filter((row: any) => {
    const min = Number(row.min_qty ?? row.reorder_level ?? row.min_level ?? 0)
    return min > 0 && rowQty(row) <= min
  })
  const staleRows = Array.isArray(agingQuery.data?.slow_rows) ? agingQuery.data.slow_rows : []
  const locationItemRows = locationRows.flatMap((location: any) =>
    (Array.isArray(location.items) ? location.items : []).map((item: any) => ({
      ...item,
      location_code: location.code,
      warehouse: location.warehouse,
      purpose: location.purpose,
      load_kg: Number(item.weight_kg || 0),
      qty_pcs: Number(item.qty || 0),
    })),
  ).sort((left: any, right: any) => right.load_kg - left.load_kg)

  const actionCards = [
    { href: "/purchase/inward", title: "Goods inward", copy: "Receive PO or manual paper with one AT label per reel/coil.", icon: Warehouse },
    { href: "/inventory/reels/issue", title: "Issue reel by scan", copy: "Scan a reel/coil label and issue it to winder or slitting.", icon: Boxes },
    { href: "/purchase/receipts", title: "Reprint labels", copy: "Open a GRN and reprint reel or lot QR labels.", icon: ReceiptText },
    { href: "/inventory/stock-control", title: "Scrap / adjust stock", copy: "Approved count correction or scrap discovery with reasons.", icon: FileCheck2 },
    { href: "/inventory/production-issue", title: "Production issue", copy: "Issue RM against job card and lot/reel truth.", icon: PackageCheck },

    { href: "/inventory/ledger", title: "Ledger and balances", copy: "Audit physical, reserved, available, and transactions.", icon: ClipboardCheck },
    { href: "/analytics/mrp", title: "MRP coverage", copy: "Reorder policy and demand/BOM coverage are separate views.", icon: LineChart },
  ]

  return (
    <div className="space-y-5" data-testid="inventory-control-page">
      <PageHeader
        variant="hero"
        appearance={MODULE_APPEARANCES.inventory}
        badge="Inventory control"
        title="Stock overview"
        description="Review material availability, held stock and valuation. Open a receipt, issue or stock record to take action."
      />

      <MetricRail className="xl:grid-cols-4">
        <MetricCard label="Inventory value" value={formatCurrency(totalValue)} detail="RM + tracked batch valuation" icon={Warehouse} tone="violet" href="/inventory/valuation" />
        <MetricCard label="Stock on hand" value={formatKg(totalKg)} detail={`${inventoryRows.length} stocked items`} icon={Boxes} tone="teal" href="/inventory/ledger" />
        <MetricCard label="Held / blocked" value={formatKg(blockedKg)} detail="QC hold, blocked and scrap" icon={FileCheck2} tone={blockedKg ? "rose" : "slate"} href="/quality/results" />
        <MetricCard label="Locations used" value={`${occupiedLocations}/${totalLocations}`} detail="Warehouse occupancy" icon={ClipboardCheck} tone="amber" progress={totalLocations ? (occupiedLocations / totalLocations) * 100 : null} href="/system/locations" />
      </MetricRail>

      <section className="stagger grid grid-cols-2 gap-2.5 xl:grid-cols-6" aria-label="Quick actions">
        {actionCards.map((card) => (
          <Link key={card.href + card.title} href={card.href} className="group flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--shadow-xs)] transition hover:border-primary/30 hover:shadow-[var(--shadow-premium)]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground transition-transform group-hover:scale-105"><card.icon className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{card.title}</span>
              <span className="block text-[12px] leading-5 text-muted-foreground">{card.copy}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11.5px] font-semibold text-muted-foreground">Material split</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">Stock by category and kg</h2>
            </div>
            <p className="text-xs text-muted-foreground">Raw paper, adhesive, parchment, FG, and packing pressure.</p>
          </div>
          <div className="mt-4 h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryRows}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any, name: string) => (name === "value" ? formatCurrency(value) : formatKg(value))} />
                <Bar dataKey="qty" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[11.5px] font-semibold text-muted-foreground">Status split</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Usable vs blocked stock</h2>
          <div className="mt-4">
            <Donut
              centerLabel="kg in stock"
              format={(value) => formatKg(value)}
              slices={statusRows.map((row: any, index: number) => ({ label: String(row.stock_status || "").replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), value: Number(row.weight_kg || row.batch_qty || 0), color: colors[index % colors.length] }))}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[11.5px] font-semibold text-muted-foreground">Paper types</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Top paper load</h2>
          <div className="mt-4 space-y-2">
            {paperRows.map((row) => (
              <div key={row.name} className="rounded-2xl border border-border bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-foreground">{row.name}</span>
                  <span className="font-semibold text-foreground">{formatKg(row.kg)}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, totalKg ? (row.kg / totalKg) * 100 : 0)}%` }} />
                </div>
              </div>
            ))}
            {!paperRows.length ? <p className="text-sm text-muted-foreground">No raw paper balances available yet.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[11.5px] font-semibold text-muted-foreground">Aging</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Old stock risk</h2>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingBuckets}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatKg(value)} />
                <Bar dataKey="weight_kg" fill="hsl(var(--chart-6))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{staleRows.length} stale reel/batch rows above 60 days.</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[11.5px] font-semibold text-muted-foreground">MRP actions</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Shortage and purchase queue</h2>
          <div className="mt-4 space-y-2">
            <Kpi label="Critical items" value={`${criticalRows.length}`} hint="At/below reorder point where configured" tone={criticalRows.length ? "rose" : "emerald"} />
            <Kpi label="Reels tracked" value={`${reels.length}`} hint="Reel records visible in current scope" tone="cyan" />
            <Kpi label="Locations" value={`${locations.length}`} hint="Created warehouse/bin locations" tone="amber" />
          </div>
          <Link href="/analytics/mrp" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
            Open MRP reorder and demand views
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[11.5px] font-semibold text-muted-foreground">Location pressure</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Occupied bins and staging</h2>
          <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {locationRows.slice(0, 10).map((row: any) => (
              <div key={row.location_id || row.code} className="rounded-2xl border border-border bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-foreground">{row.code}</span>
                  <span className="text-muted-foreground">{row.purpose}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{row.warehouse} · {row.zone || "-"} / {row.bin || "-"} · {formatKg(row.weight_kg)} · {formatNumber(row.qty, 2)} qty</p>
                {Array.isArray(row.items) && row.items.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.items.slice(0, 3).map((item: any) => (
                      <span key={`${row.location_id}-${item.item_id}`} className="rounded-full border border-signal-cyan-line bg-card px-2 py-1 text-[10px] font-semibold text-signal-cyan-ink">
                        {item.item_code} · {Number(item.weight_kg || 0) > 0 ? formatKg(item.weight_kg) : `${formatNumber(item.qty, 2)} qty`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!locationRows.length ? <p className="text-sm text-muted-foreground">Create locations from System to start occupancy tracking.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11.5px] font-semibold text-muted-foreground">Recent movement</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">Latest ledger postings</h2>
            </div>
            <Link href="/inventory/ledger" className="text-xs font-semibold text-signal-cyan-ink">Full ledger</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-[11.5px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Qty</th>
                  <th className="px-3 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentTransactions.map((txn: any) => (
                  <tr key={txn.transaction_id || txn.id}>
                    <td className="px-3 py-3 text-muted-foreground">{txn.date ? new Date(txn.date).toLocaleDateString("en-GB") : "-"}</td>
                    <td className="px-3 py-3 font-semibold text-foreground">{txn.type || txn.transaction_type}</td>
                    <td className="px-3 py-3">{formatNumber(txn.qty_change ?? txn.quantity, 2)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{txn.reference || txn.external_ref || "-"}</td>
                  </tr>
                ))}
                {!recentTransactions.length ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No ledger movement yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11.5px] font-semibold text-muted-foreground">Location-wise stock</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">All visible item load by bin</h2>
            </div>
            <Link href="/inventory/ledger" className="text-xs font-semibold text-signal-cyan-ink">Open balances</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-[hsl(var(--surface-2))] text-[11.5px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Purpose</th>
                  <th className="px-3 py-3">Kg</th>
                  <th className="px-3 py-3">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {locationItemRows.slice(0, 12).map((row: any) => (
                  <tr key={`${row.location_code}-${row.item_id}`}>
                    <td className="px-3 py-3 font-semibold text-foreground">{row.location_code}<span className="block text-xs font-normal text-muted-foreground">{row.warehouse}</span></td>
                    <td className="px-3 py-3 text-muted-foreground">{row.item_code}<span className="block text-xs text-muted-foreground">{row.item_name}</span></td>
                    <td className="px-3 py-3 text-muted-foreground">{row.purpose}</td>
                    <td className="px-3 py-3 font-semibold text-foreground">{formatKg(row.weight_kg)}</td>
                    <td className="px-3 py-3">{formatNumber(row.qty, 2)}</td>
                  </tr>
                ))}
                {!locationItemRows.length ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No location-level item load yet. Post inward with a location to populate this view.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft p-5 shadow-xl shadow-amber-900/5">
          <p className="text-[11.5px] font-semibold text-signal-amber-ink">Stock close logic</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Opening, alerts, and closing in one audit chain</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            <p><b>Opening load</b> is only for go-live or year carry-forward. It posts an auditable OPENING transaction and should not be used for daily GRN.</p>
            <p><b>Daily GRN / inward</b> creates receipt batches or reels against vendor and location, then issues consume the same ledger.</p>
            <p><b>Close certification</b> freezes book stock for a period, records physical count variance, and carries certified closing into next period opening.</p>
            <p><b>Alerts</b> come from item master reorder level, safety stock, aging, blocked stock, and location pressure. Configure these in item/location masters.</p>
          </div>
          <Link href="/inventory/stock-control" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-amber-800">
            Open stock close control <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
