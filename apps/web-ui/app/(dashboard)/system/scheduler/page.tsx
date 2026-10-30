"use client"

import { useMemo } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  NoteCallout,
  Panel,
  Pill,
  ReportHero,
} from "@/components/reports/primitives"
import { useSchedulerStatus } from "@/hooks/use-analytics"
import { cn } from "@/lib/utils"

// Background jobs (menu name since 2026-10-28): the timers the system runs by itself, in plain words.
const JOB_INFO: Record<string, { name: string; detail: string }> = {
  owner_pack_daily: { name: "Owner's daily summary", detail: "Builds the morning summary of orders, production, quality and stock for the Owner." },
  exceptions_check_hourly: { name: "Hourly check for late or stuck work", detail: "Looks for late orders, blocked job cards and held lots, and sends alerts." },
  background_job_worker: { name: "Report and alert queue", detail: "Works through waiting reports and alerts every few seconds." },
}

const STATUS_WORD: Record<string, { word: string; tone: "ok" | "info" | "critical" | "neutral" }> = {
  OK: { word: "Done", tone: "ok" },
  SUCCEEDED: { word: "Done", tone: "ok" },
  RUNNING: { word: "Running now", tone: "info" },
  SCHEDULED: { word: "Waiting for its time", tone: "info" },
  QUEUED: { word: "Waiting in queue", tone: "info" },
  FAIL: { word: "Failed", tone: "critical" },
  FAILED: { word: "Failed", tone: "critical" },
}

function statusOf(status?: string) {
  if (!status) return { word: "Not run yet", tone: "neutral" as const }
  return STATUS_WORD[status.toUpperCase()] || { word: status.charAt(0) + status.slice(1).toLowerCase(), tone: "neutral" as const }
}

/** "30 Oct 2026, 6:30 am" in IST. Server times without a zone are UTC. */
function istTime(value?: string | null) {
  if (!value) return "—"
  const text = String(value)
  const stamp = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`)
  if (Number.isNaN(stamp.getTime())) return "—"
  return stamp.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

/** The two timetables the system uses, in words ("every day at 6:30 am", "every hour"). */
function timetableWords(cron?: string | null) {
  const parts = String(cron || "").trim().split(/\s+/)
  if (parts.length !== 5) return "on a set timetable"
  const [minute, hour, day, month, weekday] = parts
  if (day !== "*" || month !== "*" || weekday !== "*") return "on a set timetable"
  if (hour === "*" && /^\d+$/.test(minute)) return Number(minute) === 0 ? "every hour, on the hour" : `every hour at ${minute} minutes past`
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    const h = Number(hour)
    return `every day at ${h % 12 || 12}:${String(Number(minute)).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`
  }
  return "on a set timetable"
}

const IST_OFFSET_MS = 5.5 * 3600_000

/** The next run of a daily ("30 6 * * *") or hourly ("0 * * * *") timetable, as an instant; null otherwise. */
function nextFromCron(cron?: string | null, now: Date = new Date()): Date | null {
  const parts = String(cron || "").trim().split(/\s+/)
  if (parts.length !== 5 || parts.slice(2).some((part) => part !== "*") || !/^\d+$/.test(parts[0])) return null
  const minute = Number(parts[0])
  const ist = new Date(now.getTime() + IST_OFFSET_MS) // IST wall clock read through the UTC getters
  if (parts[1] === "*") {
    let at = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), ist.getUTCHours(), minute) - IST_OFFSET_MS
    if (at <= now.getTime()) at += 3600_000
    return new Date(at)
  }
  if (!/^\d+$/.test(parts[1])) return null
  let at = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), Number(parts[1]), minute) - IST_OFFSET_MS
  if (at <= now.getTime()) at += 86_400_000
  return new Date(at)
}

/** "Today, 3:00 pm", "Tomorrow, 6:30 am", else "2 Nov 2026, 6:30 am" (IST). */
function whenWords(value?: string | Date | null, now: Date = new Date()) {
  if (!value) return "—"
  const text = String(value instanceof Date ? value.toISOString() : value)
  const stamp = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`)
  if (Number.isNaN(stamp.getTime())) return "—"
  const day = (date: Date) => Math.floor((date.getTime() + IST_OFFSET_MS) / 86_400_000)
  const time = stamp.toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
  const diff = day(stamp) - day(now)
  return diff === 0 ? `Today, ${time}` : diff === 1 ? `Tomorrow, ${time}` : istTime(text)
}

const GLANCE_TONE: Record<"rose" | "emerald" | "cyan", string> = {
  rose: "before:bg-signal-rose-ink/70",
  emerald: "before:bg-signal-emerald-ink/70",
  cyan: "before:bg-signal-cyan-ink/70",
}

/** A job at a glance: its name, its state, and when it last ran and runs next (IST). */
function JobGlance({ name, tone, loading, state, last, lastFallback, next, timetable }: {
  name: string
  tone: "rose" | "emerald" | "cyan"
  loading: boolean
  state: { word: string; tone: "ok" | "info" | "critical" | "neutral" }
  last: string | null
  lastFallback: string
  next: string
  timetable: string
}) {
  const timetableText = timetable.charAt(0).toUpperCase() + timetable.slice(1)
  return (
    <section aria-label={name} className={cn("tube-kpi relative !py-3.5 before:absolute before:left-0 before:top-3.5 before:h-6 before:w-[3px] before:rounded-r-full", GLANCE_TONE[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 text-[13.5px] font-semibold leading-5 text-foreground">{name}</h2>
        {loading ? null : <Pill tone={state.tone}>{state.word}</Pill>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">Last run</dt>
          <dd className={cn("mt-1 font-semibold leading-tight tabular-nums text-foreground", last ? "text-[18px] tracking-tight" : "text-[14px]")}>{loading ? "…" : last || lastFallback}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">Next run</dt>
          <dd className="mt-1 text-[18px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">{loading ? "…" : next}</dd>
          {loading ? null : <dd className="mt-1 text-[11.5px] leading-4 text-muted-foreground">{timetableText}</dd>}
        </div>
      </dl>
    </section>
  )
}

export default function SchedulerWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <SchedulerPage />
    </RoleGate>
  )
}

function SchedulerPage() {
  const { data, isLoading, isError } = useSchedulerStatus()
  const enabled = Boolean((data as any)?.enabled)
  const jobs: Record<string, any> = useMemo(() => ((data as any)?.jobs || {}), [data])
  const nextRuns: Record<string, string | null> = useMemo(() => ((data as any)?.next_runs || {}), [data])
  const ownerPackInProcess = Boolean((data as any)?.owner_pack_in_process)
  const ownerPack = jobs["owner_pack_daily"] || {}
  const exceptionsCheck = jobs["exceptions_check_hourly"] || {}
  const jobIds = Object.keys({ owner_pack_daily: 1, exceptions_check_hourly: 1, ...jobs })
  // One next-run source for the cards and the table: the server's next run, else the job's own timetable.
  const cronOf: Record<string, string | undefined> = { owner_pack_daily: (data as any)?.owner_pack_cron, exceptions_check_hourly: (data as any)?.exceptions_cron }
  const nextRunFor = (jobId: string): string | Date | null => nextRuns[jobId] || (enabled ? nextFromCron(cronOf[jobId]) : null)
  /**
   * The job's state in words. The timer leaves a finished job as QUEUED or SCHEDULED until its next turn,
   * so a job whose last run finished reads "Done · next at …"; "Waiting in queue" is kept for a run that was
   * really started and has not finished.
   */
  const stateFor = (jobId: string) => {
    const row = jobs[jobId] || {}
    const status = String(row.status || "").toUpperCase()
    const next = nextRunFor(jobId)
    const finishedAfterStart = Boolean(row.last_finished_at) && (!row.last_started_at || String(row.last_finished_at) >= String(row.last_started_at))
    if (status === "RUNNING" || status === "FAIL" || status === "FAILED") return statusOf(status)
    if (["QUEUED", "SCHEDULED", "OK", "SUCCEEDED"].includes(status) && finishedAfterStart) {
      return { word: next ? `Done · next ${whenWords(next).replace(/^Today, /, "at ").replace(/^Tomorrow, /, "tomorrow ")}` : "Done", tone: "ok" as const }
    }
    if (status === "QUEUED" && row.last_started_at) return statusOf(status)
    if (status === "QUEUED" || status === "SCHEDULED") return { word: "Waiting for its time", tone: "info" as const }
    if (!status && jobId === "owner_pack_daily" && !ownerPackInProcess && enabled) return { word: "Run by the server's timer", tone: "neutral" as const }
    return statusOf(row.status)
  }
  const failed = jobIds.filter((id) => stateFor(id).tone === "critical").length
  const kpiTone = (jobId: string) => (stateFor(jobId).tone === "critical" ? "rose" : stateFor(jobId).tone === "ok" ? "emerald" : "cyan")

  return (
    <div className="space-y-5 px-4 pb-10 pt-2 sm:px-6" data-testid="system-scheduler-page">
      <ReportHero
        eyebrow="System · Background jobs"
        title={isLoading ? "Background jobs" : enabled ? "Background jobs are running" : "Background jobs are stopped"}
        description="Work the system does by itself on a timetable: the Owner's daily summary, an hourly check for late or stuck work, and the queue that sends reports and alerts."
        accent={isLoading ? "slate" : enabled ? "emerald" : "rose"}
        chips={isLoading ? [] : [
          { label: enabled ? "Running" : "Stopped", tone: enabled ? "ok" : "critical" },
          { label: `Daily summary ${timetableWords((data as any)?.owner_pack_cron)}`, tone: "neutral" },
          { label: `Late-work check ${timetableWords((data as any)?.exceptions_cron)}`, tone: "neutral" },
          ...(failed ? [{ label: `${failed} job${failed === 1 ? "" : "s"} failed`, tone: "critical" as const }] : []),
        ]}
      />

      {isError ? (
        <NoteCallout tone="critical">The job status could not be read from the reports service. Refresh in a minute; if it stays like this, ask the developer to check the reports service.</NoteCallout>
      ) : !isLoading && !enabled ? (
        <NoteCallout tone="warn">
          Background jobs are not running, so the daily summary and the hourly alerts are not sent by themselves. Reports still open when someone asks for them. Ask the developer to switch the job timer on for the reports service.
        </NoteCallout>
      ) : null}
      {!isLoading && enabled && !ownerPackInProcess ? (
        <NoteCallout tone="neutral">The server&apos;s own timer sends the Owner&apos;s daily summary {timetableWords((data as any)?.owner_pack_cron)}. Those runs are not listed on this page; the next one follows the timetable.</NoteCallout>
      ) : null}

      {/* One card per job, so each figure keeps a short label ("Last run", "Next run") that never cuts on a phone (30 Oct). */}
      <div className="stagger grid gap-3 md:grid-cols-2">
        <JobGlance
          name="Owner's daily summary"
          tone={kpiTone("owner_pack_daily")}
          loading={isLoading}
          state={stateFor("owner_pack_daily")}
          last={ownerPack.last_finished_at || ownerPack.last_started_at ? whenWords(ownerPack.last_finished_at || ownerPack.last_started_at) : null}
          lastFallback={enabled && !ownerPackInProcess ? "Sent by the server timer" : "Not run yet"}
          next={whenWords(nextRunFor("owner_pack_daily"))}
          timetable={timetableWords((data as any)?.owner_pack_cron)}
        />
        <JobGlance
          name="Hourly check for late or stuck work"
          tone={kpiTone("exceptions_check_hourly")}
          loading={isLoading}
          state={stateFor("exceptions_check_hourly")}
          last={exceptionsCheck.last_finished_at || exceptionsCheck.last_started_at ? whenWords(exceptionsCheck.last_finished_at || exceptionsCheck.last_started_at) : null}
          lastFallback="Not run yet"
          next={whenWords(nextRunFor("exceptions_check_hourly"))}
          timetable={timetableWords((data as any)?.exceptions_cron)}
        />
      </div>

      <Panel eyebrow="Jobs" title="Every background job" description="When each job last ran, when it runs next, and what went wrong if it failed. Times are in IST.">
        {isLoading ? (
          <NoteCallout tone="neutral">Loading background jobs…</NoteCallout>
        ) : (
          <>
            <ul className="space-y-2.5 sm:hidden" aria-label="Background jobs">
              {jobIds.map((jobId) => {
                const row = jobs[jobId] || {}
                const info = JOB_INFO[jobId] || { name: jobId.replace(/_/g, " "), detail: "" }
                const state = stateFor(jobId)
                return (
                  <li key={jobId} className="rounded-xl border border-border bg-card p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[14px] font-semibold text-foreground">{info.name}</p>
                      <Pill tone={state.tone}>{state.word}</Pill>
                    </div>
                    {info.detail ? <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{info.detail}</p> : null}
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                      <dt className="text-muted-foreground">Last run</dt><dd className="text-right tabular-nums">{!(row.last_finished_at || row.last_started_at) && jobId === "owner_pack_daily" && enabled && !ownerPackInProcess ? "Sent by the server timer" : whenWords(row.last_finished_at || row.last_started_at)}</dd>
                      <dt className="text-muted-foreground">Next run</dt><dd className="text-right tabular-nums">{whenWords(nextRunFor(jobId))}</dd>
                    </dl>
                    {row.last_error ? <p className="mt-2 break-words rounded-lg bg-signal-rose-soft px-2.5 py-2 text-[12.5px] text-signal-rose-ink">What went wrong: {row.last_error}</p> : null}
                  </li>
                )
              })}
            </ul>
            <div className="hidden overflow-x-auto sm:block"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Last started</th>
                  <th className="py-2 pr-3">Last finished</th>
                  <th className="py-2 pr-3">Next run</th>
                  <th className="py-2 pr-3">What went wrong</th>
                </tr>
              </thead>
              <tbody>
                {jobIds.map((jobId) => {
                  const row = jobs[jobId] || {}
                  const info = JOB_INFO[jobId] || { name: jobId.replace(/_/g, " "), detail: "" }
                  const state = stateFor(jobId)
                  return (
                    <tr key={jobId} className="border-b border-border align-top">
                      <td className="py-2.5 pr-3"><p className="font-medium text-foreground">{info.name}</p>{info.detail ? <p className="mt-0.5 max-w-[320px] text-[12px] leading-5 text-muted-foreground">{info.detail}</p> : null}</td>
                      <td className="py-2.5 pr-3"><Pill tone={state.tone}>{state.word}</Pill></td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs tabular-nums">{whenWords(row.last_started_at)}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs tabular-nums">{whenWords(row.last_finished_at)}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs tabular-nums">{whenWords(nextRunFor(jobId))}</td>
                      <td className="max-w-[280px] break-words py-2.5 pr-3 text-xs text-signal-rose-ink">{row.last_error || <span className="text-muted-foreground">Nothing</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
          </>
        )}
      </Panel>
    </div>
  )
}
