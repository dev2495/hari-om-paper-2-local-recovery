"use client"

import Link from "next/link"
import { useMemo } from "react"
import { AlertTriangle, CalendarClock, ExternalLink, Gauge, Info, ListChecks, OctagonAlert, Undo2, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { SEVERITY_LABEL, SEVERITY_TONE, TONE, boardHref, cardHref, fmtDay, shiftLabel, stageLabel, type Tone } from "./lib"
import { ToneChip } from "./ui"
import type { AttentionKind, OverviewAttention, OverviewSlot, Severity } from "./types"

const KIND_META: Record<AttentionKind, { label: string; Icon: LucideIcon }> = {
  SILENT_SLOT: { label: "Nothing logged", Icon: Undo2 },
  ORDER: { label: "Stage order", Icon: ListChecks },
  AFTER_DUE: { label: "Planned after due", Icon: CalendarClock },
  OVERLOAD: { label: "Over capacity", Icon: Gauge },
  QUEUE_DUE: { label: "Due, not planned", Icon: AlertTriangle },
}
const SEVERITY_ICON: Record<Severity, LucideIcon> = { high: OctagonAlert, medium: AlertTriangle, low: Info }
const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"]

export function AttentionList({ items, slots, onOpenSlot, limit }: { items: OverviewAttention[]; slots: OverviewSlot[]; onOpenSlot: (slot: OverviewSlot) => void; limit?: number }) {
  const sorted = useMemo(() => items.slice().sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)), [items])
  const slotIndex = useMemo(() => {
    const map = new Map<string, OverviewSlot>()
    for (const slot of slots) map.set(`${slot.job_card_id}|${slot.stage}|${slot.plan_date}|${slot.shift_code}`, slot)
    return map
  }, [slots])
  const shown = limit ? sorted.slice(0, limit) : sorted
  if (!sorted.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2.5 text-sm text-signal-emerald-ink">
        <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />
        Nothing needs action in this period.
      </p>
    )
  }
  return (
    <ol className="max-h-[440px] space-y-2 overflow-y-auto pr-0.5" data-testid="attention-list">
      {shown.map((item, index) => {
        const tone: Tone = SEVERITY_TONE[item.severity] || "blue"
        const kind = KIND_META[item.kind] || { label: item.kind, Icon: Info }
        const SeverityIcon = SEVERITY_ICON[item.severity] || Info
        const slot = item.job_card_id && item.stage && item.plan_date && item.shift_code ? slotIndex.get(`${item.job_card_id}|${item.stage}|${item.plan_date}|${item.shift_code}`) : undefined
        return (
          <li key={`${item.kind}:${item.job_card_id}:${item.stage}:${item.plan_date}:${item.shift_code}:${index}`} className={cn("rounded-lg border border-l-[3px] bg-card px-3 py-2.5", TONE[tone].line)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ToneChip tone={tone} Icon={SeverityIcon}>{SEVERITY_LABEL[item.severity] || item.severity}</ToneChip>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
                    <kind.Icon className="h-3 w-3" aria-hidden="true" />
                    {kind.label}
                  </span>
                  {item.stage ? <span className="text-[11.5px] text-muted-foreground">· {stageLabel(item.stage)}</span> : null}
                  {item.plan_date ? <span className="text-[11.5px] tabular-nums text-muted-foreground">· {fmtDay(item.plan_date)}{item.shift_code ? ` ${shiftLabel(item.shift_code)}` : ""}</span> : null}
                </div>
                <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">{item.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{item.detail}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {slot ? (
                  <button type="button" className="erp-btn-secondary !h-8 !px-2.5 !text-[12px]" onClick={() => onOpenSlot(slot)}>
                    Show slot
                  </button>
                ) : null}
                {item.job_card_id ? (
                  <Link href={cardHref(item.job_card_id)} className="erp-btn-secondary !h-8 !px-2.5 !text-[12px]">
                    Open card
                  </Link>
                ) : null}
                {item.stage ? (
                  <Link href={boardHref({ stage: item.stage, plan_date: item.plan_date, job_card_id: item.job_card_id, machine_id: item.machine_id, shift_code: item.shift_code })} className="erp-btn-primary !h-8 !px-2.5 !text-[12px]">
                    Planner board
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
      {limit && sorted.length > limit ? <li className="text-[12px] text-muted-foreground">{sorted.length - limit} more · narrow the stages or machine, or export Excel for the full list.</li> : null}
    </ol>
  )
}
