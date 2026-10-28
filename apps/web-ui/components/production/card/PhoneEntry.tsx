"use client"

// Phone scan landing: the printed card's QR opens this. One card, its stages as tabs, two big buttons
// (Log output, Log QC), the stage's recent runs and what still needs QC. Old-form cards keep their form.
// A card from another plant switches the active plant; a closed card is shown read-only.

import Link from "next/link"
import { ArrowLeftRight, Camera, CheckCircle2, ClipboardCheck, ClipboardList, Clock3, Flag, Lock, ScanLine, SearchX } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useCardPlantFallback } from "@/hooks/use-card-plant"
import { useJobCardLifecycle } from "@/hooks/use-lifecycle"
import { usePlanningJobCard } from "@/hooks/use-production"
import { cn } from "@/lib/utils"
import JobCardDocument from "../JobCardDocument"
import { ColorChip, LifecycleBadge } from "../lifecycle-chips"
import { LiveFloorLog } from "../live-floor-log"
import { CloseStageDialog, closeBlockedReason } from "./CloseStageDialog"
import { useCardFlow, useCardMasters, useStageEntries } from "./data"
import { FormStageTabs, type StageTab } from "./EntrySheet"
import { CardEntrySheets, defaultOutputStage, defaultQcStage, type EntryPanel } from "./JobCardPage"
import { RunRows } from "./RunList"
import { cardFacts, currentFloorStage, fmt, isLoggable, previousStage, runNo, runQcState, stageLabel, stageParameters, toneClass, useCardRoles, visibleStages } from "./model"

export function PhoneEntry({ jobCardId, mode, stage: wantedStage, entryId }: { jobCardId: string; mode?: string | null; stage?: string | null; entryId?: string | null }) {
  const { canDraft, canQc, canSubmit } = useCardRoles()
  const cardQuery = usePlanningJobCard(jobCardId)
  const card = cardQuery.data
  const facts = cardFacts(card)
  const isV2 = Boolean(card) && facts.isV2
  const flow = useCardFlow(card, isV2)
  // Asked in the card's own plant, so the status badge also shows in the "All plants" view.
  const lifecycle = useJobCardLifecycle(card?.id, card?.plant_id)
  // A card from another plant answers 404 here: it is looked for in this user's other plants.
  const plant = useCardPlantFallback(jobCardId, cardQuery)
  const stages = useMemo(() => visibleStages(flow.data), [flow.data])
  const [stage, setStage] = useState<string>(wantedStage || "")
  const [panel, setPanel] = useState<EntryPanel>(null)
  const [closing, setClosing] = useState(false)
  const { machineName } = useCardMasters(card)
  useEffect(() => {
    if (!stages.length) return
    if (!stage || !stages.some((s: any) => s.stage === stage)) setStage(wantedStage && stages.some((s: any) => s.stage === wantedStage) ? wantedStage : defaultOutputStage(stages))
  }, [stages, stage, wantedStage])
  const listing = useStageEntries(card, stage || undefined, 0, isV2 && Boolean(stage))
  const entries: any[] = listing.data?.entries || []
  const state = stages.find((s: any) => s.stage === stage)
  const prev = previousStage(stages, stage)
  // A completed or cancelled card takes no more runs and no run edits. QC readings can still be added or
  // corrected on a completed card (as before); a cancelled card takes nothing. A card cancelled by its
  // close mode can still carry an older status, so both are read.
  const cancelled = String(card?.status || "").toUpperCase() === "CANCELLED" || String(card?.close_mode || "").toUpperCase() === "CANCELLED"
  const cardOpen = facts.open && !cancelled
  const closedWord = cancelled ? "cancelled" : "completed"
  const waiting = !cancelled ? entries.filter((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && stageParameters(card, e.stage).length && !runQcState(card, e).accepted) : []
  const hasQc = stageParameters(card, stage).length > 0
  const outputBlocked = !cardOpen ? "Card is closed" : !state ? "" : !isLoggable(state) ? (state.status === "COMPLETED" ? `${stageLabel(stage)} is closed` : `${stageLabel(stage)} is not logged as runs`) : !canDraft ? "Your role cannot log runs" : ""
  const qcBlocked = cancelled ? "Card is cancelled" : !hasQc ? `No QC checks on ${stageLabel(stage)}` : !canQc ? "Your role cannot record QC" : ""
  // The stage the card is on now can be closed from the phone too (a supervisor confirms; others see what is missing).
  const closeable = Boolean(state) && cardOpen && state?.status !== "COMPLETED" && currentFloorStage(stages)?.stage === stage
  const closeBlocked = closeable ? closeBlockedReason(state, card) : ""
  // ?mode=output|qc from the picker opens the form straight away, once the stages are known, but only a
  // form this role can use on this card. Old supervisor-entry links always ask for output, so a QC role
  // gets its own Log QC; a role with neither (Planner) gets no form, only the card.
  const autoPanel = mode === "output" && canDraft ? "output" : (mode === "qc" || mode === "output") && canQc ? "qc" : ""
  useEffect(() => {
    if (!isV2 || !stages.length || !stage || panel || !autoPanel) return
    if (autoPanel === "output" && cardOpen) setPanel({ kind: "output", stage: isLoggable(state) ? stage : defaultOutputStage(stages) })
    if (autoPanel === "qc" && !cancelled) setPanel({ kind: "qc", stage: hasQc ? stage : defaultQcStage(card, stages, entries).stage, entryId: entryId || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isV2, stages.length, stage, listing.isLoading])

  const pickerHref = `/production/entry${mode ? `?mode=${mode}` : ""}`
  if (cardQuery.isLoading || plant.probing) return <LoadingState label="Opening the job card…" />
  if (plant.missing) {
    return (
      <section className="mx-auto max-w-lg rounded-xl border border-signal-rose-line bg-card p-5" data-testid="phone-card-missing">
        <div role="alert">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-signal-rose-ink">
            <SearchX className="h-4 w-4" aria-hidden="true" /> No such job card
          </p>
          <h1 className="mt-2 text-[18px] font-semibold">This QR or link does not match a job card {plant.multiPlant ? "in your plants" : "in this plant"}.</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Scan the QR on the printed card again, or type its number on the floor entry page.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={pickerHref} className="erp-btn-primary !h-11" data-testid="phone-missing-scan">
            <ScanLine className="h-4 w-4" /> Scan another card
          </Link>
          <Link href={`${pickerHref}#open-cards`} className="erp-btn-secondary !h-11" data-testid="phone-missing-pick">
            <ClipboardList className="h-4 w-4" /> Pick from open cards
          </Link>
        </div>
      </section>
    )
  }
  if (cardQuery.isError || plant.failed || !card) return <ErrorState title="This job card could not be opened" message="Check the connection and try again, or scan another card." onRetry={() => (plant.failed ? plant.retry() : void cardQuery.refetch())} />

  const tabs: StageTab[] = stages.map((s: any) => ({ stage: s.stage, status: s.status, good: s.accepted_total, target: s.target, unit: s.unit, badge: s.draft_count ? `${s.draft_count} draft` : s.qc_flagged_runs ? `${s.qc_flagged_runs} flagged` : undefined }))
  const pct = state && Number(state.target) ? Math.min(100, (Number(state.accepted_total) / Number(state.target)) * 100) : 0

  return (
    <div className="space-y-3" data-testid="phone-entry">
      {plant.switchedTo ? (
        <p role="status" className={cn("flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium", toneClass("blue"))} data-testid="phone-plant-switched">
          <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" /> Switched to {plant.switchedToName} for this card
        </p>
      ) : null}
      <section className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--shadow-premium)]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-bold tracking-tight">{facts.no}</h1>
          {lifecycle.data ? <LifecycleBadge state={lifecycle.data.state} /> : null}
          <Link href={`/production/job-cards/${card.id}`} className="-mr-2 ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-[12.5px] font-medium text-primary underline-offset-2 hover:underline" data-testid="phone-open-card">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> Full card
          </Link>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <b className="text-foreground">{facts.customer}</b>
          {facts.size ? ` · ${facts.size} mm` : ""}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
          <ColorChip color={facts.colour} empty="Plain" />
          <span>
            · {fmt(facts.qty, 0)} pcs{facts.bamboo ? ` = ${fmt(facts.bamboo, 0)} bamboo × ${fmt(facts.pcsPerBamboo, 0)}` : ""}
          </span>
        </p>
      </section>

      {!cardOpen ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-[13px]" data-testid="phone-card-closed">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <b>This card is closed ({closedWord}).</b> {cancelled || !isV2 ? "Nothing more can be logged on it." : "No more runs can be logged; QC readings can still be added to its runs."}{!isV2 ? " Full card shows what was entered." : ""}
          </span>
        </p>
      ) : null}

      {!isV2 ? (
        <div className="space-y-3" data-testid="phone-old-form">
          {cardOpen ? (
            <p className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-[13px]">
              <b>Old entry form.</b> Enter this card&apos;s stage output and QC below as before.
            </p>
          ) : null}
          {/* Its "put the card on the schedule" hint does not apply to a cancelled card. */}
          {closedWord !== "cancelled" ? <LiveFloorLog jobCardId={String(card.id)} /> : null}
          {/* A closed card's whole sheet is read-only on Full card; the phone shows no form to fill. */}
          {cardOpen ? <JobCardDocument jobCardId={String(card.id)} mode="supervisor" /> : null}
        </div>
      ) : (
        <>
          {flow.isError ? <ErrorState title="The card's stages could not be loaded" message="Refresh to retry." onRetry={() => void flow.refetch()} /> : null}
          {stages.length ? <FormStageTabs tabs={tabs} value={stage} onChange={setStage} /> : null}

          {state ? (
            <section className="rounded-xl border border-border bg-card px-3.5 py-3" data-testid="phone-stage-summary">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[16px] font-semibold">
                  {stageLabel(stage)} <span className="text-[12.5px] font-normal text-muted-foreground">· {state.status === "COMPLETED" ? "closed" : state.status === "RUNNING" ? "running" : "not started"}</span>
                </h2>
                <p className="text-[13px] tabular-nums">
                  <b className="text-[16px]">{fmt(state.accepted_total)}</b> / {fmt(state.target)} {state.unit}
                </p>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", state.status === "COMPLETED" ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                {state.rejected_total ? <span className="text-signal-rose-ink">{fmt(state.rejected_total)} rejected</span> : null}
                {state.draft_count ? <span className="text-signal-amber-ink">{state.draft_count} draft waiting</span> : null}
                {state.available_from_upstream != null && prev && state.status !== "COMPLETED" ? (
                  <span>
                    {fmt(state.available_from_upstream)} {state.input_unit} ready from {stageLabel(prev)}
                  </span>
                ) : null}
                {Number(state.awaiting_qc_from_upstream) > 0 ? <span className="text-signal-amber-ink">{fmt(state.awaiting_qc_from_upstream)} waiting for {stageLabel(prev || "")} QC</span> : null}
                {state.qc_flagged_runs ? (
                  <span className="inline-flex items-center gap-0.5 text-signal-amber-ink">
                    <Flag className="h-3 w-3" aria-hidden="true" /> {state.qc_flagged_runs} flagged run{state.qc_flagged_runs === 1 ? "" : "s"}
                  </span>
                ) : null}
              </p>
            </section>
          ) : null}

          <div className="grid grid-cols-2 gap-2" data-testid="phone-actions">
            <button type="button" className="erp-btn-primary !h-16 flex-col !gap-0.5 !rounded-xl !text-[15px] disabled:cursor-not-allowed" disabled={Boolean(outputBlocked)} title={outputBlocked || undefined} onClick={() => setPanel({ kind: "output", stage })} data-testid="phone-log-output">
              <Camera className="h-5 w-5" />
              Log output
              {outputBlocked ? <span className="text-[10.5px] font-normal opacity-90">{outputBlocked}</span> : null}
            </button>
            <button type="button" className="erp-btn-secondary !h-16 flex-col !gap-0.5 !rounded-xl !text-[15px] disabled:cursor-not-allowed" disabled={Boolean(qcBlocked)} title={qcBlocked || undefined} onClick={() => setPanel({ kind: "qc", stage, entryId: waiting[0]?.id || null })} data-testid="phone-log-qc">
              <ClipboardCheck className="h-5 w-5" />
              <span className="inline-flex items-center gap-1.5">
                Log QC {waiting.length ? <span className={cn("rounded-full border px-1.5 text-[11px] font-bold", toneClass("amber"))}>{waiting.length} waiting</span> : null}
              </span>
              {qcBlocked ? <span className="text-[10.5px] font-normal text-muted-foreground">{qcBlocked}</span> : null}
            </button>
          </div>

          {closeable ? (
            <button type="button" className={cn("erp-btn-secondary !h-12 w-full !rounded-xl !text-[14px]", closeBlocked || !canSubmit ? "!text-muted-foreground" : "")} onClick={() => setClosing(true)} data-testid="phone-close-stage">
              {closeBlocked || !canSubmit ? <Lock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              Close {stageLabel(stage)}
              <span className="text-[11.5px] font-normal">{!canSubmit ? "· supervisor" : closeBlocked ? `· ${!state?.qc?.ready ? "QC readings short" : "not yet"}` : ""}</span>
            </button>
          ) : null}

          {waiting.length ? (
            <section className={cn("rounded-xl border px-3.5 py-2.5", toneClass("amber"))} data-testid="phone-waiting">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Clock3 className="h-4 w-4" aria-hidden="true" /> Still needs QC
              </p>
              <ul className="mt-1 space-y-1">
                {waiting.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">
                      Run {runNo(e)} · {fmt(e.accepted)} good{e.machine_id ? ` · ${machineName(e.machine_id)}` : ""}
                      {runQcState(card, e).key === "short" ? " · needs more readings" : ""}
                    </span>
                    <button type="button" className="erp-btn-primary !h-11 !px-3" onClick={() => setPanel({ kind: "qc", stage: e.stage, entryId: e.id })} data-testid={`phone-qc-${e.entry_no}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Log QC
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="phone-runs">
            <div className="flex items-baseline justify-between border-b border-border px-3.5 py-2.5">
              <h3 className="text-[14px] font-semibold">
                {stageLabel(stage)} runs <span className="font-normal text-muted-foreground">· {listing.data?.total ?? 0}</span>
              </h3>
              <span className="text-[11.5px] text-muted-foreground">newest first</span>
            </div>
            {listing.isLoading ? <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Loading runs…</p> : <RunRows card={card} flow={flow.data} entries={entries.slice(0, 20)} showStage={false} layout="list" onEdit={cardOpen ? (entry) => setPanel({ kind: "output", stage: entry.stage, entry }) : undefined} onQc={!cancelled ? (entry) => setPanel({ kind: "qc", stage: entry.stage, entryId: entry.id }) : undefined} readOnly={!cardOpen} emptyText={`No runs on ${stageLabel(stage)} yet.`} />}
          </section>

          <CardEntrySheets card={card} flow={flow.data} stages={stages} panel={panel} onChange={setPanel} />
          {closing && state ? <CloseStageDialog card={card} flow={flow.data} stage={stage} entries={entries} open={closing} onOpenChange={setClosing} onLogQc={(s) => setPanel({ kind: "qc", stage: s, entryId: null })} /> : null}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 text-[12.5px]">
        <Link href={pickerHref} className="erp-btn-secondary !h-11">
          <ScanLine className="h-4 w-4" /> Scan another card
        </Link>
        <Link href={`/production/job-cards/${card.id}`} className="inline-flex min-h-11 items-center px-1 text-primary underline-offset-2 hover:underline">
          Open the full job card
        </Link>
      </div>
    </div>
  )
}
