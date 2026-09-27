"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, CalendarClock, ChevronRight, Flame, History, Pencil, Printer, Scissors, Undo2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ColorChip, JobCardNo, LifecycleBadge } from "@/components/production/lifecycle-chips"
import { useApp } from "@/context/AppContext"
import { useParchments } from "@/hooks/use-master-data"
import { useMachines } from "@/hooks/use-production"
import {
  apiErrorText,
  useAmendJobCard,
  useEmergencyInsert,
  useForceCloseJobCard,
  useJobCardLifecycle,
  useSplitJobCard,
  type JobCardLifecycle,
} from "@/hooks/use-lifecycle"
import { cn } from "@/lib/utils"

export type LifecycleAction = "edit" | "split" | "force_close" | "emergency"

const fmt = (value: number | null | undefined, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })

const STEPS: Array<{ key: string; label: string }> = [
  { key: "QUEUED", label: "Queue" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "RUNNING", label: "Running" },
  { key: "COMPLETED", label: "Done" },
]

const EVENT_LABEL: Record<string, string> = {
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

function eventText(event: JobCardLifecycle["events"][number]) {
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
              ) : (
                "Loading lifecycle…"
              )}
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {query.isLoading || !data ? (
            <div className="space-y-3">
              <div className="skeleton h-14 rounded-xl" />
              <div className="skeleton h-24 rounded-xl" />
              <div className="skeleton h-40 rounded-xl" />
            </div>
          ) : query.isError ? (
            <p className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-[13px] text-signal-rose-ink">{apiErrorText(query.error)}</p>
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

function QtyBar({ data }: { data: JobCardLifecycle }) {
  const planned = Math.max(1, data.planned_qty + data.returned_qty)
  const made = Math.min(data.made_qty, data.max_output_qty)
  const tolPct = (data.max_output_qty / planned) * 100
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
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        Floor may run up to +{data.output_tolerance_pct}% ({fmt(data.max_output_qty)} pcs). {tolPct > 100 ? "" : ""}
      </p>
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
  const machines: any[] = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
  const machineName = useMemo(() => new Map(machines.map((row: any) => [String(row.id), String(row.code || row.name || "").trim()])), [machines])
  const actionButtons: Array<{ key: LifecycleAction; label: string; icon: any; allowed: boolean; why: string; danger?: boolean }> = [
    { key: "edit", label: "Edit qty / color", icon: Pencil, allowed: data.actions.edit, why: "Only while in queue (not on the calendar)" },
    { key: "split", label: "Split", icon: Scissors, allowed: data.actions.split, why: "Nothing unstarted left to split" },
    { key: "emergency", label: "Emergency", icon: Flame, allowed: data.actions.emergency, why: "Only queued or scheduled cards" },
    { key: "force_close", label: "Force close", icon: Undo2, allowed: data.actions.force_close, why: "Card is already closed", danger: true },
  ]
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {actionButtons.map((button) => (
          <button
            key={button.key}
            type="button"
            disabled={!button.allowed}
            title={button.allowed ? button.label : button.why}
            onClick={() => setAction(action === button.key ? null : button.key)}
            aria-pressed={action === button.key}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[12px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40",
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

      {action ? (
        <div className="animate-enter-up rounded-xl border border-border bg-card p-3.5 shadow-sm">
          {action === "edit" ? <EditForm data={data} onDone={() => setAction(null)} /> : null}
          {action === "split" ? <SplitForm data={data} onDone={() => setAction(null)} onOpenCard={onOpenCard} /> : null}
          {action === "force_close" ? <ForceCloseForm data={data} onDone={() => setAction(null)} /> : null}
          {action === "emergency" ? <EmergencyForm data={data} machines={machines} onDone={() => setAction(null)} /> : null}
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
        <Link href={`/production/job-cards/${data.id}`} className="erp-btn-secondary !h-9"><ArrowUpRight className="h-4 w-4" />Open job card</Link>
        <Link href={`/production/job-cards/${data.id}/print`} className="erp-btn-secondary !h-9"><Printer className="h-4 w-4" />Print</Link>
        <Link href={`/sales-orders/${data.sales_order_id}`} className="erp-btn-secondary !h-9"><CalendarClock className="h-4 w-4" />Sales order</Link>
      </div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11.5px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

const inputClass = "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/30"

function EditForm({ data, onDone }: { data: JobCardLifecycle; onDone: () => void }) {
  const { showToast } = useApp()
  const amend = useAmendJobCard()
  const { data: parchments } = useParchments()
  const options = (Array.isArray(parchments) ? parchments : []).filter((row: any) => row?.color_name && row?.id && !String(row.id).startsWith("vendor:"))
  const [qty, setQty] = useState(String(Math.round(data.planned_qty)))
  const [colorId, setColorId] = useState("")
  const [reason, setReason] = useState("")
  const chosen = options.find((row: any) => String(row.id) === colorId)
  const colorName = chosen ? String(chosen.display_name || [chosen.color_name, chosen.vendor_name].filter(Boolean).join(" / ")) : ""
  const submit = async () => {
    try {
      await amend.mutateAsync({ jobCardId: data.id, data: { planned_qty: Number(qty), parchment_color: colorName || undefined, parchment_color_id: colorId || null, reason: reason || undefined } })
      showToast("Job card updated — sales release lot changed with it.", "success")
      onDone()
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">This card is still in the queue, so its qty and color can change. The sales order release updates in step and the change is audited.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity (pcs)"><input className={inputClass} type="number" min="1" value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
        {data.parchment_color !== null ? (
          <Field label="Color" hint={`Now: ${data.parchment_color || "—"}`}>
            <select className={inputClass} value={colorId} onChange={(event) => setColorId(event.target.value)}>
              <option value="">Keep current color</option>
              {options.map((row: any) => <option key={row.id} value={row.id}>{row.display_name || row.color_name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Reason (optional)"><input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. customer changed color" /></Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-9" disabled={amend.isPending || !Number(qty)} onClick={() => void submit()}>{amend.isPending ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  )
}

function SplitForm({ data, onDone, onOpenCard }: { data: JobCardLifecycle; onDone: () => void; onOpenCard: (id: string) => void }) {
  const { showToast } = useApp()
  const split = useSplitJobCard()
  const max = Math.max(1, Math.floor(Math.min(data.open_first_stage_qty, data.planned_qty - 1)))
  const [qty, setQty] = useState(String(Math.floor(max / 2) || 1))
  const [reason, setReason] = useState("")
  const value = Math.min(max, Math.max(1, Number(qty) || 0))
  const submit = async () => {
    try {
      const response = await split.mutateAsync({ jobCardId: data.id, qty: value, reason: reason || undefined })
      const childNo = response?.data?.child_job_card_no
      showToast(`${childNo || "New card"} created with ${fmt(value)} pcs — place it on the board.`, "success")
      onDone()
      if (response?.data?.child_job_card_id) onOpenCard(String(response.data.child_job_card_id))
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">Move part of the not-yet-started qty to a new card in the same family (same color, own lot). Use it to run the rest on another winder or day.</p>
      <input type="range" min={1} max={max} value={value} onChange={(event) => setQty(event.target.value)} className="w-full accent-[hsl(var(--primary))]" aria-label="Split quantity" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New card gets (pcs)"><input className={inputClass} type="number" min={1} max={max} value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
        <Field label="Reason (optional)"><input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. second winder free" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center text-[12.5px]">
        <div className="rounded-lg bg-muted px-2 py-2"><span className="block text-muted-foreground">{data.job_card_no} keeps</span><strong className="text-[15px] tabular-nums">{fmt(data.planned_qty - value)}</strong></div>
        <div className="rounded-lg bg-primary/10 px-2 py-2"><span className="block text-muted-foreground">New card gets</span><strong className="text-[15px] tabular-nums text-primary">{fmt(value)}</strong></div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-9" disabled={split.isPending} onClick={() => void submit()}>{split.isPending ? "Splitting…" : "Split card"}</button>
      </div>
    </div>
  )
}

function ForceCloseForm({ data, onDone }: { data: JobCardLifecycle; onDone: () => void }) {
  const { showToast } = useApp()
  const close = useForceCloseJobCard()
  const [reason, setReason] = useState("")
  const made = Math.min(data.made_qty, data.planned_qty)
  const back = Math.max(0, data.planned_qty - made)
  const submit = async () => {
    try {
      await close.mutateAsync({ jobCardId: data.id, reason })
      showToast(made > 0 ? `Closed at ${fmt(made)} pcs — ${fmt(back)} pcs back on the sales order.` : `Card cancelled — ${fmt(back)} pcs back on the sales order.`, "success")
      onDone()
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-center text-[12.5px]">
        <div className="rounded-lg bg-muted px-2 py-2"><span className="block text-muted-foreground">{made > 0 ? "Keeps going as this lot" : "Made"}</span><strong className="text-[15px] tabular-nums">{fmt(made)} pcs</strong></div>
        <div className="rounded-lg bg-signal-rose-soft px-2 py-2"><span className="block text-signal-rose-ink">Back to the sales order</span><strong className="text-[15px] tabular-nums text-signal-rose-ink">{fmt(back)} pcs</strong></div>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {made > 0
          ? "The winder closes at what was made; those pcs still go through oven, process and packing on this card. The balance becomes unreleased on the order — re-release it with a new color or qty as a new card."
          : "Nothing is made yet, so the card is cancelled and its whole quantity goes back to the order."}
      </p>
      <Field label="Reason"><textarea className={cn(inputClass, "h-20 py-2")} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. customer changed color to red" /></Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-9 !bg-signal-rose-ink !text-white hover:!opacity-90" disabled={close.isPending || reason.trim().length < 3} onClick={() => void submit()}>
          {close.isPending ? "Closing…" : made > 0 ? "Force close" : "Cancel card"}
        </button>
      </div>
    </div>
  )
}

function EmergencyForm({ data, machines, onDone }: { data: JobCardLifecycle; machines: any[]; onDone: () => void }) {
  const { showToast } = useApp()
  const insert = useEmergencyInsert()
  const winders = machines.filter((row: any) => String(row.department || row.stage || row.machine_type || "").toUpperCase().includes(data.first_stage === "SLITTING" ? "SLIT" : "WIND"))
  const today = new Date().toISOString().slice(0, 10)
  const [machineId, setMachineId] = useState(String(winders[0]?.id || ""))
  const [planDate, setPlanDate] = useState(today)
  const [shift, setShift] = useState("SHIFT_A")
  const [reason, setReason] = useState("")
  useEffect(() => {
    if (!machineId && winders[0]?.id) setMachineId(String(winders[0].id))
  }, [machineId, winders])
  const [result, setResult] = useState<any[] | null>(null)
  const submit = async () => {
    try {
      const response = await insert.mutateAsync({ job_card_id: data.id, machine_id: machineId, plan_date: planDate, shift_code: shift, reason })
      const bumped = response?.data?.bumped || []
      setResult(bumped)
      showToast(bumped.length ? `${data.job_card_no} runs first — ${bumped.length} card(s) pushed to later shifts.` : `${data.job_card_no} runs first — the slot had room.`, "success")
    } catch (error) {
      showToast(apiErrorText(error), "error")
    }
  }
  if (result) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] font-semibold">{result.length ? "Pushed later to make room" : "Nothing had to move"}</p>
        {result.map((row: any) => (
          <p key={row.segment_id} className="text-[12.5px] tabular-nums text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{row.job_card_no}</span> {row.from?.date} {String(row.from?.shift).replace("SHIFT_", "")} → {row.to?.date} {String(row.to?.shift).replace("SHIFT_", "")}
          </p>
        ))}
        <div className="flex justify-end"><button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Done</button></div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">The card goes first in the chosen shift. If that shift is then over capacity, the lowest-priority cards move to the next shift (and onward), never the running ones. Everyone affected is notified.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Machine">
          <select className={inputClass} value={machineId} onChange={(event) => setMachineId(event.target.value)}>
            {winders.map((row: any) => <option key={row.id} value={row.id}>{row.code || row.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input className={inputClass} type="date" min={today} value={planDate} onChange={(event) => setPlanDate(event.target.value)} /></Field>
        <Field label="Shift">
          <select className={inputClass} value={shift} onChange={(event) => setShift(event.target.value)}>
            <option value="SHIFT_A">Shift A</option>
            <option value="SHIFT_B">Shift B</option>
          </select>
        </Field>
      </div>
      <Field label="Reason"><input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. customer line-down, truck at 6 pm" /></Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="erp-btn-secondary !h-9" onClick={onDone}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-9" disabled={insert.isPending || !machineId || reason.trim().length < 3} onClick={() => void submit()}>
          <Flame className="h-4 w-4" />{insert.isPending ? "Inserting…" : "Insert as emergency"}
        </button>
      </div>
    </div>
  )
}
