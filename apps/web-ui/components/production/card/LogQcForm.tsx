"use client"

// Log QC: readings for one run (or "QC without a run"), typed by the operator or anyone on the floor.
// At least 2 readings per required check (moisture optional); a reading outside the band is allowed
// and FLAGGED — it never holds the run (client 2026-10-27). Changing readings already recorded needs
// a reason; adding more does not. Instrument evidence is asked for where the check requires it.
// Readings typed are kept on the device per card, stage and run until saved (client 2026-10-28).

import { CheckCircle2, Clock3, Flag, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { InstrumentFields } from "../InstrumentFields"
import { SeasonQcMatrix, readingVerdict, sampleBand } from "../SeasonQcMatrix"
import { useCardMasters, useCardMutation, useEntryApi, useStableCommand, useStageEntries } from "./data"
import { DraftRestoredBar, draftKey, useFormDraft } from "./draft"
import { FormStageTabs, fieldLabel, type StageTab } from "./EntrySheet"
import { bandText, dayLabel, filledSamples, flagText, fmt, neededText, padSamples, runNo, runQcState, shiftLabel, shortChecks, stageLabel, stageParameters, toneClass, useCardRoles } from "./model"

export type SavedQc = { entry: any; stage: string; flagged: boolean }

/** Tabs for the QC form: stages with QC checks on this card; the others say why they have none. */
export function qcStageTabs(card: any, stages: any[]): StageTab[] {
  return stages
    .filter((s: any) => !["SLITTING", "DISPATCH"].includes(s.stage))
    .map((s: any) => {
      const checks = stageParameters(card, s.stage).length
      return {
        stage: s.stage,
        status: s.status,
        good: s.accepted_total,
        target: s.target,
        unit: s.unit,
        badge: s.qc_flagged_runs ? `${s.qc_flagged_runs} flagged` : undefined,
        disabled: !checks ? (s.stage === "QC" ? "Process QC is the final QC" : "No QC checks on this stage") : undefined,
      }
    })
}

export function LogQcForm({
  card,
  stages,
  stage,
  onStage,
  entryId,
  onSaved,
  onCancel,
}: {
  card: any
  stages: any[]
  stage: string
  onStage?: (stage: string) => void
  /** Run preselected (from the run list or straight after Log output); "none" = QC without a run. */
  entryId?: string | null
  onSaved?: (saved: SavedQc) => void
  onCancel?: () => void
}) {
  const entryApi = useEntryApi(card)
  const { canQc } = useCardRoles()
  const { machineName } = useCardMasters(card)
  const { mutation, error, setError } = useCardMutation(String(card.id))
  const { stableCommand, reset } = useStableCommand()
  const listing = useStageEntries(card, stage, 0)
  const state = stages.find((s: any) => s.stage === stage)
  const parameters = useMemo(() => stageParameters(card, stage), [card, stage])
  // Drafts take QC too: the operator logs the run and its readings in one go; the supervisor submits later.
  const runs: any[] = useMemo(() => (listing.data?.entries || []).filter((e: any) => ["SUBMITTED", "DRAFT"].includes(e.status) && e.kind !== "QC_ONLY"), [listing.data])
  const waiting = runs.filter((e: any) => !runQcState(card, e).accepted)
  const [runId, setRunId] = useState<string>(entryId || "")
  const [samples, setSamples] = useState<any[]>([])
  const [instrument, setInstrument] = useState<any>({})
  const [correction, setCorrection] = useState("")
  const [remark, setRemark] = useState("")
  const [saved, setSaved] = useState<SavedQc | null>(null)
  const run = runId && runId !== "none" ? runs.find((e: any) => e.id === runId) : null
  const picked = runId === "none" || Boolean(run)
  // Device draft for this run (or "QC without a run"): readings, instrument, reason and remark.
  const baseline = useRef("[]")
  const typedJson = JSON.stringify(filledSamples(samples))
  const draft = useFormDraft(picked ? draftKey("qc", card.id, stage, runId) : null, { samples, instrument, correction, remark }, !saved && (typedJson !== baseline.current || Boolean(correction.trim() || remark.trim())))
  const startValues = () => {
    setSamples(padSamples(run?.samples || [], parameters))
    setInstrument(run?.details?.instrument || {})
    setCorrection("")
    setRemark("")
  }

  useEffect(() => {
    setRunId(entryId || "")
    setSaved(null)
    setError("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, entryId, card.id])
  // Nothing chosen yet (or a link named a run that is voided / not on this stage): start on the run that is
  // waiting for QC — the floor's usual case; it can be changed.
  useEffect(() => {
    if (saved || listing.isLoading) return
    const known = runId === "none" || runs.some((e: any) => e.id === runId)
    if (!known && waiting.length) setRunId(waiting[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.data, stage])
  useEffect(() => {
    baseline.current = JSON.stringify(filledSamples(run?.samples || []))
    startValues()
    const typed: any = picked ? draft.restore() : null
    if (typed) {
      if (Array.isArray(typed.samples)) setSamples(padSamples(typed.samples, parameters))
      setInstrument(typed.instrument || {})
      setCorrection(typed.correction || "")
      setRemark(typed.remark || "")
    }
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, runId, stage])

  const filled = filledSamples(samples)
  const short = shortChecks(parameters, filled)
  const priorSamples: any[] = run?.samples || []
  const onlyAdded =
    priorSamples.length > 0 &&
    priorSamples.every((old: any) => {
      const now = filled.find((sample: any) => sample.sample_id === old.sample_id)
      return now && Object.entries(old.readings || {}).every(([code, value]) => value === "" || value == null || String(now.readings?.[code]) === String(value))
    })
  const needsInstrument = parameters.some((p: any) => p.requires_instrument)
  const missing = [
    !picked ? "the run (or QC without a run)" : "",
    picked && !filled.length ? "at least one reading" : "",
    filled.length && short.length ? `2 readings for ${short.map((rule: any) => rule.label).join(", ")}` : "",
    priorSamples.length && !onlyAdded && !correction.trim() ? "the reason for changing readings" : "",
    needsInstrument && filled.length && !String(instrument?.instrument_id || "").trim() ? "the instrument ID" : "",
  ].filter(Boolean)
  // Readings outside their band, in words ("I.D. 76.9 mm (band 76.2–76.5) · S2"): they save and flag the run.
  const outOfBand = useMemo(() => {
    const rows: string[] = []
    for (const rule of parameters) {
      samples.forEach((sample: any, index: number) => {
        const value = sample.readings?.[rule.code]
        if (readingVerdict(rule, value, sample.readings || {}) !== "fail") return
        const band = sampleBand(rule, sample.readings || {})
        const round = (n: number | null) => (n == null ? null : Number(n.toFixed(3)))
        rows.push(`${rule.label} ${value}${rule.unit ? ` ${rule.unit}` : ""} (band ${bandText(round(band.min), round(band.max))}) · S${index + 1}`)
      })
    }
    return rows
  }, [parameters, samples])

  const save = () => {
    const reason = [correction.trim(), remark.trim()].filter(Boolean).join(" · ")
    mutation.mutate(async () => {
      const result = run
        ? await entryApi.observations(card.id, run.id, stableCommand({ samples: filled, instrument, expected_version: run.row_version, reason }))
        : await entryApi.create(card.id, stableCommand({ stage, kind: "QC_ONLY", quantity_mode: "DELTA", expected_version: state?.row_version, samples: filled, details: { instrument, qc_remark: remark.trim() || undefined }, reason, submit: true }))
      const savedEntry = result?.data?.entry
      const done = { entry: savedEntry, stage, flagged: Boolean(savedEntry?.qc_flagged || savedEntry?.evaluation?.verdict === "FAIL") }
      draft.clear()
      setSaved(done)
      onSaved?.(done)
      return result
    })
  }
  const errorShown = error

  const tabs = qcStageTabs(card, stages)
  const stageTabs = onStage ? <FormStageTabs tabs={tabs} value={stage} onChange={onStage} /> : null
  const runLine = (e: any) => `${dayLabel(e.business_date)} · ${shiftLabel(e.shift_code)}${e.machine_id ? ` · ${machineName(e.machine_id)}` : ""} · ${fmt(e.accepted)} ${state?.unit || ""} good`

  if (saved) {
    const e = saved.entry || {}
    const flags: any[] = e.qc_flags || []
    const stillWaiting = runs.filter((r: any) => r.id !== e.id && !runQcState(card, r).accepted)
    return (
      <div className="space-y-4" data-testid="log-qc-saved">
        <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
          <span className={cn("grid h-14 w-14 place-items-center rounded-full", saved.flagged ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-emerald-soft text-signal-emerald-ink")}>
            {saved.flagged ? <Flag className="h-8 w-8" aria-hidden="true" /> : <CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
          </span>
          <p className="text-[19px] font-bold tracking-tight">
            QC saved · {e.kind === "QC_ONLY" ? "without a run" : `run ${runNo(e)}`} · {saved.flagged ? "flagged" : "all in band"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {card.job_card_no} · {stageLabel(saved.stage)} · {(e.samples || []).length} sample{(e.samples || []).length === 1 ? "" : "s"}
          </p>
        </div>
        {flags.length ? (
          <div className={cn("rounded-xl border px-3 py-2.5 text-[13px]", toneClass("amber"))} data-testid="log-qc-flags">
            <p className="flex items-center gap-1.5 font-semibold">
              <Flag className="h-4 w-4" aria-hidden="true" /> Flagged, not held
            </p>
            <ul className="mt-1 space-y-0.5">
              {flags.map((flag: any, index: number) => (
                <li key={`${flag.sample_id}-${flag.parameter}-${index}`}>{flagText(flag)}</li>
              ))}
            </ul>
            <p className="mt-1 opacity-90">The run is accepted; the flag shows on the card, the order and Quality › QC flags.</p>
          </div>
        ) : null}
        <p className={cn("rounded-lg border px-3 py-2 text-[13px]", stillWaiting.length ? toneClass("amber") : toneClass("emerald"))}>
          {stillWaiting.length ? (
            <>
              <Clock3 className="mr-1 inline h-4 w-4" aria-hidden="true" /> Still waiting for QC on {stageLabel(saved.stage)}: {stillWaiting.map((r: any) => runNo(r)).join(", ")}
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-1 inline h-4 w-4" aria-hidden="true" /> Nothing else waiting for QC on {stageLabel(saved.stage)}.
            </>
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {stillWaiting.length ? (
            <Button size="lg" className="h-12" onClick={() => { setSaved(null); setRunId(stillWaiting[0].id) }} data-testid="log-qc-next-waiting">
              <CheckCircle2 className="h-4 w-4" /> QC for run {runNo(stillWaiting[0])}
            </Button>
          ) : null}
          <Button size="lg" variant="outline" className="h-12" onClick={() => { setSaved(null); setRunId("") }} data-testid="log-qc-another">
            <Plus className="h-4 w-4" /> Log another QC
          </Button>
          <Button size="lg" variant="ghost" className="h-12 sm:col-span-2" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="log-qc-form">
      {stageTabs}
      {!state ? <p className="text-sm text-muted-foreground">Pick a stage.</p> : null}
      {state && !parameters.length ? <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{stageLabel(stage)} has no QC checks on this card.</p> : null}
      {state && parameters.length && !canQc ? <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">Your role can view QC but not record it.</p> : null}

      {state && parameters.length && canQc ? (
        <>
          <div>
            <span className={fieldLabel}>Run at {stageLabel(stage)}</span>
            {listing.isLoading ? <p className="text-[13px] text-muted-foreground">Loading runs…</p> : null}
            <div className="space-y-1.5" role="radiogroup" aria-label="Run">
              {[...waiting, ...runs.filter((e: any) => runQcState(card, e).accepted)].map((e: any) => {
                const qc = runQcState(card, e)
                const on = runId === e.id
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRunId(e.id)}
                    data-testid={`log-qc-run-${e.entry_no}`}
                    className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition", on ? "border-primary bg-primary/[.06] shadow-[0_0_0_3px_hsl(var(--primary)/.08)]" : "border-border bg-card hover:bg-muted")}
                  >
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", qc.accepted ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-amber-soft text-signal-amber-ink")}>
                      {qc.accepted ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock3 className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">
                        Run {runNo(e)}
                        {e.status === "DRAFT" ? <span className={cn("ml-1.5 rounded-full border px-1.5 text-[10.5px] font-semibold", toneClass("amber"))} title="Saved by the operator; waiting for the supervisor to submit">with supervisor</span> : null}
                        {e.operator_name ? <span className="font-normal text-muted-foreground"> · {e.operator_name}</span> : null}
                      </span>
                      <span className="block truncate text-[12px] text-muted-foreground">{runLine(e)}</span>
                    </span>
                    <span className={cn("inline-flex max-w-[45%] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold", toneClass(qc.tone))} title={[qc.label, qc.detail].filter(Boolean).join(" — ")}>
                      {qc.flags.length ? <Flag className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                      <span className="truncate">{qc.flags.length ? "Flagged" : qc.key === "short" ? "Needs more readings" : qc.key === "draft" ? (e.samples?.length ? "QC recorded" : "QC due") : qc.label}</span>
                    </span>
                  </button>
                )
              })}
              {!listing.isLoading && runs.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">No runs on {stageLabel(stage)} yet — log the output first, or pick QC without a run.</p> : null}
              {state.status !== "COMPLETED" ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={runId === "none"}
                  onClick={() => setRunId("none")}
                  data-testid="log-qc-run-none"
                  className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition", runId === "none" ? "border-primary bg-primary/[.06] shadow-[0_0_0_3px_hsl(var(--primary)/.08)]" : "border-dashed border-border bg-card hover:bg-muted")}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-signal-violet-soft text-signal-violet-ink">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">QC without a run</span>
                    <span className="block text-[12px] text-muted-foreground">a check between runs, start of shift, or on held pieces</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>

          <DraftRestoredBar
            savedAt={draft.restoredAt}
            onDiscard={() => {
              draft.discard()
              startValues()
            }}
            testId="log-qc-draft"
          />
          {picked ? (
            <fieldset className="space-y-3 rounded-xl border border-border bg-muted/30 p-3" data-testid="log-qc-readings">
              <legend className="px-1 text-[12.5px] font-semibold text-muted-foreground">
                Readings · {run ? `run ${runNo(run)}` : "no run"} · {stageLabel(stage)}
              </legend>
              <SeasonQcMatrix rules={parameters} samples={samples} onChange={setSamples} stageLabel={stageLabel(stage)} flagNote={false} />
              {needsInstrument ? <InstrumentFields value={instrument} onChange={setInstrument} /> : null}
              {outOfBand.length ? (
                <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", toneClass("amber"))} data-testid="log-qc-will-flag">
                  <Flag className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <b>Outside the band:</b> {outOfBand.join(" · ")}. It still saves — the {run ? "run" : "check"} is <b>flagged</b>, not held, and the next stage can take it. Add another sample if you want a second reading beside it.
                  </span>
                </p>
              ) : null}
              <p className="text-[12px] text-muted-foreground">At least 2 readings per check (moisture optional); use “Add another sample” for more. The next stage takes this run once its QC is recorded, and the stage closes once it has 2 readings per check.</p>
              {priorSamples.length && !onlyAdded ? (
                <label className="block text-sm">
                  Why are recorded readings changed? <span className="text-muted-foreground">(required — adding new readings needs no reason)</span>
                  <Input aria-label="Entry reason" className="mt-1 h-11 min-h-11" value={correction} onChange={(e) => setCorrection(e.target.value)} data-testid="log-qc-correction" />
                </label>
              ) : null}
              <label className="block">
                <span className={fieldLabel}>
                  Remark <span className="font-normal">(optional — what you saw, in plain words)</span>
                </span>
                <textarea className="min-h-[4.5rem] w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px]" value={remark} onChange={(e) => setRemark(e.target.value)} data-testid="log-qc-remark" />
              </label>
            </fieldset>
          ) : null}

          {errorShown ? (
            <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink" data-testid="log-qc-error">
              {errorShown}
            </p>
          ) : null}

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 space-y-2 border-t border-border bg-card px-4 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-5 sm:px-5">
            {missing.length ? (
              <p className="text-[12.5px] text-muted-foreground" data-testid="log-qc-missing">
                {neededText(missing)}
              </p>
            ) : (
              <p className={cn("flex items-center gap-1.5 text-[12.5px]", outOfBand.length ? "font-medium text-signal-amber-ink" : "text-muted-foreground")} data-testid="log-qc-ready">
                {outOfBand.length ? <Flag className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5 text-signal-emerald-ink" aria-hidden="true" />}
                {outOfBand.length ? `Saves with ${outOfBand.length} flagged reading${outOfBand.length === 1 ? "" : "s"} — not held.` : "All readings in band."}
              </p>
            )}
            <div className="flex gap-2">
              {onCancel ? (
                <Button size="lg" variant="outline" className="h-12 shrink-0 px-4" onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              <Button size="lg" className="h-12 min-w-0 flex-1" disabled={mutation.isPending || missing.length > 0} onClick={save} data-testid="log-qc-save">
                {mutation.isPending ? "Saving…" : outOfBand.length && !missing.length ? "Save QC · flagged" : "Save QC"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
