"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import dayjs from "dayjs"
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  History,
  LockKeyhole,
  Scale,
  Search,
  Sigma,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/context/AuthContext"
import { productionApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"
import { computeReconciliationBridge } from "@/lib/reconciliation-math"

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatKg = (value: unknown, digits = 2) => `${numberValue(value).toFixed(digits)} kg`
const formatPct = (value: unknown) => `${numberValue(value).toFixed(2)}%`
const formatCurrency = (value: unknown) => `₹${numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const currentMonth = () => new Date().toISOString().slice(0, 7)

type ActualDraft = Record<string, { actual_consumed_weight_kg: string; actual_cost: string }>

const TAB_COPY = {
  workspace: "Close workspace",
  actuals: "Actual entry",
  history: "Close history",
} as const

export default function ReconciliationPage() {
  const queryClient = useQueryClient()
  const { activePlant } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [activeTab, setActiveTab] = useState<keyof typeof TAB_COPY>("workspace")
  const [actualDraft, setActualDraft] = useState<ActualDraft>({})
  const [closeNotes, setCloseNotes] = useState("")
  const [rowSearch, setRowSearch] = useState("")
  const [varianceFilter, setVarianceFilter] = useState("ALL")
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
      const { data } = await productionApi.getMonthlyMaterialSummary({ month, plant_id: selectedPlant })
      return data
    },
    enabled: Boolean(month),
  })

  const closeQuery = useQuery({
    queryKey: ["monthly-close-state", month, selectedPlant],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyCloseState({ month, plant_id: selectedPlant })
      return data
    },
    enabled: Boolean(month),
  })

  const historyQuery = useQuery({
    queryKey: ["monthly-close-history", selectedPlant],
    queryFn: async () => {
      const { data } = await productionApi.getMonthlyCloseHistory({ limit: 12, plant_id: selectedPlant })
      return data
    },
  })

  const importMutation = useMutation({
    mutationFn: (rows: any[]) => productionApi.importMonthlyActuals({ month, rows }, selectedPlant),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-history"] })
      setActiveTab("workspace")
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => productionApi.approveMonthlyClose({ month, notes: closeNotes }, selectedPlant),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-material-summary"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-state"] })
      queryClient.invalidateQueries({ queryKey: ["monthly-close-history"] })
    },
  })

  const rows = useMemo(
    () => (Array.isArray(summaryQuery.data?.rows) ? summaryQuery.data.rows : []),
    [summaryQuery.data?.rows],
  )
  const closeStatus = String(closeQuery.data?.status || (writeBlocked ? "READ_ONLY_ALL" : "DRAFT")).toUpperCase()
  const isLocked = closeStatus === "APPROVED"
  const hasSavedActuals = Number(closeQuery.data?.imported_rows_count || 0) > 0
  const totalVarianceKg = numberValue(summaryQuery.data?.total_variance_kg)
  const varianceRows = rows.filter((row: any) => Math.abs(numberValue(row.variance_kg)) > 1)
  const canEditActuals = !writeBlocked && !isLocked
  const canClose =
    !writeBlocked &&
    !isLocked &&
    rows.length > 0 &&
    (!varianceRows.length || closeNotes.trim().length >= 8) &&
    !approveMutation.isPending

  const filteredRows = useMemo(() => {
    const needle = rowSearch.trim().toLowerCase()
    return rows.filter((row: any) => {
      const variance = numberValue(row.variance_kg)
      if (varianceFilter === "VARIANCE" && Math.abs(variance) <= 1) return false
      if (varianceFilter === "MATCHED" && Math.abs(variance) > 1) return false
      if (!needle) return true
      return [row.item_code, row.item_name, row.item_type, row.item_uom]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [rows, rowSearch, varianceFilter])

  const bridge = useMemo(() => {
    return computeReconciliationBridge({
      paperKg: numberValue(model.paper),
      adhesiveKg: numberValue(model.adhesive),
      parchmentKg: numberValue(model.parchment),
      moisturePercent: numberValue(model.moisture),
      wastageKg: numberValue(model.wastage),
      targetOutputKg: numberValue(model.target),
    })
  }, [model])

  function updateDraft(row: any, key: "actual_consumed_weight_kg" | "actual_cost", value: string) {
    const itemCode = String(row.item_code || "")
    setActualDraft((current) => ({
      ...current,
      [itemCode]: {
        actual_consumed_weight_kg:
          current[itemCode]?.actual_consumed_weight_kg ??
          String(row.actual_month_end_consumption_kg || row.actual_consumption_kg || ""),
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
          actual_consumed_weight_kg: numberValue(
            draft?.actual_consumed_weight_kg ?? row.actual_month_end_consumption_kg ?? row.actual_consumption_kg,
          ),
          actual_cost: numberValue(draft?.actual_cost ?? row.actual_cost),
        }
      })
      .filter((row: any) => row.item_code)
    importMutation.mutate(payloadRows)
  }

  const historyRows = Array.isArray(historyQuery.data?.rows) ? historyQuery.data.rows : []

  return (
    <div className="min-h-screen bg-[#f5f1e8] px-5 py-5 text-slate-950" data-testid="reconciliation-page">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
          <div className="grid gap-0 xl:grid-cols-[1fr_430px]">
            <div className="bg-[radial-gradient(circle_at_15%_20%,rgba(8,145,178,0.18),transparent_30%),linear-gradient(135deg,#ffffff,#f8fafc)] p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-800">
                  Production / Reconciliation
                </span>
                <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${isLocked ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                  {isLocked ? "Closed and locked" : writeBlocked ? "Global read-only" : hasSavedActuals ? "Actuals saved" : "Open month"}
                </span>
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">Month-end material close</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                The system calculates theory from job cards and spec snapshots. At month end, stores/plant enters actual consumption from registers, explains variance, and locks the month.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <FlowStep icon={Sigma} title="1. Theory" text="Auto from released job-card material snapshots." />
                <FlowStep icon={Scale} title="2. Actuals" text="Enter monthly consumed kg and cost from plant records." />
                <FlowStep icon={ClipboardCheck} title="3. Explain" text="Variance notes bridge scrap, moisture, returns, or errors." />
                <FlowStep icon={LockKeyhole} title="4. Close" text="Approval locks rows and feeds audit history." />
              </div>
            </div>
            <div className="border-l border-slate-200 bg-slate-950 p-6 text-white">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                  Reconciliation month
                  <input
                    type="month"
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                    className="mt-2 h-12 w-full rounded-2xl border border-white/15 bg-white/10 px-4 text-base font-black text-white outline-none focus:border-cyan-200"
                  />
                </label>
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Plant scope</p>
                  <p className="mt-1 text-lg font-black">{displayPlantScope(selectedPlant, "No plant selected")}</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {writeBlocked ? "Select one plant to save or close actuals." : `${closeStatus} · ${closeQuery.data?.imported_rows_count || 0} rows saved`}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-cyan-200/30 bg-cyan-300/10 px-4 py-3 text-sm leading-6 text-cyan-50">
                Open means editable. Save Actuals stores the physical/register truth for the selected month. Close Month locks the record and keeps it in history for audit.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-4">
          <KpiCard label="Expected consumption" value={formatKg(summaryQuery.data?.total_theoretical_consumption_kg)} detail="Spec paper plus 7% standard wastage for variance" tone="cyan" />
          <KpiCard label="Actual consumption" value={formatKg(summaryQuery.data?.total_actual_month_end_consumption_kg)} detail={hasSavedActuals ? "From saved month-end actual rows" : "Not saved yet"} tone="slate" />
          <KpiCard label="Variance bridge" value={formatKg(totalVarianceKg)} detail={`${varianceRows.length} row(s) need explanation`} tone={Math.abs(totalVarianceKg) <= 1 ? "emerald" : "amber"} />
          <KpiCard label="Variance cost" value={formatCurrency(summaryQuery.data?.total_variance_cost)} detail="Cost impact from actual vs theory" tone="rose" />
        </section>

        <section className="rounded-[1.8rem] border border-slate-200 bg-white p-2 shadow-[0_16px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TAB_COPY) as Array<keyof typeof TAB_COPY>).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                  activeTab === tab ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {TAB_COPY[tab]}
              </button>
            ))}
            <Link href="/inventory/stock-control" className="ml-auto inline-flex items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-black text-cyan-900">
              Stock close control <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {activeTab === "workspace" ? (
          <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-slate-950 p-3 text-white">
                  <FileCheck2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Close command</p>
                  <h2 className="mt-1 text-xl font-black">Save actuals, explain variance, then lock the month</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Closing does not create stock. It certifies production variance for the selected month. Inventory stock certification handles opening, physical count, and carry-forward.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <StateTile label="Month state" value={isLocked ? "Closed" : "Open"} text={isLocked ? "Actuals locked for audit" : "Actuals can still be edited"} good={isLocked} />
                <StateTile label="Actual records" value={String(closeQuery.data?.imported_rows_count || 0)} text={hasSavedActuals ? "Saved into monthly actual table" : "No month-end actuals saved"} good={hasSavedActuals} />
                <StateTile label="Variance rows" value={String(varianceRows.length)} text={varianceRows.length ? "Close note required" : "Within tolerance"} good={!varianceRows.length} />
                <StateTile label="Scope" value={writeBlocked ? "Read-only" : "Plant"} text={writeBlocked ? "Use one plant, not global" : "Writable plant selected"} good={!writeBlocked} />
              </div>
              <div className="mt-5 space-y-3">
                <textarea
                  value={closeNotes}
                  onChange={(event) => setCloseNotes(event.target.value)}
                  disabled={writeBlocked || isLocked}
                  placeholder="Close notes: physical stock reference, scrap/moisture reason, rejection summary, manager approval note..."
                  className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-300 disabled:bg-slate-50 disabled:text-slate-400"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canEditActuals || rows.length === 0 || importMutation.isPending}
                    onClick={importActuals}
                    className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save Actuals
                  </button>
                  <button
                    type="button"
                    disabled={!canClose}
                    onClick={() => approveMutation.mutate()}
                    className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-black text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Close Month
                  </button>
                </div>
                {varianceRows.length > 0 ? (
                  <p className="text-xs font-semibold text-amber-700">Close is enabled only after a meaningful variance explanation is entered.</p>
                ) : null}
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-[#08111f] p-5 text-white shadow-[0_18px_70px_rgba(15,23,42,0.16)]">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200">Theory formula check</p>
              <h2 className="mt-2 text-xl font-black">Paper + adhesive + parchment, moisture reduction, then process wastage</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                This bridge is a sanity calculator for the global production formula. The monthly table below still uses item-level theory from spec/job-card snapshots.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-6">
                {[
                  ["paper", "Paper"],
                  ["adhesive", "Adhesive"],
                  ["parchment", "Parchment"],
                  ["moisture", "Moisture %"],
                  ["wastage", "Wastage kg"],
                  ["target", "Output"],
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
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <FormulaMetric label="Wet input" value={bridge.grossWetKg.toFixed(2)} />
                <FormulaMetric label="Dry after moisture" value={bridge.afterMoistureKg.toFixed(2)} />
                <FormulaMetric label="Final output" value={bridge.finalOutputKg.toFixed(2)} good={Math.abs(bridge.varianceKg) <= 1} />
                <FormulaMetric label="Moisture loss" value={bridge.moistureLossKg.toFixed(2)} />
                <FormulaMetric label="Variance" value={`${bridge.varianceKg >= 0 ? "+" : ""}${bridge.varianceKg.toFixed(2)}`} good={Math.abs(bridge.varianceKg) <= 1} />
                <FormulaMetric label="Exact paper" value={bridge.exactPaperRequiredKg.toFixed(2)} />
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "actuals" ? (
          <ActualEntryTable
            canEditActuals={canEditActuals}
            filteredRows={filteredRows}
            importActuals={importActuals}
            importPending={importMutation.isPending}
            rowSearch={rowSearch}
            rows={rows}
            setRowSearch={setRowSearch}
            setVarianceFilter={setVarianceFilter}
            summaryLoading={summaryQuery.isLoading}
            updateDraft={updateDraft}
            actualDraft={actualDraft}
            varianceFilter={varianceFilter}
          />
        ) : null}

        {activeTab === "history" ? (
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Month-end records</p>
                <h2 className="mt-1 text-xl font-black">Close history and audit trail</h2>
                <p className="mt-1 text-sm text-slate-500">Each row is one plant/month close record. Approved rows are locked and should reconcile with stock certification.</p>
              </div>
              <History className="h-6 w-6 text-slate-400" />
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-950 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Month</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Plant</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Status</th>
                    <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Rows</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Approved</th>
                    <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {historyQuery.isLoading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading close history...</td></tr>
                  ) : historyRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No monthly close records yet.</td></tr>
                  ) : (
                    historyRows.map((row: any) => (
                      <tr key={`${row.plant_id}-${row.month_start}`} className="bg-white">
                        <td className="px-4 py-3 font-black">{dayjs(row.month_start).format("MMM YYYY")}</td>
                        <td className="px-4 py-3 text-slate-600">{displayPlantScope(row.plant_id, row.plant_id)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${String(row.status).toUpperCase() === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{row.imported_rows_count || 0}</td>
                        <td className="px-4 py-3 text-slate-600">{row.approved_at ? dayjs(row.approved_at).format("DD MMM YYYY HH:mm") : "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{row.notes || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function ActualEntryTable({
  canEditActuals,
  filteredRows,
  importActuals,
  importPending,
  rowSearch,
  rows,
  setRowSearch,
  setVarianceFilter,
  summaryLoading,
  updateDraft,
  actualDraft,
  varianceFilter,
}: any) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Actual input</p>
          <h2 className="mt-1 text-xl font-black">Monthly material actuals</h2>
          <p className="mt-1 text-sm text-slate-500">Save posts the full month. Filter only changes what is visible while editing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
              placeholder="Search material..."
              className="w-56 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <select
            value={varianceFilter}
            onChange={(event) => setVarianceFilter(event.target.value)}
            className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
          >
            <option value="ALL">All rows</option>
            <option value="VARIANCE">Variance over 1 kg</option>
            <option value="MATCHED">Matched rows</option>
          </select>
          <button
            type="button"
            disabled={!canEditActuals || rows.length === 0 || importPending}
            onClick={importActuals}
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save Actuals
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em]">Material</th>
              <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Expected basis</th>
              <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Actual kg</th>
              <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Variance</th>
              <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Actual Cost</th>
              <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.16em]">Variance %</th>
            </tr>
          </thead>
          <tbody>
            {summaryLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading reconciliation rows...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No material rows found for this month/filter.</td></tr>
            ) : (
              filteredRows.map((row: any) => {
                const itemCode = String(row.item_code || "")
                const draft = actualDraft[itemCode]
                const variance = numberValue(row.variance_kg)
                return (
                  <tr key={itemCode} className="border-t border-slate-200 transition hover:bg-cyan-50/40">
                    <td className="px-4 py-3">
                      <div className="font-black text-slate-950">{itemCode}</div>
                      <div className="text-xs text-slate-500">{row.item_name || row.item_type || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <div>{formatKg(row.theoretical_consumption_kg)}</div>
                      {numberValue(row.expected_consumption_factor || 1) > 1 ? (
                        <div className="mt-1 text-[10px] font-bold text-amber-700">
                          Exact {formatKg(row.exact_output_paper_kg)} + {formatKg(row.standard_wastage_kg)} std wastage
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        step="0.001"
                        disabled={!canEditActuals}
                        value={draft?.actual_consumed_weight_kg ?? String(row.actual_month_end_consumption_kg || row.actual_consumption_kg || "")}
                        onChange={(event) => updateDraft(row, "actual_consumed_weight_kg", event.target.value)}
                        className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-right font-semibold disabled:bg-slate-50 disabled:text-slate-400"
                      />
                    </td>
                    <td className={`px-4 py-3 text-right font-black ${Math.abs(variance) <= 1 ? "text-emerald-700" : "text-amber-700"}`}>{formatKg(variance)}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        disabled={!canEditActuals}
                        value={draft?.actual_cost ?? String(row.actual_cost || "")}
                        onChange={(event) => updateDraft(row, "actual_cost", event.target.value)}
                        className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-right font-semibold disabled:bg-slate-50 disabled:text-slate-400"
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
    </section>
  )
}

function FlowStep({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
      <Icon className="h-5 w-5 text-cyan-700" />
      <p className="mt-2 text-sm font-black">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  )
}

function KpiCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "cyan" | "slate" | "emerald" | "amber" | "rose" }) {
  const classes: Record<string, string> = {
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-950",
    slate: "border-slate-200 bg-white text-slate-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    rose: "border-rose-200 bg-rose-50 text-rose-950",
  }
  return (
    <div className={`rounded-[1.5rem] border p-4 shadow-sm ${classes[tone]}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.22em] opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs font-semibold opacity-70">{detail}</p>
    </div>
  )
}

function StateTile({ label, value, text, good }: { label: string; value: string; text: string; good: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${good ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p>
        {good ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <LockKeyhole className="h-4 w-4 text-amber-700" />}
      </div>
      <p className="mt-2 text-lg font-black">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{text}</p>
    </div>
  )
}

function FormulaMetric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-2 text-xl font-black ${good === undefined ? "text-white" : good ? "text-emerald-300" : "text-amber-300"}`}>{value}</p>
    </div>
  )
}
