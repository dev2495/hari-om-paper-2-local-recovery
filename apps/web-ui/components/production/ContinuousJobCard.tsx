"use client"

// Seasonal job card entry desk. One screen, same on phone and PC:
//   stage tabs → "log a run" form (1 who & when · 2 quantity · 3 QC readings) → runs of this stage.
// Every run is its own batch entry; the printed card row is what gets typed in.

import Link from "next/link"
import { ResidualWipPanel } from "./ResidualWipPanel"
import { InstrumentFields } from "./InstrumentFields"
import { FinalQcForm } from "./FinalQcForm"
import { WholeCardEntryForm } from "./WholeCardEntryForm"
import { JobCardShortagePanel } from "./JobCardShortagePanel"
import { OPTIONAL_QC_CODES, SeasonQcMatrix, allowedText } from "./SeasonQcMatrix"
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"
import { entryApiForPlant, command, errorText, seasonLabel, seasonTimestamp } from "@/lib/season-api"

const label = (stage: string) => (stage === "WINDER" ? "Winding" : stage === "QC" ? "Final QC" : stage.charAt(0) + stage.slice(1).toLowerCase())
const verdictLabels: Record<string, string> = { NOT_MEASURED: "QC readings due", OBSERVATION_ONLY: "Recorded", PASS: "QC pass", FAIL: "QC fail", INCOMPLETE: "QC incomplete", INVALID: "QC invalid" }
const verdictLabel = (value: string) => verdictLabels[value] || "QC readings due"
const count = (value: string) => (value === "" ? 0 : Math.max(0, Math.floor(Number(value) || 0)))
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
const selectClass = "h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px]"
const numberClass = "h-12 w-full rounded-lg border border-border bg-background px-3 text-lg font-semibold tabular-nums"
const REJECT_CODES: [string, string][] = [
  ["WL", "Winding loose"],
  ["PG", "Pasting / glue"],
  ["ID", "I.D. out"],
  ["OD", "O.D. out"],
  ["LN", "Length out"],
  ["WT", "Weight out"],
  ["CS", "C.S. low"],
  ["DM", "Damage / dent"],
  ["MS", "Moisture"],
  ["NT", "Notch"],
  ["OT", "Other"],
]
const machineLabelFor = (stage: string) => (stage === "WINDER" ? "Winder no." : stage === "OVEN" ? "Oven no." : stage === "PROCESS" ? "Line no." : stage === "PACKING" ? "Packing table" : "Machine")
const helperLabelFor = (stage: string) => (stage === "WINDER" ? "Pattiwala" : stage === "PROCESS" ? "Packing name" : "Helper")
const today = () => new Date().toLocaleDateString("en-CA")
const clockShift = () => {
  const hour = new Date().getHours()
  return hour >= 8 && hour < 20 ? "SHIFT_A" : "SHIFT_B"
}
// "HH:MM" on the business date; an end time before the start is the next morning (night shift).
const stamp = (day: string, time: string, after?: string) => {
  if (!day || !time) return null
  if (after && time < after) {
    const next = new Date(`${day}T00:00:00`)
    next.setDate(next.getDate() + 1)
    return `${next.toLocaleDateString("en-CA")}T${time}`
  }
  return `${day}T${time}`
}
const clockOf = (value: any) => (value ? String(value).slice(11, 16) : "")
const cycleText = (start: string | null, end: string | null) => {
  if (!start || !end) return ""
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const minutes = Math.round(ms / 60000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}
const remembered = (key: string) => {
  try {
    return window.localStorage.getItem(key) || ""
  } catch {
    return ""
  }
}
const remember = (key: string, value: string) => {
  try {
    if (value) window.localStorage.setItem(key, value)
  } catch {}
}

export function ContinuousJobCard({ card, initialStage, embedded = false }: { card: any; initialStage?: string; embedded?: boolean }) {
  const { user } = useAuth()
  const entryApi = entryApiForPlant(card.plant_id)
  const cache = useQueryClient()
  const [stage, setStage] = useState(initialStage || "WINDER")
  const [page, setPage] = useState(0)
  const [panel, setPanel] = useState<"" | "close" | "whole">("")
  // Form mode: a new run, a draft being revised, or QC readings (for a saved batch, or with no run at the QC desk).
  const [editing, setEditing] = useState<any>(null)
  const [qcOnly, setQcOnly] = useState(false)
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
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [segment, setSegment] = useState("")
  const [samples, setSamples] = useState<any[]>([])
  const [instrument, setInstrument] = useState<any>({})
  const [gateOverride, setGateOverride] = useState(false)
  const [gateReason, setGateReason] = useState("")
  const [correction, setCorrection] = useState("")
  const [showQc, setShowQc] = useState(true)
  const [supervisor, setSupervisor] = useState("")
  const [closeReason, setCloseReason] = useState("")
  const [fgItem, setFgItem] = useState("")
  const [location, setLocation] = useState("")
  const [reelLinks, setReelLinks] = useState<string[]>([])
  const [residual, setResidual] = useState("HOLD")
  const [history, setHistory] = useState<any>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const formRef = useRef<HTMLElement | null>(null)
  const pending = useRef<{ fingerprint: string; body: any } | null>(null)
  const roles = new Set([user?.role, ...(user?.roles || [])])
  const canSubmit = ["Owner", "Admin", "PlantManager"].some((r) => roles.has(r))
  const canReopen = ["Owner", "Admin"].some((r) => roles.has(r))
  const canQc = ["Owner", "Admin", "QC", "PlantManager"].some((r) => roles.has(r))
  const canDraft = canSubmit || roles.has("Operator")
  const flow = useQuery({ queryKey: ["continuous-flow", card.id], queryFn: async () => (await entryApi.flow(card.id)).data, refetchInterval: 15000 })
  const listing = useQuery({ queryKey: ["continuous-entries", card.id, stage, page], queryFn: async () => (await entryApi.list(card.id, stage, page * 50)).data })
  const employees = useQuery({ queryKey: ["continuous-employees", card.plant_id], queryFn: async () => (await entryApi.employees()).data })
  const machines = useQuery({ queryKey: ["continuous-machines", card.plant_id], queryFn: async () => (await entryApi.machines()).data })
  const effects = useQuery({ queryKey: ["continuous-effects", card.id], queryFn: async () => (await entryApi.effects(card.id)).data, refetchInterval: 15000 })
  const items = useQuery({ queryKey: ["continuous-items", card.plant_id], queryFn: async () => (await entryApi.items()).data, enabled: panel === "close" })
  const locations = useQuery({ queryKey: ["continuous-locations", card.plant_id], queryFn: async () => (await entryApi.locations()).data, enabled: panel === "close" })
  const winderMachine = card.stages?.find((s: any) => s.stage_type === "WINDER")?.machine_id
  const reelIssues = useQuery({
    queryKey: ["continuous-reel-issues", card.id, winderMachine],
    queryFn: async () => (await entryApi.reelIssues(winderMachine)).data,
    enabled: Boolean(winderMachine && panel === "close" && stage === "WINDER"),
  })
  const stages: any[] = useMemo(() => flow.data?.stages || [], [flow.data])
  const state = stages.find((s: any) => s.stage === stage)
  const stageIndex = stages.findIndex((s: any) => s.stage === stage)
  const prevStage = stages[stageIndex - 1]?.stage
  const activeEmployees = (employees.data || []).filter((e: any) => e.active !== false && e.is_active !== false)
  const worksHere = (e: any) =>
    String(e.department || "").toUpperCase() === stage ||
    String(e.skills || "")
      .toUpperCase()
      .split(/[,;/|]/)
      .map((t: string) => t.trim())
      .includes(stage)
  const operatorRank = (e: any) => (String(e.role || "").toLowerCase() === "operator" ? 0 : 2) + (worksHere(e) ? 0 : 1)
  const operatorOptions = [...activeEmployees].sort((a: any, b: any) => operatorRank(a) - operatorRank(b) || String(a.name).localeCompare(String(b.name)))
  const supervisorOptions = activeEmployees.filter((e: any) => ["supervisor", "manager"].includes(String(e.role || "").toLowerCase()))
  const stageMachines = (machines.data || []).filter((m: any) => m.is_active !== false && String(m.department || "").toUpperCase() === stage)
  const machineName = (id: any) => {
    const m = (machines.data || []).find((row: any) => String(row.id) === String(id))
    return m ? m.name || m.code : ""
  }
  const openSegments = (state?.segments || []).filter((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status))
  const slotReady = !(state?.segments || []).length || openSegments.some((s: any) => s.planner_gate_ready)
  // Input taken from the previous stage equals what this stage made, except Process (bamboo in → pieces out).
  const inputFollowsOutput = stage !== "PROCESS" && Boolean(prevStage) && prevStage !== "SLITTING"
  const parameters = card.spec_snapshot?.qc_profile?.stages?.[stage]?.parameters?.filter((r: any) => r.applicable) || []
  const profile = card.spec_snapshot?.qc_profile
  const memory = (what: string) => `hariom-floor-${what}:${card.plant_id}:${stage}`
  const loggable = Boolean(state) && state.status !== "COMPLETED" && !["SLITTING", "DISPATCH", "QC"].includes(stage)
  // In-process QC gate (client rule 2026-10-18): a stage opens for new runs only once the
  // previous stage has batches whose QC is accepted. A supervisor may still override.
  const [forceOpen, setForceOpen] = useState(false)
  const prevState = stages.find((s: any) => s.stage === prevStage)
  const gateLocked = loggable && Boolean(prevStage) && prevStage !== "SLITTING" && state?.available_from_upstream != null && Number(state.available_from_upstream) <= 0
    && (Number(state?.awaiting_qc_from_upstream || 0) > 0 || !(Number(state?.input_total || 0) > 0))
  const formOpen = Boolean(editing) || qcOnly || (loggable && canDraft && (!gateLocked || forceOpen))

  // Always offer at least as many sample columns as the strictest check needs (two by default).
  const padSamples = (list: any[]) => {
    const need = Math.max(2, ...parameters.map((r: any) => Number(r.min_readings || 0)))
    return [...list, ...Array.from({ length: Math.max(0, need - list.length) }, (_, i) => ({ sample_id: `${crypto.randomUUID()}-${list.length + i + 1}`, readings: {} }))]
  }
  const defaultMachine = () =>
    openSegments.find((s: any) => s.machine_id)?.machine_id ||
    card.stages?.find((s: any) => s.stage_type === stage)?.machine_id ||
    remembered(memory("machine")) ||
    (stageMachines.length === 1 ? stageMachines[0].id : "")
  // A fresh run keeps who/when (same shift, same machine) and clears the numbers.
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
    setStartTime("")
    setEndTime("")
    setSamples(padSamples([]))
    setInstrument({})
    setGateOverride(false)
    setGateReason("")
    setCorrection("")
    pending.current = null
  }
  const startRun = () => {
    setEditing(null)
    setQcOnly(false)
    setSegment(openSegments[0]?.id || "")
    clearNumbers()
  }
  const openEntry = (entry: any, observationOnly = false) => {
    setEditing(entry || null)
    setQcOnly(observationOnly)
    setShowQc(true)
    setError("")
    setNotice("")
    pending.current = null
    if (entry && !observationOnly) {
      setBusinessDate(entry.business_date || today())
      setShift(entry.shift_code || clockShift())
      setMachine(entry.machine_id || "")
      setOperator(entry.operator_id || "")
      setHelper(entry.details?.helper_name || "")
      setOutput(entry.produced ? String(entry.produced) : "")
      setRejected(entry.rejected ? String(entry.rejected) : "")
      setRejectCode(entry.details?.reject_code || "")
      setRejectNote(entry.details?.reject_reason || "")
      setOverNote(entry.details?.overproduction_reason || "")
      setInput(entry.input_quantity ? String(entry.input_quantity) : "")
      setLoss(entry.cutting_loss_pcs ? String(entry.cutting_loss_pcs) : "")
      setCarryIn(entry.carry_in_pcs ? String(entry.carry_in_pcs) : "")
      setCarryOut(entry.carry_out_pcs ? String(entry.carry_out_pcs) : "")
      setRemark(entry.details?.carryover_reason || "")
      setStartTime(clockOf(entry.details?.start_time))
      setEndTime(clockOf(entry.details?.end_time))
      setSegment(entry.segment_id || "")
    }
    setSamples(padSamples(entry?.samples || []))
    setInstrument(entry?.details?.instrument || {})
    setCorrection("")
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
  }

  useEffect(() => {
    if (stages.length && !stages.some((s: any) => s.stage === stage)) setStage(stages[0].stage)
  }, [stages, stage])
  // Deep link from the QC desk (?stage=OVEN) opens that stage's tab once.
  useEffect(() => {
    if (typeof window === "undefined") return
    const wanted = new URLSearchParams(window.location.search).get("stage")
    if (wanted && ["WINDER", "OVEN", "PROCESS", "PACKING", "QC"].includes(wanted)) setStage(wanted)
  }, [])
  // New stage: who ran it last time on this stage, the planned machine, fresh sample columns.
  useEffect(() => {
    setOperator(remembered(memory("operator")))
    setHelper(remembered(memory("helper")))
    setMachine(defaultMachine() || "")
    setEditing(null)
    setQcOnly(false)
    setPanel("")
    setSegment("")
    setForceOpen(false)
    clearNumbers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, card.id])
  // Machines and the stage plan load after the first paint; fill the machine once they arrive.
  useEffect(() => {
    if (!machine && !editing && state) setMachine(defaultMachine() || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.stage, machines.data])

  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["continuous-flow", card.id] }),
      cache.invalidateQueries({ queryKey: ["continuous-entries", card.id] }),
      cache.invalidateQueries({ queryKey: ["planning-job-card", card.id] }),
      cache.invalidateQueries({ queryKey: ["continuous-effects", card.id] }),
    ])
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<any>) => action(),
    onError: (e) => {
      setError(errorText(e))
      setNotice("")
    },
    onSuccess: async () => {
      pending.current = null
      setError("")
      await refresh()
    },
  })
  const stableCommand = (body: any) => {
    const fingerprint = JSON.stringify(body)
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, body: command(body) }
    return pending.current.body
  }

  const made = count(output)
  const bad = count(rejected)
  const good = Math.max(0, made - bad)
  const takenIn = inputFollowsOutput ? made : count(input)
  const lossQty = count(loss)
  const carryInQty = count(carryIn)
  const carryOutQty = count(carryOut)
  const disposition = stage === "PROCESS" && made === 0 && carryInQty > 0
  const startStamp = stamp(businessDate, startTime)
  const endStamp = stamp(businessDate, endTime, startTime || undefined)
  const overTarget = state ? Number(state.produced_total || 0) + made > Number(state.target || 0) * 1.1 : false
  const codeText = REJECT_CODES.find(([code]) => code === rejectCode)?.[1] || ""
  const rejectReason = rejectNote.trim() || (rejectCode && rejectCode !== "OT" ? `${rejectCode} · ${codeText}` : "") || (lossQty ? remark.trim() : "")
  const filledSamples = samples
    .filter((s) => Object.values(s.readings || {}).some((v) => v !== "" && v != null))
    .map((s) => ({ ...s, readings: Object.fromEntries(Object.entries(s.readings).filter(([, v]) => v !== "" && v != null)) }))
  const runMissing = [
    !businessDate ? "the date" : "",
    !shift ? "the shift" : "",
    !operator ? "the operator" : "",
    !made && !disposition ? `how many ${state?.unit || "pieces"} were made` : "",
    bad > made ? "a rejected count that is not more than the output" : "",
    bad > 0 && !rejectCode ? "the rejection code" : "",
    bad > 0 && rejectCode === "OT" && !rejectNote.trim() ? "what the 'Other' rejection was" : "",
    stage === "PROCESS" && !takenIn && !disposition ? `how many ${state?.input_unit || "bamboo"} were taken from ${label(prevStage || "OVEN")}` : "",
    (lossQty || disposition) && !rejectReason ? "the reason for the cutting loss" : "",
    (carryInQty || carryOutQty) && !remark.trim() ? "the reason for the held carryover" : "",
    overTarget && !overNote.trim() ? "why output is above the planned +10%" : "",
    gateOverride && !gateReason.trim() ? "why the batch is taken before its QC" : "",
  ].filter(Boolean)
  // Minimum 2 readings per required check (more may be added); moisture stays optional.
  const shortChecks = parameters.filter((rule: any) => !OPTIONAL_QC_CODES.has(rule.code))
    .filter((rule: any) => filledSamples.filter((sample: any) => sample.readings?.[rule.code] !== undefined).length < Math.max(2, Number(rule.min_readings || 0)))
  const priorSamples: any[] = editing?.samples || []
  const onlyAdded = priorSamples.length > 0 && priorSamples.every((old: any) => {
    const now = filledSamples.find((sample: any) => sample.sample_id === old.sample_id)
    return now && Object.entries(old.readings || {}).every(([code, value]) => value === "" || value == null || String(now.readings?.[code]) === String(value))
  })
  const qcMissing = [
    !filledSamples.length ? "at least one reading" : "",
    filledSamples.length && shortChecks.length ? `2 readings for ${shortChecks.map((rule: any) => rule.label).join(", ")}` : "",
    priorSamples.length && !onlyAdded && !correction.trim() ? "the reason for changing readings" : "",
  ].filter(Boolean)
  const missing = qcOnly ? qcMissing : runMissing

  const saveRun = (submit: boolean) => {
    const details: any = {
      reject_reason: bad || lossQty || disposition ? rejectReason : undefined,
      reject_code: bad ? rejectCode || null : null,
      helper_name: helper.trim() || null,
      overproduction_reason: overTarget ? overNote.trim() : undefined,
      carryover_reason: carryInQty || carryOutQty ? remark.trim() : undefined,
      start_time: startStamp,
      end_time: endStamp,
      instrument,
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
      segment_id: segment || null,
      produced: made,
      accepted: good,
      input_quantity: takenIn,
      cutting_loss_pcs: lossQty,
      carry_in_pcs: carryInQty,
      carry_out_pcs: carryOutQty,
      samples: filledSamples,
      machine_id: machine || null,
      details,
      reason: [rejectReason, overTarget ? overNote.trim() : "", remark.trim()].filter(Boolean).join(" · "),
      submit,
    }
    remember(memory("operator"), operator)
    remember(memory("helper"), helper.trim())
    remember(memory("machine"), machine)
    const word = `${label(stage)} run`
    mutation.mutate(async () => {
      const result = editing ? await entryApi.edit(card.id, editing.id, stableCommand({ ...body, submit: false })) : await entryApi.create(card.id, stableCommand(body))
      const saved = result?.data?.entry
      setNotice(
        editing
          ? `Draft #${editing.entry_no} updated.`
          : `${word} #${saved?.entry_no ?? ""} saved${submit ? "" : " as a draft for the supervisor"}: ${fmt(good)} good${bad ? `, ${fmt(bad)} rejected` : ""}${filledSamples.length ? ` · QC ${verdictLabel(saved?.evaluation?.verdict).replace("QC ", "")}` : ""}.`,
      )
      setEditing(null)
      clearNumbers()
      return result
    })
  }
  const saveQc = () => {
    const word = editing ? `batch #${editing.entry_no}` : "QC desk"
    mutation.mutate(async () => {
      const result =
        editing
          ? await entryApi.observations(card.id, editing.id, stableCommand({ samples: filledSamples, instrument, expected_version: editing.row_version, reason: correction.trim() }))
          : await entryApi.create(card.id, stableCommand({ stage, kind: "QC_ONLY", quantity_mode: "DELTA", expected_version: state?.row_version, samples: filledSamples, details: { instrument }, reason: correction.trim(), submit: true }))
      const verdict = result?.data?.entry?.evaluation?.verdict
      setNotice(`QC readings saved for ${word}${verdict ? ` · ${verdictLabel(verdict)}` : ""}.`)
      setEditing(null)
      setQcOnly(false)
      clearNumbers()
      return result
    })
  }

  if (flow.isLoading || listing.isLoading) return <p role="status" className="p-6">Loading production entries…</p>
  if (flow.isError || listing.isError)
    return (
      <div className="rounded-xl border border-destructive p-6">
        <p>Production entries could not be loaded.</p>
        <Button
          onClick={() => {
            flow.refetch()
            listing.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )

  const pct = state && Number(state.target) ? Math.min(100, (Number(state.accepted_total) / Number(state.target)) * 100) : 0
  const entries: any[] = listing.data.entries || []

  return (
    <div className={embedded ? "space-y-4" : "mx-auto max-w-5xl space-y-4"} data-testid="continuous-job-card">
      {embedded ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Production entry</p>
            <h1 className="text-xl font-semibold">
              {card.job_card_no || "Job card"} · {seasonLabel(flow.data.season)}
            </h1>
            <p className="text-sm text-muted-foreground">
              Recipe r{flow.data.recipe_revision} · QC rules v{profile?.provenance?.rule_set_version}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/production/job-cards/${card.id}/print`}>Print card</Link>
          </Button>
        </div>
      )}

      {/* Stage tabs with progress: tap the stage the printed card row belongs to. */}
      <nav aria-label="Production stages" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="season-stage-tabs">
        {stages.map((s: any) => {
          const done = s.status === "COMPLETED"
          const share = Number(s.target) ? Math.min(100, (Number(s.accepted_total) / Number(s.target)) * 100) : 0
          return (
            <button
              key={s.stage}
              type="button"
              aria-pressed={s.stage === stage}
              onClick={() => {
                const dirty = (made || filledSamples.length) && !mutation.isPending
                if (!dirty || window.confirm("Discard the run you are typing?")) {
                  setStage(s.stage)
                  setPage(0)
                  setNotice("")
                  setError("")
                }
              }}
              className={cn(
                "min-w-[7.5rem] shrink-0 rounded-xl border px-3 py-2 text-left transition",
                s.stage === stage ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-[13px] font-semibold">
                {label(s.stage)}
                {done ? <span aria-label="closed">✓</span> : null}
              </span>
              <span className={cn("mt-0.5 block text-[12px] tabular-nums", s.stage === stage ? "opacity-90" : "text-muted-foreground")}>
                {fmt(s.accepted_total)} / {fmt(s.target)} {s.unit}
              </span>
              <span className={cn("mt-1 block h-1 overflow-hidden rounded-full", s.stage === stage ? "bg-primary-foreground/30" : "bg-muted")}>
                <span className={cn("block h-full rounded-full", s.stage === stage ? "bg-primary-foreground" : done ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${share}%` }} />
              </span>
            </button>
          )
        })}
      </nav>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-signal-emerald-line bg-signal-emerald-soft p-3 text-sm font-medium text-signal-emerald-ink" data-testid="season-entry-notice">
          {notice}
        </p>
      ) : null}

      {state ? (
        <section className="rounded-xl border border-border bg-card p-4" data-testid="season-stage-status">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {label(stage)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {state.status === "COMPLETED" ? "closed" : state.status === "RUNNING" ? "running" : "not started"}
              </span>
            </h2>
            <p className="text-sm tabular-nums">
              <strong className="text-base">{fmt(state.accepted_total)}</strong> good of {fmt(state.target)} {state.unit}
              {state.rejected_total ? <span className="text-signal-rose-ink"> · {fmt(state.rejected_total)} rejected</span> : null}
              {state.draft_count ? <span className="text-signal-amber-ink"> · {state.draft_count} draft waiting</span> : null}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", state.status === "COMPLETED" ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
          {state.available_from_upstream != null && state.status !== "COMPLETED" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Ready from {label(prevStage || "")}: <strong className="text-foreground">{fmt(state.available_from_upstream)} {state.input_unit}</strong>
              {state.upstream_has_qc ? " (QC passed)" : ""}
              {state.awaiting_qc_from_upstream > 0 ? <span className="text-signal-amber-ink"> · {fmt(state.awaiting_qc_from_upstream)} still waiting for QC</span> : null}
              {stage === "PROCESS" && state.carryover_pcs ? ` · held carryover ${fmt(state.carryover_pcs)} pcs` : ""}
            </p>
          ) : null}
          {state.status !== "COMPLETED" && state.awaiting_qc_from_upstream > 0 && !gateLocked ? (
            <p className="mt-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-2.5 text-sm text-signal-amber-ink" data-testid="batch-qc-gate">
              {fmt(state.awaiting_qc_from_upstream)} {state.input_unit} from {label(prevStage || "")} cannot be used yet — their QC is not recorded as pass. Open the {label(prevStage || "")} tab and press <strong>Add QC</strong> on that run.
            </p>
          ) : null}
          {state.status === "COMPLETED" ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <p>
                {state.supervisor_name ? `Closed by ${state.supervisor_name}` : stage === "DISPATCH" ? "Dispatch reconciled" : "Stage closed"}
                {state.closed_at ? ` · ${seasonTimestamp(state.closed_at)}` : ""}
                {state.residual_quantity ? ` · ${state.residual_quantity} unused input ${state.residual_disposition}` : ""}
              </p>
              {canReopen && !["SLITTING", "DISPATCH"].includes(stage) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const reason = window.prompt("Reason to reopen this stage. Posted stock or tool usage needs a governed reversal or an additional card.")
                    if (reason?.trim()) mutation.mutate(() => entryApi.reopen(card.id, stage, stableCommand({ expected_version: state.row_version, reason })))
                  }}
                >
                  Reopen stage
                </Button>
              ) : null}
            </div>
          ) : null}
          {state.blockers.length > 0 && state.status !== "COMPLETED" ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Before this stage can close ({state.blockers.length})</summary>
              <div className="mt-1 space-y-0.5">
                {state.blockers.map((b: string) => (
                  <p key={b}>{b}</p>
                ))}
                {state.qc.missing.map((r: any) => (
                  <span className="mr-3 text-xs" key={r.parameter}>
                    {r.label}: {r.have}/{r.need} samples
                  </span>
                ))}
              </div>
            </details>
          ) : null}
          {state.qc?.unrecorded?.length ? (
            <p className="mt-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-2.5 py-1.5 text-sm text-signal-amber-ink" data-testid="season-qc-unrecorded">
              Not recorded (optional): {state.qc.unrecorded.map((r: any) => `${r.label} ${r.have}/${r.need}`).join(", ")} — the stage can still close; this is flagged for the owner.
            </p>
          ) : null}
          {stage === "DISPATCH" && state.qc_rejected_qty > 0 ? <p className="mt-2 text-sm text-signal-amber-ink">Final QC rejected {state.qc_rejected_qty} pcs; they are excluded from shipments.</p> : null}
          {stage === "DISPATCH" && state.qc_uninspected_qty > 0 ? <p className="mt-2 text-sm">Uninspected at final QC: {state.qc_uninspected_qty} pcs (not shipped).</p> : null}
          {state.retained_fg_qty > 0 ? <p className="mt-2 text-sm">Retained finished goods: {state.retained_fg_qty} pcs (kept in stock, not shipped).</p> : null}
          {stage === "SLITTING" ? (
            <Button asChild variant="outline" className="mt-3">
              <Link href={`/production/job-cards/${card.id}/slitting`}>Open slitting and reel issue</Link>
            </Button>
          ) : null}
          {stage === "DISPATCH" ? (
            <Button asChild className="mt-3">
              <Link href="/logistics/dispatch">Open dispatch</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      {stage === "QC" && canQc ? <FinalQcForm card={card} /> : null}

      {gateLocked && !forceOpen && !editing && !qcOnly && state ? (
        <section className="rounded-xl border-2 border-dashed border-signal-amber-line bg-signal-amber-soft/50 p-4 sm:p-5" data-testid="stage-qc-lock">
          <h2 className="text-lg font-semibold text-foreground">{label(stage)} opens when {label(prevStage || "")} QC is accepted</h2>
          <p className="mt-1 text-sm text-foreground/80">
            {state.awaiting_qc_from_upstream > 0
              ? `${fmt(state.awaiting_qc_from_upstream)} ${state.input_unit} made in ${label(prevStage || "")} are waiting for QC (minimum 2 readings per check). As soon as QC accepts a batch, this stage unlocks for that quantity.`
              : prevState && Number(prevState.accepted_total || 0) > 0 && prevState.status !== "COMPLETED"
                ? `${label(prevStage || "")} has output but must be closed before ${label(stage).toLowerCase()} starts.`
                : `Nothing from ${label(prevStage || "")} is ready yet. Log ${label(prevStage || "").toLowerCase()} runs and their QC first.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setStage(prevStage)}>Go to {label(prevStage || "")}{state.awaiting_qc_from_upstream > 0 ? " QC" : ""}</Button>
            {canSubmit && state.awaiting_qc_from_upstream > 0 ? (
              <Button variant="outline" onClick={() => { setForceOpen(true); setGateOverride(true) }}>Supervisor override…</Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {formOpen && state ? (
        <section ref={formRef} className="space-y-4 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-5" data-testid="season-run-form">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {qcOnly && editing
                ? `QC readings · ${label(stage)} run #${editing.entry_no}`
                : qcOnly
                  ? `QC readings without a run · ${label(stage)}`
                  : editing
                    ? `Change draft #${editing.entry_no} · ${label(stage)}`
                    : `Log a ${label(stage).toLowerCase()} run`}
            </h2>
            {editing || qcOnly ? (
              <Button variant="ghost" size="sm" onClick={startRun}>
                Back to new run
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">One run = one line of the printed card</span>
            )}
          </div>

          {!qcOnly ? (
            <>
              {!slotReady ? (
                <p className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink" data-testid="season-entry-unscheduled">
                  Not on the planner yet — you can still log it. It is flagged for the owner under Reports › Exceptions.
                </p>
              ) : null}

              <fieldset className="space-y-3" data-testid="season-entry-card-row">
                <legend className="mb-2 text-sm font-semibold text-muted-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">1</span>
                  Who and when
                </legend>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label className="text-sm">
                    Date
                    <Input type="date" className="h-11 text-[15px]" value={businessDate} max={today()} onChange={(e) => setBusinessDate(e.target.value)} />
                  </label>
                  <div className="text-sm">
                    Shift
                    <div className="mt-0.5 grid h-11 grid-cols-2 overflow-hidden rounded-lg border border-border" role="group" aria-label="Shift">
                      {["SHIFT_A", "SHIFT_B"].map((code) => (
                        <button
                          key={code}
                          type="button"
                          aria-pressed={shift === code}
                          onClick={() => setShift(code)}
                          className={cn("text-[15px] font-semibold", shift === code ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
                        >
                          {code.replace("SHIFT_", "Shift ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="col-span-2 text-sm sm:col-span-1">
                    {machineLabelFor(stage)}
                    <select className={selectClass} value={machine} onChange={(e) => setMachine(e.target.value)} data-testid="season-entry-machine">
                      <option value="">{stageMachines.length ? "Choose" : "No machine in this department"}</option>
                      {stageMachines.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 text-sm sm:col-span-1">
                    Operator
                    <select className={selectClass} value={operator} onChange={(e) => setOperator(e.target.value)} data-testid="season-entry-operator">
                      <option value="">{employees.isLoading ? "Loading…" : operatorOptions.length ? "Choose operator" : "No active employees — add in Masters › Employees"}</option>
                      {operatorOptions.map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {e.employee_code ? ` · ${e.employee_code}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label className="col-span-2 text-sm sm:col-span-1">
                    {helperLabelFor(stage)} <span className="text-muted-foreground">(optional)</span>
                    <Input className="h-11 text-[15px]" value={helper} onChange={(e) => setHelper(e.target.value)} />
                  </label>
                  <label className="text-sm">
                    Start time <span className="text-muted-foreground">(A)</span>
                    <Input type="time" className="h-11 text-[15px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" />
                  </label>
                  <label className="text-sm">
                    End time <span className="text-muted-foreground">(B)</span>
                    <Input type="time" className="h-11 text-[15px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" />
                  </label>
                  <div className="col-span-2 flex items-end text-sm text-muted-foreground sm:col-span-1 sm:pb-2">{cycleText(startStamp, endStamp) ? `Cycle ${cycleText(startStamp, endStamp)}` : "Times are optional"}</div>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold text-muted-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">2</span>
                  How many
                </legend>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {stage === "PROCESS" ? (
                    <label className="col-span-2 text-sm lg:col-span-1">
                      {state.input_unit || "Bamboo"} taken from {label(prevStage || "OVEN")}
                      <input inputMode="numeric" type="number" min="0" step="1" className={numberClass} value={input} onChange={(e) => setInput(e.target.value)} data-testid="season-entry-input" />
                    </label>
                  ) : null}
                  <label className="text-sm">
                    Output ({state.unit})
                    <input inputMode="numeric" type="number" min="0" step="1" className={numberClass} value={output} onChange={(e) => setOutput(e.target.value)} data-testid="season-entry-produced" />
                  </label>
                  <label className="text-sm">
                    Rejected
                    <input inputMode="numeric" type="number" min="0" step="1" className={numberClass} value={rejected} onChange={(e) => setRejected(e.target.value)} data-testid="season-entry-rejected" />
                  </label>
                  <div className="col-span-2 flex flex-col justify-end rounded-lg bg-muted px-3 py-2 text-sm lg:col-span-1" data-testid="season-entry-math">
                    <span className="text-muted-foreground">Good</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {fmt(good)} {state.unit}
                    </span>
                    {inputFollowsOutput && made ? (
                      <span className="text-xs text-muted-foreground">
                        takes {fmt(made)} {state.input_unit || state.unit} from {label(prevStage)}
                      </span>
                    ) : null}
                  </div>
                </div>
                {bad > 0 ? (
                  <div className="space-y-2" data-testid="season-entry-reject">
                    <p className="text-sm">Why rejected?</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Rejection code">
                      {REJECT_CODES.map(([code, text]) => (
                        <button
                          key={code}
                          type="button"
                          aria-pressed={rejectCode === code}
                          onClick={() => setRejectCode(code)}
                          className={cn("rounded-full border px-3 py-1.5 text-sm", rejectCode === code ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}
                        >
                          <strong>{code}</strong> {text}
                        </button>
                      ))}
                    </div>
                    <Input
                      className="h-11 text-[15px]"
                      aria-label="Entry reason"
                      placeholder={rejectCode === "OT" ? "What was wrong? (required)" : "Note (optional)"}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                    />
                  </div>
                ) : null}
                {overTarget ? (
                  <label className="block text-sm text-signal-amber-ink">
                    Output goes above the planned quantity +10%. Why?
                    <Input className="h-11 text-[15px]" value={overNote} onChange={(e) => setOverNote(e.target.value)} aria-label="Overproduction reason" />
                  </label>
                ) : null}
                {canSubmit && state.awaiting_qc_from_upstream > 0 ? (
                  <div className="rounded-lg border border-border bg-muted p-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={gateOverride} onChange={(e) => setGateOverride(e.target.checked)} /> Supervisor override: take batches whose QC is not recorded yet
                    </label>
                    {gateOverride ? (
                      <Input className="mt-2" placeholder="Why this batch is taken before its QC (kept on the entry)" aria-label="QC gate override reason" value={gateReason} onChange={(e) => setGateReason(e.target.value)} />
                    ) : null}
                  </div>
                ) : null}
                {stage === "PROCESS" || openSegments.length > 1 ? (
                  <details className="rounded-lg border border-border p-3 text-sm" open={Boolean(lossQty || carryInQty || carryOutQty)}>
                    <summary className="cursor-pointer font-medium">More: {stage === "PROCESS" ? "cutting loss, held carryover" : ""}{stage === "PROCESS" && openSegments.length > 1 ? ", " : ""}{openSegments.length > 1 ? "planned slot" : ""}</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {openSegments.length > 1 ? (
                        <label className="text-sm sm:col-span-2">
                          Planned slot
                          <select className={selectClass} value={segment} onChange={(e) => setSegment(e.target.value)}>
                            {openSegments.map((s: any) => (
                              <option key={s.id} value={s.id}>
                                {s.plan_date || "Unscheduled"} · {s.shift_code?.replace("SHIFT_", "Shift ") || "No shift"} · {machineName(s.machine_id) || "no machine"}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {stage === "PROCESS"
                        ? (
                            [
                              ["Cutting loss pcs", loss, setLoss],
                              ["Held carry-in pcs", carryIn, setCarryIn],
                              ["Held carry-out pcs", carryOut, setCarryOut],
                            ] as [string, string, (v: string) => void][]
                          ).map(([title, value, setter]) => (
                            <label className="text-sm" key={title}>
                              {title}
                              <Input inputMode="numeric" type="number" min="0" step="1" className="h-11" value={value} onChange={(e) => setter(e.target.value)} />
                            </label>
                          ))
                        : null}
                      {stage === "PROCESS" ? (
                        <label className="text-sm sm:col-span-2 lg:col-span-4">
                          Reason for loss or carryover
                          <Input className="h-11" value={remark} onChange={(e) => setRemark(e.target.value)} aria-label="Loss or carryover reason" />
                        </label>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </fieldset>
            </>
          ) : null}

          {parameters.length > 0 ? (
            <fieldset className="rounded-xl border border-border bg-muted/30 p-3">
              <legend className="px-1 text-sm font-semibold text-muted-foreground">
                {!qcOnly ? <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">3</span> : null}
                QC readings{!qcOnly ? " (can be added later)" : ""}
              </legend>
              {!qcOnly ? (
                <button type="button" className="mb-2 text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => setShowQc((v) => !v)}>
                  {showQc ? "Hide QC readings" : `Add QC readings now (${samples.length} samples)`}
                </button>
              ) : null}
              {showQc || qcOnly ? (
                <div className="space-y-2">
                  <SeasonQcMatrix rules={parameters} samples={samples} onChange={setSamples} stageLabel={label(stage)} />
                  {parameters.some((p: any) => p.requires_instrument) ? <InstrumentFields value={instrument} onChange={setInstrument} /> : null}
                  <p className="text-xs text-muted-foreground">Minimum 2 readings per check (moisture optional); use “Add another sample” for more. The next stage takes this batch only once QC is accepted.</p>
                  {qcOnly && editing?.samples?.length && !onlyAdded ? (
                    <label className="block text-sm">
                      Why are recorded readings changed? (required — adding new readings needs no reason)
                      <Input aria-label="Entry reason" value={correction} onChange={(e) => setCorrection(e.target.value)} />
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">The next stage takes this batch only after its QC readings pass.</p>
              )}
            </fieldset>
          ) : null}

          <div className="space-y-2">
            {missing.length ? (
              <p className="text-sm text-muted-foreground" data-testid="season-entry-missing">
                Still needed: {missing.join(", ")}.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {qcOnly ? (
                <Button size="lg" className="min-w-[12rem] flex-1 sm:flex-none" disabled={mutation.isPending || missing.length > 0} onClick={saveQc}>
                  {mutation.isPending ? "Saving…" : "Save QC readings"}
                </Button>
              ) : editing ? (
                <Button size="lg" className="min-w-[12rem] flex-1 sm:flex-none" disabled={mutation.isPending || missing.length > 0} onClick={() => saveRun(false)}>
                  {mutation.isPending ? "Saving…" : "Save draft changes"}
                </Button>
              ) : (
                <Button size="lg" className="min-w-[12rem] flex-1 sm:flex-none" disabled={mutation.isPending || missing.length > 0} onClick={() => saveRun(canSubmit)} data-testid="season-entry-save">
                  {mutation.isPending ? "Saving…" : canSubmit ? "Save run" : "Send to supervisor"}
                </Button>
              )}
              {editing || qcOnly ? (
                <Button size="lg" variant="ghost" onClick={startRun}>
                  Cancel
                </Button>
              ) : null}
            </div>
            {!qcOnly && !editing ? (
              <p className="text-xs text-muted-foreground">
                {canSubmit ? "Saving posts the run straight away. Date, shift, machine and operator stay filled for the next run." : "Your run is saved as a draft; a supervisor checks and submits it."}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Runs of this stage: newest first. QC, draft review and corrections happen from here. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="season-runs">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-semibold">
            {label(stage)} runs · {listing.data.total}
          </h2>
          <p className="text-xs text-muted-foreground">Drafts do not count until submitted</p>
        </div>
        {entries.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No runs logged on this stage yet.</p> : null}
        <ul className="divide-y divide-border">
          {entries.map((e: any) => {
            const verdict = e.evaluation?.verdict
            const pass = verdict === "PASS" || verdict === "OBSERVATION_ONLY"
            const fail = verdict === "FAIL"
            return (
              <li key={e.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <strong>#{e.entry_no}</strong>{" "}
                    {e.kind === "QC_ONLY" ? (
                      <span className="text-muted-foreground">QC readings only</span>
                    ) : (
                      <span className="tabular-nums">
                        {fmt(e.produced)} made · <strong>{fmt(e.accepted)} good</strong>
                        {e.rejected ? (
                          <span className="text-signal-rose-ink">
                            {" "}
                            · {fmt(e.rejected)} rejected{e.details?.reject_code ? ` (${e.details.reject_code})` : ""}
                          </span>
                        ) : null}
                        {e.input_quantity && stage === "PROCESS" ? ` · ${fmt(e.input_quantity)} bamboo in` : ""}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      e.business_date,
                      e.shift_code?.replace("SHIFT_", "Shift "),
                      e.machine_id ? machineName(e.machine_id) : "",
                      e.operator_name,
                      e.details?.start_time && e.details?.end_time ? `${clockOf(e.details.start_time)}–${clockOf(e.details.end_time)}` : "",
                      e.details?.unscheduled_entry ? "logged before planning" : "",
                      e.details?.material_prep_pending ? "logged before the slitting record" : "",
                      e.qc_gate_override ? "taken before upstream QC (override)" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {e.status === "DRAFT" ? (
                    <span className="rounded-full bg-signal-amber-soft px-2 py-0.5 text-xs font-semibold text-signal-amber-ink">Draft</span>
                  ) : e.status === "VOID" ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Void</span>
                  ) : stage === "QC" ? null : (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        pass ? "bg-signal-emerald-soft text-signal-emerald-ink" : fail ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-amber-soft text-signal-amber-ink",
                      )}
                    >
                      {verdictLabel(verdict)}
                      {e.kind !== "QC_ONLY" ? (e.qc_cleared ? " · accepted, next stage can take it" : fail ? " · on hold" : "") : ""}
                    </span>
                  )}
                  {e.status === "SUBMITTED" && !e.qc_cleared && !fail && e.qc_readings_short?.length ? (
                    <span className="rounded-full bg-signal-amber-soft px-2 py-0.5 text-xs font-semibold text-signal-amber-ink" title="Minimum 2 readings per check before QC is accepted">
                      Needs more readings: {e.qc_readings_short.map((r: any) => `${r.label} ${r.have}/${r.need}`).join(", ")}
                    </span>
                  ) : null}
                  {e.status !== "VOID" && e.evaluation?.unrecorded?.length ? (
                    <span className="rounded-full bg-signal-amber-soft px-2 py-0.5 text-xs font-semibold text-signal-amber-ink" title="Optional; flagged for the owner">
                      {e.evaluation.unrecorded.map((u: any) => u.label).join(", ")} not recorded
                    </span>
                  ) : null}
                  {e.status === "SUBMITTED" && canQc && parameters.length ? (
                    <Button size="sm" variant={pass ? "ghost" : "outline"} onClick={() => openEntry(e, true)}>
                      {e.samples?.length ? "QC" : "Add QC"}
                    </Button>
                  ) : null}
                  {e.status === "DRAFT" && canDraft ? (
                    <Button size="sm" variant="ghost" onClick={() => openEntry(e)}>
                      Edit
                    </Button>
                  ) : null}
                  {e.status === "DRAFT" && canSubmit ? (
                    <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(() => entryApi.submit(card.id, e.id, stableCommand({ expected_version: e.row_version, reason: "Reviewed draft" })))}>
                      Submit
                    </Button>
                  ) : null}
                  {e.status !== "VOID" && canSubmit && state?.status !== "COMPLETED" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt("Reason to void this run (output already used downstream cannot be voided)")
                        if (reason) mutation.mutate(() => entryApi.void(card.id, e.id, stableCommand({ expected_version: e.row_version, reason })))
                      }}
                    >
                      Void
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        setHistory((await entryApi.history(card.id, e.id)).data)
                      } catch (err) {
                        setError(errorText(err))
                      }
                    }}
                  >
                    History
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        {listing.data.total > 50 ? (
          <div className="flex justify-between border-t border-border p-3">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <Button variant="outline" disabled={(page + 1) * 50 >= listing.data.total} onClick={() => setPage((p) => p + 1)}>
              Older
            </Button>
          </div>
        ) : null}
      </section>

      {history ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <Button variant="ghost" onClick={() => setHistory(null)}>
            Close history
          </Button>
          {history.map((r: any) => (
            <details key={r.version}>
              <summary className="cursor-pointer py-2">
                Revision {r.version} · {r.actor} · {r.reason}
              </summary>
              <pre className="max-h-96 overflow-auto text-xs">{JSON.stringify(r.payload, null, 2)}</pre>
            </details>
          ))}
        </section>
      ) : null}

      {/* Less frequent actions: finishing a stage, typing a whole printed card, QC desk readings. */}
      <div className="flex flex-wrap gap-2" data-testid="season-stage-actions">
        {canSubmit && loggable ? (
          <Button variant="outline" onClick={() => setPanel(panel === "close" ? "" : "close")}>
            Close {label(stage).toLowerCase()} stage
          </Button>
        ) : null}
        {canSubmit && stages.some((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status) && !["DISPATCH", "SLITTING"].includes(s.stage)) ? (
          <Button variant="outline" onClick={() => setPanel(panel === "whole" ? "" : "whole")}>
            Enter the whole printed card
          </Button>
        ) : null}
        {canQc && parameters.length > 0 && loggable ? (
          <Button variant="outline" onClick={() => openEntry(undefined, true)} title="Readings for a sample that is not tied to one run (QC desk).">
            QC readings without a run
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link href={`/quality/results?job_card_id=${card.id}`}>QC results / holds</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/inventory/production-issue">Material issues</Link>
        </Button>
      </div>

      {panel === "close" && state ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Close {label(stage)}</h2>
          <p className="text-sm text-muted-foreground">
            {fmt(state.accepted_total)} of {fmt(state.target)} {state.unit} good{state.accepted_total < state.target ? " — closing now is a short close and needs a reason" : ""}.
            {state.draft_count ? ` ${state.draft_count} draft must be submitted or voided first.` : ""}
          </p>
          <label className="block text-sm">
            Supervisor
            <select className={selectClass} value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
              <option value="">{supervisorOptions.length ? "Choose supervisor" : "No active Supervisor or Manager — add one in Masters › Employees"}</option>
              {supervisorOptions.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.employee_code ? ` · ${e.employee_code}` : ""} · {e.role}
                </option>
              ))}
            </select>
          </label>
          {stage === "WINDER" ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Link reel issues (optional — the monthly stock count settles material)</summary>
              {reelIssues.isError ? (
                <p className="text-sm text-destructive">Could not load reel issues. Retry after checking Inventory.</p>
              ) : (
                (reelIssues.data || [])
                  .filter((i: any) => !i.sales_order_id || i.sales_order_id === card.sales_order_id)
                  .map((i: any) => (
                    <label key={i.id} className="mt-2 block text-sm">
                      <input type="checkbox" checked={reelLinks.includes(i.id)} onChange={(e) => setReelLinks((current) => (e.target.checked ? [...current, i.id] : current.filter((id) => id !== i.id)))} />{" "}
                      {i.reel_code || i.amigo_no || i.id.slice(0, 8)} · {i.consumed_weight_kg} kg · {i.issue_date}
                    </label>
                  ))
              )}
            </details>
          ) : null}
          {stage === "PACKING" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Finished-good item
                <select className={selectClass} value={fgItem} onChange={(e) => setFgItem(e.target.value)}>
                  <option value="">Choose finished good</option>
                  {(items.data || [])
                    .filter((i: any) => i.type === "FINISHED_GOOD")
                    .map((i: any) => (
                      <option key={i.id} value={i.id}>
                        {i.item_code || i.code} · {i.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                Stock location
                <select className={selectClass} value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">Default location</option>
                  {(locations.data || []).map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {state.available_from_upstream > 0 ? (
            <label className="block text-sm">
              Unused input ({fmt(state.available_from_upstream)} {state.input_unit})
              <select className={selectClass} value={residual} onChange={(e) => setResidual(e.target.value)}>
                <option value="HOLD">Hold for follow-up</option>
                <option value="RETURN">Return unused input</option>
                <option value="SCRAP">Scrap with reason</option>
              </select>
            </label>
          ) : null}
          <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Reason (short close, material exception, unused input)" aria-label="Close reason" />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={mutation.isPending || !supervisor || !state.qc.ready || state.draft_count > 0}
              onClick={() =>
                mutation.mutate(async () => {
                  const result = await entryApi.close(
                    card.id,
                    stage,
                    stableCommand({
                      expected_version: state.row_version,
                      supervisor_id: supervisor,
                      reel_issue_ids: stage === "WINDER" ? reelLinks : [],
                      fg_item_id: stage === "PACKING" ? fgItem || null : null,
                      location_id: location || null,
                      short_close: state.accepted_total < state.target,
                      residual_disposition: residual,
                      reason: closeReason,
                    }),
                  )
                  setPanel("")
                  setNotice(`${label(stage)} closed.`)
                  return result
                })
              }
            >
              Confirm close
            </Button>
            <Button variant="ghost" onClick={() => setPanel("")}>
              Cancel
            </Button>
          </div>
          {!state.qc.ready ? <p className="text-xs text-signal-amber-ink">QC readings are still missing for this stage (see “Before this stage can close”).</p> : null}
        </section>
      ) : null}

      {panel === "whole" ? <WholeCardEntryForm card={card} flow={flow.data} onDone={() => setPanel("")} /> : null}

      {canSubmit ? <JobCardShortagePanel key={card.id} card={card} flow={flow.data} /> : null}

      {effects.data?.length > 0 ? (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Stock postings · {flow.data.pending_effects} pending</summary>
          {effects.data.map((e: any) => (
            <div key={e.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <div>
                <p>
                  {label(e.stage || "")} · {e.kind.replaceAll("_", " ")} · {e.status}
                </p>
                {e.last_error ? <p className="text-destructive">{e.last_error}</p> : null}
                <p className="text-xs text-muted-foreground">
                  Attempts {e.attempts}
                  {e.status === "FAILED" ? ` · Next automatic retry ${seasonTimestamp(e.next_attempt_at)}` : ""}
                </p>
              </div>
              {canSubmit && e.status === "FAILED" ? (
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate(async () => {
                      const r = await entryApi.retryEffect(card.id, e.id, stableCommand({ expected_version: e.attempts, reason: "Supervisor requested retry after reviewing posting failure" }))
                      await effects.refetch()
                      return r
                    })
                  }
                >
                  Retry posting
                </Button>
              ) : null}
            </div>
          ))}
        </details>
      ) : null}

      <ResidualWipPanel
        rows={flow.data.residual_wip}
        canResolve={canSubmit}
        busy={mutation.isPending}
        onResolve={(row, disposition, reason) => mutation.mutate(() => entryApi.resolveResidual(card.id, row.id, stableCommand({ expected_version: row.row_version, disposition, reason })))}
      />

      {parameters.length ? (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">{label(stage)} QC limits on this card</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {parameters.map((r: any) => (
              <div key={r.code} className="rounded-lg border border-border p-3 text-sm">
                <strong>{r.label}</strong>
                <p>
                  {allowedText(r)} · {r.min_readings} samples
                </p>
                <p className="text-xs text-muted-foreground">{r.overlay_id ? `Customer/spec overlay v${r.overlay_version}` : `Global ${seasonLabel(flow.data.season)} v${profile?.provenance?.rule_set_version}`}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
