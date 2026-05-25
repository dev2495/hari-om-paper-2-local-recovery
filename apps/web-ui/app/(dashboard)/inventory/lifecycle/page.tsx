"use client"

import { useMemo } from "react"
import Link from "next/link"
import dayjs from "dayjs"
import {
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileCheck2,
  FilePlus2,
  Gauge,
  Layers,
  LockKeyhole,
  Pencil,
  PackageCheck,
  Scale,
  Sigma,
  Sparkles,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ExecutiveHero, Panel } from "@/components/erp/shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import {
  useBooksState,
  useMonthlyMaterialSummary,
  useMonthlyCloseHistory,
  usePeriodState,
  useWeeklyDrift,
} from "@/hooks/use-production"
import {
  useCarryForwards,
  useInventoryStockStatement,
  useOpeningLoads,
  useStockCertifications,
} from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

const numberValue = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const fmtKg = (value: unknown, digits = 1) =>
  `${numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: digits })} kg`
const fmtNumber = (value: unknown, digits = 0) =>
  numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: digits })
const fmtCurrency = (value: unknown) =>
  `₹${numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
const currentMonth = () => new Date().toISOString().slice(0, 7)
const currentMonthStart = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
const currentMonthEnd = () => new Date().toISOString().slice(0, 10)
const currentWeekStart = () => {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

const STEP_KEYS = ["OPENING", "DAILY", "CERT", "CF", "RECO", "LOCK"] as const
type StepKey = (typeof STEP_KEYS)[number]

type StepDef = {
  key: StepKey
  index: number
  title: string
  description: string
  icon: LucideIcon
  href: string
  cta: string
}

const STEPS: StepDef[] = [
  {
    key: "OPENING",
    index: 1,
    title: "Opening posted",
    description: "Period seed — opening load or auto-posted carry-forward.",
    icon: FilePlus2,
    href: "/inventory/stock-control",
    cta: "Manage opening",
  },
  {
    key: "DAILY",
    index: 2,
    title: "Daily operations",
    description: "Daily RM inward and issues hit the ledger in real time.",
    icon: Workflow,
    href: "/inventory/ledger",
    cta: "View ledger",
  },
  {
    key: "CERT",
    index: 3,
    title: "Stock certification",
    description: "Draft → physical count → certify. Locks book vs physical.",
    icon: ClipboardCheck,
    href: "/inventory/stock-control",
    cta: "Open cert",
  },
  {
    key: "CF",
    index: 4,
    title: "Carry-forward",
    description: "Audited closing → next-period opening proof, one-click post.",
    icon: BookmarkCheck,
    href: "/inventory/stock-control",
    cta: "Carry forward",
  },
  {
    key: "RECO",
    index: 5,
    title: "Monthly reconciliation",
    description: "Theoretical · ledger · actual reconciled. Variance explained.",
    icon: Scale,
    href: "/production/reconciliation",
    cta: "Open reco",
  },
  {
    key: "LOCK",
    index: 6,
    title: "Books locked",
    description: "Period approved, locked_at stamped, books visible everywhere.",
    icon: LockKeyhole,
    href: "/production/reconciliation",
    cta: "View close",
  },
]

type StepStatus = "PENDING" | "ACTIVE" | "DONE" | "BLOCKED"

const STATUS_COLORS: Record<StepStatus, { ring: string; bg: string; chip: string; chipLabel: string }> = {
  PENDING: { ring: "border-slate-200", bg: "bg-slate-50/60", chip: "bg-slate-200 text-slate-700", chipLabel: "Pending" },
  ACTIVE: { ring: "border-amber-300 ring-2 ring-amber-200", bg: "bg-amber-50/70", chip: "bg-amber-200 text-amber-900", chipLabel: "Now" },
  DONE: { ring: "border-emerald-300", bg: "bg-emerald-50/70", chip: "bg-emerald-200 text-emerald-900", chipLabel: "Done" },
  BLOCKED: { ring: "border-rose-300 ring-2 ring-rose-200", bg: "bg-rose-50/70", chip: "bg-rose-200 text-rose-900", chipLabel: "Blocked" },
}

function normalizeRows(raw: any): any[] {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

export default function StockLifecycleHubPageWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Store"]}>
      <StockLifecycleHubPage />
    </RoleGate>
  )
}

function StockLifecycleHubPage() {
  const { activePlant } = useAuth()
  const month = currentMonth()
  const startDate = currentMonthStart()
  const endDate = currentMonthEnd()
  const weekStart = currentWeekStart()
  const selectedPlant = activePlant || ""
  const writeBlocked = !selectedPlant || selectedPlant.toUpperCase() === "ALL"

  const booksQuery = useBooksState(selectedPlant, !writeBlocked)
  const periodStateQuery = usePeriodState(month, selectedPlant, !writeBlocked)
  const summaryQuery = useMonthlyMaterialSummary({ month, plant_id: selectedPlant }, !writeBlocked)
  const historyQuery = useMonthlyCloseHistory({ limit: 12, plant_id: selectedPlant })
  const driftQuery = useWeeklyDrift(weekStart, selectedPlant, !writeBlocked)
  const statementQuery = useInventoryStockStatement({ start_date: startDate, end_date: endDate })
  const openingLoadsQuery = useOpeningLoads()
  const certsQuery = useStockCertifications()
  const cfsQuery = useCarryForwards()

  const certs = normalizeRows(certsQuery.data)
  const cfs = normalizeRows(cfsQuery.data)
  const opens = normalizeRows(openingLoadsQuery.data)
  const summary = summaryQuery.data as any
  const periodState = periodStateQuery.data as any
  const books = booksQuery.data as any
  const drift = driftQuery.data as any
  const statement = statementQuery.data as any

  const reconciliationRows: any[] = useMemo(
    () => (Array.isArray(summary?.rows) ? summary.rows : []),
    [summary],
  )

  // ── Determine step statuses ──
  const periodStartObj = new Date(startDate)
  const recentOpening = opens.find((o: any) => {
    const eff = o.effective_date ? new Date(o.effective_date) : null
    return eff && eff >= periodStartObj
  })
  const currentMonthCert = certs.find((c: any) => {
    const pEnd = c.period_end ? new Date(c.period_end) : null
    return pEnd && pEnd >= periodStartObj && pEnd <= new Date(endDate)
  })
  const currentMonthCf = cfs.find((cf: any) => {
    const open = cf.opening_date ? new Date(cf.opening_date) : null
    return open && open > new Date(endDate)
  })
  const recoStatus = String(periodState?.reco_status || "OPEN").toUpperCase()
  const certStatus = String(periodState?.stock_cert_status || currentMonthCert?.status || "").toUpperCase()
  const isLocked = recoStatus === "APPROVED"

  const stepStatus: Record<StepKey, StepStatus> = {
    OPENING: recentOpening ? "DONE" : "ACTIVE",
    DAILY: "DONE", // assumed ongoing
    CERT: certStatus === "CERTIFIED" || certStatus === "CARRIED_FORWARD" ? "DONE" : certStatus === "DRAFT" ? "ACTIVE" : "PENDING",
    CF: ["CARRIED_FORWARD"].includes(certStatus) ? "DONE" : (currentMonthCf ? "DONE" : (certStatus === "CERTIFIED" ? "ACTIVE" : "PENDING")),
    RECO: isLocked ? "DONE" : (recoStatus === "DRAFT" ? "ACTIVE" : "PENDING"),
    LOCK: isLocked ? "DONE" : "PENDING",
  }
  // If reco is gated by cert blocker → mark reco as BLOCKED
  if (!isLocked && periodState?.blockers?.some((b: any) => b.code === "CERT_NOT_CERTIFIED")) {
    stepStatus.RECO = "BLOCKED"
  }

  const blockers = (periodState?.blockers || []) as Array<{ code: string; item_code?: string; detail: string }>
  const blockerCount = blockers.length

  // ── Compute next-action for the operator ──
  const nextAction = (() => {
    if (writeBlocked)
      return { title: "Select a plant", detail: "Stock lifecycle is per-plant. Pick a plant from the header.", href: "#", cta: "Pick plant" }
    if (!recentOpening) return { title: "Post the opening", detail: "No opening load found for this period. Seed the ledger.", href: "/inventory/stock-control", cta: "Post opening" }
    if (stepStatus.CERT === "PENDING") return { title: "Draft stock certification", detail: "Time to capture book closing and start the physical count.", href: "/inventory/stock-control", cta: "Draft cert" }
    if (stepStatus.CERT === "ACTIVE") return { title: "Finish the physical count", detail: "Certification is DRAFT. Enter physical counts and certify.", href: "/inventory/stock-control", cta: "Certify" }
    if (stepStatus.CF === "ACTIVE") return { title: "Generate carry-forward", detail: "Cert is certified — freeze it into a CF proof document.", href: "/inventory/stock-control", cta: "Carry forward" }
    if (stepStatus.CF === "DONE" && currentMonthCf?.status !== "POSTED") return { title: "Post next-period opening", detail: "CF exists. One-click posts the opening for the new period.", href: "/inventory/stock-control", cta: "Post opening" }
    if (stepStatus.RECO === "BLOCKED") return { title: "Resolve close blockers", detail: `${blockerCount} blocker(s) before monthly reco can be approved.`, href: "/production/reconciliation", cta: "Open reco" }
    if (stepStatus.RECO === "PENDING") return { title: "Import monthly actuals", detail: "Pull plant-register actuals into the reconciliation grid.", href: "/production/reconciliation", cta: "Open reco" }
    if (stepStatus.RECO === "ACTIVE") return { title: "Explain variances and approve", detail: "Reco is in DRAFT — add notes to over-tolerance rows, then approve.", href: "/production/reconciliation", cta: "Open reco" }
    if (stepStatus.LOCK === "DONE") return { title: "All clear — books locked", detail: `Books locked through ${books?.locked_through || dayjs(endDate).format("DD MMM YYYY")}. Next period is open.`, href: "/production/reconciliation", cta: "View history" }
    return { title: "Looking good", detail: "Everything seems healthy. Check daily ledger or weekly drift.", href: "/inventory/ledger", cta: "Open ledger" }
  })()

  // ── KPIs ──
  const totals = statement?.totals || {}
  const closingValue = numberValue(totals.closing_value)
  const physicalMatch = (() => {
    if (!currentMonthCert?.lines || !Array.isArray(currentMonthCert.lines)) return null
    const lines: any[] = currentMonthCert.lines
    if (lines.length === 0) return null
    const matched = lines.filter((l) => Math.abs(numberValue(l.variance_qty)) < 0.01).length
    return Math.round((matched / lines.length) * 100)
  })()
  const totalVariance = numberValue(summary?.total_variance_kg)
  const overTolerance = numberValue(summary?.rows_over_tolerance)
  const needNotes = numberValue(summary?.rows_needing_explanation)

  // ── History trend ──
  const historyTrend = useMemo(() => {
    const arr = Array.isArray(historyQuery.data?.rows) ? historyQuery.data.rows : []
    return arr.slice().reverse().map((row: any) => ({
      label: dayjs(row.month_start).format("MMM"),
      approved: String(row.status || "").toUpperCase() === "APPROVED" ? 1 : 0,
      rows: numberValue(row.imported_rows_count),
    }))
  }, [historyQuery.data])

  const variancePreview = reconciliationRows
    .filter((r) => Math.abs(numberValue(r.variance_kg)) > numberValue(r.tolerance_kg))
    .slice(0, 5)

  return (
    <div className="space-y-6 animate-enter-up">
      <ExecutiveHero
        testId="lifecycle-hub-hero"
        badge="Stock close lifecycle"
        title={`${dayjs(month).format("MMMM YYYY")} · ${recoStatus} · ${certStatus || "no cert"}`}
        description="One workspace for the full close ritual: opening · daily ops · stock cert · carry-forward · monthly reco · lock. Every step shows where you are, what's next, and the one action you need to take."
        actions={
          <>
            <Link
              href={nextAction.href}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-white shadow-md transition hover:bg-emerald-800"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {nextAction.cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em]",
                isLocked
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              {isLocked ? <LockKeyhole className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              Books {isLocked ? "locked" : "open"}
            </span>
            {blockerCount > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-rose-800">
                <AlertTriangle className="h-3 w-3" />
                {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </>
        }
        aside={
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/85">Next action</p>
            <p className="text-lg font-semibold leading-tight">{nextAction.title}</p>
            <p className="text-[12px] leading-5 text-slate-200/85">{nextAction.detail}</p>
            <Link
              href={nextAction.href}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white hover:bg-white/20"
            >
              {nextAction.cta} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      />

      {/* ── KPI rail ── */}
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Closing value" value={fmtCurrency(closingValue)} hint="Book at end of period" tone="cyan" icon={Database} />
        <KpiTile label="Theoretical" value={fmtKg(summary?.total_theoretical_consumption_kg)} hint="From BOM × produced" tone="cyan" icon={Sigma} />
        <KpiTile label="Ledger issued" value={fmtKg(summary?.total_ledger_issued_kg)} hint="Daily ISSUE_PRODUCTION sum" tone="violet" icon={Workflow} />
        <KpiTile label="Actual" value={fmtKg(summary?.total_actual_consumption_kg)} hint="Imported from register" tone="emerald" icon={ClipboardCheck} />
        <KpiTile label="Variance" value={fmtKg(totalVariance)} hint={`${overTolerance} over tolerance`} tone={Math.abs(totalVariance) > 0 ? (overTolerance > 0 ? "rose" : "amber") : "emerald"} icon={Scale} />
        <KpiTile
          label="Physical match"
          value={physicalMatch == null ? "—" : `${physicalMatch}%`}
          hint={physicalMatch == null ? "No cert yet" : "Lines matching book qty"}
          tone={physicalMatch == null ? "slate" : physicalMatch >= 95 ? "emerald" : physicalMatch >= 80 ? "amber" : "rose"}
          icon={Gauge}
        />
      </section>

      {/* ── Stepper ── */}
      <Panel
        title="Where you are in the close cycle"
        subtitle="6 stages. Each shows its current state and the page that drives it."
      >
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {STEPS.map((step) => {
            const Icon = step.icon
            const status = stepStatus[step.key]
            const colors = STATUS_COLORS[status]
            return (
              <li
                key={step.key}
                className={cn(
                  "flex flex-col gap-2 rounded-[1.3rem] border p-4 shadow-sm transition",
                  colors.ring,
                  colors.bg,
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                    <Icon className="h-4.5 w-4.5 text-slate-700" />
                  </div>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]", colors.chip)}>
                    {colors.chipLabel}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Step {step.index}</p>
                  <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-600">{step.description}</p>
                </div>
                <Link
                  href={step.href}
                  className="mt-auto inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-800 hover:text-cyan-900"
                >
                  {step.cta} <ArrowRight className="h-3 w-3" />
                </Link>
              </li>
            )
          })}
        </ol>
      </Panel>

      {/* ── Blockers + variance preview side-by-side ── */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel
          title="Close blockers"
          subtitle="Everything that's preventing the monthly close from approving."
          actions={
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em]",
                blockerCount === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              {blockerCount === 0 ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {blockerCount === 0 ? "All clear" : `${blockerCount} blocker(s)`}
            </span>
          }
        >
          {blockers.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              No blockers — close can be approved once all DRAFT actuals are entered.
            </div>
          ) : (
            <ul className="space-y-2">
              {blockers.slice(0, 6).map((b, i) => (
                <li key={`${b.code}:${b.item_code || i}`} className="flex items-start gap-3 rounded-xl border border-rose-200 bg-white px-3 py-2.5 shadow-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-rose-700">{b.code.replaceAll("_", " ")}</p>
                    <p className="text-[12.5px] text-slate-700">{b.detail}</p>
                  </div>
                  <Link
                    href={b.code === "CERT_NOT_CERTIFIED" ? "/inventory/stock-control" : "/production/reconciliation"}
                    className="shrink-0 rounded-full border border-rose-300 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-rose-700 hover:bg-rose-50"
                  >
                    Fix
                  </Link>
                </li>
              ))}
              {blockers.length > 6 ? (
                <li className="text-[12px] font-semibold text-slate-500">+ {blockers.length - 6} more — open reconciliation for full list.</li>
              ) : null}
            </ul>
          )}
        </Panel>

        <Panel
          title="Top variance items"
          subtitle="Rows above tolerance — likeliest cause of close friction."
          actions={
            <Link
              href="/production/reconciliation"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:border-cyan-300"
            >
              See all <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {variancePreview.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
              <CheckCircle2 className="mr-2 inline h-4 w-4" />
              All items within tolerance.
            </div>
          ) : (
            <ul className="space-y-2">
              {variancePreview.map((row: any) => (
                <li key={row.item_code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] font-bold text-cyan-800">{row.item_code}</p>
                    <p className="text-[11.5px] text-slate-500 truncate">{row.item_name || "—"} · tolerance ±{numberValue(row.tolerance_kg)} kg</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("font-bold tabular-nums", numberValue(row.variance_kg) >= 0 ? "text-rose-700" : "text-amber-700")}>
                      {fmtKg(row.variance_kg)}
                    </p>
                    {row.needs_explanation ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-amber-700">
                        <Pencil className="h-2.5 w-2.5" /> Note needed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-violet-700">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Explained
                      </span>
                    )}
                  </div>
                  {row.item_id ? (
                    <Link
                      href={`/inventory/ledger?item_id=${row.item_id}&start=${startDate}&end=${endDate}&from=reconciliation`}
                      className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-800 hover:bg-cyan-100"
                    >
                      Drill
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Three-stream comparison ── */}
      <Panel
        title="Three streams of consumption truth"
        subtitle="Theoretical (BOM × produced) · Ledger (daily ISSUE_PRODUCTION sum) · Actual (plant-register import). Variance closes the loop."
        actions={
          <Link
            href="/production/reconciliation"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:border-cyan-300"
          >
            Full table <ArrowRight className="h-3 w-3" />
          </Link>
        }
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <StreamCard
            title="Theoretical"
            subtitle="What the spec says we should consume"
            value={fmtKg(summary?.total_theoretical_consumption_kg)}
            color="#0e7490"
            icon={Sigma}
          />
          <StreamCard
            title="Ledger issued"
            subtitle="What stores actually issued day-by-day"
            value={fmtKg(summary?.total_ledger_issued_kg)}
            color="#7c3aed"
            icon={Workflow}
          />
          <StreamCard
            title="Actual"
            subtitle="What the plant register confirms"
            value={fmtKg(summary?.total_actual_consumption_kg)}
            color="#059669"
            icon={ClipboardCheck}
          />
        </div>
        <div className="mt-5 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                {
                  name: "Period",
                  Theoretical: numberValue(summary?.total_theoretical_consumption_kg),
                  Ledger: numberValue(summary?.total_ledger_issued_kg),
                  Actual: numberValue(summary?.total_actual_consumption_kg),
                },
              ]}
            >
              <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Bar dataKey="Theoretical" fill="#0e7490" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Ledger" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Actual" fill="#059669" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* ── Weekly drift + history ── */}
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel
          title="Weekly drift"
          subtitle="Same math, scoped to the running week. Early warning — read-only."
          actions={
            <Link
              href="/production/reconciliation?tab=drift"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:border-cyan-300"
            >
              Full drift <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          <div className="grid gap-3 md:grid-cols-4">
            <MiniTile label="Theoretical" value={fmtKg(drift?.total_theoretical_kg)} />
            <MiniTile label="Ledger" value={fmtKg(drift?.total_ledger_kg)} />
            <MiniTile label="Running variance" value={fmtKg(drift?.total_running_variance_kg)} />
            <MiniTile label="Drifting items" value={String(drift?.rows_over_tolerance ?? 0)} accent={(drift?.rows_over_tolerance || 0) > 0 ? "amber" : "emerald"} />
          </div>
        </Panel>

        <Panel
          title="Close history (last 12 months)"
          subtitle="Approved closes per month — keep the close rhythm steady."
          actions={
            <Link
              href="/production/reconciliation?tab=history"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700 hover:border-cyan-300"
            >
              See history <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {historyTrend.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No close history yet.
            </p>
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyTrend}>
                  <defs>
                    <linearGradient id="hub-trend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0e7490" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#0e7490" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 11 }} />
                  <Area type="monotone" dataKey="rows" stroke="#0e7490" strokeWidth={2} fill="url(#hub-trend)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Shortcuts ── */}
      <Panel title="Lifecycle shortcuts" subtitle="Every page that lives inside this flow. Bookmark the ones you use most.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ShortcutTile href="/inventory/stock-control" title="Stock control" detail="Opening · cert · carry-forward" icon={ClipboardCheck} />
          <ShortcutTile href="/production/reconciliation" title="Monthly reconciliation" detail="3-stream variance, drift, history" icon={Scale} />
          <ShortcutTile href="/inventory/ledger" title="Ledger" detail="Every txn, drill-down enabled" icon={Workflow} />
          <ShortcutTile href="/inventory/raw-material-inward" title="RM inward" detail="Daily inward of paper/adhesive/parchment" icon={FilePlus2} />
          <ShortcutTile href="/inventory/production-issue" title="Production issue" detail="Daily RM → WIP issue (ledger feed)" icon={PackageCheck} />
          <ShortcutTile href="/inventory/fg-inward" title="Manual FG inward" detail="Rework · returns · adjustments" icon={Layers} />
        </div>
      </Panel>
    </div>
  )
}

function KpiTile({
  label,
  value,
  hint,
  tone = "cyan",
  icon: Icon,
}: {
  label: string
  value: string
  hint: string
  tone?: "cyan" | "emerald" | "amber" | "rose" | "violet" | "slate"
  icon: LucideIcon
}) {
  const toneClass: Record<string, string> = {
    cyan: "border-cyan-200 bg-cyan-50/70 text-cyan-950",
    emerald: "border-emerald-200 bg-emerald-50/70 text-emerald-950",
    amber: "border-amber-200 bg-amber-50/70 text-amber-950",
    rose: "border-rose-200 bg-rose-50/70 text-rose-950",
    violet: "border-violet-200 bg-violet-50/70 text-violet-950",
    slate: "border-slate-200 bg-white/90 text-slate-950",
  }
  return (
    <div className={cn("relative overflow-hidden rounded-[1.3rem] border px-4 py-3 shadow-sm", toneClass[tone])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-65">{label}</p>
        <Icon className="h-3.5 w-3.5 opacity-50" />
      </div>
      <p className="mt-2 text-[1.5rem] font-semibold leading-none tabular-nums tracking-tight">{value}</p>
      <p className="mt-1.5 text-[11px] leading-4 opacity-75">{hint}</p>
    </div>
  )
}

function StreamCard({
  title,
  subtitle,
  value,
  color,
  icon: Icon,
}: {
  title: string
  subtitle: string
  value: string
  color: string
  icon: LucideIcon
}) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color }}>{title}</p>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <p className="mt-3 text-3xl font-semibold leading-none tabular-nums tracking-tight text-slate-950">{value}</p>
      <p className="mt-1.5 text-[12px] text-slate-500">{subtitle}</p>
    </div>
  )
}

function MiniTile({ label, value, accent }: { label: string; value: string; accent?: "amber" | "emerald" }) {
  const accentClass = accent === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : accent === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white"
  return (
    <div className={cn("rounded-2xl border px-3 py-2.5 shadow-sm", accentClass)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-65">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{value}</p>
    </div>
  )
}

function ShortcutTile({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: LucideIcon }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-md"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-700 via-cyan-600 to-emerald-500 text-white shadow-sm">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-[12px] text-slate-500">{detail}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-cyan-700" />
    </Link>
  )
}
