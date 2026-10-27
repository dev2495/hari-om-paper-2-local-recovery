"use client"

// The one job card page (client 2026-10-27): header with the card's identity and bamboo math, a sticky
// bar with the day-to-day actions (Log output, Log QC, Close stage, Print, Phone link) and Manage card,
// the stage stepper, and tabs — Overview, Output log, QC, Plan, Material, Dispatch, History & audit.
// Old-form cards keep their stage form inside the page ("Old form" tab); batch-entry cards log through
// the two short floor forms, which open in a side panel here and full screen on a phone.

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Camera, CheckCircle2, ClipboardCheck, ClipboardList, Copy, Download, Flag, History, Lock, Printer, QrCode, Scissors, Smartphone, Wrench } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useJobCardLifecycle } from "@/hooks/use-lifecycle"
import { usePlanningJobCard } from "@/hooks/use-production"
import { buildProductionEntryUrl } from "@/lib/app-url"
import { cn } from "@/lib/utils"
import JobCardDocument from "../JobCardDocument"
import { CardPlanPanel } from "../CardPlanPanel"
import { OldFormDrafts } from "../BatchEntrySwitch"
import { ColorChip, JobCardNo, LifecycleBadge } from "../lifecycle-chips"
import { LiveFloorLog } from "../live-floor-log"
import { WholeCardEntryForm } from "../WholeCardEntryForm"
import { CloseStageDialog, closeBlockedReason } from "./CloseStageDialog"
import { useAllStageEntries, useCardFlow, useCardHistory, useCardMasters, useCardMutation, useCardPlan, useEntryApi, useStableCommand } from "./data"
import { EntrySheet } from "./EntrySheet"
import { LogOutputForm } from "./LogOutputForm"
import { LogQcForm } from "./LogQcForm"
import { RunRows } from "./RunList"
import { StageStepper, stepsFromFlow, stepsFromOldCard, type StepInfo } from "./StageStepper"
import { DispatchTab } from "./tabs/DispatchTab"
import { HistoryTab } from "./tabs/HistoryTab"
import { MaterialTab } from "./tabs/MaterialTab"
import { OverviewTab, type NextStep } from "./tabs/OverviewTab"
import { QcTab } from "./tabs/QcTab"
import { cardFacts, currentFloorStage, dayLabel, fmt, isLoggable, runNo, runQcState, shiftLabel, stageLabel, stageParameters, stampDay, stampLabel, toneClass, useCardRoles, visibleStages } from "./model"

export type EntryPanel = { kind: "output" | "qc"; stage: string; entryId?: string | null; entry?: any | null } | null
const TABS = ["overview", "log", "qc", "plan", "material", "dispatch", "history", "oldform"] as const
type Tab = (typeof TABS)[number]

/** The two floor forms in their sheet; used by the job card page, the phone landing and the QC desk. */
export function CardEntrySheets({ card, flow, stages, panel, onChange }: { card: any; flow: any; stages: any[]; panel: EntryPanel; onChange: (panel: EntryPanel) => void }) {
  const facts = cardFacts(card)
  return (
    <>
      <EntrySheet open={panel?.kind === "output"} onOpenChange={(open) => (open ? undefined : onChange(null))} title="Log output" subtitle={`${facts.no} · ${facts.customer}${facts.size ? ` · ${facts.size}` : ""} · no QC fields here`} testId="log-output-sheet">
        {panel?.kind === "output" ? (
          <LogOutputForm
            card={card}
            flow={flow}
            stages={stages}
            stage={panel.stage}
            onStage={(stage) => onChange({ kind: "output", stage, entry: null })}
            entry={panel.entry}
            onCancel={() => onChange(null)}
            onLogQc={(entry) => onChange({ kind: "qc", stage: entry.stage, entryId: entry.id })}
          />
        ) : null}
      </EntrySheet>
      <EntrySheet open={panel?.kind === "qc"} onOpenChange={(open) => (open ? undefined : onChange(null))} title="Log QC" subtitle={`${facts.no} · ${facts.customer} · at least 2 readings per check · out of band is flagged, not held`} tone="amber" testId="log-qc-sheet">
        {panel?.kind === "qc" ? <LogQcForm card={card} stages={stages} stage={panel.stage} onStage={(stage) => onChange({ kind: "qc", stage, entryId: null })} entryId={panel.entryId} onCancel={() => onChange(null)} /> : null}
      </EntrySheet>
    </>
  )
}

/** Which stage a new run goes to: the open floor stage, else the first open one. */
export function defaultOutputStage(stages: any[]): string {
  const current = currentFloorStage(stages)
  if (current && isLoggable(current)) return current.stage
  return stages.find((s: any) => isLoggable(s))?.stage || stages[0]?.stage || "WINDER"
}
/** Which stage Log QC opens on: the one with runs waiting, else the open stage with QC checks. */
export function defaultQcStage(card: any, stages: any[], entries: any[]): { stage: string; entryId: string | null } {
  const waiting = entries.find((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && stageParameters(card, e.stage).length && !runQcState(card, e).accepted)
  if (waiting) return { stage: waiting.stage, entryId: waiting.id }
  const current = currentFloorStage(stages)
  if (current && stageParameters(card, current.stage).length) return { stage: current.stage, entryId: null }
  return { stage: stages.find((s: any) => stageParameters(card, s.stage).length)?.stage || stages[0]?.stage || "WINDER", entryId: null }
}

function PhoneLinkDialog({ card, open, onOpenChange }: { card: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  const url = buildProductionEntryUrl(card?.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="phone-link-dialog">
        <DialogHeader>
          <DialogTitle>Phone link · {card?.job_card_no}</DialogTitle>
          <DialogDescription>Scan with the phone camera or open the link. It lands on this card with Log output and Log QC.</DialogDescription>
        </DialogHeader>
        <div className="grid place-items-center rounded-xl border border-border bg-white p-4">
          <QRCodeSVG value={url} size={180} />
        </div>
        <p className="break-all rounded-lg bg-muted px-3 py-2 text-[12px]">{url}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url)
                showToast("Link copied.", "success")
              } catch {
                showToast("Could not copy — select the link and copy it.", "error")
              }
            }}
          >
            <Copy className="h-4 w-4" /> Copy link
          </Button>
          <Button asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <Smartphone className="h-4 w-4" /> Open
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function JobCardPage({ jobCardId }: { jobCardId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showToast } = useApp()
  const { canSubmit, canReopen, canQc, canDraft } = useCardRoles()
  const cardQuery = usePlanningJobCard(jobCardId)
  const card = cardQuery.data
  const facts = cardFacts(card)
  const isV2 = Boolean(card) && facts.isV2
  const flow = useCardFlow(card, isV2)
  const lifecycle = useJobCardLifecycle(card?.id)
  const stages = useMemo(() => visibleStages(flow.data), [flow.data])
  const entryStages = useMemo(() => (flow.data?.stages || []).map((s: any) => s.stage).filter((s: string) => !["SLITTING", "DISPATCH"].includes(s)), [flow.data])
  const all = useAllStageEntries(card, entryStages, isV2)
  const plan = useCardPlan(card, isV2)
  const history = useCardHistory(card)
  const { machineName } = useCardMasters(card)
  const entryApi = useEntryApi(card)
  const { mutation, error: actionError, setError: setActionError } = useCardMutation(String(card?.id || jobCardId))
  const { stableCommand, reset } = useStableCommand()

  const [tab, setTabState] = useState<Tab>(() => {
    const wanted = searchParams?.get("tab") as Tab | null
    return wanted && TABS.includes(wanted) ? wanted : "overview"
  })
  const setTab = useCallback((next: Tab) => {
    setTabState(next)
    try {
      const url = new URL(window.location.href)
      if (next === "overview") url.searchParams.delete("tab")
      else url.searchParams.set("tab", next)
      window.history.replaceState(window.history.state, "", url.toString())
    } catch {}
  }, [])
  const [logStage, setLogStage] = useState<string>(searchParams?.get("stage") || "ALL")
  const [panel, setPanel] = useState<EntryPanel>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [phoneLink, setPhoneLink] = useState(false)
  const [wholeCard, setWholeCard] = useState(false)
  // Deep link from the floor or a notification: ?log=output|qc opens that form once.
  useEffect(() => {
    const wanted = searchParams?.get("log")
    if (!wanted || !isV2 || !stages.length || panel) return
    if (wanted === "output") setPanel({ kind: "output", stage: searchParams?.get("stage") || defaultOutputStage(stages) })
    // QC needs the runs first, so the waiting run (or ?entry=) is preselected.
    if (wanted === "qc" && !all.isLoading) setPanel({ kind: "qc", ...defaultQcStage(card, stages, all.entries), ...(searchParams?.get("stage") ? { stage: String(searchParams.get("stage")) } : {}), ...(searchParams?.get("entry") ? { entryId: String(searchParams.get("entry")) } : {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isV2, stages.length, all.isLoading])
  // An old-form card has no floor forms: ?log=output|qc lands on its Old form tab instead.
  useEffect(() => {
    if (card && !isV2 && searchParams?.get("log")) setTabState("oldform")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, isV2])
  useEffect(() => {
    if (card && !isV2 && tab === "log") setTabState("oldform")
    if (card && isV2 && tab === "oldform") setTabState("log")
  }, [card, isV2, tab])

  const steps: StepInfo[] = useMemo(() => (isV2 ? stepsFromFlow(flow.data) : stepsFromOldCard(card, lifecycle.data)), [isV2, flow.data, card, lifecycle.data])
  const entries = all.entries
  const live = entries.filter((e) => e.status !== "VOID")
  const waitingQc = live.filter((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && stageParameters(card, e.stage).length && !runQcState(card, e).accepted)
  const drafts = live.filter((e) => e.status === "DRAFT")
  const flagCount = live.reduce((n, e) => n + (Array.isArray(e.qc_flags) ? e.qc_flags.length : 0), 0)
  const current = currentFloorStage(stages)
  const closeTarget = current && (isLoggable(current) || current.stage === "QC") ? current : null
  const closeBlocked = closeTarget ? closeBlockedReason(closeTarget, card) : "No open stage"
  const closeTitle = !canSubmit ? "A supervisor closes the stage — open to see what is still needed" : closeBlocked ? `${closeBlocked} — open for details` : closeTarget ? `Confirms ${stageLabel(closeTarget.stage)} totals and moves the card on` : ""
  const outputBlocked = !facts.open ? "Card is closed" : !isV2 ? "Old entry form — use the Old form tab" : !stages.some((s: any) => isLoggable(s)) ? "No open stage takes runs" : !canDraft ? "Your role cannot log runs" : ""
  const qcBlocked = !isV2 ? "Old entry form — QC is on the Old form tab" : !stages.some((s: any) => stageParameters(card, s.stage).length) ? "No QC checks on this card" : !canQc ? "Your role cannot record QC" : ""
  const lastRun = live.find((e) => e.kind !== "QC_ONLY")
  const lastEvent = history.data?.events?.[0]
  const dueDays = facts.due ? Math.round((new Date(`${String(facts.due).slice(0, 10)}T00:00:00`).getTime() - new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00").getTime()) / 86400000) : null

  const openOutput = (stage?: string, entry?: any) => setPanel({ kind: "output", stage: stage || defaultOutputStage(stages), entry: entry || null })
  const openQc = (entry?: any | null, stage?: string) => setPanel({ kind: "qc", ...(entry ? { stage: entry.stage, entryId: entry.id } : { ...defaultQcStage(card, stages, entries), ...(stage ? { stage, entryId: null } : {}) }) })

  const nextSteps: NextStep[] = useMemo(() => {
    const out: NextStep[] = []
    if (!card) return out
    if (!isV2) {
      out.push({ title: "This card is on the old entry form", detail: "Enter stage output and QC on the Old form tab; a supervisor or planner can move it to batch entry.", action: { label: "Old form", onClick: () => setTab("oldform") } })
      return out
    }
    if (drafts.length) out.push({ title: canSubmit ? `Submit ${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : `Waiting for the supervisor: ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`, detail: `${Array.from(new Set(drafts.map((e) => `${runNo(e)} (${stageLabel(e.stage)})`))).join(", ")}${canSubmit ? "" : " · a supervisor checks and submits them"}`, action: { label: "Output log", onClick: () => setTab("log") } })
    if (waitingQc.length) out.push({ title: `Log QC on ${waitingQc.length} run${waitingQc.length === 1 ? "" : "s"}`, detail: `${waitingQc.map((e) => `${runNo(e)} (${stageLabel(e.stage)})`).slice(0, 4).join(", ")} · at least 2 readings per check`, action: canQc ? { label: "Log QC", onClick: () => openQc(waitingQc[0]) } : undefined })
    if (current && current.stage !== "DISPATCH") {
      const remaining = Math.max(0, Number(current.target || 0) - Number(current.accepted_total || 0))
      // A slot counts as planned only with its date, shift and machine (a queued card has a date only).
      const slot = (current.segments || []).find((s: any) => s.plan_date && s.shift_code && s.machine_id && !["COMPLETED", "CANCELLED"].includes(s.status))
      if (remaining > 0 && isLoggable(current)) out.push({ title: `Finish ${stageLabel(current.stage)} · ${fmt(remaining)} ${current.unit} to make`, detail: slot ? `Planned ${dayLabel(slot.plan_date)} · ${shiftLabel(slot.shift_code)}${slot.machine_id ? ` on ${machineName(slot.machine_id)}` : ""}` : "Not on the planner yet — runs can still be logged", action: canDraft ? { label: "Log output", onClick: () => openOutput(current.stage) } : undefined })
      else {
        const blocked = closeBlockedReason(current, card)
        out.push({ title: current.completes_card ? `Close ${stageLabel(current.stage)} and complete the card` : `Close ${stageLabel(current.stage)}`, detail: blocked || `${fmt(current.accepted_total)} of ${fmt(current.target)} ${current.unit} good · a supervisor confirms`, action: { label: canSubmit && !blocked ? "Close stage" : "See what is needed", onClick: () => setClosing(current.stage) } })
      }
    }
    const dispatch = stages.find((s: any) => s.stage === "DISPATCH")
    if (dispatch && Number(dispatch.available_from_upstream) > 0) out.push({ title: `Create dispatch slip · ${fmt(dispatch.available_from_upstream, 0)} pcs ready`, action: { label: "Dispatch", onClick: () => router.push(`/logistics/dispatch/new?job_card_id=${card.id}`) } })
    if (!out.length) out.push({ title: dispatch?.status === "COMPLETED" ? "Nothing pending — dispatched" : "Nothing pending", done: true })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, isV2, drafts.length, waitingQc.length, current, stages, canSubmit, canQc, canDraft])

  const reopen = (stage: string) => {
    const state = stages.find((s: any) => s.stage === stage)
    const reason = window.prompt("Reason to reopen this stage. Posted stock or tool usage needs a governed reversal or an additional card.")
    if (!reason?.trim() || !state) return
    mutation.mutate(async () => {
      const r = await entryApi.reopen(card.id, stage, stableCommand({ expected_version: state.row_version, reason: reason.trim() }, `reopen:${stage}`))
      reset()
      showToast(`${stageLabel(stage)} reopened.`, "success")
      return r
    })
  }
  const exportRuns = async () => {
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Output log")
    sheet.columns = [
      { header: "Run", key: "run", width: 8 },
      { header: "Stage", key: "stage", width: 10 },
      { header: "Date", key: "date", width: 12 },
      { header: "Shift", key: "shift", width: 8 },
      { header: "Machine", key: "machine", width: 14 },
      { header: "Operator", key: "operator", width: 20 },
      { header: "Made", key: "made", width: 8 },
      { header: "Good", key: "good", width: 8 },
      { header: "Rejected", key: "rejected", width: 9 },
      { header: "Reject code", key: "code", width: 10 },
      { header: "Status", key: "status", width: 10 },
      { header: "QC", key: "qc", width: 40 },
      { header: "Logged", key: "logged", width: 20 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const e of entries.filter((row) => logStage === "ALL" || row.stage === logStage)) sheet.addRow({ run: e.entry_no, stage: stageLabel(e.stage), date: e.business_date, shift: shiftLabel(e.shift_code), machine: machineName(e.machine_id), operator: e.operator_name || "", made: e.produced, good: e.accepted, rejected: e.rejected, code: e.details?.reject_code || "", status: e.status, qc: runQcState(card, e).label, logged: stampLabel(e.created_at) })
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `job-card-${String(facts.no).replace(/[^\w-]+/g, "-")}-runs.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (cardQuery.isLoading) return <LoadingState label="Opening the job card…" />
  if (cardQuery.isError || !card) return <ErrorState title="This job card could not be loaded" message="Refresh to retry, or go back to the job cards list." onRetry={() => void cardQuery.refetch()} />

  const logEntries = entries.filter((e) => logStage === "ALL" || e.stage === logStage)
  const logStageState = stages.find((s: any) => s.stage === logStage)
  const countFor = (stage: string) => entries.filter((e) => e.stage === stage).length
  const actionButton = "erp-btn-secondary !h-9 disabled:cursor-not-allowed"

  return (
    <div className="space-y-3" data-testid="job-card-page">
      <nav className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/production/job-cards" className="hover:text-foreground">
          Job cards
        </Link>
        <span aria-hidden="true">›</span>
        <b className="text-foreground">{facts.no}</b>
      </nav>

      <header className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-premium)]" data-testid="job-card-header">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-[24px] font-bold tracking-tight">{facts.no}</h1>
          {lifecycle.data ? <LifecycleBadge state={lifecycle.data.state} /> : null}
          {card.is_emergency || card.missed_slot_open ? <JobCardNo job={{ ...card, job_card_no: "" }} /> : null}
          {lifecycle.data?.family?.length > 1 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground" data-testid="family-chips">
              <Scissors className="h-3 w-3" aria-hidden="true" />
              {lifecycle.data.family.filter((f: any) => !f.is_self).map((f: any, i: number) => (
                <span key={f.id}>
                  {i ? ", " : card.parent_job_card_id ? "split of " : "family: "}
                  <Link href={`/production/job-cards/${f.id}`} className="text-primary underline-offset-2 hover:underline">
                    {f.job_card_no}
                  </Link>
                </span>
              ))}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">no split</span>
          )}
          {flagCount ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", toneClass("amber"))} data-testid="header-flags" title="Readings outside the band — flagged, not held">
              <Flag className="h-3 w-3" aria-hidden="true" /> {flagCount} flagged reading{flagCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <span className="text-[13px]">
            Order{" "}
            {facts.orderId ? (
              <Link href={`/sales-orders/${facts.orderId}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                {facts.orderNo || "open"}
              </Link>
            ) : (
              <b>{facts.orderNo || "—"}</b>
            )}
            {facts.lineNo ? ` · line ${facts.lineNo}` : ""}
          </span>
          <span className="text-[13px]">
            <b>{facts.customer}</b>
            {facts.customerCode ? <span className="text-muted-foreground"> · {facts.customerCode}</span> : null}
          </span>
          {facts.po ? (
            <span className="text-[13px]">
              PO <b>{facts.po}</b>
            </span>
          ) : null}
          {facts.due ? (
            <span className="text-[13px]">
              Due <b>{dayLabel(facts.due)}</b>{" "}
              {dueDays != null ? <span className={cn("rounded-full border px-1.5 text-[11px] font-medium", dueDays < 0 ? toneClass("rose") : dueDays <= 3 ? toneClass("amber") : "border-border bg-muted text-muted-foreground")}>{dueDays < 0 ? `${-dueDays} days late` : dueDays === 0 ? "today" : `in ${dueDays} day${dueDays === 1 ? "" : "s"}`}</span> : null}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {facts.size ? (
            <span>
              Size <b className="text-foreground">{facts.size}</b> mm
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            Colour <ColorChip color={facts.colour} empty="Plain" className="font-semibold text-foreground" />
          </span>
          <span>
            Qty <b className="text-foreground">{fmt(facts.qty, 0)} pcs</b>
            {facts.bamboo ? (
              <>
                {" "}
                = <b className="text-foreground">{fmt(facts.bamboo, 0)} bamboo</b> × {fmt(facts.pcsPerBamboo, 0)} pcs{facts.bambooLength ? ` · bamboo ${fmt(facts.bambooLength, 0)} mm` : ""}
              </>
            ) : null}
          </span>
          <span>Winding · Oven in bamboo, Process onwards in pcs</span>
          {facts.releasedAt ? (
            <span>
              Released <b className="text-foreground">{stampDay(facts.releasedAt)}</b>
            </span>
          ) : null}
          {card.plan_status_label ? <span className={cn("rounded-full border px-2 py-px text-[11.5px] font-medium", card.plan_status === "RUNNING" ? toneClass("blue") : card.plan_status === "PLANNED" ? toneClass("violet") : "border-border bg-muted")}>{card.plan_status_label}</span> : null}
        </div>
        {card.blocked_reason ? <p className={cn("mt-2 rounded-lg border px-3 py-1.5 text-[12.5px]", toneClass("rose"))}>{card.blocked_reason}</p> : null}
      </header>

      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur" data-testid="job-card-actions">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="erp-btn-primary !h-9 disabled:cursor-not-allowed" disabled={Boolean(outputBlocked)} title={outputBlocked || undefined} onClick={() => openOutput()} data-testid="action-log-output">
            <Camera className="h-4 w-4" /> Log output
          </button>
          <button type="button" className={actionButton} disabled={Boolean(qcBlocked)} title={qcBlocked || undefined} onClick={() => openQc()} data-testid="action-log-qc">
            <ClipboardCheck className="h-4 w-4" /> Log QC
            {waitingQc.length ? <span className={cn("rounded-full border px-1.5 text-[11px] font-bold", toneClass("amber"))}>{waitingQc.length} waiting</span> : null}
          </button>
          {isV2 && closeTarget && facts.open ? (
            <button type="button" className={cn(actionButton, closeBlocked || !canSubmit ? "!text-muted-foreground" : "")} title={closeTitle} onClick={() => setClosing(closeTarget.stage)} data-testid="action-close-stage" data-blocked={closeBlocked ? "true" : undefined}>
              {closeBlocked || !canSubmit ? <Lock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Close {stageLabel(closeTarget.stage)}
              {!canSubmit ? <span className="rounded-full border border-border bg-muted px-1.5 text-[10.5px] font-semibold">supervisor</span> : closeBlocked && !closeTarget.qc?.ready ? <span className={cn("rounded-full border px-1.5 text-[10.5px] font-semibold", toneClass("amber"))}>QC short</span> : null}
            </button>
          ) : null}
          <Link href={`/production/job-cards/${card.id}/print`} className="erp-btn-secondary !h-9" data-testid="action-print">
            <Printer className="h-4 w-4" /> Print card
          </Link>
          <button type="button" className={actionButton} onClick={() => setPhoneLink(true)} data-testid="action-phone-link">
            <QrCode className="h-4 w-4" /> Phone link
          </button>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Link href={`/production/job-cards/manage?card=${card.id}`} className="erp-btn-secondary !h-9 !border-signal-violet-line !text-signal-violet-ink" data-testid="action-manage">
            <Wrench className="h-4 w-4" /> Manage card
          </Link>
          <span className="ml-auto hidden items-center gap-3 text-[12px] text-muted-foreground min-[1400px]:flex">
            {current && lastRun ? (
              <span>
                {stageLabel(current.stage)}
                {lastRun.machine_id ? ` · ${machineName(lastRun.machine_id)}` : ""}
                {lastRun.operator_name ? ` · ${lastRun.operator_name}` : ""}
                {lastRun.shift_code ? ` · ${shiftLabel(lastRun.shift_code)}` : ""}
              </span>
            ) : null}
            {lastEvent ? (
              <span className="inline-flex items-center gap-1">
                <History className="h-3.5 w-3.5" aria-hidden="true" /> {stampLabel(lastEvent.at)} · {String(lastEvent.actor || "").split("@")[0]}
              </span>
            ) : null}
          </span>
        </div>
        {actionError ? (
          <p role="alert" className="mt-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-1.5 text-[12.5px] text-signal-rose-ink">
            {actionError} <button type="button" className="underline" onClick={() => setActionError("")}>dismiss</button>
          </p>
        ) : null}
      </div>

      {isV2 && flow.isError ? <ErrorState title="The card's stages could not be loaded" message="Refresh to retry." onRetry={() => void flow.refetch()} /> : null}
      <section className="rounded-xl border border-border bg-card px-2 py-1">
        {steps.length ? <StageStepper steps={steps} current={closeTarget?.stage || current?.stage} onSelect={isV2 ? (stage) => { setLogStage(entryStages.includes(stage) ? stage : "ALL"); setTab(stage === "DISPATCH" ? "dispatch" : "log") } : undefined} /> : <p className="px-2 py-3 text-[13px] text-muted-foreground">{isV2 && flow.isLoading ? "Loading stages…" : "No stages on this card."}</p>}
      </section>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="h-10 w-full justify-start overflow-x-auto" data-testid="job-card-tabs">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isV2 ? (
            <TabsTrigger value="log">
              Output log <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{entries.filter((e) => e.kind !== "QC_ONLY").length}</span>
            </TabsTrigger>
          ) : (
            <TabsTrigger value="oldform">Old form</TabsTrigger>
          )}
          {isV2 ? (
            <TabsTrigger value="qc">
              QC {waitingQc.length ? <span className={cn("rounded-full border px-1.5 text-[11px] tabular-nums", toneClass("amber"))}>{waitingQc.length}</span> : flagCount ? <span className={cn("rounded-full border px-1.5 text-[11px] tabular-nums", toneClass("amber"))}>{flagCount} flag</span> : null}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="material">Material</TabsTrigger>
          <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
          <TabsTrigger value="history">
            History &amp; audit {history.data?.summary?.events != null ? <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{history.data.summary.events}</span> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab card={card} steps={steps} entries={entries} lifecycle={lifecycle.data} machineName={machineName} nextSteps={nextSteps} onLogQc={(entry) => openQc(entry)} />
        </TabsContent>

        {isV2 ? (
          <TabsContent value="log">
            <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="tab-log">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <h3 className="text-[14px] font-semibold">Output log</h3>
                <span className="hidden text-[12px] text-muted-foreground sm:inline">every run, who / when / machine, made · good · rejected, QC state and plan match</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!logEntries.length} onClick={() => void exportRuns()}>
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                  {canSubmit && stages.some((s: any) => isLoggable(s)) ? (
                    <Button size="sm" variant="outline" onClick={() => setWholeCard(true)} title="Type a whole printed card at once: the running totals of every stage" data-testid="action-whole-card">
                      <ClipboardList className="h-3.5 w-3.5" /> Whole printed card
                    </Button>
                  ) : null}
                  {logStageState?.status === "COMPLETED" && canReopen && !["SLITTING", "DISPATCH"].includes(logStage) ? (
                    <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => reopen(logStage)} data-testid="action-reopen">
                      Reopen stage…
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={Boolean(outputBlocked)} title={outputBlocked || undefined} onClick={() => openOutput(logStage !== "ALL" && logStageState && isLoggable(logStageState) ? logStage : undefined)}>
                    <Camera className="h-3.5 w-3.5" /> Log output
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5" role="group" aria-label="Stage filter">
                {[{ stage: "ALL", label: "All", n: entries.length }, ...entryStages.filter((s: string) => stages.some((v: any) => v.stage === s) || countFor(s) > 0).map((s: string) => ({ stage: s, label: stageLabel(s), n: countFor(s) }))].map((chip) => (
                  <button key={chip.stage} type="button" aria-pressed={logStage === chip.stage} onClick={() => setLogStage(chip.stage)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition", logStage === chip.stage ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")} data-testid={`log-chip-${chip.stage.toLowerCase()}`}>
                    {chip.label}
                    <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", logStage === chip.stage ? "bg-background/20" : "bg-muted text-muted-foreground")}>{chip.n}</span>
                  </button>
                ))}
                {drafts.length ? <span className="ml-auto self-center text-[12px] text-muted-foreground">Drafts do not count until submitted</span> : null}
              </div>
              {all.isLoading ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading runs…</p> : <RunRows card={card} flow={flow.data} entries={logEntries} planRuns={plan.data?.runs} showStage={logStage === "ALL"} onEdit={(entry) => openOutput(entry.stage, entry)} onQc={(entry) => openQc(entry)} emptyText={logStage === "ALL" ? "No runs logged on this card yet." : `No runs on ${stageLabel(logStage)} yet.`} />}
              <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                <span>Rejection codes: WL Winding loose · PG Pasting/glue · ID I.D. out · OD O.D. out · LN Length · WT Weight · CS C.S. · DM Damage · MS Moisture · NT Notch · OT Other</span>
                <span>Edits and voids need a reason and are kept in History &amp; audit</span>
              </div>
            </section>
            {flow.data?.stages?.some((s: any) => Number(s.unscheduled_entries) > 0) ? (
              <p className={cn("mt-3 rounded-lg border px-3 py-2 text-[13px]", toneClass("amber"))} data-testid="card-unplanned-summary">
                <b>Run before planning:</b> {flow.data.stages.filter((s: any) => Number(s.unscheduled_entries) > 0).map((s: any) => `${stageLabel(s.stage)} (${s.unscheduled_entries} run${Number(s.unscheduled_entries) === 1 ? "" : "s"})`).join(" · ")} — each run took the machine, date and shift written on the card. See Reports › Plan vs actual.
              </p>
            ) : null}
          </TabsContent>
        ) : (
          <TabsContent value="oldform">
            <div className="space-y-4" data-testid="tab-oldform">
              <p className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-[13px]">
                <b>Old entry form.</b> This card was released before batch entry. Enter stage output and QC below as before; the move to batch entry (if still possible) is offered at the top of the form.
              </p>
              <LiveFloorLog jobCardId={String(card.id)} />
              <JobCardDocument jobCardId={String(card.id)} mode="supervisor" />
            </div>
          </TabsContent>
        )}

        {isV2 ? (
          <TabsContent value="qc">
            {all.isLoading ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Loading QC…</p> : <QcTab card={card} flow={flow.data} stages={stages} entries={entries} machineName={machineName} onLogQc={(entry, stage) => openQc(entry, stage)} />}
          </TabsContent>
        ) : null}

        <TabsContent value="plan">
          <div className="space-y-3" data-testid="tab-plan">
            <CardPlanPanel jobCardId={String(card.id)} plantId={card.plant_id ? String(card.plant_id) : undefined} open />
            <p className="text-[12.5px] text-muted-foreground">The plan is never moved by the floor. A run on another day or shift is shown as earlier / later than plan; only a stage with no slot at all is &quot;run before planning&quot;. Cutting a plan into parts is done on the Planner board.</p>
          </div>
        </TabsContent>
        <TabsContent value="material">
          {isV2 ? <OldFormDrafts card={card} /> : null}
          <MaterialTab card={card} flow={flow.data} />
        </TabsContent>
        <TabsContent value="dispatch">
          <DispatchTab card={card} flow={flow.data} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab card={card} />
        </TabsContent>
      </Tabs>

      {isV2 ? <CardEntrySheets card={card} flow={flow.data} stages={stages} panel={panel} onChange={setPanel} /> : null}
      {isV2 && canSubmit && wholeCard && flow.data ? (
        <EntrySheet open={wholeCard} onOpenChange={setWholeCard} title="Enter the whole printed card" subtitle={`${facts.no} · the card's running totals per stage; only what is new is posted, all ticked stages save together`} testId="whole-card-sheet">
          <WholeCardEntryForm card={card} flow={flow.data} onDone={() => setWholeCard(false)} />
        </EntrySheet>
      ) : null}
      {isV2 && closing ? (
        <CloseStageDialog
          card={card}
          flow={flow.data}
          stage={closing}
          entries={entries}
          onLogQc={(stage) => openQc(null, stage)}
          open={Boolean(closing)}
          onOpenChange={(open) => (open ? undefined : setClosing(null))}
          onClosed={(notice, completed) => {
            showToast(notice, "success")
            if (completed) setTab("dispatch")
          }}
        />
      ) : null}
      <PhoneLinkDialog card={card} open={phoneLink} onOpenChange={setPhoneLink} />
    </div>
  )
}
