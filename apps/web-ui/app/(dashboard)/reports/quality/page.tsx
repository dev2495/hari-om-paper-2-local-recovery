"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Info, LockKeyhole } from "lucide-react"
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useReasonCodes } from "@/hooks/use-master-data"
import { inventoryApi, productionApi } from "@/lib/api"
import { seasonApi } from "@/lib/season-api"
import { cn } from "@/lib/utils"

const STAGE_LABELS: Record<string, string> = { WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC" }
const STAGE_ORDER = ["WINDER", "OVEN", "PROCESS", "QC"]
// Categorical slots in fixed order (validated for colour-blind separation); colour follows the stage, never its rank.
const STAGE_COLOR: Record<string, string> = { WINDER: "#2a78d6", OVEN: "#eb6834", PROCESS: "#1baf7a", QC: "#eda100" }
const ONE_SERIES = "#2a78d6"
const GRID = "hsl(var(--chart-grid))"
const AXIS = "hsl(var(--chart-axis))"
const PERIODS = [{ label: "4 weeks", days: 28 }, { label: "13 weeks", days: 91 }, { label: "6 months", days: 182 }]

function isoDaysAgo(days: number) {
  const value = new Date()
  value.setDate(value.getDate() - days)
  return value.toISOString().slice(0, 10)
}
const pct = (value: number | null | undefined) => (value == null ? "—" : `${Number(value).toFixed(1)}%`)
const num = (value: number | null | undefined, digits = 0) => (value == null ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits }))
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
const ratio = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null)
const asArray = (value: any) => (Array.isArray(value) ? value : [])

function rateTone(value: number | null | undefined, good: "high" | "low") {
  if (value == null) return "text-foreground"
  const bad = good === "high" ? value < 90 : value > 5
  return bad ? "text-signal-rose-ink" : "text-signal-emerald-ink"
}

function Section({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0"><h2 className="font-semibold">{title}</h2>{subtitle ? <p className="text-[12.5px] text-muted-foreground">{subtitle}</p> : null}</div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Table({ head, rows, empty, align }: { head: string[]; rows: ReactNode[][]; empty: string; align?: ("left" | "right")[] }) {
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto">
      <table className="tube-grid w-full min-w-[480px]">
        <thead><tr>{head.map((cell, index) => <th key={cell} className={align?.[index] === "right" ? "text-right" : undefined}>{cell}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={align?.[cellIndex] === "right" ? "text-right tabular-nums" : undefined}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Tile({ label, value, detail, tone, href }: { label: string; value: ReactNode; detail: ReactNode; tone?: string; href?: string }) {
  const body = (
    <>
      <p className="text-[12.5px] font-semibold text-foreground/75">{label}</p>
      <p className={cn("mt-2 text-[30px] font-semibold leading-none tabular-nums tracking-tight", tone)}>{value}</p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{detail}</p>
    </>
  )
  return href
    ? <Link href={href} className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
    : <div className="rounded-xl border border-border bg-card p-4">{body}</div>
}

function ChartTooltip({ active, payload, label, render }: any) {
  if (!active || !payload?.length) return null
  return <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] shadow-md"><p className="mb-1 font-semibold">Week of {weekLabel(label)}</p>{render(payload)}</div>
}

/** Direct label at each line's last point, so a stage is never identified by colour alone.
 *  Lines ending at the same height share one label ("Oven, Process") instead of overprinting. */
function endLabels(trend: any[], stages: string[]) {
  const ends = stages
    .map((stage) => {
      let index = -1
      trend.forEach((row, i) => { if (row[stage] != null) index = i })
      return { stage, index, value: index >= 0 ? Number(trend[index][stage]) : null }
    })
    .filter((row) => row.value != null)
  const out: Record<string, { index: number; text: string } | null> = {}
  for (const row of ends) {
    if (row.stage in out) continue
    const group = ends.filter((other) => !(other.stage in out) && other.index === row.index && Math.abs(Number(other.value) - Number(row.value)) < 7)
    group.forEach((other, i) => { out[other.stage] = i === 0 ? { index: row.index, text: group.map((g) => STAGE_LABELS[g.stage]).join(", ") } : null })
  }
  return out
}
function EndLabel({ at, last }: { at: { index: number; text: string } | null | undefined; last: number }) {
  return function Label(props: any) {
    const { x, y, index, value } = props
    if (!at || index !== at.index || value == null) return null
    // At the right edge the label sits beside the point; a line that ends earlier gets its label above the point.
    const edge = index === last
    return <text x={edge ? x + 6 : x + 4} y={y} dy={edge ? 4 : -9} fontSize={11.5} fill="hsl(var(--foreground))" stroke="hsl(var(--card))" strokeWidth={3} paintOrder="stroke">{at.text}</text>
  }
}

export default function QualityReportsPage() {
  const { activePlant, user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  // In-process QC works the floor only; incoming and complaint figures belong to the wider QC team.
  const seesGate = ["Owner", "Admin", "QC", "InwardQC", "PlantManager", "Planner"].some((role) => roles.has(role))
  const [from, setFrom] = useState(isoDaysAgo(91))
  const [to, setTo] = useState(isoDaysAgo(0))
  const params = useMemo(() => ({ date_from: from, date_to: to }), [from, to])
  const production = useQuery({ queryKey: ["quality-analytics", "production", activePlant, params], queryFn: async () => (await productionApi.getProductionQualityAnalytics(params)).data })
  const incoming = useQuery({ queryKey: ["quality-analytics", "incoming", activePlant, params], queryFn: async () => (await inventoryApi.getIncomingQualityAnalytics(params)).data, enabled: seesGate })
  const reasons = useReasonCodes("CUSTOMER_COMPLAINT", { includeInactive: true })
  // Batch checks store the parameter code (e.g. "id"); the stage rules give its name (e.g. "I.D.").
  const rules = useQuery({ queryKey: ["season-rules", "ROY"], queryFn: async () => (await seasonApi.rules("ROY")).data })
  const checkName = useMemo(() => {
    const names = new Map<string, string>()
    for (const rule of asArray((rules.data?.published || rules.data?.draft)?.rules)) names.set(`${rule.stage}:${rule.parameter}`, rule.label)
    return (stage: string, parameter: string) => names.get(`${stage}:${parameter}`) || parameter
  }, [rules.data])
  const reasonLabel = useMemo(() => new Map(asArray(reasons.data).map((row: any) => [row.code, row.label || row.name || row.code])), [reasons.data])

  const prod: any = production.data || {}
  const inc: any = incoming.data?.incoming || {}
  const returns: any = incoming.data?.customer_returns || {}
  const stages: any[] = asArray(prod.by_stage)
  const inProcess = stages.filter((row) => row.stage !== "QC")
  const inProcessUnits = inProcess.reduce((sum, row) => sum + Number(row.units ?? row.job_cards ?? 0), 0)
  const inProcessFirst = inProcess.reduce((sum, row) => sum + Number(row.first_pass || 0), 0)
  const finalStage = stages.find((row) => row.stage === "QC")

  const stagesInTrend = useMemo(() => STAGE_ORDER.filter((stage) => asArray(prod.weekly).some((row: any) => row.stage === stage)), [prod.weekly])
  const trend = useMemo(() => {
    const weeks = new Map<string, any>()
    for (const row of asArray(prod.weekly)) {
      const week = weeks.get(row.week) || { week: row.week }
      week[row.stage] = row.first_pass_yield
      week[`${row.stage}_units`] = row.units
      week[`${row.stage}_first`] = row.first_pass
      weeks.set(row.week, week)
    }
    return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
  }, [prod.weekly])
  const labels = useMemo(() => endLabels(trend, stagesInTrend), [trend, stagesInTrend])
  const incomingTrend: any[] = asArray(inc.weekly)
  const holdTrend: any[] = asArray(prod.holds_weekly)
  const reasonRows = asArray(returns.by_reason).map((row: any) => ({ ...row, label: reasonLabel.get(row.reason_code) || row.reason_code }))
  const maxFailing = Math.max(1, ...asArray(prod.failing_parameters).map((row: any) => Number(row.job_cards || 0)))
  const openHolds: any[] = asArray(prod.open_holds)

  return (
    <RoleGate allow={["QC", "InwardQC", "InProcessQC", "PlantManager", "Planner"]}>
      <div className="space-y-5" data-testid="quality-report-page">
        <PageHeader
          title="Quality analytics"
          description="How often work is right the first time — on the floor, at the gate and at the customer — and where it goes wrong."
          actions={<Link href="/reports/variance" className="erp-btn-secondary">Material variance<ArrowRight className="h-4 w-4" /></Link>}
        />
        <QualityDeskNav />

        <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Period">
          {PERIODS.map((period) => {
            const active = from === isoDaysAgo(period.days) && to === isoDaysAgo(0)
            return <button key={period.days} type="button" aria-pressed={active} onClick={() => { setFrom(isoDaysAgo(period.days)); setTo(isoDaysAgo(0)) }} className={cn("h-10 rounded-lg border px-3 text-sm font-medium", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>Last {period.label}</button>
          })}
          <label className="ml-1 space-y-1 text-sm"><span className="block text-xs text-muted-foreground">From</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-lg border border-border bg-card px-3" /></label>
          <label className="space-y-1 text-sm"><span className="block text-xs text-muted-foreground">To</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-lg border border-border bg-card px-3" /></label>
        </div>

        <section aria-label="Headline numbers" className={cn("grid gap-3 sm:grid-cols-2", seesGate ? "xl:grid-cols-5" : "xl:grid-cols-3")}>
          <Tile label="Floor batches right first time" value={production.isError ? "—" : pct(ratio(inProcessFirst, inProcessUnits))} tone={rateTone(ratio(inProcessFirst, inProcessUnits), "high")} detail={production.isError ? "Unavailable" : `${num(inProcessFirst)} of ${num(inProcessUnits)} checked batches · winding, oven, process`} />
          <Tile label="Final QC first pass" value={production.isError ? "—" : pct(finalStage?.first_pass_yield)} tone={rateTone(finalStage?.first_pass_yield, "high")} detail={finalStage ? `${num(finalStage.units ?? finalStage.job_cards)} checked` : "No final QC in this period"} />
          {seesGate ? <Tile label="Incoming lots first pass" value={incoming.isError ? "—" : pct(inc.first_pass_rate)} tone={rateTone(inc.first_pass_rate, "high")} detail={`${num(inc.lots_inspected)} lots · ${num(inc.reinspected_lots)} re-inspected`} /> : null}
          <Tile label="Holds waiting for a decision" href="/quality/results?tab=jobs" value={production.isError ? "—" : num(prod.holds?.still_open)} tone={prod.holds?.still_open ? "text-signal-amber-ink" : undefined} detail={`${num(prod.holds?.opened)} opened · avg ${prod.holds?.avg_hours_to_release == null ? "—" : `${prod.holds.avg_hours_to_release} h`} to decide`} />
          {seesGate ? <Tile label="Customer complaints" href="/quality/returns" value={incoming.isError ? "—" : num(returns.cases)} tone={returns.open_cases ? "text-signal-rose-ink" : undefined} detail={`${num(returns.open_cases)} open · ${num(returns.qty)} pcs · ₹${num(returns.cost_impact)}`} /> : null}
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <Section className="xl:col-span-2" title="Right first time, week by week" subtitle="Share of batches whose first QC check passed at each stage. Re-checks after a fix do not raise it.">
            {production.isLoading ? <LoadingState label="Loading the weekly trend…" /> : production.isError ? <ErrorState message="Stage results could not be loaded." onRetry={() => production.refetch()} /> : !trend.length ? <p className="py-8 text-center text-sm text-muted-foreground">No stage QC checks in this period yet. The chart fills in as QC records batch readings.</p> : (
              <>
                <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="Legend">
                  {stagesInTrend.map((stage) => <li key={stage} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: STAGE_COLOR[stage] }} aria-hidden="true" />{STAGE_LABELS[stage]}</li>)}
                </ul>
                <div className="h-64" role="img" aria-label="Weekly right-first-time percentage by stage. The stage table below lists the same figures.">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 20, right: 132, bottom: 0, left: -12 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11.5, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11.5, fill: AXIS }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ stroke: AXIS, strokeDasharray: "3 3" }} content={<ChartTooltip render={(payload: any[]) => payload.map((entry) => <p key={entry.dataKey} className="flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: entry.color }} />{STAGE_LABELS[entry.dataKey]}: <b className="tabular-nums">{pct(entry.value)}</b><span className="text-muted-foreground">({num(entry.payload[`${entry.dataKey}_first`])} of {num(entry.payload[`${entry.dataKey}_units`])})</span></p>)} />} />
                      {stagesInTrend.map((stage) => (
                        <Line key={stage} type="monotone" dataKey={stage} stroke={STAGE_COLOR[stage]} strokeWidth={2} dot={{ r: 3.5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: STAGE_COLOR[stage] }} activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }} connectNulls isAnimationActive={false}>
                          <LabelList dataKey={stage} content={EndLabel({ at: labels[stage], last: trend.length - 1 })} />
                        </Line>
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Section>

          <Section title="Waiting for a decision" subtitle="Batches held after a failed check. Plant head, Owner or Admin decides." action={<Link href="/quality/results?tab=jobs" className="text-[13px] font-semibold text-primary hover:underline">All holds</Link>}>
            {production.isLoading ? <LoadingState label="Loading holds…" /> : !openHolds.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing on hold in this period.</p> : (
              <ul className="-mx-4 -my-4 divide-y divide-border">
                {openHolds.slice(0, 8).map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                    <LockKeyhole className="h-4 w-4 shrink-0 text-signal-amber-ink" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.job_card_no || "Job card"} · {STAGE_LABELS[row.stage] || row.stage}</p>
                      <p className="truncate text-[12px] text-muted-foreground">{[row.customer, row.reason, row.hours_open != null && `${num(row.hours_open, 1)} h on hold`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Link href={`/quality/results?tab=jobs&card=${row.job_card_id}`} className="erp-btn-secondary !h-9 shrink-0">Decide</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Section title="By stage" subtitle="The same figures as the chart, for the whole period.">
            {production.isLoading ? <LoadingState label="Loading…" /> : production.isError ? <ErrorState message="Stage results could not be loaded." onRetry={() => production.refetch()} /> : (
              <Table
                head={["Stage", "Checked", "Right first time", "Rate", "All checks", "Failed checks"]}
                align={["left", "right", "right", "right", "right", "right"]}
                empty="No stage checks in this period."
                rows={stages.map((row) => [
                  <span key="s" className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLOR[row.stage] || AXIS }} aria-hidden="true" />{STAGE_LABELS[row.stage] || row.stage}</span>,
                  num(row.units ?? row.job_cards),
                  num(row.first_pass),
                  <b key="r" className={rateTone(row.first_pass_yield, "high")}>{pct(row.first_pass_yield)}</b>,
                  num(row.checks),
                  num(row.failed_checks),
                ])}
              />
            )}
          </Section>
          <Section title="Checks that fail first time" subtitle="Which reading fails most, counted once per job card.">
            {production.isLoading ? <LoadingState label="Loading…" /> : !asArray(prod.failing_parameters).length ? <p className="py-2 text-sm text-muted-foreground">No first-check failures in this period.</p> : (
              <ul className="space-y-2.5">
                {asArray(prod.failing_parameters).slice(0, 8).map((row: any) => (
                  <li key={`${row.stage}:${row.parameter}`} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="truncate">{checkName(row.stage, row.parameter)} <span className="text-muted-foreground">· {STAGE_LABELS[row.stage] || row.stage}</span></span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-signal-rose-ink/70" style={{ width: `${(Number(row.job_cards) / maxFailing) * 100}%` }} /></span>
                    <span className="text-right tabular-nums">{num(row.job_cards)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {seesGate ? <>
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <Section title="Incoming lots passing first time" subtitle="Weekly share of GRN lots inside their bands at the first inspection.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : incoming.isError ? <ErrorState message="Incoming results could not be loaded." onRetry={() => incoming.refetch()} /> : !incomingTrend.length ? <p className="py-8 text-center text-sm text-muted-foreground">No incoming inspections in this period.</p> : (
              <div className="h-48" role="img" aria-label="Weekly incoming first-pass percentage. The supplier table lists the figures.">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={incomingTrend} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 11.5, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} />
                    <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11.5, fill: AXIS }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ stroke: AXIS, strokeDasharray: "3 3" }} content={<ChartTooltip render={(payload: any[]) => <p><b className="tabular-nums">{pct(payload[0].value)}</b> <span className="text-muted-foreground">({num(payload[0].payload.first_pass)} of {num(payload[0].payload.lots)} lots)</span></p>} />} />
                    <Line type="monotone" dataKey="first_pass_rate" stroke={ONE_SERIES} strokeWidth={2} dot={{ r: 3.5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: ONE_SERIES }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>
          <Section className="xl:col-span-2" title="Suppliers" subtitle="Worst reject rate first. Rejected means the lot was blocked, scrapped or returned.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : incoming.isError ? <ErrorState message="Supplier quality could not be loaded." onRetry={() => incoming.refetch()} /> : (
              <Table
                head={["Supplier", "Lots", "First pass", "Rejected", "Returned", "Reject rate", "Rejected qty"]}
                align={["left", "right", "right", "right", "right", "right", "right"]}
                empty="No incoming inspections in this period."
                rows={asArray(inc.by_supplier).map((row: any) => [row.supplier, num(row.lots), pct(row.first_pass_rate), num(row.rejected), num(row.returned), <b key="r" className={rateTone(row.reject_rate, "low")}>{pct(row.reject_rate)}</b>, num(row.rejected_qty, 2)])}
              />
            )}
          </Section>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Section title="Materials" subtitle="Which materials fail most often at the gate.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <Table head={["Material", "Lots", "First pass", "Reject rate"]} align={["left", "right", "right", "right"]} empty="No incoming inspections in this period."
                rows={asArray(inc.by_material).slice(0, 12).map((row: any) => [row.material, num(row.lots), pct(row.first_pass_rate), <b key="r" className={rateTone(row.reject_rate, "low")}>{pct(row.reject_rate)}</b>])} />
            )}
          </Section>
          <Section title="Incoming checks that fail" subtitle="Counted once per lot, at its first inspection.">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <Table head={["Check", "Lots"]} align={["left", "right"]} empty="No incoming check failed first time."
                rows={asArray(inc.failing_parameters).map((row: any) => [row.parameter, num(row.lots)])} />
            )}
          </Section>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Section title="Customer complaints by reason" subtitle="Reasons come from the Customer complaints master." action={<Link href="/quality/returns" className="text-[13px] font-semibold text-primary hover:underline">Open register</Link>}>
            {incoming.isLoading ? <LoadingState label="Loading…" /> : !reasonRows.length ? <p className="py-2 text-sm text-muted-foreground">No customer complaints in this period.</p> : (
              <div style={{ height: Math.max(120, reasonRows.length * 36 + 16) }} role="img" aria-label="Complaint cases by reason. The table beside lists customers.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reasonRows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={8}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: GRID }} content={({ active, payload }: any) => active && payload?.length ? <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] shadow-md"><p className="font-semibold">{payload[0].payload.label}</p><p>{num(payload[0].payload.cases)} cases · {num(payload[0].payload.qty)} pcs · {num(payload[0].payload.open)} open</p></div> : null} />
                    <Bar dataKey="cases" fill={ONE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                      <LabelList dataKey="cases" position="right" fontSize={12} fill="hsl(var(--foreground))" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>
          <Section title="Customer complaints by customer">
            {incoming.isLoading ? <LoadingState label="Loading…" /> : (
              <Table head={["Customer", "Cases", "Qty", "Open", "Cost impact"]} align={["left", "right", "right", "right", "right"]} empty="No customer complaints in this period."
                rows={asArray(returns.by_customer).map((row: any) => [row.customer, num(row.cases), num(row.qty, 2), num(row.open), `₹${num(row.cost_impact)}`])} />
            )}
          </Section>
        </div>

        </> : null}

        {holdTrend.length ? (
          <Section title="Holds by week" subtitle="Holds opened each week and how many of them have been decided.">
            <Table head={["Week of", "Opened", "Decided", "Still open"]} align={["left", "right", "right", "right"]} empty=""
              rows={holdTrend.slice().reverse().map((row) => [weekLabel(row.week), num(row.opened), num(row.released), num(row.opened - row.released)])} />
          </Section>
        ) : null}

        <aside className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4 text-[12.5px] leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <b className="text-foreground">How these numbers are counted.</b> Every QC check is saved as an inspection: an incoming lot at the gate, a batch at a stage, a final QC check or a complaint decision.
            Only the <b className="text-foreground">first</b> check of each batch or lot counts toward “right first time”; a re-check after a fix shows in “All checks” but never raises the rate.
            Readings that are only recorded (no band set) never count as a failure. Every check is listed under Holds &amp; inspections → All inspections.
          </p>
        </aside>
      </div>
    </RoleGate>
  )
}
