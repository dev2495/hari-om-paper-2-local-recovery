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

const formatNumber = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatKg = (value: unknown) => `${formatNumber(value, 2)} kg`
const formatCurrency = (value: unknown) => `₹${formatNumber(value, 0)}`
const colors = ["#0e7490", "#f59e0b", "#0f766e", "#334155", "#be123c", "#7c3aed"]

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
    slate: "border-slate-200 bg-white text-slate-950",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
  }
  return (
    <div className={`rounded-[1.35rem] border px-4 py-3 shadow-sm ${toneClass[tone] || toneClass.slate}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">{label}</p>
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
    { href: "/inventory/raw-material-inward", title: "Raw material inward", copy: "Post paper, adhesive, parchment, packing lots.", icon: Warehouse },
    { href: "/inventory/reels/inward", title: "Reel inward", copy: "Scan paper reels, vendor, weight, and location.", icon: Boxes },
    { href: "/inventory/production-issue", title: "Production issue", copy: "Issue RM against job card and lot/reel truth.", icon: PackageCheck },
    { href: "/inventory/stock-control", title: "Stock close control", copy: "Opening load, closing certification, and year carry-forward.", icon: FileCheck2 },
    { href: "/purchase", title: "Purchase and GRN", copy: "Request, PO status, GRN handoff, and incoming QC.", icon: ReceiptText },
    { href: "/inventory/ledger", title: "Ledger and balances", copy: "Audit physical, reserved, available, and transactions.", icon: ClipboardCheck },
    { href: "/analytics/mrp", title: "MRP and PO drafts", copy: "Convert shortages into purchase order drafts.", icon: LineChart },
  ]

  return (
    <div className="space-y-5" data-testid="inventory-control-page">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[#07111f] p-6 text-white shadow-[0_24px_90px_rgba(15,23,42,0.18)]">
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200">Inventory control</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
              Inventory stock, locations, reels, issues, valuation, and MRP readiness.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
              Stores gets transaction screens; owner and planner get kg/value/risk views; purchasing gets shortage-to-PO draft signals.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Kpi label="Inventory value" value={formatCurrency(totalValue)} hint="RM + tracked batch valuation" tone="cyan" />
            <Kpi label="Available load" value={formatKg(totalKg)} hint={`${inventoryRows.length} stocked item rows`} tone="emerald" />
            <Kpi label="Blocked / hold" value={formatKg(blockedKg)} hint="QC hold, blocked, scrap pressure" tone={blockedKg ? "rose" : "slate"} />
            <Kpi label="Locations used" value={`${occupiedLocations}/${totalLocations}`} hint="Warehouse occupancy" tone="amber" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {actionCards.map((card) => (
          <Link key={card.href} href={card.href} className="group rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-950">{card.title}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.copy}</p>
              </div>
              <div className="rounded-2xl bg-cyan-950 p-2.5 text-white transition group-hover:bg-amber-700">
                <card.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-cyan-900">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Material split</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Stock by category and kg</h2>
            </div>
            <p className="text-xs text-slate-500">Raw paper, adhesive, parchment, FG, and packing pressure.</p>
          </div>
          <div className="mt-4 h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryRows}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="type" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any, name: string) => (name === "value" ? formatCurrency(value) : formatKg(value))} />
                <Bar dataKey="qty" fill="#0e7490" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Status split</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Usable vs blocked stock</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-[210px_minmax(0,1fr)]">
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusRows} dataKey={(row: any) => Number(row.weight_kg || row.batch_qty || 0)} nameKey="stock_status" innerRadius={50} outerRadius={82} paddingAngle={3}>
                    {statusRows.map((_: any, index: number) => <Cell key={index} fill={colors[index % colors.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatKg(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {statusRows.map((row: any, index: number) => (
                <div key={row.stock_status} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                      {row.stock_status}
                    </span>
                    <span className="text-sm font-semibold text-slate-950">{formatKg(Number(row.weight_kg || row.batch_qty || 0))}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{row.reel_count || 0} reels · {row.batch_count || 0} batches</p>
                </div>
              ))}
              {!statusRows.length ? <p className="text-sm text-slate-500">No status rows yet.</p> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Paper types</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Top paper load</h2>
          <div className="mt-4 space-y-2">
            {paperRows.map((row) => (
              <div key={row.name} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-slate-800">{row.name}</span>
                  <span className="font-semibold text-slate-950">{formatKg(row.kg)}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-cyan-800" style={{ width: `${Math.min(100, totalKg ? (row.kg / totalKg) * 100 : 0)}%` }} />
                </div>
              </div>
            ))}
            {!paperRows.length ? <p className="text-sm text-slate-500">No raw paper balances available yet.</p> : null}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Aging</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Old stock risk</h2>
          <div className="mt-4 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingBuckets}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatKg(value)} />
                <Bar dataKey="weight_kg" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-500">{staleRows.length} stale reel/batch rows above 60 days.</p>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">MRP actions</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Shortage and purchase queue</h2>
          <div className="mt-4 space-y-2">
            <Kpi label="Critical items" value={`${criticalRows.length}`} hint="At/below reorder point where configured" tone={criticalRows.length ? "rose" : "emerald"} />
            <Kpi label="Reels tracked" value={`${reels.length}`} hint="Reel records visible in current scope" tone="cyan" />
            <Kpi label="Locations" value={`${locations.length}`} hint="Created warehouse/bin locations" tone="amber" />
          </div>
          <Link href="/analytics/mrp" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
            Open MRP and generate PO drafts
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Location pressure</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Occupied bins and staging</h2>
          <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {locationRows.slice(0, 10).map((row: any) => (
              <div key={row.location_id || row.code} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-900">{row.code}</span>
                  <span className="text-slate-500">{row.purpose}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{row.warehouse} · {row.zone || "-"} / {row.bin || "-"} · {formatKg(row.weight_kg)} · {formatNumber(row.qty, 2)} qty</p>
                {Array.isArray(row.items) && row.items.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.items.slice(0, 3).map((item: any) => (
                      <span key={`${row.location_id}-${item.item_id}`} className="rounded-full border border-cyan-100 bg-white px-2 py-1 text-[10px] font-semibold text-cyan-900">
                        {item.item_code} · {Number(item.weight_kg || 0) > 0 ? formatKg(item.weight_kg) : `${formatNumber(item.qty, 2)} qty`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!locationRows.length ? <p className="text-sm text-slate-500">Create locations from System to start occupancy tracking.</p> : null}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Recent movement</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Latest ledger postings</h2>
            </div>
            <Link href="/inventory/ledger" className="text-xs font-semibold text-cyan-900">Full ledger</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Qty</th>
                  <th className="px-3 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {recentTransactions.map((txn: any) => (
                  <tr key={txn.transaction_id || txn.id}>
                    <td className="px-3 py-3 text-slate-600">{txn.date ? new Date(txn.date).toLocaleDateString("en-GB") : "-"}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{txn.type || txn.transaction_type}</td>
                    <td className="px-3 py-3">{formatNumber(txn.qty_change ?? txn.quantity, 2)}</td>
                    <td className="px-3 py-3 text-slate-600">{txn.reference || txn.external_ref || "-"}</td>
                  </tr>
                ))}
                {!recentTransactions.length ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No ledger movement yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Location-wise stock</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">All visible item load by bin</h2>
            </div>
            <Link href="/inventory/ledger" className="text-xs font-semibold text-cyan-900">Open balances</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                <tr>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Purpose</th>
                  <th className="px-3 py-3">Kg</th>
                  <th className="px-3 py-3">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {locationItemRows.slice(0, 12).map((row: any) => (
                  <tr key={`${row.location_code}-${row.item_id}`}>
                    <td className="px-3 py-3 font-semibold text-slate-900">{row.location_code}<span className="block text-xs font-normal text-slate-500">{row.warehouse}</span></td>
                    <td className="px-3 py-3 text-slate-700">{row.item_code}<span className="block text-xs text-slate-500">{row.item_name}</span></td>
                    <td className="px-3 py-3 text-slate-600">{row.purpose}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{formatKg(row.weight_kg)}</td>
                    <td className="px-3 py-3">{formatNumber(row.qty, 2)}</td>
                  </tr>
                ))}
                {!locationItemRows.length ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No location-level item load yet. Post inward with a location to populate this view.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 shadow-xl shadow-amber-900/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">Stock close logic</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Opening, alerts, and closing in one audit chain</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
            <p><b>Opening load</b> is only for go-live or year carry-forward. It posts an auditable OPENING transaction and should not be used for daily GRN.</p>
            <p><b>Daily GRN / inward</b> creates receipt batches or reels against vendor and location, then issues consume the same ledger.</p>
            <p><b>Close certification</b> freezes book stock for a period, records physical count variance, and carries certified closing into next period opening.</p>
            <p><b>Alerts</b> come from item master reorder level, safety stock, aging, blocked stock, and location pressure. Configure these in item/location masters.</p>
          </div>
          <Link href="/inventory/stock-control" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-800">
            Open stock close control <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
