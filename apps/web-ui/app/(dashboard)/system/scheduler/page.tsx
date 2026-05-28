"use client"

import { useMemo } from "react"

import { RoleGate } from "@/components/workspace/role-gate"
import {
  KpiRail,
  NoteCallout,
  Panel,
  Pill,
  ReportHero,
} from "@/components/reports/primitives"
import { useSchedulerStatus } from "@/hooks/use-analytics"

export default function SchedulerWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <SchedulerPage />
    </RoleGate>
  )
}

function SchedulerPage() {
  const { data, isLoading } = useSchedulerStatus()
  const enabled = Boolean((data as any)?.enabled)
  const jobs: Record<string, any> = useMemo(() => ((data as any)?.jobs || {}), [data])
  const nextRuns: Record<string, string | null> = useMemo(() => ((data as any)?.next_runs || {}), [data])
  const ownerPack = jobs["owner_pack_daily"] || {}
  const exceptionsCheck = jobs["exceptions_check_hourly"] || {}

  const statusTone = (status?: string) => {
    if (!status) return "neutral" as const
    const s = status.toUpperCase()
    if (s === "OK") return "ok" as const
    if (s === "RUNNING") return "info" as const
    if (s === "SCHEDULED") return "info" as const
    if (s === "FAIL") return "critical" as const
    return "neutral" as const
  }

  const fmtTime = (iso?: string | null) => {
    if (!iso) return "—"
    try { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) } catch { return iso }
  }

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="system-scheduler-page">
      <ReportHero
        eyebrow="System · scheduler"
        title={enabled ? "Scheduler is running" : "Scheduler is disabled"}
        description="In-process APScheduler that fires daily owner-pack and hourly exception checks. Status is best-effort — falls back gracefully if APScheduler isn't installed or fails to start."
        accent={enabled ? "emerald" : "rose"}
        chips={[
          { label: enabled ? "ENABLED" : "DISABLED", tone: enabled ? "ok" : "critical" },
          { label: `Owner pack cron: ${((data as any)?.owner_pack_cron) || "—"}`, tone: "neutral" },
          { label: `Exceptions cron: ${((data as any)?.exceptions_cron) || "—"}`, tone: "neutral" },
        ]}
      />

      {!enabled ? (
        <NoteCallout tone="warn">
          The scheduler is not running. Make sure <code>SCHEDULER_ENABLED=true</code> and <code>apscheduler</code> is installed in the analytics-service environment. Endpoints still work — they just aren&apos;t fired automatically.
        </NoteCallout>
      ) : null}

      <KpiRail
        items={[
          { label: "Owner pack — last", value: fmtTime(ownerPack.last_finished_at || ownerPack.last_started_at), tone: statusTone(ownerPack.status) === "critical" ? "rose" : statusTone(ownerPack.status) === "ok" ? "emerald" : "cyan", detail: `Status ${ownerPack.status || "—"}` },
          { label: "Owner pack — next", value: fmtTime(nextRuns["owner_pack_daily"]), tone: "violet" },
          { label: "Exceptions — last", value: fmtTime(exceptionsCheck.last_finished_at || exceptionsCheck.last_started_at), tone: statusTone(exceptionsCheck.status) === "critical" ? "rose" : statusTone(exceptionsCheck.status) === "ok" ? "emerald" : "cyan", detail: `Status ${exceptionsCheck.status || "—"}` },
          { label: "Exceptions — next", value: fmtTime(nextRuns["exceptions_check_hourly"]), tone: "violet" },
        ]}
        columns={4}
      />

      <Panel eyebrow="Jobs" title="Scheduled job table" description="Each row is one scheduled cron job. Last error appears in red.">
        {isLoading ? (
          <NoteCallout tone="neutral">Loading scheduler status…</NoteCallout>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Job</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Last started</th>
                <th className="py-2 pr-3">Last finished</th>
                <th className="py-2 pr-3">Next run</th>
                <th className="py-2 pr-3">Last error</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys({ owner_pack_daily: 1, exceptions_check_hourly: 1, ...jobs }).map((jobId) => {
                const row = jobs[jobId] || {}
                return (
                  <tr key={jobId} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs">{jobId}</td>
                    <td className="py-2 pr-3"><Pill tone={statusTone(row.status)}>{row.status || "—"}</Pill></td>
                    <td className="py-2 pr-3 text-xs">{fmtTime(row.last_started_at)}</td>
                    <td className="py-2 pr-3 text-xs">{fmtTime(row.last_finished_at)}</td>
                    <td className="py-2 pr-3 text-xs">{fmtTime(nextRuns[jobId])}</td>
                    <td className="py-2 pr-3 text-xs text-rose-700">{row.last_error || ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
