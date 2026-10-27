"use client"

// The QC desk embed (Quality › Stage QC) and any older host of a batch-entry card: stage tabs, the
// stage's runs with their QC state, and the same two floor forms the job card page uses. Every rule
// lives in components/production/card/*; this is only the compact desk around them.

import Link from "next/link"
import { Camera, ClipboardCheck } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { seasonLabel } from "@/lib/season-api"
import { useCardFlow, useStageEntries } from "./card/data"
import { FormStageTabs } from "./card/EntrySheet"
import { CardEntrySheets, type EntryPanel } from "./card/JobCardPage"
import { qcStageTabs } from "./card/LogQcForm"
import { RunRows } from "./card/RunList"
import { fmt, isLoggable, runQcState, stageLabel, stageParameters, toneClass, useCardRoles, visibleStages } from "./card/model"

export function ContinuousJobCard({ card, initialStage, embedded = false }: { card: any; initialStage?: string; embedded?: boolean }) {
  const { canDraft, canQc } = useCardRoles()
  const flow = useCardFlow(card)
  const stages = useMemo(() => visibleStages(flow.data), [flow.data])
  const [stage, setStage] = useState(initialStage || "WINDER")
  const [panel, setPanel] = useState<EntryPanel>(null)
  useEffect(() => {
    if (stages.length && !stages.some((s: any) => s.stage === stage)) setStage(stages[0].stage)
  }, [stages, stage])
  const listing = useStageEntries(card, stage, 0, Boolean(stage))
  const entries: any[] = listing.data?.entries || []
  const state = stages.find((s: any) => s.stage === stage)
  const waiting = entries.filter((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && stageParameters(card, e.stage).length && !runQcState(card, e).accepted)
  const hasQc = stageParameters(card, stage).length > 0
  const profile = card.spec_snapshot?.qc_profile

  if (flow.isLoading) return <p role="status" className="p-6">Loading production entries…</p>
  if (flow.isError)
    return (
      <div className="rounded-xl border border-destructive p-6">
        <p>Production entries could not be loaded.</p>
        <Button onClick={() => void flow.refetch()}>Retry</Button>
      </div>
    )

  return (
    <div className={embedded ? "space-y-4" : "mx-auto max-w-5xl space-y-4"} data-testid="continuous-job-card">
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">QC desk</p>
            <h2 className="text-xl font-semibold">
              {card.job_card_no || "Job card"} · {seasonLabel(flow.data.season)}
            </h2>
            <p className="text-sm text-muted-foreground">
              Recipe r{flow.data.recipe_revision} · QC rules v{profile?.provenance?.rule_set_version}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/production/job-cards/${card.id}`}>Open the job card</Link>
          </Button>
        </div>
      )}
      <FormStageTabs tabs={qcStageTabs(card, stages).map((tab) => ({ ...tab, disabled: undefined }))} value={stage} onChange={setStage} />
      {state ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid="season-stage-status">
          <p className="text-[14px]">
            <b>{stageLabel(stage)}</b> · {fmt(state.accepted_total)} of {fmt(state.target)} {state.unit} good
            {state.rejected_total ? <span className="text-signal-rose-ink"> · {fmt(state.rejected_total)} rejected</span> : null}
            {state.draft_count ? <span className="text-signal-amber-ink"> · {state.draft_count} draft waiting</span> : null}
          </p>
          {waiting.length ? <span className={cn("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", toneClass("amber"))}>{waiting.length} run{waiting.length === 1 ? "" : "s"} waiting for QC</span> : null}
          <div className="ml-auto flex flex-wrap gap-2">
            {canQc && hasQc ? (
              <Button onClick={() => setPanel({ kind: "qc", stage, entryId: waiting[0]?.id || null })} data-testid="desk-log-qc">
                <ClipboardCheck className="h-4 w-4" /> Log QC
              </Button>
            ) : null}
            {canDraft && isLoggable(state) ? (
              <Button variant="outline" onClick={() => setPanel({ kind: "output", stage })} data-testid="desk-log-output">
                <Camera className="h-4 w-4" /> Log output
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="season-runs">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="font-semibold">
            {stageLabel(stage)} runs · {listing.data?.total ?? 0}
          </h3>
          <p className="text-xs text-muted-foreground">Out of band is flagged, never held · at least 2 readings per check</p>
        </div>
        {listing.isLoading ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading runs…</p> : <RunRows card={card} flow={flow.data} entries={entries} showStage={false} onEdit={(entry) => setPanel({ kind: "output", stage: entry.stage, entry })} onQc={(entry) => setPanel({ kind: "qc", stage: entry.stage, entryId: entry.id })} emptyText={`No runs logged on ${stageLabel(stage)} yet.`} />}
      </section>
      <CardEntrySheets card={card} flow={flow.data} stages={stages} panel={panel} onChange={setPanel} />
    </div>
  )
}
