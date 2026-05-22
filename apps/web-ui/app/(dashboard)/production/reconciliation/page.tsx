"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import dayjs from "dayjs"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  History as HistoryIcon,
  LockKeyhole,
  Pencil,
  Scale,
  Search,
  Sigma,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ExecutiveHero, Panel } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import {
  useApproveMonthlyClose,
  useBooksState,
  useImportMonthlyActuals,
  useMonthlyCloseHistory,
  useMonthlyCloseState,
  useMonthlyMaterialSummary,
  usePeriodState,
  useWeeklyDrift,
} from "@/hooks/use-production"
import { cn } from "@/lib/utils"

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const fmtKg = (value: unknown, digits = 2) =>
  `${numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: digits })} kg`
const fmtPct = (value: unknown) => `${numberValue(value).toFixed(2)}%`
const fmtCurrency = (value: unknown) =>
  `₹${numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
const currentMonth = () => new Date().toISOString().slice(0, 7)
const currentWeekStart = () => {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // 0 = Mon
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

type ActualDraft = Record<string, { actual_consumed_weight_kg: string; actual_cost: string; notes: string }>

const TABS = [
  { key: "workspace", label: "Monthly close", icon: ClipboardCheck },
  { key: "drift", label: "Weekly drift", icon: TrendingUp },
  { key: "actuals", label: "Actuals entry", icon: Pencil },
  { key: "history", label: "Close history", icon: HistoryIcon },
] as const

type TabKey = (typeof TABS)[number]["key"]

export default function ReconciliationPage() {
  const { activePlant } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [weekStart, setWeekStart] = useState(currentWeekStart())
  const [activeTab, setActiveTab] = useState<TabKey>("workspace")
  const [actualDraft, setActualDraft] = useState<ActualDraft>({})
  const [closeNotes, setCloseNotes] = useState("")
  const [rowSearch, setRowSearch] = useState("")

  const selectedPlant = activePlant || ""
  const writeBlocked = selectedPlant.toUpperCase() === "ALL" || !selectedPlant

  const summaryQuery = useMonthlyMaterialSummary({ month, plant_id: selectedPlant }, Boolean(month))
  const closeQuery = useMonthlyCloseState({ month, plant_id: selectedPlant }, Boolean(month))
  const historyQuery = useMonthlyCloseHistory({ limit: 12, plant_id: selectedPlant })
  const periodStateQuery = usePeriodState(month, selectedPlant, Boolean(month))
  const booksStateQuery = useBooksState(selectedPlant, true)
  const driftQuery = useWeeklyDrift(weekStart, selectedPlant, activeTab === "drift")

  const importMutation = useImportMonthlyActuals()
  const approveMutation = useApproveMonthlyClose()

  const summary = summaryQuery.data as any
  const rows = useMemo<any[]>(() => (Array.isArray(summary?.rows) ? summary.rows : []), [summary])
  const closeStatus = String(closeQuery.data?.status || (writeBlocked ? "READ_ONLY_ALL" : "DRAFT")).toUpperCase()
  const isLocked = closeStatus === "APPROVED"
  const periodState = periodStateQuery.data
  const books = booksStateQuery.data

  // Seed actual-draft from the latest summary so user edits start from current truth.
  useEffect(() => {
    const seed: ActualDraft = {}
    rows.forEach((row) => {
      seed[row.item_code] = {
        actual_consumed_weight_kg: String(row.actual_consumption_kg ?? row.actual_month_end_consumption_kg ?? ""),
        actual_cost: String(row.actual_cost ?? ""),
        notes: row.notes || "",
      }
    })
    setActualDraft(seed)
  }, [rows])

  const filteredRows = useMemo(() => {
    const needle = rowSearch.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => {
      const blob = `${r.item_code} ${r.item_name || ""} ${r.item_type || ""}`.toLowerCase()
      return blob.includes(needle)
    })
  }, [rows, rowSearch])

  const blockers = (periodState?.blockers || []) as Array<{ code: string; item_code?: string; detail: string }>
  const canApprove = Boolean(periodState?.can_approve_reco) && !isLocked && !writeBlocked

  const trendSeries = useMemo(() => {
    const arr = Array.isArray(historyQuery.data?.rows) ? historyQuery.data.rows : []
    return arr
      .slice()
      .reverse()
      .map((row: any) => ({
        label: dayjs(row.month_start).format("MMM"),
        imported: numberValue(row.imported_rows_count),
        approved: String(row.status || "").toUpperCase() === "APPROVED" ? 1 : 0,
      }))
  }, [historyQuery.data])

  const handleSaveActuals = () => {
    const payload = Object.entries(actualDraft)
      .map(([item_code, value]) => ({
        item_code,
        actual_consumed_weight_kg: Number(value.actual_consumed_weight_kg || 0),
        actual_cost: Number(value.actual_cost || 0),
        notes: value.notes?.trim() || undefined,
      }))
      .filter((r) => r.item_code && (r.actual_consumed_weight_kg > 0 || r.actual_cost > 0 || r.notes))
    importMutation.mutate(
      { payload: { month, rows: payload }, plantId: selectedPlant },
      {
        onSuccess: () => setActiveTab("workspace"),
      },
    )
  }

  const handleApprove = () => {
    approveMutation.mutate(
      { payload: { month, notes: closeNotes || null }, plantId: selectedPlant },
    )
  }

  const approveError = approveMutation.error as any
  const approveErrorBlockers: Array<{ code: string; item_code?: string; detail: string }> =
    approveError?.response?.data?.detail?.blockers || []

  return (
    <div className="space-y-6 animate-enter-up">
      <ExecutiveHero
        testId="reconciliation-hero"
        badge="Month-end close"
        title="Reconcile theoretical, ledger, and actual consumption — then lock the month"
        description="Theoretical comes from job-card BOM snapshots. Ledger is daily issues. Actual is the plant-register import. Variance is the gap we explain before close."
        actions={
          <>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-xl border border-white/70 bg-white/90 px-3 text-sm font-semibold shadow-sm"
            />
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]",
                isLocked
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : closeStatus === "DRAFT"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {isLocked ? <LockKeyhole className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              {closeStatus.replaceAll("_", " ")}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]",
                periodState?.stock_cert_status === "CERTIFIED" || periodState?.stock_cert_status === "CARRIED_FORWARD"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              <FileCheck2 className="h-3 w-3" />
              Stock cert: {periodState?.stock_cert_status || "missing"}
            </span>
          </>
        }
        aside={
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Theoretical</p>
                <p className="mt-2 text-2xl font-semibold">{fmtKg(summary?.total_theoretical_consumption_kg)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Ledger</p>
                <p className="mt-2 text-2xl font-semibold">{fmtKg(summary?.total_ledger_issued_kg)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Actual</p>
                <p className="mt-2 text-2xl font-semibold">{fmtKg(summary?.total_actual_consumption_kg)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/10 bg-white/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Variance</p>
                <p className="mt-2 text-2xl font-semibold">{fmtKg(summary?.total_variance_kg)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-100">
                <AlertTriangle className="h-3 w-3" /> {summary?.rows_over_tolerance ?? 0} over tolerance
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-100">
                <Pencil className="h-3 w-3" /> {summary?.rows_needing_explanation ?? 0} need notes
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-100">
                <Sigma className="h-3 w-3" /> {rows.length} items
              </span>
            </div>
          </div>
        }
      />

      {/* Flow context */}
      <section className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-cyan-200 bg-cyan-50/60 px-4 py-2.5 text-[12.5px] font-semibold text-cyan-950 shadow-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-800">Step 5–6 of 6</span>
        <span>You are in <strong>Monthly reconciliation</strong> · <strong>Books lock</strong></span>
        <Link
          href="/inventory/lifecycle"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-cyan-700 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-900 hover:bg-white"
        >
          ← Lifecycle hub
        </Link>
        <Link
          href="/inventory/stock-control"
          className="inline-flex items-center gap-1 rounded-full border border-cyan-700 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-900 hover:bg-white"
        >
          Stock control
        </Link>
      </section>

      {/* Books-locked banner */}
      {books?.locked_through && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm font-semibold text-amber-900 shadow-sm">
          <span className="inline-flex items-center gap-2">
            <LockKeyhole className="h-4 w-4" />
            Books locked through {dayjs(books.locked_through).format("DD MMM YYYY")}
            {books.locked_by ? ` · by ${books.locked_by}` : null}
          </span>
        </div>
      )}

      {/* Cross-app linked-state banner (Gap 4) */}
      {periodState && !canApprove && !isLocked && !writeBlocked && (
        <Panel
          title="Close blockers"
          subtitle="Resolve every item below before the monthly close can be approved."
          actions={
            <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-rose-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
            </span>
          }
        >
          <ul className="space-y-2.5">
            {blockers.map((b, idx) => (
              <li
                key={`${b.code}:${b.item_code || idx}`}
                className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white px-4 py-3 shadow-sm"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-rose-700">{b.code.replaceAll("_", " ")}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{b.detail}</p>
                </div>
                {b.code === "CERT_NOT_CERTIFIED" ? (
                  <Link
                    href="/inventory/stock-control"
                    className="shrink-0 rounded-xl bg-rose-900 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white shadow-sm"
                  >
                    Open stock cert
                  </Link>
                ) : b.code === "VARIANCE_NEEDS_NOTE" ? (
                  <button
                    onClick={() => setActiveTab("actuals")}
                    className="shrink-0 rounded-xl bg-amber-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white shadow-sm"
                  >
                    Add note
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Tabs */}
      <nav className="flex flex-wrap items-center gap-2 overflow-x-auto rounded-full border border-white/70 bg-white/85 p-1.5 shadow-sm backdrop-blur">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition",
                active
                  ? "bg-gradient-to-br from-cyan-700 via-cyan-600 to-emerald-500 text-white shadow-md"
                  : "text-slate-700 hover:bg-cyan-50 hover:text-cyan-800",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </nav>

      {/* ── Workspace tab ── */}
      {activeTab === "workspace" && (
        <div className="space-y-5">
          <Panel
            title="Theoretical · Ledger · Actual"
            subtitle="Three independent consumption streams for the period. Variance = Actual − Theoretical. Ledger is the sum of daily ISSUE_PRODUCTION transactions."
            actions={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={rowSearch}
                    onChange={(e) => setRowSearch(e.target.value)}
                    placeholder="Search items…"
                    className="h-9 w-64 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm shadow-sm"
                  />
                </div>
              </div>
            }
          >
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                    <tr>
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-3 py-3 text-right">Theoretical</th>
                      <th className="px-3 py-3 text-right">Ledger</th>
                      <th className="px-3 py-3 text-right">Actual</th>
                      <th className="px-3 py-3 text-right">Variance</th>
                      <th className="px-3 py-3 text-right">%</th>
                      <th className="px-3 py-3 text-left">Status</th>
                      <th className="px-3 py-3 text-left">Notes</th>
                      <th className="px-3 py-3 text-center">Drill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                          No items match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const status = row.over_tolerance
                          ? row.needs_explanation
                            ? "amber"
                            : "violet"
                          : "emerald"
                        return (
                          <tr key={row.item_code} className="border-t border-slate-100 transition hover:bg-cyan-50/30">
                            <td className="px-4 py-2.5">
                              <span className="block font-mono text-[12px] font-bold text-cyan-800">{row.item_code}</span>
                              <span className="block text-[11px] text-slate-500">{row.item_name || "—"}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                              {fmtKg(row.theoretical_consumption_kg)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              <span className="font-semibold text-cyan-800">{fmtKg(row.ledger_issued_kg)}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                              {fmtKg(row.actual_consumption_kg)}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-2.5 text-right tabular-nums font-bold",
                                Math.abs(numberValue(row.variance_kg)) > 0 ? (numberValue(row.variance_kg) >= 0 ? "text-rose-700" : "text-amber-700") : "text-emerald-700",
                              )}
                            >
                              {fmtKg(row.variance_kg)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                              {fmtPct(row.variance_percent)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                                  status === "emerald"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : status === "amber"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-violet-200 bg-violet-50 text-violet-700",
                                )}
                              >
                                {row.over_tolerance
                                  ? row.needs_explanation
                                    ? `Note needed (±${row.tolerance_kg}kg)`
                                    : "Explained"
                                  : "OK"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 max-w-[220px]">
                              <span className="block truncate text-[12px] text-slate-600" title={row.notes || ""}>
                                {row.notes || (row.needs_explanation ? "—" : "")}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {row.item_id ? (
                                <Link
                                  href={`/inventory/ledger?item_id=${row.item_id}&start=${summary?.month_start}&end=${summary?.month_end}&from=reconciliation`}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-cyan-800 hover:border-cyan-300"
                                >
                                  <Workflow className="h-3 w-3" /> Drill
                                </Link>
                              ) : (
                                <span className="text-[10.5px] text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Stream contributions" subtitle="Theoretical vs ledger vs actual at the period level.">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      {
                        name: "Period",
                        theoretical: numberValue(summary?.total_theoretical_consumption_kg),
                        ledger: numberValue(summary?.total_ledger_issued_kg),
                        actual: numberValue(summary?.total_actual_consumption_kg),
                      },
                    ]}
                  >
                    <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="theoretical" name="Theoretical" fill="#0e7490" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="ledger" name="Ledger" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="actual" name="Actual" fill="#059669" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Close month"
              subtitle="Add closing notes, then approve. Approval is blocked while blockers exist above."
            >
              <div className="space-y-4">
                <textarea
                  rows={4}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Why are we closing now? Any caveats for the next period?"
                  disabled={!canApprove}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                  onClick={handleApprove}
                  disabled={!canApprove || approveMutation.isPending}
                  className={cn(
                    "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold uppercase tracking-[0.1em] shadow-md transition",
                    canApprove
                      ? "bg-gradient-to-br from-emerald-700 via-emerald-600 to-cyan-600 text-white hover:-translate-y-0.5"
                      : "cursor-not-allowed bg-slate-200 text-slate-500",
                  )}
                >
                  {approveMutation.isPending ? "Locking…" : isLocked ? "Already locked" : canApprove ? "Approve & lock month" : "Resolve blockers first"}
                </button>
                {approveErrorBlockers.length > 0 && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-900">
                    <p className="font-bold uppercase tracking-[0.12em]">Approval rejected — {approveErrorBlockers.length} blocker(s)</p>
                    <ul className="mt-1.5 list-disc pl-5">
                      {approveErrorBlockers.map((b, i) => (
                        <li key={i}>{b.detail}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {approveMutation.isSuccess && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[12.5px] font-semibold text-emerald-900">
                    <CheckCircle2 className="mr-2 inline h-4 w-4" />
                    Month locked. Books-locked banner now appears across the workspace.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── Actuals entry tab ── */}
      {activeTab === "actuals" && (
        <Panel
          title="Enter actual consumption from plant registers"
          subtitle="Plug in qty and cost from the physical register. Notes are required when variance > tolerance."
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveActuals}
                disabled={importMutation.isPending || writeBlocked || isLocked}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold uppercase tracking-[0.1em] shadow-md",
                  writeBlocked || isLocked
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-slate-900 text-white hover:bg-slate-800",
                )}
              >
                <FileCheck2 className="h-4 w-4" />
                {importMutation.isPending ? "Saving…" : "Save actuals"}
              </button>
            </div>
          }
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left">Item</th>
                    <th className="px-3 py-3 text-right">Theoretical</th>
                    <th className="px-3 py-3 text-right">Ledger</th>
                    <th className="px-3 py-3 text-right">Actual kg</th>
                    <th className="px-3 py-3 text-right">Actual cost</th>
                    <th className="px-3 py-3 text-left">Notes (required if over tolerance)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const draft = actualDraft[row.item_code] || {
                      actual_consumed_weight_kg: "",
                      actual_cost: "",
                      notes: row.notes || "",
                    }
                    return (
                      <tr key={row.item_code} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">
                          <span className="block font-mono text-[12px] font-bold text-cyan-800">{row.item_code}</span>
                          <span className="block text-[11px] text-slate-500">{row.item_name || "—"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtKg(row.theoretical_consumption_kg)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtKg(row.ledger_issued_kg)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={draft.actual_consumed_weight_kg}
                            disabled={writeBlocked || isLocked}
                            onChange={(e) =>
                              setActualDraft((prev) => ({
                                ...prev,
                                [row.item_code]: { ...draft, actual_consumed_weight_kg: e.target.value },
                              }))
                            }
                            className="h-9 w-28 rounded-lg border border-slate-200 bg-white px-2 text-right tabular-nums text-sm disabled:bg-slate-50"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={draft.actual_cost}
                            disabled={writeBlocked || isLocked}
                            onChange={(e) =>
                              setActualDraft((prev) => ({
                                ...prev,
                                [row.item_code]: { ...draft, actual_cost: e.target.value },
                              }))
                            }
                            className="h-9 w-32 rounded-lg border border-slate-200 bg-white px-2 text-right tabular-nums text-sm disabled:bg-slate-50"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            value={draft.notes}
                            disabled={writeBlocked || isLocked}
                            onChange={(e) =>
                              setActualDraft((prev) => ({
                                ...prev,
                                [row.item_code]: { ...draft, notes: e.target.value },
                              }))
                            }
                            placeholder={row.needs_explanation ? "Required — explain the variance" : "Optional"}
                            className={cn(
                              "h-9 w-full rounded-lg border bg-white px-2 text-sm disabled:bg-slate-50",
                              row.needs_explanation && !draft.notes
                                ? "border-amber-300 ring-1 ring-amber-200"
                                : "border-slate-200",
                            )}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Weekly drift tab ── */}
      {activeTab === "drift" && (
        <div className="space-y-5">
          <Panel
            title="Weekly drift — early warning"
            subtitle="Read-only. Same theoretical math, scoped to the running week. Use this to spot drift before month-end."
            actions={
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm"
              />
            }
          >
            <div className="grid gap-3 md:grid-cols-4">
              <KpiTile label="Theoretical" value={fmtKg(driftQuery.data?.total_theoretical_kg)} tone="cyan" />
              <KpiTile label="Ledger" value={fmtKg(driftQuery.data?.total_ledger_kg)} tone="violet" />
              <KpiTile label="Running variance" value={fmtKg(driftQuery.data?.total_running_variance_kg)} tone="amber" />
              <KpiTile
                label="Over tolerance"
                value={String(driftQuery.data?.rows_over_tolerance ?? 0)}
                tone={(driftQuery.data?.rows_over_tolerance || 0) > 0 ? "rose" : "emerald"}
              />
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                    <tr>
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-3 py-3 text-right">Theoretical</th>
                      <th className="px-3 py-3 text-right">Ledger</th>
                      <th className="px-3 py-3 text-right">Running variance</th>
                      <th className="px-3 py-3 text-right">%</th>
                      <th className="px-3 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(driftQuery.data?.rows) ? driftQuery.data!.rows : []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                          No drift data for this week yet.
                        </td>
                      </tr>
                    ) : (
                      (driftQuery.data!.rows as any[]).map((row: any) => (
                        <tr key={row.item_code} className="border-t border-slate-100 hover:bg-cyan-50/30">
                          <td className="px-4 py-2.5">
                            <span className="block font-mono text-[12px] font-bold text-cyan-800">{row.item_code}</span>
                            <span className="block text-[11px] text-slate-500">{row.item_name || "—"}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtKg(row.theoretical_kg)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-cyan-800 font-semibold">{fmtKg(row.ledger_issued_kg)}</td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums font-bold", row.running_variance_kg >= 0 ? "text-rose-700" : "text-amber-700")}>{fmtKg(row.running_variance_kg)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmtPct(row.running_variance_percent)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                                row.over_tolerance ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
                              )}
                            >
                              {row.over_tolerance ? "Drifting" : "On track"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab === "history" && (
        <Panel title="Close history" subtitle="The last 12 months of monthly closes for this plant.">
          {trendSeries.length > 0 && (
            <div className="mb-4 h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendSeries}>
                  <defs>
                    <linearGradient id="grad-trend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0e7490" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#0e7490" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="imported" stroke="#0e7490" strokeWidth={2} fill="url(#grad-trend)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
                <tr>
                  <th className="px-4 py-3 text-left">Month</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th className="px-3 py-3 text-right">Rows imported</th>
                  <th className="px-3 py-3 text-left">Approved by</th>
                  <th className="px-3 py-3 text-left">Approved at</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(historyQuery.data?.rows) ? historyQuery.data!.rows : []).map((row: any) => (
                  <tr key={`${row.plant_id}:${row.month_start}`} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{dayjs(row.month_start).format("MMM YYYY")}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                          String(row.status).toUpperCase() === "APPROVED"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.imported_rows_count || 0}</td>
                    <td className="px-3 py-2.5 text-slate-700">{row.approved_by || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{row.approved_at ? dayjs(row.approved_at).format("DD MMM YYYY HH:mm") : "—"}</td>
                  </tr>
                ))}
                {(historyQuery.data?.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      No close history yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}

function KpiTile({ label, value, tone = "cyan" }: { label: string; value: string; tone?: "cyan" | "emerald" | "amber" | "rose" | "violet" }) {
  const toneClass: Record<string, string> = {
    cyan: "border-cyan-200 bg-cyan-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
    violet: "border-violet-200 bg-violet-50/70",
  }
  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", toneClass[tone])}>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none tracking-tight text-slate-950">{value}</p>
    </div>
  )
}
