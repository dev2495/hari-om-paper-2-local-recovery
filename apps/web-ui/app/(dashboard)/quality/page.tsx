"use client"

import Link from "next/link"
import { useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, BarChart3, ClipboardCheck, Factory, FlaskConical, LockKeyhole, RefreshCw, Ruler, ShieldCheck, Undo2 } from "lucide-react"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useCustomerRejections, useInventoryQualityInspections, usePendingInventoryQuality } from "@/hooks/use-inventory"
import { useInProcessQcDue, usePlanningJobCards, useQualityHolds, useQualityInspections, useQualitySummary } from "@/hooks/use-production"
import { seasonApi, seasonLabel } from "@/lib/season-api"
import { cn } from "@/lib/utils"

const toDate = (value?: string) => (value ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`) : null)
const stamp = (value?: string) => toDate(value)?.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) ?? "—"
const since = (value?: string) => {
  const date = toDate(value)
  if (!date) return ""
  const hours = (Date.now() - date.getTime()) / 3_600_000
  return hours < 1 ? "under 1 h" : hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`
}
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
const asArray = (value: any) => (Array.isArray(value) ? value : [])
const STAGE: Record<string, string> = { WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC", PACKING: "Packing" }
const isToday = (value?: string) => toDate(value)?.toDateString() === new Date().toDateString()

function Verdict({ status }: { status?: string }) {
  const value = String(status || "").toUpperCase()
  const pass = ["PASS", "OBSERVATION_ONLY", "OBSERVATION", "ACCEPT"].includes(value)
  const fail = ["FAIL", "INVALID", "REJECT", "BLOCK"].includes(value)
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", pass ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : fail ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-muted text-muted-foreground ring-border")}>{pass ? "Pass" : fail ? "Fail" : value ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ") : "—"}</span>
}

function Queue({ title, subtitle, href, linkLabel, testId, children }: { title: string; subtitle: string; href: string; linkLabel: string; testId: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid={testId}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0"><h2 className="font-semibold">{title}</h2><p className="text-[12.5px] text-muted-foreground">{subtitle}</p></div>
        <Link href={href} className="shrink-0 text-[13px] font-semibold text-primary hover:underline">{linkLabel}</Link>
      </header>
      {children}
    </section>
  )
}

function Clear({ icon: Icon, title, detail }: { icon: any; title: string; detail: string }) {
  return <div className="px-6 py-8 text-center"><Icon className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" /><p className="font-semibold">{title}</p><p className="mt-1 text-[12.5px] text-muted-foreground">{detail}</p></div>
}

export default function QualityDeskPage() {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const hasRole = (allowed: string[]) => ["Owner", "Admin", ...allowed].some((role) => roles.has(role))
  // Role views: an inward inspector sees the gate only; an in-process inspector sees the floor only.
  const seesIncoming = hasRole(["QC", "InwardQC", "PlantManager", "Store"])
  const seesFloor = hasRole(["QC", "InProcessQC", "PlantManager"])
  const seesComplaints = hasRole(["QC", "PlantManager", "Store", "Sales", "Dispatch"])
  const canInspectLots = hasRole(["QC", "InwardQC"])
  const canAddStageQc = hasRole(["QC", "InProcessQC", "PlantManager"])
  const canDecide = hasRole(["PlantManager"])
  const canDecideLots = hasRole(["PlantManager", "QC", "InwardQC"])

  const pending = usePendingInventoryQuality(seesIncoming)
  const due = useInProcessQcDue(seesFloor)
  const holds = useQualityHolds({ limit: 150, status: "HOLD" }, seesFloor || canDecide)
  const jobCards = usePlanningJobCards({ limit: 300 }, seesFloor || canDecide)
  const summary = useQualitySummary(seesFloor)
  const returns = useCustomerRejections({ limit: 200 }, seesComplaints)
  const incoming = useInventoryQualityInspections({ limit: 100 }, seesIncoming)
  const production = useQualityInspections({ limit: 100 }, seesFloor)
  const roy = useQuery({ queryKey: ["season-rules", "ROY"], queryFn: async () => (await seasonApi.rules("ROY")).data, enabled: seesFloor })
  const monsoon = useQuery({ queryKey: ["season-rules", "MONSOON"], queryFn: async () => (await seasonApi.rules("MONSOON")).data, enabled: seesFloor })

  const lots = asArray(pending.data)
  const awaiting = lots.filter((row: any) => !row.queue_state || row.queue_state === "AWAITING_INSPECTION")
  const overdue = awaiting.filter((row: any) => row.overdue)
  const heldLots = lots.filter((row: any) => ["FAILED", "REJECTED"].includes(String(row.queue_state || "")))
  const jobHolds = asArray(holds.data).filter((row: any) => String(row.status || "").toUpperCase() === "HOLD")
  const dueRows = asArray(due.data)
  const openReturns = asArray(returns.data).filter((row: any) => !row.closed_at && String(row.closure_status || "").toUpperCase() !== "CLOSED")
  const returnsToDecide = openReturns.filter((row: any) => !row.disposition || ["HOLD", "BLOCK"].includes(String(row.disposition).toUpperCase()))
  const jobMap = useMemo(() => new Map(asArray(jobCards.data).map((job: any) => [String(job.id), job])), [jobCards.data])

  // Everything held, oldest first: inward lots outside their band and floor batches that failed stage QC.
  const decisions = useMemo(() => [
    ...(seesIncoming ? heldLots.map((row: any) => ({
      key: `lot:${row.entity_type}:${row.entity_id}`, kind: "Inward lot", title: row.label,
      detail: [row.supplier_or_customer, row.grn_no, `${fmt(row.qty)} ${row.uom || "KG"}`].filter(Boolean).join(" · "),
      at: row.created_at || row.received_date, href: `/quality/incoming?lot=${row.entity_type}:${row.entity_id}`, can: canDecideLots,
    })) : []),
    ...(seesFloor || canDecide ? jobHolds.map((row: any) => {
      const job: any = jobMap.get(String(row.job_card_id))
      return {
        key: `hold:${row.id}`, kind: `${STAGE[String(row.stage_type || "").toUpperCase()] || "Stage"} batch`, title: `${job?.job_card_no || "Job card"}${job?.customer_name ? ` · ${job.customer_name}` : ""}`,
        detail: row.reason, at: row.created_at, href: `/quality/results?tab=jobs&card=${row.job_card_id}`, can: canDecide,
      }
    }) : []),
  ].sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))), [seesIncoming, seesFloor, canDecide, canDecideLots, heldLots, jobHolds, jobMap])

  const recent = useMemo(() => [
    ...asArray(incoming.data).map((row: any) => ({ ...row, where: "Incoming", title: row.entity_label || "Material lot", href: `/quality/results?tab=register` })),
    ...asArray(production.data).map((row: any) => ({ ...row, where: STAGE[row.stage_type] || "In-process", title: row.job_card_no || jobMap.get(String(row.job_card_id))?.job_card_no || "Job card", href: `/production/job-cards/${row.job_card_id}` })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [incoming.data, production.data, jobMap])
  const today = recent.filter((row) => isToday(row.created_at))
  const failedToday = today.filter((row) => ["FAIL", "INVALID"].includes(String(row.status || "").toUpperCase()))
  // Pass rate comes from the server aggregate over all production inspections, never from a loaded page.
  const passRate = summary.data?.pass_rate == null ? null : Number(summary.data.pass_rate)
  const refresh = () => [pending, due, holds, returns, incoming, production, summary, jobCards].forEach((query) => void query.refetch())

  const tiles = [
    { href: "/quality/incoming", label: "Incoming lots to inspect", value: pending.isLoading ? "…" : awaiting.length, detail: overdue.length ? `${overdue.length} past the 24-hour deadline` : "Oldest first · 24-hour deadline", icon: FlaskConical, urgent: overdue.length > 0, show: seesIncoming },
    { href: "/quality/stage", label: "Batches waiting for stage QC", value: due.isLoading ? "…" : dueRows.length, detail: "The next stage opens once QC accepts", icon: Factory, urgent: dueRows.length > 0, show: seesFloor },
    { href: "/quality/results", label: "On hold — decision needed", value: (seesIncoming && pending.isLoading) || holds.isLoading ? "…" : decisions.length, detail: [seesIncoming && `${heldLots.length} inward lot${heldLots.length === 1 ? "" : "s"}`, (seesFloor || canDecide) && `${jobHolds.length} floor batch${jobHolds.length === 1 ? "" : "es"}`].filter(Boolean).join(" · "), icon: LockKeyhole, urgent: decisions.length > 0, show: true },
    { href: "/quality/returns", label: "Customer complaints open", value: returns.isLoading ? "…" : openReturns.length, detail: `${returnsToDecide.length} waiting for a QC decision`, icon: Undo2, urgent: returnsToDecide.length > 0, show: seesComplaints },
  ].filter((tile) => tile.show)

  return (
    <RoleGate allow={["QC", "InwardQC", "InProcessQC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-5" data-testid="quality:page">
        <PageHeader
          title="QC desk"
          description={seesIncoming && !seesFloor ? "Incoming lots waiting for inspection and lots held at the gate." : !seesIncoming && seesFloor ? "Floor batches waiting for stage QC and batches held for a decision." : "What needs quality control right now. Anything held stays held until it is decided."}
          actions={<button type="button" className="erp-btn-secondary" onClick={refresh}><RefreshCw className="h-4 w-4" />Refresh</button>}
        />
        <QualityDeskNav />

        <section aria-label="Needs action" className={cn("grid gap-3 sm:grid-cols-2", tiles.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href} className={cn("group flex min-h-[124px] flex-col justify-between rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tile.urgent ? "border-signal-amber-line" : "border-border")} data-testid={`qc-tile-${tile.href.split("/").pop()}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-semibold text-foreground/80">{tile.label}</p>
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tile.urgent ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-emerald-soft text-signal-emerald-ink")}><tile.icon className="h-4 w-4" aria-hidden="true" /></span>
              </div>
              <div>
                <p className="text-[32px] font-semibold leading-none tabular-nums tracking-tight">{tile.value}</p>
                <p className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">{tile.detail}<ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></p>
              </div>
            </Link>
          ))}
        </section>

        {decisions.length ? (
          <section className="overflow-hidden rounded-xl border border-signal-amber-line bg-card" data-testid="qc-decisions">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-signal-amber-soft/50 px-4 py-3">
              <div><h2 className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-signal-amber-ink" aria-hidden="true" />Held — waiting for a decision</h2><p className="text-[12.5px] text-muted-foreground">Inward lots: QC re-inspects, the plant head concedes or Store returns. Floor batches: plant head, Owner or Admin releases, reworks or scraps.</p></div>
              <Link href="/quality/results" className="text-[13px] font-semibold text-primary hover:underline">Holds &amp; inspections</Link>
            </header>
            <ul className="divide-y divide-border">
              {decisions.slice(0, 8).map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-28 shrink-0 text-[12px] font-semibold text-muted-foreground">{row.kind}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{row.detail}</p>
                  </div>
                  {row.at ? <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">waiting {since(row.at)}</span> : null}
                  <Link className={cn("!h-9 shrink-0", row.can ? "erp-btn-primary" : "erp-btn-secondary")} href={row.href}>{row.can ? "Decide" : "View"}</Link>
                </li>
              ))}
              {decisions.length > 8 ? <li className="px-4 py-2.5 text-[12.5px] text-muted-foreground">+ {decisions.length - 8} more on Holds &amp; inspections</li> : null}
            </ul>
          </section>
        ) : null}

        <div className={cn("grid items-start gap-4", seesIncoming && seesFloor ? "xl:grid-cols-2" : "")}>
          {seesIncoming ? (
            <Queue title="Incoming lots" subtitle="Checked against the bands set in Masters · oldest due first" href="/quality/incoming" linkLabel="Open incoming QC" testId="qc-incoming-queue">
              {pending.isLoading ? <LoadingState label="Loading incoming lots…" /> : pending.isError ? <ErrorState message="Incoming queue unavailable. This is not an empty queue." onRetry={() => pending.refetch()} /> : awaiting.length ? (
                <ul className="divide-y divide-border">
                  {awaiting.slice(0, 8).map((row: any) => (
                    <li key={`${row.entity_type}:${row.entity_id}`} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{row.label}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{[row.supplier_or_customer, row.grn_no, `${fmt(row.qty)} ${row.uom || "KG"}`].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", row.overdue ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-muted text-muted-foreground ring-border")}>{row.overdue ? "Overdue" : `Due ${stamp(row.due_at)}`}</span>
                      {canInspectLots ? <Link className="erp-btn-primary !h-9 shrink-0" href={`/quality/incoming?lot=${row.entity_type}:${row.entity_id}`}>Inspect</Link> : null}
                    </li>
                  ))}
                  {awaiting.length > 8 ? <li className="px-4 py-2.5 text-[12.5px] text-muted-foreground">+ {awaiting.length - 8} more on incoming QC</li> : null}
                </ul>
              ) : <Clear icon={ShieldCheck} title="Incoming queue is clear" detail="New GRN lots appear here automatically." />}
            </Queue>
          ) : null}

          {seesFloor ? (
            <Queue title="Stage QC due" subtitle="Batches the next stage is waiting on · at least 2 readings per check" href="/quality/stage" linkLabel="In-process QC" testId="qc-stage-queue">
              {due.isLoading ? <LoadingState label="Loading stage QC queue…" /> : due.isError ? <ErrorState message="Stage QC queue unavailable." onRetry={() => due.refetch()} /> : dueRows.length ? (
                <ul className="divide-y divide-border">
                  {dueRows.slice(0, 8).map((row: any) => (
                    <li key={row.entry_id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{row.job_card_no} · {row.stage_label} batch #{row.entry_no}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{[row.customer, `${fmt(row.accepted)} ${row.unit || ""}`, row.shift_code && `Shift ${String(row.shift_code).replace("SHIFT_", "")}`].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", row.state === "FAILED" ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line")}>
                        {row.state === "FAILED" ? "Failed — on hold" : row.state === "NO_READINGS" ? "No readings yet" : row.state === "MORE_READINGS" ? `More readings: ${asArray(row.readings_short).slice(0, 2).map((s: any) => s.label).join(", ")}` : "Readings incomplete"}
                      </span>
                      {canAddStageQc ? <Link className="erp-btn-primary !h-9 shrink-0" href={`/production/job-cards/${row.job_card_id}?stage=${row.stage}`}>Add QC</Link> : null}
                    </li>
                  ))}
                  {dueRows.length > 8 ? <li className="px-4 py-2.5 text-[12.5px] text-muted-foreground">+ {dueRows.length - 8} more batches</li> : null}
                </ul>
              ) : <Clear icon={ClipboardCheck} title="Every batch on the floor is QC-accepted" detail="New batches appear here as soon as the floor saves them." />}
            </Queue>
          ) : null}
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <section className="overflow-hidden rounded-xl border border-border bg-card xl:col-span-2" data-testid="qc-latest">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">Latest checks</h2><p className="text-[12.5px] text-muted-foreground">Today: {today.length} check{today.length === 1 ? "" : "s"}{failedToday.length ? ` · ${failedToday.length} failed` : ""}</p></div>
              <Link href="/quality/results?tab=register" className="text-[13px] font-semibold text-primary hover:underline">All inspections</Link>
            </header>
            {(seesIncoming && incoming.isLoading) || (seesFloor && production.isLoading) ? <LoadingState label="Loading latest checks…" /> : recent.length ? (
              <ul className="divide-y divide-border">
                {recent.slice(0, 6).map((row: any) => (
                  <li key={`${row.where}:${row.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-24 shrink-0 text-[12px] font-semibold text-muted-foreground">{row.where}</span>
                    <Link href={row.href} className="min-w-0 flex-1 truncate font-medium hover:underline">{row.title}</Link>
                    <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">{stamp(row.created_at)}</span>
                    <Verdict status={row.status} />
                  </li>
                ))}
              </ul>
            ) : <Clear icon={ClipboardCheck} title="No checks recorded yet" detail="Every inward and stage check shows here as it is saved." />}
          </section>

          <div className="grid gap-3" aria-label="Standards and results">
            <Link href="/quality/material-standards" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40">
              <p className="flex items-center gap-2 text-sm font-semibold"><Ruler className="h-4 w-4 text-primary" aria-hidden="true" />Material standards</p>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">The checks on every incoming material. Bands per line or group are set in Masters.</p>
            </Link>
            {seesFloor ? (
              <Link href="/quality/stage-rules" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40">
                <p className="flex items-center gap-2 text-sm font-semibold"><Factory className="h-4 w-4 text-primary" aria-hidden="true" />Process stage rules</p>
                <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{seasonLabel("ROY")} v{roy.data?.published?.version ?? "—"} · {seasonLabel("MONSOON")} v{monsoon.data?.published?.version ?? "—"} in use. New job cards take the current version when released.</p>
              </Link>
            ) : null}
            <Link href="/reports/quality" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40">
              <p className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />Quality analytics</p>
              {seesFloor && passRate != null ? (
                <>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-signal-rose-soft" aria-hidden="true"><span className="bg-signal-emerald-ink" style={{ width: `${passRate}%` }} /></div>
                  <p className="mt-1.5 text-[12.5px] text-muted-foreground">{passRate.toFixed(1)}% production pass rate · {summary.data?.measured_count ?? 0} measured</p>
                </>
              ) : <p className="mt-1 text-[12.5px] text-muted-foreground">{seesFloor ? (summary.isError ? "Pass rate unavailable — " : "No data — no measured production checks yet. ") : ""}Right first time by week, suppliers and complaints.</p>}
            </Link>
          </div>
        </div>
      </div>
    </RoleGate>
  )
}
