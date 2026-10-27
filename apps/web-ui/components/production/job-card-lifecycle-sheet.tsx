"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, CalendarClock, ChevronRight, History, Printer, Settings2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ActionPanel, actionAvailability, fmt, type LifecycleAction } from "@/components/production/job-card-actions"
import { ColorChip, JobCardNo, LifecycleBadge } from "@/components/production/lifecycle-chips"
import { useMachines, usePlanningJobCards } from "@/hooks/use-production"
import { apiErrorText, useJobCardLifecycle, type JobCardLifecycle } from "@/hooks/use-lifecycle"
import { cn } from "@/lib/utils"

export type { LifecycleAction }

const STEPS: Array<{ key: string; label: string }> = [
  { key: "QUEUED", label: "Queue" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "RUNNING", label: "Running" },
  { key: "COMPLETED", label: "Done" },
]

export const EVENT_LABEL: Record<string, string> = {
  release_sync_create: "Released from the sales order",
  release_sync_replay_noop: "Release re-synced (no change)",
  job_card_amended: "Qty / color edited",
  job_card_split: "Split into a new card",
  job_card_created_by_split: "Created by split",
  job_card_force_closed: "Force-closed",
  job_card_emergency_insert: "Inserted as emergency",
  running_entry: "Running entry",
  draft_saved: "Stage draft saved",
  stage_completed: "Stage completed",
  physical_output_recorded_restricted: "Output recorded under QC hold",
  missed_slot_requeued: "Missed slot — back to queue",
  winder_override: "Scheduled on another winder",
  missed_slot_late_entry: "Late entry — slot restored",
}

export function eventText(event: { action: string; payload?: Record<string, any> | null }) {
  const p = event.payload || {}
  switch (event.action) {
    case "job_card_amended":
      return `${fmt(p.before?.planned_qty)} ${p.before?.parchment_color || ""} → ${fmt(p.after?.planned_qty)} ${p.after?.parchment_color || ""}`.replace(/\s+/g, " ")
    case "job_card_split":
      return `${fmt(p.qty)} pcs moved to ${p.child_job_card_no || "a new card"}`
    case "job_card_created_by_split":
      return `${fmt(p.qty)} pcs from ${p.parent_job_card_no || "parent"}`
    case "job_card_force_closed":
      return `Made ${fmt(p.made_qty)} · ${fmt(p.returned_qty)} pcs back to the order${p.reason ? ` — ${p.reason}` : ""}`
    case "job_card_emergency_insert":
      return `${p.plan_date} ${String(p.shift_code || "").replace("SHIFT_", "Shift ")}${Array.isArray(p.bumped) && p.bumped.length ? ` · ${p.bumped.length} card(s) pushed later` : ""}`
    case "winder_override":
      return `Released for one winder, planned on another${p.plan_date ? ` · ${p.plan_date} ${String(p.shift_code || "").replace("SHIFT_", "Shift ")}` : ""}`
    case "missed_slot_requeued":
      return `${p.stage || ""} slot ${p.plan_date} ${String(p.shift_code || "").replace("SHIFT_", "Shift ")} had no entry for 36h`
    case "missed_slot_late_entry":
      return `Entered late; back on ${p.plan_date} ${String(p.shift_code || "").replace("SHIFT_", "Shift ")}`
    case "running_entry":
      return `${p.stage}: +${fmt(p.qty)} (total ${fmt(p.total)})${p.shift ? ` · ${String(p.shift).replace("SHIFT_", "Shift ")}` : ""}`
    default:
      return p.stage ? String(p.stage) : ""
  }
}

/**
 * Quick lifecycle side sheet (planner board, tracker, sales order page). The same action forms as
 * the Job card manager; the manager is the full console with the family tree, bulk actions and the
 * management history.
 */
export function JobCardLifecycleSheet({
  jobCardId,
  open,
  onOpenChange,
  initialAction = null,
}: {
  jobCardId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAction?: LifecycleAction | null
}) {
  const [currentId, setCurrentId] = useState<string | null>(jobCardId)
  const [action, setAction] = useState<LifecycleAction | null>(initialAction)
  useEffect(() => {
    if (open) {
      setCurrentId(jobCardId)
      setAction(initialAction)
    }
  }, [open, jobCardId, initialAction])
  const query = useJobCardLifecycle(open ? currentId : null)
  const data = query.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="tube-sheet-right !left-auto !right-0 !top-0 flex !h-dvh !max-h-dvh !w-[min(560px,100vw)] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 !rounded-none !rounded-l-2xl !border-y-0 !border-r-0 !p-0"
        data-testid="job-card-lifecycle-sheet"
      >
        <div className="flex items-start gap-3 border-b border-border py-4 pl-5 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="!text-[16px]">{data ? <JobCardNo job={data} /> : "Job card"}</DialogTitle>
            <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 !text-[12.5px]">
              {data ? (
                <>
                  <LifecycleBadge state={data.state} />
                  <ColorChip color={data.parchment_color} empty="Plain (no parchment)" />
                  <span className="tabular-nums text-muted-foreground">{fmt(data.planned_qty)} pcs</span>
                </>
              ) : query.isError ? (
                "Could not load"
              ) : (
                "Loading lifecycle…"
              )}
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {query.isError && !data ? (
            <div className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-[13px] text-signal-rose-ink" role="alert">
              <p>{apiErrorText(query.error, "The job card could not be loaded.")}</p>
              <button type="button" className="mt-2 font-semibold underline" onClick={() => query.refetch()}>Try again</button>
            </div>
          ) : query.isLoading || !data ? (
            <div className="space-y-3">
              <div className="skeleton h-14 rounded-xl" />
              <div className="skeleton h-24 rounded-xl" />
              <div className="skeleton h-40 rounded-xl" />
            </div>
          ) : (
            <LifecycleBody data={data} action={action} setAction={setAction} onOpenCard={(id) => { setCurrentId(id); setAction(null) }} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stepper({ state }: { state: string }) {
  const terminal = state === "FORCE_CLOSED" || state === "CANCELLED"
  const reached = terminal ? (state === "CANCELLED" ? 0 : 2) : STEPS.findIndex((step) => step.key === state)
  return (
    <ol className="flex items-center gap-1" aria-label="Lifecycle">
      {STEPS.map((step, index) => {
        const done = index < reached || (index === reached && state === "COMPLETED")
        const active = index === reached && !terminal && state !== "COMPLETED"
        return (
          <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1">
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors duration-300",
                done ? "bg-primary text-primary-foreground" : active ? "bg-primary/15 text-primary ring-2 ring-primary/40" : "bg-muted text-muted-foreground",
              )}
            >
              {done ? "✓" : index + 1}
            </span>
            <span className={cn("truncate text-[12px]", active ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
            {index < STEPS.length - 1 ? <span className={cn("h-px min-w-3 flex-1", index < reached ? "bg-primary" : "bg-border")} /> : null}
          </li>
        )
      })}
      {terminal ? <LifecycleBadge state={state} className="ml-1" /> : null}
    </ol>
  )
}

export function QtyBar({ data }: { data: JobCardLifecycle }) {
  const planned = Math.max(1, data.planned_qty + data.returned_qty)
  const made = Math.min(data.made_qty, data.max_output_qty)
  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[11.5px] text-muted-foreground">Planned</p>
          <p className="text-[17px] font-semibold tabular-nums">{fmt(data.planned_qty)}</p>
        </div>
        <div>
          <p className="text-[11.5px] text-muted-foreground">Made</p>
          <p className="text-[17px] font-semibold tabular-nums">{fmt(data.made_qty)}</p>
          {data.pcs_per_bamboo ? <p className="text-[11px] tabular-nums text-muted-foreground">{fmt(data.made_in_anchor_unit)} bamboo × {data.pcs_per_bamboo}</p> : null}
        </div>
        <div>
          <p className="text-[11.5px] text-muted-foreground">Back to order</p>
          <p className={cn("text-[17px] font-semibold tabular-nums", data.returned_qty ? "text-signal-rose-ink" : "")}>{fmt(data.returned_qty)}</p>
        </div>
      </div>
      <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] rounded-full bg-primary" style={{ width: `${Math.min(100, (made / planned) * 100)}%` }} />
        {data.returned_qty ? <div className="absolute inset-y-0 right-0 bg-signal-rose-line/60" style={{ width: `${(data.returned_qty / planned) * 100}%` }} /> : null}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">Floor may run up to +{data.output_tolerance_pct}% ({fmt(data.max_output_qty)} pcs).</p>
    </div>
  )
}

function LifecycleBody({
  data,
  action,
  setAction,
  onOpenCard,
}: {
  data: JobCardLifecycle
  action: LifecycleAction | null
  setAction: (value: LifecycleAction | null) => void
  onOpenCard: (id: string) => void
}) {
  const machinesQuery = useMachines()
  const machines: any[] = useMemo(() => (Array.isArray(machinesQuery.data) ? machinesQuery.data : []), [machinesQuery.data])
  const machineName = useMemo(() => new Map(machines.map((row: any) => [String(row.id), String(row.code || row.name || "").trim()])), [machines])
  // The lifecycle payload carries the entry model; the list row is the fallback for older services.
  const rowsQuery = usePlanningJobCards({ limit: 250 }, true)
  const row = useMemo(() => (Array.isArray(rowsQuery.data) ? rowsQuery.data : []).find((job: any) => String(job.id) === data.id), [rowsQuery.data, data.id])
  const actions = actionAvailability(data, row ? row.entry_model : undefined)
  return (
    <div className="space-y-4">
      <Stepper state={data.state} />
      {data.missed_slot_open ? (
        <div className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink">
          <p className="font-semibold">Missed slot — back in the queue{data.missed_slot_count > 1 ? ` (${data.missed_slot_count}×)` : ""}</p>
          <p className="mt-0.5">
            Planned {data.last_missed_slot?.plan_date} {String(data.last_missed_slot?.shift_code || "").replace("SHIFT_", "Shift ")}, nothing was entered 36h after the shift.
            Reschedule it on the board — or if it really ran, just enter it: the card returns to that slot automatically.
          </p>
        </div>
      ) : null}
      <QtyBar data={data} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {actions.map((button) => (
          <button
            key={button.key}
            type="button"
            disabled={!button.allowed}
            title={button.allowed ? button.hint : button.why || button.hint}
            onClick={() => setAction(action === button.key ? null : button.key)}
            aria-pressed={action === button.key}
            data-testid={`sheet-action-${button.key}`}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center text-[12px] font-semibold leading-tight transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40",
              action === button.key
                ? button.danger
                  ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink shadow-sm"
                  : "border-primary/40 bg-primary/10 text-primary shadow-sm"
                : "border-border bg-card hover:-translate-y-0.5 hover:shadow-md",
            )}
          >
            <button.icon className="h-4 w-4" />
            {button.label}
          </button>
        ))}
      </div>
      {!action ? (
        <ul className="space-y-0.5 text-[11.5px] text-muted-foreground">
          {actions.filter((button) => !button.allowed && button.why).map((button) => (
            <li key={button.key}><span className="font-medium text-foreground/80">{button.label}:</span> {button.why}</li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <div className="animate-enter-up rounded-xl border border-border bg-card p-3.5 shadow-sm">
          <ActionPanel action={action} data={data} machines={machines} onDone={() => setAction(null)} onOpenCard={onOpenCard} />
        </div>
      ) : null}

      {data.close_reason ? (
        <p className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-[12.5px]">
          <span className="font-semibold">{data.close_mode === "CANCELLED" ? "Cancelled" : "Force-closed"}</span>
          {data.closed_by ? ` by ${data.closed_by}` : ""}{data.closed_at ? ` · ${new Date(data.closed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""} — {data.close_reason}
        </p>
      ) : null}

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Stages</h3>
        <ol className="space-y-1.5">
          {data.stages.map((stage) => {
            const progress = stage.planned_in_unit ? Math.min(100, ((stage.output_qty || stage.running_total) / stage.planned_in_unit) * 100) : 0
            return (
              <li key={stage.stage} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[12.5px] font-semibold">{stage.stage}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-[width] duration-700", stage.status === "COMPLETED" ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${progress}%` }} />
                  </div>
                  <span className="w-32 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                    {fmt(stage.output_qty || stage.running_total)} / {fmt(stage.planned_in_unit)} {stage.unit === "bamboo" ? "bamboo" : "pcs"}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[11.5px] text-muted-foreground">{stage.status.toLowerCase()}</span>
                </div>
                {stage.segments.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {stage.segments.map((segment) => (
                      <span key={segment.id} className={cn("rounded-md px-1.5 py-0.5 text-[11px] tabular-nums", segment.status === "RUNNING" ? "bg-signal-amber-soft text-signal-amber-ink" : segment.status === "COMPLETED" ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-muted text-muted-foreground")}>
                        {segment.plan_date ? new Date(segment.plan_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "queue"}
                        {segment.shift_code ? ` · ${segment.shift_code.replace("SHIFT_", "")}` : ""}
                        {segment.machine_id ? ` · ${machineName.get(segment.machine_id) || "machine"}` : ""} · {fmt(segment.planned_qty)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      </section>

      {data.family.length > 1 ? (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Card family</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.family.map((row) => (
              <li key={row.id}>
                <button type="button" disabled={row.is_self} onClick={() => onOpenCard(row.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-muted/60 disabled:cursor-default disabled:bg-primary/5">
                  <span className="font-mono font-semibold">{row.job_card_no || row.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{row.split_kind ? row.split_kind.replace("_", " ").toLowerCase() : "original"}</span>
                  <span className="ml-auto tabular-nums">{fmt(row.planned_qty)} pcs</span>
                  <span className="w-20 text-right text-[11.5px] text-muted-foreground">{row.close_mode ? row.close_mode.toLowerCase() : row.status.toLowerCase()}</span>
                  {!row.is_self ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><History className="h-3.5 w-3.5" />Audit trail</h3>
        {data.events.length ? (
          <ol className="relative space-y-2 border-l border-border pl-4">
            {data.events.map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                <p className="text-[12.5px] font-medium">{EVENT_LABEL[event.action] || event.action.replace(/_/g, " ")}</p>
                <p className="text-[12px] text-muted-foreground">{eventText(event)}</p>
                <p className="text-[11px] text-muted-foreground">{event.actor || "system"} · {new Date(event.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">No events yet.</p>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Link href={`/production/job-cards/manage?card=${data.id}`} className="erp-btn-primary !h-9"><Settings2 className="h-4 w-4" />Job card manager</Link>
        <Link href={`/production/job-cards/${data.id}`} className="erp-btn-secondary !h-9"><ArrowUpRight className="h-4 w-4" />Open job card</Link>
        <Link href={`/production/job-cards/${data.id}/print`} className="erp-btn-secondary !h-9"><Printer className="h-4 w-4" />Print</Link>
        <Link href={`/sales-orders/${data.sales_order_id}`} className="erp-btn-secondary !h-9"><CalendarClock className="h-4 w-4" />Sales order</Link>
      </div>
    </div>
  )
}
