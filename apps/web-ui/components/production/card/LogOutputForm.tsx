"use client"

// Log output: one run of one stage, as written on the printed card. No QC fields here — QC is its own
// short form. Every rule of the older entry desk is kept: drafts for operators and straight save for
// supervisors, the upstream QC gate with a supervisor override and reason, +10% over the plan needs a
// reason, a rejection needs a code (and a note for "Other"), cutting loss written needs a reason, held
// pieces carried in or out need a reason, and the same command is resent on a retry (request_id +
// expected_version). The Process count (bamboo × pcs per bamboo) is a check, never a gate (client
// 2026-10-28): a gap saves and is flagged on the run. What is typed is kept on the device until saved.

import { CalendarRange, CheckCircle2, ChevronDown, Clock3, Flag, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useCardMasters, useCardMutation, useEntryApi, useStableCommand } from "./data"
import { DraftRestoredBar, draftKey, useFormDraft } from "./draft"
import { Chips, FormStageTabs, Segmented, bigNumberClass, fieldLabel, selectClass, type StageTab } from "./EntrySheet"
import {
  REJECT_CODES,
  clockOf,
  clockShift,
  count,
  cycleText,
  dayLabel,
  fmt,
  helperLabelFor,
  isLoggable,
  machineLabelFor,
  memoryKey,
  neededText,
  planMatchFor,
  plannerSlots,
  previousStage,
  rejectCodeText,
  remember,
  runNo,
  remembered,
  shiftLabel,
  stageLabel,
  stamp,
  today,
  toneClass,
  savedRunPlanMatch,
  useCardRoles,
  waitingRunsBadge,
  waitingRunsTitle,
  yesterday,
} from "./model"

export type SavedRun = { entry: any; submitted: boolean; stage: string }

/** Tabs for the output form: only open floor stages take a run; the others say why. */
export function outputStageTabs(stages: any[]): StageTab[] {
  return stages
    .filter((s: any) => s.stage !== "QC")
    .map((s: any) => ({
      stage: s.stage,
      status: s.status,
      good: s.accepted_total,
      target: s.target,
      unit: s.unit,
      badge: waitingRunsBadge(Number(s.draft_count || 0)),
      badgeTitle: waitingRunsTitle(Number(s.draft_count || 0)),
      disabled:
        s.status === "COMPLETED"
          ? `Closed · ${fmt(s.accepted_total)} ${s.unit}`
          : s.stage === "SLITTING"
            ? "Slitting record, not a run"
            : s.stage === "DISPATCH"
              ? "Comes from the dispatch slip"
              : undefined,
    }))
}

export function LogOutputForm({
  card,
  flow,
  stages,
  stage,
  onStage,
  entry,
  onSaved,
  onCancel,
  onLogQc,
}: {
  card: any
  flow: any
  stages: any[]
  stage: string
  onStage?: (stage: string) => void
  /** A draft being revised. */
  entry?: any | null
  onSaved?: (saved: SavedRun) => void
  onCancel?: () => void
  /** After a save: open Log QC on the run that was just saved. */
  onLogQc?: (entry: any) => void
}) {
  const entryApi = useEntryApi(card)
  const { canSubmit, canDraft } = useCardRoles()
  const { activeEmployees, machines, employees, machineName } = useCardMasters(card)
  const { mutation, error, setError } = useCardMutation(String(card.id))
  const { stableCommand, reset } = useStableCommand()
  const state = stages.find((s: any) => s.stage === stage)
  const prevStage = previousStage(stages, stage)
  const prevState = stages.find((s: any) => s.stage === prevStage)
  const editing = entry || null
  const [saved, setSaved] = useState<SavedRun | null>(null)

  const [businessDate, setBusinessDate] = useState(today())
  const [shift, setShift] = useState(clockShift())
  const [machine, setMachine] = useState("")
  const [operator, setOperator] = useState("")
  const [helper, setHelper] = useState("")
  const [output, setOutput] = useState("")
  const [rejected, setRejected] = useState("")
  const [rejectCode, setRejectCode] = useState("")
  const [rejectNote, setRejectNote] = useState("")
  const [overNote, setOverNote] = useState("")
  const [input, setInput] = useState("")
  const [loss, setLoss] = useState("")
  const [carryIn, setCarryIn] = useState("")
  const [carryOut, setCarryOut] = useState("")
  const [remark, setRemark] = useState("")
  const [lossNote, setLossNote] = useState("")
  const [showTimes, setShowTimes] = useState(false)
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [gateOverride, setGateOverride] = useState(false)
  const [gateReason, setGateReason] = useState("")
  const [forceOpen, setForceOpen] = useState(false)
  // Process: bamboo in and pieces out fill themselves from the card until the operator types over them.
  const inputTouched = useRef(false)
  const outputTouched = useRef(false)
  // Kept on the device as it is typed (card · stage · draft run), restored when the form opens again.
  const typed = { businessDate, shift, machine, operator, helper, output, rejected, rejectCode, rejectNote, overNote, input, loss, carryIn, carryOut, remark, lossNote, showTimes, startTime, endTime, gateOverride, gateReason, inputTouched: inputTouched.current, outputTouched: outputTouched.current }
  // A server draft being revised counts as typed only once a value differs from the saved draft.
  const savedDraftValues: Record<string, string> | null = editing
    ? { businessDate: editing.business_date || today(), shift: editing.shift_code || clockShift(), machine: editing.machine_id || "", operator: editing.operator_id || "", helper: editing.details?.helper_name || "", output: editing.produced ? String(editing.produced) : "", rejected: editing.rejected ? String(editing.rejected) : "", rejectCode: editing.details?.reject_code || "", rejectNote: editing.details?.reject_reason || "", overNote: editing.details?.overproduction_reason || "", input: editing.input_quantity ? String(editing.input_quantity) : "", loss: editing.cutting_loss_pcs ? String(editing.cutting_loss_pcs) : "", carryIn: editing.carry_in_pcs ? String(editing.carry_in_pcs) : "", carryOut: editing.carry_out_pcs ? String(editing.carry_out_pcs) : "", remark: editing.details?.carryover_reason || "", lossNote: editing.details?.cutting_loss_reason || "" }
    : null
  const typedSomething = savedDraftValues
    ? Object.entries(savedDraftValues).some(([k, v]) => String((typed as any)[k] ?? "") !== v)
    : Boolean(rejected || rejectNote || overNote || loss || carryIn || carryOut || remark || lossNote || startTime || endTime || gateReason.trim()) ||
      (Boolean(output) && (stage !== "PROCESS" || outputTouched.current)) ||
      (Boolean(input) && (stage !== "PROCESS" || inputTouched.current)) ||
      businessDate !== today()
  const draft = useFormDraft(draftKey("output", card.id, stage, editing?.id), typed, !saved && typedSomething)
  const applyDraft = (d: any) => {
    if (!d) return
    setBusinessDate(d.businessDate || today())
    setShift(d.shift || clockShift())
    if (d.machine) setMachine(d.machine)
    if (d.operator) setOperator(d.operator)
    setHelper(d.helper || "")
    setOutput(d.output || "")
    setRejected(d.rejected || "")
    setRejectCode(d.rejectCode || "")
    setRejectNote(d.rejectNote || "")
    setOverNote(d.overNote || "")
    setInput(d.input || "")
    setLoss(d.loss || "")
    setCarryIn(d.carryIn || "")
    setCarryOut(d.carryOut || "")
    setRemark(d.remark || "")
    setLossNote(d.lossNote || "")
    setShowTimes(Boolean(d.showTimes))
    setStartTime(d.startTime || "")
    setEndTime(d.endTime || "")
    setGateOverride(Boolean(d.gateOverride))
    setGateReason(d.gateReason || "")
    if (d.gateOverride) setForceOpen(true)
    inputTouched.current = Boolean(d.inputTouched)
    outputTouched.current = Boolean(d.outputTouched)
  }

  const worksHere = (e: any) =>
    String(e.department || "").toUpperCase() === stage ||
    String(e.skills || "")
      .toUpperCase()
      .split(/[,;/|]/)
      .map((t: string) => t.trim())
      .includes(stage)
  const operatorRank = (e: any) => (String(e.role || "").toLowerCase() === "operator" ? 0 : 2) + (worksHere(e) ? 0 : 1)
  const operatorOptions = useMemo(() => [...activeEmployees].sort((a: any, b: any) => operatorRank(a) - operatorRank(b) || String(a.name).localeCompare(String(b.name))), [activeEmployees, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const stageMachines = useMemo(() => (machines.data || []).filter((m: any) => m.is_active !== false && String(m.department || "").toUpperCase() === stage), [machines.data, stage])
  const openSegments = (state?.segments || []).filter((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status))
  const plannedParts = plannerSlots(state, true).sort((a: any, b: any) => String(a.plan_date).localeCompare(String(b.plan_date)) || String(a.shift_code).localeCompare(String(b.shift_code)))
  // Input taken from the previous stage equals what this stage made, except Process (bamboo in → pieces out).
  const inputFollowsOutput = stage !== "PROCESS" && Boolean(prevStage) && prevStage !== "SLITTING"
  const loggable = isLoggable(state)
  // In-process QC gate (client rule 2026-10-18): a stage opens for new runs only once the previous
  // stage has batches whose QC is recorded. A supervisor may still override with a reason.
  const gateLocked =
    loggable && Boolean(prevStage) && prevStage !== "SLITTING" && state?.available_from_upstream != null && Number(state.available_from_upstream) <= 0 && (Number(state?.awaiting_qc_from_upstream || 0) > 0 || !(Number(state?.input_total || 0) > 0))
  const formOpen = Boolean(editing) || (loggable && canDraft && (!gateLocked || forceOpen))

  const defaultMachine = () =>
    openSegments.find((s: any) => s.machine_id)?.machine_id ||
    card.stages?.find((s: any) => s.stage_type === stage)?.machine_id ||
    remembered(memoryKey(card, stage, "machine")) ||
    (stageMachines.length === 1 ? stageMachines[0].id : "")
  const clearNumbers = () => {
    setOutput("")
    setRejected("")
    setRejectCode("")
    setRejectNote("")
    setOverNote("")
    setInput("")
    setLoss("")
    setCarryIn("")
    setCarryOut("")
    setRemark("")
    setLossNote("")
    inputTouched.current = false
    outputTouched.current = false
    setStartTime("")
    setEndTime("")
    setShowTimes(false)
    setGateOverride(false)
    setGateReason("")
    reset()
  }

  // New stage or a draft opened: who ran it last time on this stage, the planned machine, fresh numbers.
  useEffect(() => {
    setError("")
    setSaved(null)
    setForceOpen(false)
    if (editing) {
      setBusinessDate(editing.business_date || today())
      setShift(editing.shift_code || clockShift())
      setMachine(editing.machine_id || "")
      setOperator(editing.operator_id || "")
      setHelper(editing.details?.helper_name || "")
      setOutput(editing.produced ? String(editing.produced) : "")
      setRejected(editing.rejected ? String(editing.rejected) : "")
      setRejectCode(editing.details?.reject_code || "")
      setRejectNote(editing.details?.reject_reason || "")
      setOverNote(editing.details?.overproduction_reason || "")
      setInput(editing.input_quantity ? String(editing.input_quantity) : "")
      setLoss(editing.cutting_loss_pcs ? String(editing.cutting_loss_pcs) : "")
      setCarryIn(editing.carry_in_pcs ? String(editing.carry_in_pcs) : "")
      setCarryOut(editing.carry_out_pcs ? String(editing.carry_out_pcs) : "")
      setRemark(editing.details?.carryover_reason || "")
      setLossNote(editing.details?.cutting_loss_reason || "")
      inputTouched.current = true
      outputTouched.current = true
      setStartTime(clockOf(editing.details?.start_time))
      setEndTime(clockOf(editing.details?.end_time))
      setShowTimes(Boolean(editing.details?.start_time || editing.details?.end_time))
      setGateOverride(Boolean(editing.details?.qc_gate_override_reason))
      setGateReason(editing.details?.qc_gate_override_reason || "")
      reset()
    } else {
      setOperator(remembered(memoryKey(card, stage, "operator")))
      setHelper(remembered(memoryKey(card, stage, "helper")))
      setMachine(defaultMachine() || "")
      clearNumbers()
    }
    // What was typed here before (reload, closed tab, form closed) comes back; it is never sent by itself.
    applyDraft(draft.restore())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, card.id, editing?.id])
  const discardDraft = () => {
    draft.discard()
    if (editing) {
      setBusinessDate(editing.business_date || today())
      setShift(editing.shift_code || clockShift())
      setMachine(editing.machine_id || "")
      setOperator(editing.operator_id || "")
      setHelper(editing.details?.helper_name || "")
      setOutput(editing.produced ? String(editing.produced) : "")
      setRejected(editing.rejected ? String(editing.rejected) : "")
      setRejectCode(editing.details?.reject_code || "")
      setRejectNote(editing.details?.reject_reason || "")
      setOverNote(editing.details?.overproduction_reason || "")
      setInput(editing.input_quantity ? String(editing.input_quantity) : "")
      setLoss(editing.cutting_loss_pcs ? String(editing.cutting_loss_pcs) : "")
      setCarryIn(editing.carry_in_pcs ? String(editing.carry_in_pcs) : "")
      setCarryOut(editing.carry_out_pcs ? String(editing.carry_out_pcs) : "")
      setRemark(editing.details?.carryover_reason || "")
      setLossNote(editing.details?.cutting_loss_reason || "")
    } else {
      setBusinessDate(today())
      setShift(clockShift())
      setMachine(defaultMachine() || "")
      clearNumbers()
    }
  }
  // Machines and the stage plan load after the first paint; fill the machine once they arrive.
  useEffect(() => {
    if (!machine && !editing && state) setMachine(defaultMachine() || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.stage, machines.data])

  const made = count(output)
  const bad = count(rejected)
  const good = Math.max(0, made - bad)
  const takenIn = inputFollowsOutput ? made : count(input)
  const carryInQty = count(carryIn)
  const carryOutQty = count(carryOut)
  // Process count (client 2026-10-26, relaxed 2026-10-28): bamboo × pieces per bamboo + held carry-in should
  // equal made + cutting loss + held carry-out. A gap never stops the save: the run is flagged and nothing has
  // to be written for it. Cutting loss is what the operator writes (one tap fills the gap as cutting loss).
  const pcsPerBamboo = stage === "PROCESS" ? Number(state?.pcs_per_bamboo || 0) : 0
  const possiblePcs = takenIn * pcsPerBamboo + carryInQty
  // Writing off held pieces (nothing made) books them all as cutting loss, as before.
  const disposition = stage === "PROCESS" && made === 0 && carryInQty > 0
  const lossQty = disposition ? carryInQty : count(loss)
  const countedPcs = made + lossQty + carryOutQty
  const countGap = pcsPerBamboo && !disposition && (takenIn || carryInQty) ? possiblePcs - countedPcs : 0
  const readyFromOven = Number(state?.available_from_upstream || 0)
  useEffect(() => {
    if (stage !== "PROCESS" || editing || inputTouched.current) return
    const next = readyFromOven > 0 ? String(readyFromOven) : ""
    if (input !== next) setInput(next)
  }, [stage, editing, readyFromOven, input])
  useEffect(() => {
    if (stage !== "PROCESS" || !pcsPerBamboo || editing || outputTouched.current) return
    const next = takenIn ? String(Math.max(0, takenIn * pcsPerBamboo + carryInQty - carryOutQty)) : ""
    if (output !== next) setOutput(next)
  }, [stage, pcsPerBamboo, editing, takenIn, carryInQty, carryOutQty, output])
  const startStamp = stamp(businessDate, startTime)
  const endStamp = stamp(businessDate, endTime, startTime || undefined)
  const overTarget = state ? Number(state.produced_total || 0) + made > Number(state.target || 0) * 1.1 : false
  const rejectPart = rejectNote.trim() || (rejectCode && rejectCode !== "OT" ? `${rejectCode} · ${rejectCodeText(rejectCode)}` : "")
  // One reason on the entry covers rejected pieces and cutting loss; writing off held pieces uses the carryover reason.
  const lossPart = disposition ? remark.trim() : lossQty ? (pcsPerBamboo ? lossNote.trim() : remark.trim()) : ""
  const rejectReason = [bad ? rejectPart : "", lossPart && !disposition && pcsPerBamboo ? `Cutting loss: ${lossPart}` : lossPart].filter(Boolean).join(" · ")
  const unit = state?.unit || "pieces"
  const missing = [
    !businessDate ? "the date" : "",
    !shift ? "the shift" : "",
    !operator ? "the operator" : "",
    !made && !disposition ? `how many ${unit} were made` : "",
    bad > made ? "a rejected count that is not more than the output" : "",
    bad > 0 && !rejectCode ? "the rejection code" : "",
    bad > 0 && rejectCode === "OT" && !rejectNote.trim() ? "what the 'Other' rejection was" : "",
    stage === "PROCESS" && !takenIn && !disposition ? `how many ${state?.input_unit || "bamboo"} were taken from ${stageLabel(prevStage || "OVEN")}` : "",
    stage === "PROCESS" && !pcsPerBamboo ? "pieces per bamboo on the spec (ask the planner)" : "",
    lossQty && !disposition && !lossPart ? "why pieces were lost in cutting" : "",
    disposition && !rejectReason ? "the reason for the cutting loss" : "",
    (carryInQty || carryOutQty) && !remark.trim() ? "the reason for the held carryover" : "",
    overTarget && !overNote.trim() ? "why output is above the planned +10%" : "",
    gateOverride && !gateReason.trim() ? "why the batch is taken before its QC" : "",
  ].filter(Boolean)
  const planMatch = planMatchFor(state, businessDate, shift, machine)
  // One truth with the Plan match tile (and the server): no machine + date + shift slot means not on the planner.
  const slotReady = !planMatch.unplanned

  const saveRun = (submit: boolean) => {
    const details: any = {
      reject_reason: bad || lossQty || disposition ? rejectReason : undefined,
      reject_code: bad ? rejectCode || null : null,
      helper_name: helper.trim() || null,
      overproduction_reason: overTarget ? overNote.trim() : undefined,
      carryover_reason: carryInQty || carryOutQty ? remark.trim() : undefined,
      cutting_loss_reason: lossQty && !disposition && pcsPerBamboo ? lossNote.trim() : undefined,
      start_time: startStamp,
      end_time: endStamp,
      instrument: editing?.details?.instrument || {},
      ...(gateOverride && gateReason.trim() ? { qc_gate_override_reason: gateReason.trim() } : {}),
    }
    const body: any = {
      stage,
      kind: disposition ? "DISPOSITION" : "PRODUCTION",
      quantity_mode: "DELTA",
      expected_version: editing?.row_version ?? state?.row_version,
      business_date: businessDate,
      shift_code: shift,
      operator_id: operator || null,
      // No slot choice on the floor (client 2026-10-26): the server puts the run in the slot of its date and shift.
      segment_id: editing?.segment_id || null,
      produced: made,
      accepted: good,
      input_quantity: takenIn,
      cutting_loss_pcs: lossQty,
      carry_in_pcs: carryInQty,
      carry_out_pcs: carryOutQty,
      samples: editing?.samples || [],
      machine_id: machine || null,
      details,
      reason: [rejectReason, overTarget ? overNote.trim() : "", remark.trim()].filter(Boolean).join(" · "),
      submit,
    }
    remember(memoryKey(card, stage, "operator"), operator)
    remember(memoryKey(card, stage, "helper"), helper.trim())
    remember(memoryKey(card, stage, "machine"), machine)
    mutation.mutate(async () => {
      const result = editing ? await entryApi.edit(card.id, editing.id, stableCommand({ ...body, submit: false })) : await entryApi.create(card.id, stableCommand(body))
      const savedEntry = result?.data?.entry
      const done = { entry: savedEntry, submitted: Boolean(savedEntry?.status === "SUBMITTED"), stage }
      draft.clear()
      setSaved(done)
      onSaved?.(done)
      return result
    })
  }

  const tabs = outputStageTabs(stages)
  const stageTabs = onStage ? <FormStageTabs tabs={tabs} value={stage} onChange={(next) => onStage(next)} /> : null

  if (saved) {
    const e = saved.entry || {}
    // What the server recorded for this run (run before planning is its flag), not the form's live guess.
    const savedMatch = savedRunPlanMatch(e, state)
    return (
      <div className="space-y-4" data-testid="log-output-saved">
        <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-signal-emerald-soft text-signal-emerald-ink">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <p className="text-[19px] font-bold tracking-tight">
            Run {runNo(e)} {editing ? "updated" : saved.submitted ? "saved" : "sent to the supervisor"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {card.job_card_no} · {stageLabel(saved.stage)} · {dayLabel(e.business_date)} · {shiftLabel(e.shift_code)}
            {e.machine_id ? ` · ${machineName(e.machine_id)}` : ""}
            {e.operator_name ? ` · ${e.operator_name}` : ""}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-3 text-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Made</p>
            <p className="text-[20px] font-bold tabular-nums">{fmt(e.produced)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rejected</p>
            <p className={cn("text-[20px] font-bold tabular-nums", e.rejected ? "text-signal-rose-ink" : "")}>{fmt(e.rejected)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Good</p>
            <p className="text-[20px] font-bold tabular-nums text-signal-emerald-ink">
              {fmt(e.accepted)} {unit}
            </p>
          </div>
        </div>
        <p className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium", toneClass(savedMatch.tone))}>
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" />
          {savedMatch.label}
        </p>
        {e.details?.count_gap ? (
          <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", toneClass("amber"))} data-testid="log-output-count-gap">
            <Flag className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <b>Count gap:</b> {e.details.count_gap.message}
            </span>
          </p>
        ) : null}
        <p className="rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
          {saved.submitted ? "The run is posted." : "The run is with the supervisor, who checks and submits it; it does not count until then."} No QC readings were asked for here — QC is its own short form and can be added to this run now or later.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {onLogQc && e.id ? (
            <Button size="lg" className="h-12" onClick={() => onLogQc(e)} data-testid="log-output-to-qc">
              <CheckCircle2 className="h-4 w-4" /> Log QC for run {runNo(e)} now
            </Button>
          ) : null}
          <Button size="lg" variant="outline" className="h-12" onClick={() => { setSaved(null); clearNumbers() }} data-testid="log-output-another">
            <Plus className="h-4 w-4" /> Log another run
          </Button>
          <Button size="lg" variant="ghost" className="h-12 sm:col-span-2" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="log-output-form">
      {stageTabs}
      <DraftRestoredBar savedAt={draft.restoredAt} onDiscard={discardDraft} testId="log-output-draft" />
      {state ? (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[.05] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">
              {card.job_card_no} · {stageLabel(stage)}
              {editing ? ` · run ${runNo(editing)} (with supervisor)` : ""}
            </p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {fmt(state.accepted_total)} of {fmt(state.target)} {state.unit} good so far
              {state.available_from_upstream != null && prevStage ? ` · ${fmt(state.available_from_upstream)} ${state.input_unit} ready from ${stageLabel(prevStage)}` : ""}
              {Number(state.awaiting_qc_from_upstream) > 0 ? ` · ${fmt(state.awaiting_qc_from_upstream)} waiting for ${stageLabel(prevStage || "")} QC` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {!state ? <p className="text-sm text-muted-foreground">Pick a stage.</p> : null}

      {state && !loggable && !editing ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {state.status === "COMPLETED" ? `${stageLabel(stage)} is closed.` : `${stageLabel(stage)} is not logged as runs.`}
        </p>
      ) : null}

      {state && gateLocked && !forceOpen && !editing ? (
        <section className="rounded-xl border-2 border-dashed border-signal-amber-line bg-signal-amber-soft/50 p-4" data-testid="stage-qc-lock">
          <h3 className="text-[15px] font-semibold text-foreground">
            {stageLabel(stage)} opens when {stageLabel(prevStage || "")} QC is recorded
          </h3>
          <p className="mt-1 text-sm text-foreground/80">
            {Number(state.awaiting_qc_from_upstream) > 0
              ? `${fmt(state.awaiting_qc_from_upstream)} ${state.input_unit} made in ${stageLabel(prevStage || "")} are waiting for QC (at least 2 readings per check). As soon as QC is recorded on a run, this stage unlocks for that quantity.`
              : prevState && Number(prevState.accepted_total || 0) > 0 && prevState.status !== "COMPLETED"
                ? `${stageLabel(prevStage || "")} has output but must be closed before ${stageLabel(stage).toLowerCase()} starts.`
                : `Nothing from ${stageLabel(prevStage || "")} is ready yet. Log ${stageLabel(prevStage || "").toLowerCase()} runs and their QC first.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onStage && prevStage ? <Button onClick={() => onStage(prevStage)}>Go to {stageLabel(prevStage)}</Button> : null}
            {canSubmit && Number(state.awaiting_qc_from_upstream) > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  setForceOpen(true)
                  setGateOverride(true)
                }}
              >
                Supervisor override…
              </Button>
            ) : null}
          </div>
          {!canSubmit && Number(state.awaiting_qc_from_upstream) > 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">Only a supervisor can let {stageLabel(stage).toLowerCase()} take a run before its QC (with a reason). Logging the QC on {stageLabel(prevStage || "")} is quicker.</p> : null}
        </section>
      ) : null}

      {state && !canDraft ? <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">Your role can view runs but not log them.</p> : null}

      {formOpen && state ? (
        <>
          {!slotReady ? (
            <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[13px] text-signal-amber-ink" data-testid="season-entry-unscheduled">
              Not on the planner yet — you can still log it. It is flagged for the owner under Reports › Plan vs actual.
            </p>
          ) : plannedParts.length ? (
            <p className="text-[12.5px] text-muted-foreground" data-testid="season-entry-plan">
              Plan: {plannedParts.slice(0, 3).map((s: any) => `${dayLabel(s.plan_date)} · ${shiftLabel(s.shift_code)} · ${machineName(s.machine_id) || "machine"}`).join("  |  ")}
              {plannedParts.length > 3 ? ` (+${plannedParts.length - 3} more)` : ""}. Log what really ran; it is matched to the plan by date and shift.
            </p>
          ) : null}

          <fieldset className="space-y-3" data-testid="season-entry-card-row">
            <legend className="sr-only">Who and when</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={fieldLabel}>Date</span>
                {businessDate === today() || businessDate === yesterday() ? (
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                    <div className="col-span-2">
                      <Segmented
                        label="Date"
                        value={businessDate === today() ? "today" : "yesterday"}
                        onChange={(v) => setBusinessDate(v === "today" ? today() : yesterday())}
                        options={[
                          { value: "today", label: "Today", sub: dayLabel(today()) },
                          { value: "yesterday", label: "Yesterday", sub: dayLabel(yesterday()) },
                        ]}
                      />
                    </div>
                    <label className="relative grid min-h-11 place-items-center rounded-xl border border-border bg-card px-2 text-[12px] font-medium text-muted-foreground">
                      Other
                      <input type="date" aria-label="Other date" className="absolute inset-0 cursor-pointer opacity-0" max={today()} value={businessDate} onChange={(e) => e.target.value && setBusinessDate(e.target.value)} />
                    </label>
                  </div>
                ) : (
                  <Input type="date" className="h-11 min-h-11 text-[15px]" value={businessDate} max={today()} onChange={(e) => setBusinessDate(e.target.value)} aria-label="Date" />
                )}
              </div>
              <div>
                <span className={fieldLabel}>Shift</span>
                <Segmented
                  label="Shift"
                  value={shift}
                  onChange={setShift}
                  options={[
                    { value: "SHIFT_A", label: "Shift A", sub: "08–20" },
                    { value: "SHIFT_B", label: "Shift B", sub: "20–08" },
                  ]}
                />
              </div>
            </div>
            <div>
              <span className={fieldLabel}>{machineLabelFor(stage)}</span>
              {stageMachines.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No machine in this department.</p>
              ) : stageMachines.length <= 8 ? (
                <Chips label={machineLabelFor(stage)} value={machine} onChange={setMachine} options={stageMachines.map((m: any) => ({ value: String(m.id), label: m.name || m.code }))} testId="season-entry-machine" />
              ) : (
                <select className={selectClass} value={machine} onChange={(e) => setMachine(e.target.value)} data-testid="season-entry-machine" aria-label={machineLabelFor(stage)}>
                  <option value="">Choose</option>
                  {stageMachines.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.code}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <span className={fieldLabel}>Operator</span>
              {employees.isLoading ? (
                <p className="text-[13px] text-muted-foreground">Loading…</p>
              ) : operatorOptions.length === 0 ? (
                <p className="text-[13px] text-signal-amber-ink">No active employees — add them in Masters › Employees.</p>
              ) : operatorOptions.length <= 8 ? (
                <Chips label="Operator" value={operator} onChange={setOperator} options={operatorOptions.map((e: any) => ({ value: String(e.id), label: e.name }))} testId="season-entry-operator" />
              ) : (
                <select className={selectClass} value={operator} onChange={(e) => setOperator(e.target.value)} data-testid="season-entry-operator" aria-label="Operator">
                  <option value="">Choose operator</option>
                  {operatorOptions.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.employee_code ? ` · ${e.employee_code}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={fieldLabel}>
                  {helperLabelFor(stage)} <span className="font-normal">(optional)</span>
                </span>
                <Input className="h-11 min-h-11 text-[15px]" value={helper} onChange={(e) => setHelper(e.target.value)} />
              </label>
              {showTimes ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className={fieldLabel}>Start time</span>
                    <Input type="time" className="h-11 min-h-11 text-[15px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" />
                  </label>
                  <label className="block">
                    <span className={fieldLabel}>End time</span>
                    <Input type="time" className="h-11 min-h-11 text-[15px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" />
                  </label>
                  <p className="col-span-2 text-[12px] text-muted-foreground">{cycleText(startStamp, endStamp) ? `Cycle ${cycleText(startStamp, endStamp)}` : "Times are optional"}</p>
                </div>
              ) : (
                <button type="button" className="inline-flex min-h-11 items-center self-end justify-self-start text-[13px] font-medium text-primary underline-offset-2 hover:underline" onClick={() => setShowTimes(true)}>
                  <Clock3 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  Add start / end time (optional)
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="sr-only">How many</legend>
            {stage === "PROCESS" ? (
              <label className="block">
                <span className={fieldLabel}>
                  {(state.input_unit || "bamboo").replace(/^./, (c: string) => c.toUpperCase())} taken from {stageLabel(prevStage || "OVEN")}
                </span>
                <div className="relative">
                  <input inputMode="numeric" type="number" min="0" step="1" className={bigNumberClass} style={{ paddingRight: "5.5rem" }} value={input} onChange={(e) => { inputTouched.current = true; setInput(e.target.value) }} data-testid="season-entry-input" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">{state.input_unit || "bamboo"}</span>
                </div>
                <span className="mt-1 block text-[12px] text-muted-foreground" data-testid="process-ready-from-oven">
                  {readyFromOven > 0 ? `${fmt(readyFromOven)} ready from ${stageLabel(prevStage || "OVEN")}` : `Nothing ready from ${stageLabel(prevStage || "OVEN")} yet`}
                  {pcsPerBamboo ? ` · 1 bamboo = ${fmt(pcsPerBamboo)} pcs` : ""}
                </span>
              </label>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={fieldLabel}>Made ({state.unit})</span>
                <input inputMode="numeric" type="number" min="0" step="1" placeholder="0" className={bigNumberClass} value={output} onChange={(e) => { outputTouched.current = true; setOutput(e.target.value) }} data-testid="season-entry-produced" />
              </label>
              <label className="block">
                <span className={fieldLabel}>Rejected ({state.unit})</span>
                <input inputMode="numeric" type="number" min="0" step="1" placeholder="0" className={cn(bigNumberClass, bad > made ? "border-signal-rose-line text-signal-rose-ink" : "")} value={rejected} onChange={(e) => setRejected(e.target.value)} data-testid="season-entry-rejected" />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className={cn("flex items-center justify-between rounded-xl border px-3 py-2.5", bad > made ? toneClass("rose") : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink")} data-testid="season-entry-math">
                <span className="text-[13px]">
                  Good = {fmt(made)} − {fmt(bad)}
                  {inputFollowsOutput && made ? <span className="block text-[11.5px] opacity-80">takes {fmt(made)} {state.input_unit || state.unit} from {stageLabel(prevStage || "")}</span> : null}
                </span>
                <strong className="text-[20px] tabular-nums">
                  {fmt(good)} {state.unit}
                </strong>
              </div>
              <div className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13px]", toneClass(planMatch.tone))} data-testid="season-entry-plan-match">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <CalendarRange className="h-4 w-4 shrink-0" aria-hidden="true" /> Plan match
                </span>
                <span className="text-right font-semibold">{planMatch.label}</span>
              </div>
            </div>
            {stage === "PROCESS" && !disposition && (takenIn || made) ? (
              !pcsPerBamboo ? (
                <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink" data-testid="process-balance">
                  This card&apos;s spec has no pieces per bamboo, so Process pieces cannot be checked. Ask the planner to correct the spec.
                </p>
              ) : (
                <div className={cn("space-y-2 rounded-lg border px-3 py-2.5 text-sm", countGap ? toneClass("amber") : "border-border bg-muted/40")} data-testid="process-balance" data-gap={countGap || undefined}>
                  <p className={countGap ? "" : "text-muted-foreground"}>
                    {fmt(takenIn)} bamboo × {fmt(pcsPerBamboo)} pcs{carryInQty ? ` + ${fmt(carryInQty)} held` : ""} = <b>{fmt(possiblePcs)} pcs</b>
                    {countGap ? (
                      <>
                        {" "}
                        · this run counts <b>{fmt(countedPcs)} pcs</b> ({fmt(made)} made{lossQty ? ` + ${fmt(lossQty)} cutting loss` : ""}{carryOutQty ? ` + ${fmt(carryOutQty)} held` : ""})
                      </>
                    ) : (
                      " · all pieces accounted for"
                    )}
                  </p>
                  {countGap ? (
                    <p className="flex items-start gap-1.5 font-medium" data-testid="process-count-gap">
                      <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {countGap > 0 ? `${fmt(countGap)} pcs short` : `${fmt(-countGap)} pcs more than the bamboo can give`} — it still saves and the run is flagged for the owner. Nothing has to be written for it.
                      </span>
                    </p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_1fr] sm:items-end">
                    <label className="block">
                      <span className={fieldLabel}>
                        Cutting loss <span className="font-normal">(pcs, if any)</span>
                      </span>
                      <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11 bg-card text-[15px]" value={loss} onChange={(e) => setLoss(e.target.value)} aria-label="Cutting loss pcs" data-testid="process-loss" />
                    </label>
                    {countGap > 0 ? (
                      <Button type="button" variant="outline" className="h-11 justify-self-start bg-card" onClick={() => setLoss(String(lossQty + countGap))} data-testid="process-gap-as-loss">
                        Count the {fmt(countGap)} pcs as cutting loss
                      </Button>
                    ) : null}
                  </div>
                  {lossQty > 0 ? (
                    <Input className="h-11 min-h-11 bg-card text-[15px]" aria-label="Cutting loss reason" placeholder={`Why were ${fmt(lossQty)} pcs lost in cutting? (required)`} value={lossNote} onChange={(e) => setLossNote(e.target.value)} data-testid="process-loss-reason" />
                  ) : null}
                </div>
              )
            ) : null}
            {bad > 0 ? (
              <div className="space-y-2" data-testid="season-entry-reject">
                <span className={fieldLabel}>Why rejected?</span>
                <Chips label="Rejection code" tone="rose" value={rejectCode} onChange={setRejectCode} options={REJECT_CODES.map(([code, text]) => ({ value: code, label: code, sub: text }))} allowClear={false} />
                <Input className="h-11 min-h-11 text-[15px]" aria-label="Entry reason" placeholder={rejectCode === "OT" ? "What was wrong? (required)" : "Note (optional)"} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
              </div>
            ) : null}
            {overTarget ? (
              <label className="block text-sm text-signal-amber-ink">
                Output goes above the planned quantity +10%. Why?
                <Input className="mt-1 h-11 min-h-11 text-[15px]" value={overNote} onChange={(e) => setOverNote(e.target.value)} aria-label="Overproduction reason" />
              </label>
            ) : null}
            {canSubmit && Number(state.awaiting_qc_from_upstream) > 0 ? (
              <div className="rounded-lg border border-border bg-muted p-3 text-sm">
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={gateOverride} onChange={(e) => setGateOverride(e.target.checked)} /> Supervisor override: take batches whose QC is not recorded yet
                </label>
                {gateOverride ? <Input className="mt-2 h-11 min-h-11" placeholder="Why this batch is taken before its QC (kept on the entry)" aria-label="QC gate override reason" value={gateReason} onChange={(e) => setGateReason(e.target.value)} /> : null}
              </div>
            ) : null}
            {stage === "PROCESS" ? (
              <details className="group rounded-lg border border-border p-3 text-sm" open={Boolean((!pcsPerBamboo && lossQty) || carryInQty || carryOutQty)}>
                <summary className="-my-1 flex min-h-11 cursor-pointer list-none items-center font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="mr-1.5 h-4 w-4 shrink-0 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true" />
                  More: {pcsPerBamboo ? "held pieces (carry to the next run)" : "cutting loss, held carryover"}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ...(pcsPerBamboo ? [] : [["Cutting loss pcs", loss, setLoss]]),
                      ["Held carry-in pcs", carryIn, setCarryIn],
                      ["Held carry-out pcs", carryOut, setCarryOut],
                    ] as [string, string, (v: string) => void][]
                  ).map(([title, value, setter]) => (
                    <label className="text-sm" key={title}>
                      {title}
                      <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11" value={value} onChange={(e) => setter(e.target.value)} />
                    </label>
                  ))}
                  <label className="text-sm sm:col-span-3">
                    {pcsPerBamboo ? "Reason for held pieces" : "Reason for loss or carryover"}
                    <Input className="h-11 min-h-11" value={remark} onChange={(e) => setRemark(e.target.value)} aria-label="Loss or carryover reason" />
                  </label>
                </div>
              </details>
            ) : null}
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink">
              {error}
            </p>
          ) : null}

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 space-y-2 border-t border-border bg-card px-4 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-5 sm:px-5">
            {missing.length ? (
              <p className="text-[12.5px] text-muted-foreground" data-testid="season-entry-missing">
                {neededText(missing)}
              </p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">{editing ? "Saves the run with these values; it stays with the supervisor." : canSubmit ? "Saving posts the run straight away." : "Your run goes to the supervisor, who checks and submits it."}</p>
            )}
            <div className="flex gap-2">
              {onCancel ? (
                <Button size="lg" variant="outline" className="h-12 shrink-0 px-4" onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              {editing ? (
                <Button size="lg" className="h-12 min-w-0 flex-1" disabled={mutation.isPending || missing.length > 0} onClick={() => saveRun(false)} data-testid="season-entry-save">
                  {mutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              ) : (
                <Button size="lg" className="h-12 min-w-0 flex-1" disabled={mutation.isPending || missing.length > 0} onClick={() => saveRun(canSubmit)} data-testid="season-entry-save">
                  {mutation.isPending ? "Saving…" : canSubmit ? "Save run" : "Send to supervisor"}
                </Button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
