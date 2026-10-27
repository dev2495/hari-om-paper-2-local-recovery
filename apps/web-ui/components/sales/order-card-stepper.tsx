"use client"

import { Check, Disc3, Package, Scissors, ShieldCheck, SlidersHorizontal, Thermometer, Truck } from "lucide-react"

import type { JobCardLifecycle } from "@/hooks/use-lifecycle"
import { STAGE_LABEL, formatShortDate } from "@/lib/sales-order-tracker"
import { cn } from "@/lib/utils"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const STAGE_ICON: Record<string, any> = { SLITTING: Scissors, WINDER: Disc3, OVEN: Thermometer, PROCESS: SlidersHorizontal, PACKING: Package, QC: ShieldCheck, DISPATCH: Truck }

type StepState = "done" | "running" | "planned" | "todo"

function stepState(stage: JobCardLifecycle["stages"][number], cardDone: boolean): StepState {
  const status = String(stage.status || "").toUpperCase()
  if (cardDone || status === "COMPLETED") return "done"
  if (status === "RUNNING" || Number(stage.output_qty || 0) > 0) return "running"
  const planned = stage.segments?.some((segment) => segment.plan_date && ["ASSIGNED", "PLANNED", "SCHEDULED"].includes(String(segment.status || "").toUpperCase()))
  if (planned || status === "ASSIGNED") return "planned"
  return "todo"
}

function slotText(stage: JobCardLifecycle["stages"][number]) {
  const slots = (stage.segments || []).filter((segment) => segment.plan_date)
  if (!slots.length) return "planned"
  const first = slots[0]
  const shift = String(first.shift_code || "").replace("SHIFT_", "Shift ")
  return `${formatShortDate(first.plan_date)}${shift ? ` · ${shift}` : ""}${slots.length > 1 ? ` · ${slots.length} parts` : ""}`
}

/**
 * One job card's stages as a stepper: done · running (with made / target in the stage unit) ·
 * planned (slot date and shift) · not started. Read from the lifecycle view the job card pages use.
 */
export function OrderCardStepper({ lifecycle, dispatchedQty = 0, className }: { lifecycle: JobCardLifecycle; dispatchedQty?: number; className?: string }) {
  const cardDone = String(lifecycle.status || "").toUpperCase() === "COMPLETED"
  const stages = lifecycle.stages || []
  const current = String(lifecycle.current_stage || "").toUpperCase()
  return (
    <ol className={cn("grid gap-1", className)} style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }} aria-label="Stages">
      {stages.map((stage, index) => {
        const state = stepState(stage, cardDone)
        const Icon = state === "done" ? Check : STAGE_ICON[stage.stage] || Disc3
        const target = Number(stage.planned_in_unit || stage.planned_qty || 0)
        const made = stage.stage === "DISPATCH" && dispatchedQty ? dispatchedQty : Number(stage.output_qty || 0)
        const pct = target > 0 ? Math.min(100, Math.round((made / target) * 100)) : 0
        const isCurrent = !cardDone && stage.stage === current
        const nums = state === "todo" ? "—" : state === "planned" ? slotText(stage) : `${fmt(made)} / ${fmt(target)} ${stage.unit || "pcs"}`
        return (
          <li key={stage.stage} className="relative min-w-0 text-center" aria-current={isCurrent ? "step" : undefined}>
            {index > 0 ? <span className={cn("absolute left-[-50%] right-[50%] top-[13px] h-0.5", state === "done" || state === "running" ? "bg-signal-emerald-ink/70" : "bg-border")} aria-hidden="true" /> : null}
            <span className={cn("relative mx-auto grid h-7 w-7 place-items-center rounded-full ring-2", state === "done" ? "bg-signal-emerald-ink text-background ring-signal-emerald-ink/30" : state === "running" ? "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-ink" : state === "planned" ? "bg-card text-signal-blue-ink ring-signal-blue-line ring-dashed" : "bg-muted text-muted-foreground ring-transparent")}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className={cn("mt-1 truncate text-[11.5px] font-semibold", state === "todo" ? "text-muted-foreground" : "text-foreground")}>{STAGE_LABEL[stage.stage] || stage.stage}</p>
            <p className="truncate text-[11px] tabular-nums text-muted-foreground" title={nums}>{nums}</p>
            {state === "running" && target > 0 ? <span className="mx-auto mt-1 block h-1 w-3/4 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-signal-blue-ink" style={{ width: `${pct}%` }} /></span> : null}
            <span className="sr-only">{state === "done" ? "done" : state === "running" ? "running" : state === "planned" ? "planned" : "not started"}</span>
          </li>
        )
      })}
    </ol>
  )
}
