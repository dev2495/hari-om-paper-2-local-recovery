"use client"

import { useState } from "react"
import { Settings2 } from "lucide-react"

import { ColorChip, JobCardNo, LifecycleBadge } from "@/components/production/lifecycle-chips"
import { JobCardLifecycleSheet } from "@/components/production/job-card-lifecycle-sheet"
import { useJobCardLifecycle } from "@/hooks/use-lifecycle"

const fmt = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

/** Compact lifecycle bar above a job card document: number, state, color, qty and a manage button. */
export function LifecycleStrip({ jobCardId }: { jobCardId: string }) {
  const { data } = useJobCardLifecycle(jobCardId)
  const [open, setOpen] = useState(false)
  if (!data) return null
  return (
    <>
      <section className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm print:hidden" data-testid="job-card-lifecycle-strip">
        <JobCardNo job={data} />
        <LifecycleBadge state={data.state} />
        <ColorChip color={data.parchment_color} empty="Plain (no parchment)" />
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          Planned <strong className="text-foreground">{fmt(data.planned_qty)}</strong> · made <strong className="text-foreground">{fmt(data.made_qty)}</strong>
          {data.returned_qty ? <> · <span className="text-signal-rose-ink">{fmt(data.returned_qty)} back to order</span></> : null}
        </span>
        {data.family.length > 1 ? <span className="text-[12px] text-muted-foreground">{data.family.length} cards in family</span> : null}
        <button type="button" className="erp-btn-secondary ml-auto !h-8" onClick={() => setOpen(true)}><Settings2 className="h-4 w-4" />Manage lifecycle</button>
      </section>
      <JobCardLifecycleSheet jobCardId={jobCardId} open={open} onOpenChange={setOpen} />
    </>
  )
}
