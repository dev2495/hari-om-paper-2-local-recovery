"use client"

// The card's route as one strip: good / target per stage, status, flags, drafts and what is waiting.

import { Check, Flag } from "lucide-react"

import { cn } from "@/lib/utils"
import { STAGE_ICON, fmt, stageLabel, stampLabel, toneClass, visibleStages } from "./model"

export type StepInfo = {
  stage: string
  label: string
  state: "done" | "running" | "planned" | "todo" | "system"
  good: number
  target: number
  unit: string
  made?: number
  rejected?: number
  flagged?: number
  drafts?: number
  waiting?: number
  closedBy?: string
  closedAt?: string
  note?: string
}

const STATE_WORD: Record<StepInfo["state"], { label: string; tone: "emerald" | "blue" | "violet" | "muted" }> = {
  done: { label: "Done", tone: "emerald" },
  running: { label: "Running", tone: "blue" },
  planned: { label: "Planned", tone: "violet" },
  todo: { label: "Not started", tone: "muted" },
  system: { label: "Closes with Process", tone: "muted" },
}

/** Steps from a batch-entry card's flow (Packing and Final QC fold into one system step when hidden). */
export function stepsFromFlow(flow: any): StepInfo[] {
  const shown = visibleStages(flow)
  const all: any[] = flow?.stages || []
  const steps: StepInfo[] = shown.map((s: any) => ({
    stage: s.stage,
    label: stageLabel(s.stage),
    state: s.status === "COMPLETED" ? "done" : Number(s.produced_total || 0) > 0 || s.status === "RUNNING" ? "running" : (s.segments || []).some((seg: any) => seg.plan_date) ? "planned" : "todo",
    good: Number(s.accepted_total || 0),
    target: Number(s.target || 0),
    unit: s.unit,
    made: Number(s.produced_total || 0),
    rejected: Number(s.rejected_total || 0),
    flagged: Number(s.qc_flagged_runs || 0),
    drafts: Number(s.draft_count || 0),
    waiting: Number(s.awaiting_qc_from_upstream || 0),
    closedBy: s.supervisor_name,
    closedAt: s.closed_at,
  }))
  const hidden = all.filter((s: any) => ["PACKING", "QC"].includes(s.stage) && !shown.some((v: any) => v.stage === s.stage))
  if (hidden.length) {
    const qc = all.find((s: any) => s.stage === "QC")
    const done = hidden.every((s: any) => s.status === "COMPLETED")
    const index = steps.findIndex((s) => s.stage === "DISPATCH")
    const step: StepInfo = { stage: "PACKING_QC", label: hidden.some((s: any) => s.stage === "PACKING") ? "Packing & final QC" : "Final QC", state: done ? "done" : "system", good: Number(qc?.accepted_total || 0), target: Number(qc?.target || 0), unit: "pcs", note: done ? undefined : "closed with Process" }
    steps.splice(index === -1 ? steps.length : index, 0, step)
  }
  return steps
}

/** Steps for an old-form card (no batch flow): from the card's stage rows and the lifecycle summary. */
export function stepsFromOldCard(card: any, lifecycle: any): StepInfo[] {
  const rows: any[] = Array.isArray(card?.stages) ? card.stages : []
  const life: any[] = lifecycle?.stages || []
  return rows
    .filter((row) => row.stage_type !== "SLITTING" || card?.requires_slitting)
    .map((row) => {
      const l = life.find((s) => s.stage === row.stage_type)
      const status = String(row.status || "").toUpperCase()
      return {
        stage: row.stage_type,
        label: stageLabel(row.stage_type),
        state: status === "COMPLETED" ? "done" : Number(row.output_qty || 0) > 0 || status === "RUNNING" || status === "IN_PROGRESS" ? "running" : row.plan_date ? "planned" : "todo",
        good: Number(l?.output_qty ?? row.output_qty ?? 0),
        target: Number(l?.planned_in_unit ?? row.input_qty ?? 0),
        unit: l?.unit || (["WINDER", "OVEN"].includes(row.stage_type) ? "bamboo" : "pcs"),
        made: Number(row.output_qty || 0) + Number(row.scrap_qty || 0),
        rejected: Number(row.scrap_qty || 0),
        closedBy: row.entered_by,
        closedAt: row.actual_end,
      } as StepInfo
    })
}

export function StageStepper({ steps, current, onSelect }: { steps: StepInfo[]; current?: string; onSelect?: (stage: string) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1" data-testid="stage-stepper" role={onSelect ? "group" : undefined} aria-label={onSelect ? "Stages" : undefined}>
      {steps.map((step, index) => {
        const Icon = STAGE_ICON[step.stage] || STAGE_ICON.PACKING
        const word = STATE_WORD[step.state]
        const pct = step.target ? Math.min(100, Math.round((step.good / step.target) * 100)) : 0
        const isCurrent = current === step.stage
        const selectable = Boolean(onSelect) && step.stage !== "PACKING_QC"
        const body = (
          <>
            <div className="flex items-center">
              <span className={cn("h-px flex-1", index === 0 ? "bg-transparent" : steps[index - 1].state === "done" ? "bg-signal-emerald-ink/60" : "bg-border")} aria-hidden="true" />
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full border-2",
                  step.state === "done" ? "border-signal-emerald-ink bg-signal-emerald-ink text-white" : step.state === "running" ? "border-primary bg-card text-primary" : "border-border bg-card text-muted-foreground",
                )}
              >
                {step.state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
              </span>
              <span className={cn("h-px flex-1", index === steps.length - 1 ? "bg-transparent" : step.state === "done" ? "bg-signal-emerald-ink/60" : "bg-border")} aria-hidden="true" />
            </div>
            <p className="mt-1.5 truncate text-[13px] font-semibold">{step.label}</p>
            <p className="text-[12px] tabular-nums text-muted-foreground">
              {step.state === "todo" || step.state === "system" ? "—" : (
                <>
                  <b className="text-foreground">{fmt(step.good)}</b> / {fmt(step.target)} {step.unit}
                </>
              )}
            </p>
            {step.state === "running" ? (
              <span className="mx-auto mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </span>
            ) : null}
            <span className="mt-1 flex flex-wrap items-center justify-center gap-1">
              <span className={cn("rounded-full border px-1.5 py-px text-[10.5px] font-semibold", toneClass(word.tone))}>{word.label}</span>
              {step.flagged ? (
                <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10.5px] font-semibold", toneClass("amber"))} title="Readings outside the band — flagged, not held">
                  <Flag className="h-2.5 w-2.5" aria-hidden="true" /> {step.flagged} flagged
                </span>
              ) : null}
              {step.drafts ? <span className={cn("rounded-full border px-1.5 py-px text-[10.5px] font-semibold", toneClass("amber"))}>{step.drafts} draft</span> : null}
            </span>
            {step.state === "done" && (step.closedBy || step.closedAt) ? <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{[step.closedBy, step.closedAt ? stampLabel(step.closedAt) : ""].filter(Boolean).join(" · ")}</p> : null}
          </>
        )
        const className = cn("min-w-[7.5rem] flex-1 rounded-xl px-2 py-2 text-center transition xl:min-w-[9.5rem]", isCurrent ? "bg-primary/[.06] ring-1 ring-primary/30" : "", selectable ? "hover:bg-muted" : "")
        return selectable ? (
          <button key={step.stage} type="button" aria-pressed={isCurrent} title={`Show ${step.label} runs`} className={className} onClick={() => onSelect?.(step.stage)} data-testid={`step-${step.stage.toLowerCase()}`}>
            {body}
          </button>
        ) : (
          <div key={step.stage} className={className} data-testid={`step-${step.stage.toLowerCase()}`}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
