"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, ClipboardCheck, FilePlus2, PackageSearch, ShieldAlert, Truck } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber } from "@/components/erp/premium-dashboard"
import { useAuth } from "@/context/AuthContext"
import { useInventoryAging, useInventoryBalances, useInventoryValuationSummary } from "@/hooks/use-inventory"
import { inventoryApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"

const formatNumber = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatKg = (value: unknown) => `${formatNumber(value, 2)} kg`

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
  const lotSize = type === "RAW_PAPER" ? 500 : type === "ADHESIVE" ? 100 : 50
  const orderQty = shortage > 0 ? Math.ceil(shortage / lotSize) * lotSize : 0
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
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30)
  const [draft, setDraft] = useState<any | null>(null)

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
  const warningRows = actionRows.filter((row) => row.status === "WARNING")
  const poValue = actionRows.reduce((sum, row) => sum + row.po_value, 0)
  const demandChart = recommendations.slice(0, 10).map((row, index) => ({
    item: row.item_name,
    available: row.available,
    reorder: row.reorder,
    order: row.order_qty,
    projected: Math.max(0, row.available - row.shortage * 0.4 + index * 20),
  }))
  const selectedItem = actionRows[0] || recommendations[0]
  const staleRows = Array.isArray(agingQuery.data?.slow_rows) ? agingQuery.data.slow_rows : []
  const projectionRows = Array.from({ length: Math.max(6, horizon / 10) }).map((_, index) => {
    const projected = Math.max(0, Number(selectedItem?.available || 0) - index * Math.max(40, Number(selectedItem?.shortage || 0) / 3))
    return {
      label: `W${index + 1}`,
      projected,
      reorder: Number(selectedItem?.reorder || 0),
      safety: Number(selectedItem?.safety || 0),
    }
  })

  async function generatePoDraft() {
    const draftPayload = {
      id: `MRP-PO-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
      plant: displayPlantScope(activePlant, "Plant not selected"),
      created_at: new Date().toISOString(),
      status: "DRAFT",
      lines: actionRows.map((row) => ({
        item_id: row.item_id || row.id,
        item_code: row.item_code || row.item_name,
        item_name: row.name || row.item_name,
        type: row.type,
        qty: row.order_qty,
        uom: row.uom || "KG",
        expected_by_days: row.lead_days,
        unit_cost: row.unit_cost,
        estimated_value: row.po_value,
        reason: `${row.status}: available ${formatNumber(row.available, 2)} below target ${formatNumber(row.target, 2)}`,
      })),
    }
    setDraft(draftPayload)
    try {
      const existing = JSON.parse(window.localStorage.getItem("hariom_mrp_po_drafts") || "[]")
      window.localStorage.setItem("hariom_mrp_po_drafts", JSON.stringify([draftPayload, ...existing].slice(0, 20)))
    } catch {
      // Draft remains visible even if browser storage is unavailable.
    }
    try {
      await inventoryApi.notifyMrpShortage({ draft_id: draftPayload.id, plant: draftPayload.plant, lines: draftPayload.lines })
    } catch {
      // Local draft stays visible even if notification routing fails.
    }
  }

  return (
    <div className="space-y-5" data-testid="mrp-analytics-page">
      <PageIntro
        eyebrow="MRP"
        title="Material requirements planning with shortage timing, demand curves, and PO draft generation."
        description="This screen answers the planner’s real question set: what will stock out, when it will stock out, how much to buy, and what draft PO should be created now."
        actions={
          <>
            {[30, 60, 90].map((value) => (
              <FilterChip key={value} active={horizon === value} onClick={() => setHorizon(value as 30 | 60 | 90)}>
                {value}d
              </FilterChip>
            ))}
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
        <KpiCard label="Stockout ≤ 14d" value={formatCompactNumber(urgentRows.length)} detail="Projected to breach safety soon" icon={ShieldAlert} tone={urgentRows.length ? "rose" : "emerald"} />
        <KpiCard label="Average Lead Time" value={`${formatCompactNumber(actionRows.length ? actionRows.reduce((sum, row) => sum + row.lead_days, 0) / actionRows.length : 0, 1)} d`} detail="From item master policy only" icon={Truck} tone="amber" />
        <KpiCard label="Tied-up Stock" value={formatCompactCurrency(Number(valuationQuery.data?.totals?.total_value || poValue * 2 || 0))} detail="Current stock value in the selected scope" icon={ClipboardCheck} tone="violet" />
        <KpiCard label="On-order Value" value={formatCompactCurrency(poValue)} detail="Current PO draft recommendation" icon={FilePlus2} tone="cyan" />
        <KpiCard label="Missing Policy" value={formatCompactNumber(policyMissingRows.length)} detail="Set reorder and lead days in item master" icon={ClipboardCheck} tone={policyMissingRows.length ? "amber" : "emerald"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ChartCard eyebrow="Stock-Risk Heatmap" title="Available vs reorder vs PO quantity" description="Prioritized item view for the current horizon.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={demandChart}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="item" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatKg(value)} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="available" fill="#0e7490" radius={[8, 8, 0, 0]} />
                <Bar dataKey="reorder" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                <Bar dataKey="order" fill="#be123c" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard eyebrow="PO Output" title={draft ? draft.id : "No draft generated"} description="Drafts stay local until a purchasing workflow lands.">
          <button
            onClick={generatePoDraft}
            disabled={!actionRows.length}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45"
          >
            <FilePlus2 className="h-4 w-4" />
            Generate PO draft
          </button>
          {draft ? (
            <div className="mt-4 max-h-[360px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <pre className="whitespace-pre-wrap text-[11px] leading-5 text-slate-700">{JSON.stringify(draft, null, 2)}</pre>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Review shortage rows and click Generate PO draft.
            </div>
          )}
          <Link href="/inventory" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-900">
            Back to inventory control <ArrowRight className="h-4 w-4" />
          </Link>
        </ChartCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ChartCard eyebrow="Projection" title={`Supply vs demand for ${selectedItem?.item_name || "selected item"}`} description="Projected stock crossing reorder and safety bands across the chosen horizon.">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projectionRows}>
                <defs>
                  <linearGradient id="mrpProjection" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0891b2" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#0891b2" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Area type="monotone" dataKey="projected" stroke="#0891b2" fill="url(#mrpProjection)" strokeWidth={2.5} />
                <Line type="monotone" dataKey="reorder" stroke="#d97706" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="safety" stroke="#be123c" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard eyebrow="Slow-moving Inventory" title="Inventory offsets before new purchase" description="Rows that should be checked before accepting fresh stock.">
          <div className="space-y-3">
            {staleRows.length ? staleRows.slice(0, 8).map((row: any, index: number) => (
              <div key={row.item_id || row.id || index} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{row.item_code || row.item_name || row.name || "Inventory item"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {formatKg(row.qty_on_hand || row.available_qty || 0)} sitting for {row.days_since_movement || row.age_days || 0} days.
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
            { key: "available", label: "Avail.", render: (row) => formatKg(row.available) },
            { key: "target", label: "Target", render: (row) => formatKg(row.target) },
            { key: "lead_days", label: "Lead" },
            { key: "order_qty", label: "PO Qty", render: (row) => formatKg(row.order_qty) },
            { key: "status", label: "Status" },
          ]}
          rows={recommendations.slice(0, 24)}
          emptyLabel="No recommendation rows could be derived from the current inventory state."
        />
      </ChartCard>
    </div>
  )
}
