"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowRight, ClipboardCheck, FilePlus2, PackageSearch, ShieldAlert, Truck } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
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

export default function MrpAnalyticsPage() {
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
    <div className="space-y-5" data-testid="mrp-analytics-page">
      {(balancesQuery.isError || valuationQuery.isError || agingQuery.isError) && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900">Some inventory data could not be loaded. Values marked unavailable must not be treated as zero. Refresh to retry.</p>}
      <PageIntro
        eyebrow="MRP"
        title="Material reorder review"
        description="Current stock compared with item reorder and safety policies. Review supplier commitments and actual demand before creating a purchase order."
        actions={
          <>
            <FilterChip>{displayPlantScope(activePlant, "No plant selected")}</FilterChip>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">Selected PO value</p>
              <p className="mt-2 text-2xl font-semibold">{formatCompactCurrency(poValue)}</p>
            </div>
            <div className="rounded-[1.15rem] border border-white/10 bg-white/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">Urgent lines</p>
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
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="item" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatNumber(value, 2)} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="available" fill="#0e7490" radius={[8, 8, 0, 0]} />
                <Bar dataKey="reorder" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                <Bar dataKey="order" fill="#be123c" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard eyebrow="Purchase orders" title="Create a saved purchase order" description="Select a supplier and review quantities in the purchasing workspace. Saved orders are shared with the team and follow approval controls.">
          <Link href="/purchase" className="inline-flex rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white">Open purchasing →</Link>
          <p className="mt-4 text-sm text-slate-600">Reorder suggestions are not committed orders. Missing policy means a recommendation cannot be calculated.</p>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Planning coverage" title="Demand forecast unavailable" description="This release checks reorder policy against current balances.">
          <p className="text-sm leading-6 text-slate-600">Date-based stockout forecasts require approved demand, material recipes, scheduled receipts, and consumption history. No forecast is shown until these sources are connected.</p>
        </ChartCard>

        <ChartCard eyebrow="Slow-moving Inventory" title="Inventory offsets before new purchase" description="Rows that should be checked before accepting fresh stock.">
          <div className="space-y-3">
            {staleRows.length ? staleRows.slice(0, 8).map((row: any, index: number) => (
              <div key={row.item_id || row.id || index} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{row.item_code || row.item_name || row.name || "Inventory item"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {`${formatNumber(row.qty_on_hand || row.available_qty || 0, 2)} ${row.uom || "units"}`} sitting for {row.days_since_movement || row.age_days || 0} days.
                </p>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No stale inventory rows were returned.
              </div>
            )}
          </div>
        </ChartCard>
      </section>

      <ChartCard eyebrow="Recommendations" title="Material recommendation table" description="Purchase candidates based on current inventory and implied target stock.">
        <CompactTable
          columns={[
            { key: "item_name", label: "Item" },
            { key: "type", label: "Type" },
            { key: "available", label: "Avail.", render: (row) => `${formatNumber(row.available, 2)} ${row.uom || "units"}` },
            { key: "target", label: "Target", render: (row) => `${formatNumber(row.target, 2)} ${row.uom || "units"}` },
            { key: "lead_days", label: "Lead" },
            { key: "order_qty", label: "PO Qty", render: (row) => `${formatNumber(row.order_qty, 2)} ${row.uom || "units"}` },
            { key: "status", label: "Status" },
          ]}
          rows={recommendations.slice(0, 24)}
          emptyLabel="No recommendation rows could be derived from the current inventory state."
        />
      </ChartCard>
    </div>
  )
}
