"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowRightLeft, CalendarRange, ExternalLink, Printer, Undo2, Zap } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { MATCH_TONE, TONE, boardHref, cardHref, fmtClock, fmtDateTime, fmtDay, fmtDayLong, fmtNum, isSilentSlot, machineName, requeueCountdown, resultMeta, shiftLabel, stageLabel, unitLabel } from "./lib"
import { DueChip, ProgressBar, ResultChip, ToneChip } from "./ui"
import type { OverviewMachine, OverviewRun, OverviewSlot } from "./types"

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide ? "col-span-2" : "")}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-foreground">{children}</dd>
    </div>
  )
}

export function SlotPanel({
  slot,
  runs,
  machines,
  now,
  today,
  missedHours,
  onClose,
  selectedForPrint,
  onToggleSelect,
}: {
  slot: OverviewSlot | null
  runs: OverviewRun[]
  machines: Map<string, OverviewMachine>
  now: Date
  today: string
  missedHours: number
  onClose: () => void
  selectedForPrint: boolean
  onToggleSelect: (slot: OverviewSlot) => void
}) {
  const inSlot = useMemo(() => (slot ? runs.filter((run) => run.slot_id === slot.id) : []), [runs, slot])
  const elsewhere = useMemo(() => (slot ? runs.filter((run) => run.slot_id !== slot.id && run.job_card_id === slot.job_card_id && run.stage === slot.stage) : []), [runs, slot])
  if (!slot) return null
  const meta = resultMeta(slot.result)
  const silent = isSilentSlot(slot) ? requeueCountdown(slot, now) : null
  const planned = Number(slot.planned_qty || 0)
  const made = Number(slot.made_in_slot || 0)
  const pct = planned > 0 ? Math.round((made / planned) * 100) : 0
  return (
    <Dialog open={Boolean(slot)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent
        data-testid="slot-panel"
        className="tube-sheet-right !left-auto !right-0 !top-0 flex !h-dvh !max-h-dvh !w-[min(520px,100vw)] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 !rounded-none !rounded-l-2xl !border-y-0 !border-r-0 !p-0"
      >
        <div className={cn("border-b border-border px-5 pb-4 pt-5", TONE[meta.tone].soft)}>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="text-[20px] tabular-nums">{slot.job_card_no}</DialogTitle>
            {slot.parts > 1 ? <span className="rounded border border-border bg-card px-1.5 text-[11px] font-semibold">part {slot.part_no} of {slot.parts}</span> : null}
            {slot.is_emergency ? <ToneChip tone="rose" Icon={Zap}>Emergency</ToneChip> : null}
          </div>
          <DialogDescription className="mt-1 text-[13px] text-foreground">
            {slot.customer_name || "—"}
            {slot.customer_code ? <span className="text-muted-foreground"> · {slot.customer_code}</span> : null}
          </DialogDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ResultChip result={slot.result} className="!text-[12.5px]" />
            <span className="text-[12px] text-muted-foreground">{meta.hint}</span>
          </div>
          {silent ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-signal-rose-line bg-card px-3 py-2 text-[12.5px] text-signal-rose-ink">
              <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>Goes back to the queue {silent.text}</strong> unless a run is logged for this card and stage. Slots return to the queue {missedHours} h after their shift ends; the plan is not changed by hand.
              </span>
            </p>
          ) : null}
          {slot.order_conflict ? (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-signal-amber-line bg-card px-3 py-2 text-[12.5px] text-signal-amber-ink">
              <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>This slot is before the previous stage&apos;s slot. The floor is not blocked, but the order on the board should be checked.</span>
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="font-semibold text-foreground">Made in this slot</span>
              <span className="tabular-nums text-muted-foreground">
                <strong className="text-foreground">{fmtNum(made, 1)}</strong> of {fmtNum(planned, 1)} {unitLabel(slot.unit)} · {pct}%
              </span>
            </div>
            <ProgressBar value={made} max={planned} tone={meta.tone} className="mt-2" height="h-2" />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              {slot.runs_in_slot ? `${slot.runs_in_slot} run${slot.runs_in_slot === 1 ? "" : "s"} logged in the slot` : "No run logged in the slot"}
              {slot.good_in_slot != null && slot.good_in_slot !== made ? ` · ${fmtNum(slot.good_in_slot, 1)} good` : ""}
              {Number(slot.made_elsewhere || 0) > 0 ? ` · ${fmtNum(slot.made_elsewhere, 1)} ${unitLabel(slot.unit)} made on another day or shift` : ""}
            </p>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Stage">{stageLabel(slot.stage)}</Fact>
            <Fact label="Machine">{machineName(machines, slot.machine_id)}</Fact>
            <Fact label="Planned slot" wide>
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {fmtDayLong(slot.plan_date)} · {shiftLabel(slot.shift_code)}
                {slot.window_start ? <span className="text-muted-foreground">({fmtClock(slot.window_start)}–{fmtClock(slot.window_end)})</span> : null}
              </span>
            </Fact>
            <Fact label="Planned">
              {fmtNum(planned, 1)} {unitLabel(slot.unit)}
              <span className="block text-[11.5px] text-muted-foreground">{fmtNum(slot.planned_pcs)} pcs</span>
            </Fact>
            <Fact label="Due date">
              <DueChip due={slot.due_date} today={today} />
              {slot.due_date ? <span className="block text-[11.5px] text-muted-foreground">{fmtDayLong(slot.due_date)}</span> : null}
            </Fact>
            <Fact label="Size">{slot.product_size_label || "—"}</Fact>
            <Fact label="Colour">{slot.parchment_color || "—"}</Fact>
            <Fact label="Sales order">{slot.sales_order_no || "—"}</Fact>
            <Fact label="PO">{slot.po_number || "—"}</Fact>
            <Fact label="Card status">{String(slot.card_status || "—").replace(/_/g, " ").toLowerCase()}</Fact>
            <Fact label="Card is now at">{slot.current_stage ? stageLabel(slot.current_stage) : "—"}</Fact>
            {slot.previous_stage ? <Fact label="Stage before this one">{stageLabel(slot.previous_stage)}</Fact> : null}
            {slot.requeue_at && !silent ? <Fact label="Was due back in queue">{fmtDateTime(slot.requeue_at)}</Fact> : null}
          </dl>

          <h3 className="mt-5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Floor runs in this slot</h3>
          {inSlot.length ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {inSlot.map((run) => (
                <RunRow key={run.key} run={run} machines={machines} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing logged in this slot yet.</p>
          )}
          {elsewhere.length ? (
            <>
              <h3 className="mt-5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Same card and stage, logged elsewhere</h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {elsewhere.map((run) => (
                  <RunRow key={run.key} run={run} machines={machines} showWhen />
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Link href={cardHref(slot.job_card_id)} className="erp-btn-secondary">
            Open job card
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link href={boardHref({ stage: slot.stage, plan_date: slot.plan_date, job_card_id: slot.job_card_id, machine_id: slot.machine_id, shift_code: slot.shift_code })} className="erp-btn-primary">
            Open on planner board
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <button type="button" className={cn("erp-btn-secondary ml-auto", selectedForPrint ? "!border-primary !text-primary" : "")} onClick={() => onToggleSelect(slot)} aria-pressed={selectedForPrint}>
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            {selectedForPrint ? "In print selection" : "Add to print"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RunRow({ run, machines, showWhen }: { run: OverviewRun; machines: Map<string, OverviewMachine>; showWhen?: boolean }) {
  const tone = MATCH_TONE[run.match] || "neutral"
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">
          {run.run}
          {run.operator ? <span className="font-normal text-muted-foreground"> · {run.operator}</span> : null}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          {showWhen ? `${fmtDay(run.date)} · ${shiftLabel(run.shift_code)} · ${machineName(machines, run.machine_id)}` : fmtClock(run.start) ? `${fmtClock(run.start)}–${fmtClock(run.end) || "?"}` : "Time not written on the card"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          <strong>{fmtNum(run.good, 1)}</strong>
          {run.good !== run.made ? <span className="text-muted-foreground"> / {fmtNum(run.made, 1)}</span> : null} {unitLabel(run.unit)}
        </span>
        <ToneChip tone={tone}>{run.match_label}</ToneChip>
      </div>
    </li>
  )
}
