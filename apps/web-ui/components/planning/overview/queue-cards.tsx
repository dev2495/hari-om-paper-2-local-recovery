"use client"

import Link from "next/link"
import { ArrowRight, CalendarClock, Hourglass, Undo2 } from "lucide-react"

import { cn } from "@/lib/utils"

import { STAGE_LABEL, STAGE_ORDER, boardHref, fmtNum, stageLabel } from "./lib"
import { ToneChip } from "./ui"
import type { OverviewQueue, Stage } from "./types"

export function QueueCards({ queue, stages, today }: { queue: OverviewQueue[]; stages: Stage[]; today: string }) {
  const rows = STAGE_ORDER.filter((stage) => !stages.length || stages.includes(stage))
    .map((stage) => queue.find((row) => row.stage === stage))
    .filter((row): row is OverviewQueue => Boolean(row))
  if (!rows.length) return <p className="text-sm text-muted-foreground">No queue for these stages.</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="queue-cards">
      {rows.map((row) => {
        const urgent = Number(row.overdue || 0) > 0
        const soon = Number(row.due_3d || 0) > 0
        return (
          <article key={row.stage} className={cn("flex min-w-0 flex-col rounded-lg border bg-card p-3", urgent ? "border-signal-rose-line" : soon ? "border-signal-amber-line" : "border-border")}>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-foreground">{STAGE_LABEL[row.stage] || row.label}</h3>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className={cn("text-[26px] font-semibold leading-none tabular-nums", row.open_cards ? "text-foreground" : "text-muted-foreground")}>{fmtNum(row.open_cards)}</span>
              <span className="text-[12px] text-muted-foreground">open to plan</span>
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{fmtNum(row.open_pcs)} pcs waiting for a slot</p>
            <div className="mb-3 mt-2 flex flex-wrap gap-1">
              {row.overdue ? <ToneChip tone="rose" Icon={CalendarClock}>{fmtNum(row.overdue)} overdue</ToneChip> : null}
              {row.due_3d ? <ToneChip tone="amber" Icon={CalendarClock}>{fmtNum(row.due_3d)} due in 3 days</ToneChip> : null}
              {row.missed ? <ToneChip tone="orange" Icon={Undo2}>{fmtNum(row.missed)} back from a silent slot</ToneChip> : null}
              {row.waiting_cards ? (
                <ToneChip tone="neutral" Icon={Hourglass} title={`${row.waiting_cards} card${row.waiting_cards === 1 ? "" : "s"} waiting for ${row.waiting_for ? stageLabel(row.waiting_for) : "the previous stage"} to be planned first`}>
                  {fmtNum(row.waiting_cards)} waiting for {row.waiting_for ? stageLabel(row.waiting_for) : "previous stage"}
                </ToneChip>
              ) : null}
              {!row.overdue && !row.due_3d && !row.missed && !row.waiting_cards ? <span className="text-[11.5px] text-muted-foreground">Nothing urgent</span> : null}
            </div>
            <Link href={boardHref({ stage: row.stage, plan_date: today })} className={cn("mt-auto inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg border text-[12px] font-semibold transition-colors", row.open_cards ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {row.open_cards ? "Plan on the board" : "Open the board"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </article>
        )
      })}
    </div>
  )
}
