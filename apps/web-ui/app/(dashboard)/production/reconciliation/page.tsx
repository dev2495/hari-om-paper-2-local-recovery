"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { productionApi } from "@/lib/api"

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatKg = (value: unknown, digits = 2) => `${numberValue(value).toFixed(digits)} kg`
const formatPct = (value: unknown) => `${numberValue(value).toFixed(2)}%`
const currentMonth = () => new Date().toISOString().slice(0, 7)

type ActualDraft = Record<string, { actual_consumed_weight_kg: string; actual_cost: string }>

export default function ReconciliationPage() {
  const queryClient = useQueryClient()
  const { activePlant } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [actualDraft, setActualDraft] = useState<ActualDraft>({})
  const [closeNotes, setCloseNotes] = useState("")
  const [model, setModel] = useState({
    paper: "107",
    adhesive: "15",
    parchment: "1.5",
    moisture: "9",
    wastage: "12",
    target: "100",
  })

  const selectedPlant = activePlant || ""
  const writeBlocked = selectedPlant.toUpperCase() === "ALL"

  const summaryQuery = useQuery({
    queryKey: ["monthly-material-summary", month, selectedPlant],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyMaterialSummary({ month })
      return data
    },
    enabled: Boolean(month),
  })

  const closeQuery = useQuery({
    queryKey: ["monthly-close-state", month, selectedPlant],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyCloseState({ month })
      return data
    },
    enabled: Boolean(month),
  })

  const importMutation = useMutation({
    mutationFn: (rows: any[]) => productionApi.importMonthlyActuals({ month, rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => productionApi.approveMonthlyClose({ month, notes: closeNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
    },
  })

  const rows = Array.isArray(summaryQuery.data?.rows) ? summaryQuery.data.rows : []
  const bridge = useMemo(() => {
    const paper = numberValue(model.paper)
    const adhesive = numberValue(model.adhesive)
    const parchment = numberValue(model.parchment)
    const moisture = numberValue(model.moisture)
    const wastage = numberValue(model.wastage)
    const target = numberValue(model.target)
    const grossWet = paper + adhesive + parchment
    const afterMoisture = grossWet * (1 - moisture / 100)
    const finalOutput = afterMoisture * (1 - wastage / 100)
    const targetWet = target / Math.max(1 - moisture / 100, 0.0001)
    const paperRequired = targetWet / Math.max(1 - wastage / 100, 0.0001) - adhesive - parchment
    return {
      grossWet,
      afterMoisture,
      finalOutput,
      variance: finalOutput - target,
      targetWet,
      paperRequired,
    }
  }, [model])

  function updateDraft(row: any, key: "actual_consumed_weight_kg" | "actual_cost", value: string) {
    const itemCode = String(row.item_code || "")
    setActualDraft((current) => ({
      ...current,
      [itemCode]: {
        actual_consumed_weight_kg: current[itemCode]?.actual_consumed_weight_kg ?? String(row.actual_month_end_consumption_kg || row.actual_consumption_kg || ""),
        actual_cost: current[itemCode]?.actual_cost ?? String(row.actual_cost || ""),
        [key]: value,
      },
    }))
  }

  function importActuals() {
    const payloadRows = rows
      .map((row: any) => {
        const itemCode = String(row.item_code || "")
        const draft = actualDraft[itemCode]
        return {
          item_code: itemCode,
          item_name: row.item_name || itemCode,
          actual_consumed_weight_kg: numberValue(draft?.actual_consumed_weight_kg ?? row.actual_month_end_consumption_kg ?? row.actual_consumption_kg),
          actual_cost: numberValue(draft?.actual_cost ?? row.actual_cost),
        }
      })
      .filter((row: any) => row.item_code)
    importMutation.mutate(payloadRows)
  }

  return (
    <div className="min-h-screen bg-[#f3f0e8] px-6 py-6 text-slate-950" data-testid="reconciliation-page">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">Month-End Reconciliation</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Material truth, variance, and rejection close</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Theoretical consumption comes from spec/job-card snapshots. Actuals are entered from stock, adhesive, parchment, and plant registers at month end.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Month
                <input
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="mt-2 h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950"
                />
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Scope</p>
                <p className="mt-1 text-sm font-black">{selectedPlant || "No plant selected"}</p>
                <p className="mt-1 text-xs text-slate-500">{writeBlocked ? "Global scope is read-only. Select one plant to import actuals." : closeQuery.data?.status || "Draft"}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-[#07111f] p-5 text-white shadow-[0_18px_70px_rgba(15,23,42,0.16)]">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200">Global Formula Bridge</p>
            <h2 className="mt-2 text-xl font-black">Paper + adhesive + parchment, then moisture and wastage.</h2>
            <p className="mt-2 text-sm text-slate-300">Use this as the month-end check model. Defaults match the working example: paper 107, adhesive 15, parchment 1.5, moisture 9%, wastage 12%.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-6">
              {[
                ["paper", "Paper"],
                ["adhesive", "Adhesive"],
                ["parchment", "Parchment"],
                ["moisture", "Moisture %"],
                ["wastage", "Wastage %"],
                ["target", "Final Output"],
              ].map(([key, label]) => (
                <label key={key} className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {label}
                  <input
                    type="number"
                    step="0.01"
                    value={(model as any)[key]}
                    onChange={(event) => setModel((current) => ({ ...current, [key]: event.target.value }))}
                    className="mt-2 h-10 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-bold text-white outline-none focus:border-cyan-200"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-5">
              <Metric label="Gross Wet" value={bridge.grossWet.toFixed(2)} dark />
              <Metric label="After Moisture" value={bridge.afterMoisture.toFixed(2)} dark />
              <Metric label="After Wastage" value={bridge.finalOutput.toFixed(2)} dark tone={Math.abs(bridge.variance) <= 1 ? "good" : "warn"} />
              <Metric label="Variance" value={`${bridge.variance >= 0 ? "+" : ""}${bridge.variance.toFixed(2)}`} dark tone={Math.abs(bridge.variance) <= 1 ? "good" : "warn"} />
              <Metric label="Paper Needed" value={bridge.paperRequired.toFixed(2)} dark />
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Monthly Totals</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="Theoretical" value={formatKg(summaryQuery.data?.total_theoretical_consumption_kg)} />
              <Metric label="Actual" value={formatKg(summaryQuery.data?.total_actual_month_end_consumption_kg)} />
              <Metric label="Variance" value={formatKg(summaryQuery.data?.total_variance_kg)} tone={Math.abs(numberValue(summaryQuery.data?.total_variance_kg)) <= 1 ? "good" : "warn"} />
              <Metric label="Variance Cost" value={`₹${numberValue(summaryQuery.data?.total_variance_cost).toFixed(2)}`} />
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Rejections are not hidden in variance. They should be entered at stage level as reject qty + reason, then stock/ledger actuals explain what was scrap, moisture, process loss, or unexplained.
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Actual Input</p>
              <h2 className="mt-1 text-xl font-black">Master-data driven monthly material close</h2>
            </div>
            <button
              type="button"
              disabled={writeBlocked || rows.length === 0 || importMutation.isPending}
              onClick={importActuals}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save Actuals
            </button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-slate-950 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Material</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Theory</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Actual kg</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Variance</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Actual Cost</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Variance %</th>
                </tr>
              </thead>
              <tbody>
                {summaryQuery.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading reconciliation rows...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No theoretical or actual material rows found for this month.</td></tr>
                ) : (
                  rows.map((row: any) => {
                    const itemCode = String(row.item_code || "")
                    const draft = actualDraft[itemCode]
                    return (
                      <tr key={itemCode} className="border-t border-slate-200">
                        <td className="px-4 py-3">
                          <div className="font-black text-slate-950">{itemCode}</div>
                          <div className="text-xs text-slate-500">{row.item_name || row.item_type || "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatKg(row.theoretical_consumption_kg)}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            step="0.001"
                            value={draft?.actual_consumed_weight_kg ?? String(row.actual_month_end_consumption_kg || row.actual_consumption_kg || "")}
                            onChange={(event) => updateDraft(row, "actual_consumed_weight_kg", event.target.value)}
                            className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-right font-semibold"
                          />
                        </td>
                        <td className={`px-4 py-3 text-right font-black ${Math.abs(numberValue(row.variance_kg)) <= 1 ? "text-emerald-700" : "text-amber-700"}`}>{formatKg(row.variance_kg)}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={draft?.actual_cost ?? String(row.actual_cost || "")}
                            onChange={(event) => updateDraft(row, "actual_cost", event.target.value)}
                            className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-right font-semibold"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatPct(row.variance_percent)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <input
              value={closeNotes}
              onChange={(event) => setCloseNotes(event.target.value)}
              placeholder="Close notes, rejection explanation, stock adjustment reference..."
              className="h-12 min-w-[280px] flex-1 rounded-2xl border border-slate-200 px-4 text-sm"
            />
            <button
              type="button"
              disabled={writeBlocked || approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
              className="rounded-2xl border border-slate-950 px-5 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve Month Close
            </button>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          {[
            ["Winder", "Reject bamboo count + reason at winder stage. Link reel issue ids so paper loss is traceable."],
            ["Oven", "Capture bamboo in/out, wet/dry weights, pre/post moisture, and oven rejects."],
            ["Process", "Capture total qty, reject qty, notch/dimension defects, and reason code before packing."],
            ["Month Close", "Import physical stock actuals. Variance = actual - theory after known rejects, moisture, and wastage are visible."],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value, dark = false, tone }: { label: string; value: string; dark?: boolean; tone?: "good" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : dark ? "text-white" : "text-slate-950"
  return (
    <div className={`rounded-2xl border px-4 py-3 ${dark ? "border-white/10 bg-white/10" : "border-slate-200 bg-slate-50"}`}>
      <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${dark ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-2 text-xl font-black ${toneClass}`}>{value}</p>
    </div>
  )
}
