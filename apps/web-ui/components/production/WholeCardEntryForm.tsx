"use client"

// Typing a printed card after all its stages were written: the card's running totals per stage.
// Only what is new since the last entry is posted, and all ticked stages save together or not at all.
// A stage whose runs were already logged can be closed here with the card's readings (nothing new is
// posted); the Process count (bamboo × pcs) is shown and flagged but never stops the save (client
// 2026-10-28). What is typed is kept on the device until the card is saved. Reasons are codes from Masters ›
// Reason codes (owner decision 4, 1 Nov 2026): rejects / cutting loss, over +10%, closing short and input left
// over each have their own list, shown only when a ticked stage needs it.

import { Flag } from "lucide-react"
import { InstrumentFields } from "./InstrumentFields"
import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { EMPTY_REASON, ReasonPicker, useReasonChoice } from "@/components/reasons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { command, entryApiForPlant, errorText } from "@/lib/season-api"
import { SeasonQcMatrix } from "./SeasonQcMatrix"
import { DraftRestoredBar, draftKey, useFormDraft } from "./card/draft"
import { reasonDetailKeys, stageOperators, toneClass } from "./card/model"
import { istToday, shiftBusinessDate, shiftSlotNow } from "@/lib/shift"

const selectClass = "h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px]"
const label = (s: string) => (s === "WINDER" ? "Winding" : s === "QC" ? "Final QC" : s.charAt(0) + s.slice(1).toLowerCase())
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
const rulesFor = (card: any, stage: string) => (card.spec_snapshot?.qc_profile?.stages?.[stage]?.parameters || []).filter((p: any) => p.applicable)
const requiredSamples = (card: any, stage: string) => Math.max(2, ...rulesFor(card, stage).map((p: any) => Number(p.min_readings) || 2))
// Date and shift default from the clock by the shift rule, in India time (01:30 IST is Shift B of yesterday).
const clockShift = (): string => shiftSlotNow().shift
const clockDate = () => shiftSlotNow().date

export function WholeCardEntryForm({ card, flow, onDone }: { card: any; flow: any; onDone: () => void }) {
  const entryApi = entryApiForPlant(card.plant_id)
  const cache = useQueryClient()
  const employees = useQuery({ queryKey: ["continuous-employees", card.plant_id], queryFn: async () => (await entryApi.employees()).data })
  const items = useQuery({ queryKey: ["continuous-items", card.plant_id], queryFn: async () => (await entryApi.items()).data })
  const [businessDate, setDate] = useState(clockDate())
  const [shift, setShift] = useState(clockShift())
  const rejectReason = useReasonChoice("SCRAP", card.plant_id)
  const overReason = useReasonChoice("OVERRIDE", card.plant_id)
  const shortReason = useReasonChoice("STAGE_SHORT_CLOSE", card.plant_id)
  const leftoverReason = useReasonChoice("LEFTOVER_INPUT", card.plant_id)
  const reasonValues = { reject: rejectReason.value, over: overReason.value, short: shortReason.value, leftover: leftoverReason.value }
  const anyReasonTyped = Object.values(reasonValues).some((v) => Boolean(v.code || v.note.trim()))
  const [fgItem, setFgItem] = useState("")
  const [error, setError] = useState("")
  const stages = flow.stages.map((s: any) => s.stage)
  // The form as it opens with nothing typed (also what Discard on the draft bar returns to).
  const freshRows = () =>
    flow.stages
      // Packing and Final QC are system steps closed with Process (client rule 2026-10-18); an older
      // card already packing on the floor keeps its Packing row.
      .filter((s: any) => s.status !== "COMPLETED" && !["SLITTING", "DISPATCH", "QC"].includes(s.stage) && !(s.stage === "PACKING" && s.system_step))
      .map((s: any) => ({
        ...s,
        include: false,
        close: false,
        instrument: {},
        operator: "",
        produced: "",
        rejected: "",
        input: "",
        loss: "",
        segment: s.segments?.filter((v: any) => !["CANCELLED", "COMPLETED"].includes(v.status))[0]?.id || "",
        samples: Array.from({ length: requiredSamples(card, s.stage) }, () => ({ sample_id: crypto.randomUUID(), readings: {} })),
      }))
  const [rows, setRows] = useState<any[]>(freshRows)
  const pending = useRef<{ fingerprint: string; body: any } | null>(null)
  // Device draft of the whole form (card): what was ticked and typed per stage.
  const DRAFT_FIELDS = ["include", "close", "operator", "produced", "rejected", "input", "loss", "segment", "samples", "instrument"] as const
  const typed = { businessDate, shift, reasons: reasonValues, fgItem, rows: rows.map((r) => ({ stage: r.stage, ...Object.fromEntries(DRAFT_FIELDS.map((k) => [k, r[k]])) })) }
  const draft = useFormDraft(draftKey("whole", card.id), typed, rows.some((r) => r.include) || anyReasonTyped)
  useEffect(() => {
    const saved: any = draft.restore()
    if (!saved) return
    if (saved.businessDate) setDate(saved.businessDate)
    if (saved.shift) setShift(saved.shift)
    const restore = (choice: { setValue: (v: any) => void }, value: any) => {
      if (value && typeof value === "object" && (value.code || value.note)) choice.setValue({ ...EMPTY_REASON, ...value })
    }
    restore(rejectReason, saved.reasons?.reject)
    restore(overReason, saved.reasons?.over)
    restore(shortReason, saved.reasons?.short)
    restore(leftoverReason, saved.reasons?.leftover)
    setFgItem(saved.fgItem || "")
    setRows((current) =>
      current.map((r) => {
        const old = (saved.rows || []).find((row: any) => row.stage === r.stage)
        return old ? { ...r, ...Object.fromEntries(DRAFT_FIELDS.filter((k) => old[k] !== undefined).map((k) => [k, old[k]])) } : r
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const update = (index: number, key: string, value: any) => setRows((current) => current.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  // Oven and Packing take exactly what they made from the stage before; Process takes bamboo and makes pieces.
  const previous = (stage: string) => stages[stages.indexOf(stage) - 1]
  const inputFollowsOutput = (stage: string) => stage !== "PROCESS" && Boolean(previous(stage)) && previous(stage) !== "SLITTING"
  const goodOf = (r: any) => Math.max(0, Number(r.produced || 0) - Number(r.rejected || 0))
  const inputTotalOf = (r: any) => (inputFollowsOutput(r.stage) ? Number(r.produced || 0) : Number(r.input || 0))
  // Process count on the card's totals: bamboo × pcs per bamboo against made + cutting loss.
  const countOf = (r: any) => {
    const pcs = Number(r.pcs_per_bamboo || 0)
    if (r.stage !== "PROCESS" || !pcs || r.input === "" || r.produced === "") return null
    const possible = Number(r.input) * pcs
    const counted = Number(r.produced) + Number(r.loss || 0)
    return { pcs, possible, counted, gap: possible - counted }
  }
  // Closing with input from the stage before left over (not taken) needs a reason, as in the close dialog.
  const leftoverOf = (r: any) => {
    const prev = previous(r.stage)
    if (!r.close || !prev || prev === "SLITTING") return 0
    const prevRow = rows.find((row) => row.stage === prev && row.include)
    const prevGood = prevRow ? goodOf(prevRow) : Number(flow.stages.find((s: any) => s.stage === prev)?.accepted_total || 0)
    return Math.max(0, prevGood - inputTotalOf(r))
  }
  const action = useMutation({
    mutationFn: (body: any) => entryApi.batch(card.id, body),
    onError: (e) => setError(errorText(e)),
    onSuccess: async () => {
      draft.clear()
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["continuous-flow", card.id] }),
        cache.invalidateQueries({ queryKey: ["continuous-entries", card.id] }),
        cache.invalidateQueries({ queryKey: ["planning-job-card", card.id] }),
      ])
      onDone()
    },
  })
  // Which reasons a ticked stage needs (the server asks the same: the difference since the last entry for rejects/loss).
  const needsReject = (r: any) => Number(r.rejected || 0) - Number(r.rejected_total || 0) > 0 || Number(r.loss || 0) - Number(r.cutting_loss_total || 0) > 0
  const needsOver = (r: any) => Number(r.produced || 0) > Number(r.target || 0) * 1.1
  const closesShort = (r: any) => Boolean(r.close) && goodOf(r) < r.target
  const submit = () => {
    const body = {
      steps: rows
        .filter((r) => r.include)
        .map((r) => ({
          entry: {
            request_id: `whole-card-${r.stage}`,
            stage: r.stage,
            quantity_mode: "TOTAL",
            expected_version: r.row_version,
            submit: true,
            business_date: businessDate,
            shift_code: shift,
            // Each stage names its own operator, from that stage's department (owner decision 7, 1 Nov 2026).
            operator_id: r.operator || null,
            segment_id: r.segment || null,
            produced: Number(r.produced),
            accepted: goodOf(r),
            input_quantity: inputTotalOf(r),
            cutting_loss_pcs: Number(r.loss || 0),
            samples: r.samples
              .filter((s: any) => Object.values(s.readings).some((v) => v !== "" && v != null))
              .map((s: any) => ({ ...s, readings: Object.fromEntries(Object.entries(s.readings).filter(([, v]) => v !== "" && v != null)) })),
            reason: [needsReject(r) ? rejectReason.text : "", needsOver(r) ? overReason.text : ""].filter(Boolean).join(" · "),
            details: {
              ...(needsReject(r) ? reasonDetailKeys("reject_reason", "reject_code", "reject_note", rejectReason) : {}),
              ...(needsOver(r) ? reasonDetailKeys("overproduction_reason", "overproduction_reason_code", "overproduction_reason_note", overReason) : {}),
              instrument: r.instrument,
            },
          },
          close: r.close
            ? {
                request_id: `whole-close-${r.stage}`,
                expected_version: r.row_version + 1,
                short_close: goodOf(r) < r.target,
                residual_disposition: "HOLD",
                ...(closesShort(r) ? shortReason.payload("reason") : {}),
                ...(leftoverOf(r) > 0 && leftoverReason.value.code
                  ? { residual_reason_code: leftoverReason.value.code, residual_reason_note: leftoverReason.value.note.trim() || undefined }
                  : {}),
                fg_item_id: r.stage === "PACKING" ? fgItem || null : null,
              }
            : null,
        })),
    }
    const fingerprint = JSON.stringify(body)
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, body: command(body) }
    action.mutate(pending.current.body)
  }
  const selected = rows.filter((r) => r.include)
  const active = (employees.data || []).filter((e: any) => e.active !== false && e.is_active !== false)
  const missing = [
    !selected.length ? "tick at least one stage" : "",
    !shift ? "the shift" : "",
    ...selected.map((r) => (!r.operator ? `${label(r.stage)} operator` : "")),
    ...selected.map((r) => (r.produced === "" ? `${label(r.stage)} output total` : "")),
    ...selected.map((r) => (Number(r.rejected || 0) > Number(r.produced || 0) ? `${label(r.stage)} rejected not more than output` : "")),
    ...selected.map((r) => (r.stage === "PROCESS" && r.input === "" ? "Process bamboo taken total" : "")),
    selected.some(needsReject) && !rejectReason.complete ? "the rejection / cutting loss reason" : "",
    selected.some(needsOver) && !overReason.complete ? "why output is above the target +10%" : "",
    selected.some(closesShort) && !shortReason.complete ? "why a stage closes short" : "",
    selected.some((r) => leftoverOf(r) > 0) && !leftoverReason.complete ? "the reason for the input left over" : "",
  ].filter(Boolean)
  const reasonPickers = [
    selected.some(needsReject) ? { key: "reject", category: "SCRAP", choice: rejectReason, label: "Why rejected or lost in cutting?" } : null,
    selected.some(needsOver) ? { key: "override", category: "OVERRIDE", choice: overReason, label: "Why is output above the target +10%?" } : null,
    selected.some(closesShort) ? { key: "short", category: "STAGE_SHORT_CLOSE", choice: shortReason, label: "Why does it close short?" } : null,
    selected.some((r) => leftoverOf(r) > 0) ? { key: "leftover", category: "LEFTOVER_INPUT", choice: leftoverReason, label: "Why is input left over (held)?" } : null,
  ].filter(Boolean) as { key: string; category: string; choice: ReturnType<typeof useReasonChoice>; label: string }[]

  return (
    <section className="space-y-5 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-5" data-testid="whole-card-form">
      <DraftRestoredBar
        savedAt={draft.restoredAt}
        onDiscard={() => {
          // Discard empties what was typed and keeps the form open, as in Log output, Log QC and Close stage.
          draft.discard()
          setDate(clockDate())
          setShift(clockShift())
          rejectReason.reset()
          overReason.reset()
          shortReason.reset()
          leftoverReason.reset()
          setFgItem("")
          setError("")
          pending.current = null
          setRows(freshRows())
        }}
        testId="whole-card-draft"
      />
      {/* The sheet around this form carries the title "Enter the whole printed card"; no second heading here. */}
      <div>
        <p className="text-sm text-muted-foreground">
          Tick each stage written on the card and type the card&apos;s totals. Only what is new since the last entry is posted; all ticked stages save together or none do.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="text-sm">
          Date
          <Input type="date" className="h-11 min-h-11" value={businessDate} max={istToday()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="text-sm">
          Shift
          <div className="mt-0.5 grid grid-cols-2 overflow-hidden rounded-lg border border-border" role="group" aria-label="Shift">
            {["SHIFT_A", "SHIFT_B"].map((code) => (
              <button key={code} type="button" aria-pressed={shift === code} onClick={() => { if (businessDate === shiftBusinessDate(shift)) setDate(shiftBusinessDate(code)); setShift(code) }} className={cn("min-h-11 text-[15px] font-semibold", shift === code ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>
                {code.replace("SHIFT_", "Shift ")}
              </button>
            ))}
          </div>
        </div>

      </div>

      {rows.map((r, index) => {
        const rules = rulesFor(card, r.stage)
        const addOutput = Number(r.produced || 0) - Number(r.produced_total || 0)
        const addGood = goodOf(r) - Number(r.accepted_total || 0)
        return (
          <fieldset key={r.stage} className={cn("space-y-3 rounded-lg border p-3 sm:p-4", r.include ? "border-primary/40" : "border-border")}>
            <legend className="px-1 text-sm font-semibold">
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={r.include} onChange={(e) => update(index, "include", e.target.checked)} />
                {label(r.stage)}
                <span className="font-normal text-muted-foreground">
                  · so far {fmt(r.accepted_total)} / {fmt(r.target)} {r.unit}
                </span>
              </label>
            </legend>
            {r.include ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <label className="col-span-2 text-sm sm:col-span-1">
                    Operator
                    <select className={selectClass} value={r.operator || ""} onChange={(e) => update(index, "operator", e.target.value)} aria-label={`${label(r.stage)} operator`} data-testid={`whole-card-operator-${r.stage}`}>
                      <option value="">{stageOperators(active, r.stage).length ? "Choose operator" : `No ${label(r.stage)} employee in Masters`}</option>
                      {stageOperators(active, r.stage).map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {e.employee_code ? ` · ${e.employee_code}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {r.stage === "PROCESS" ? (
                    <label className="text-sm">
                      Bamboo taken total
                      <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11 text-lg" value={r.input} onChange={(e) => update(index, "input", e.target.value)} />
                    </label>
                  ) : null}
                  <label className="text-sm">
                    Output total ({r.unit})
                    <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11 text-lg" value={r.produced} onChange={(e) => update(index, "produced", e.target.value)} aria-label={`${label(r.stage)} produced total`} />
                  </label>
                  <label className="text-sm">
                    Rejected total
                    <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11 text-lg" value={r.rejected} onChange={(e) => update(index, "rejected", e.target.value)} aria-label={`${label(r.stage)} rejected total`} />
                  </label>
                  {r.stage === "PROCESS" ? (
                    <label className="text-sm">
                      Cutting loss total pcs
                      <Input inputMode="numeric" type="number" min="0" step="1" className="h-11 min-h-11" value={r.loss} onChange={(e) => update(index, "loss", e.target.value)} />
                    </label>
                  ) : null}
                  {(r.segments || []).filter((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status)).length > 1 ? (
                    <label className="col-span-2 text-sm sm:col-span-1">
                      Planned slot
                      <select className={selectClass} value={r.segment} onChange={(e) => update(index, "segment", e.target.value)}>
                        {(r.segments || [])
                          .filter((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status))
                          .map((s: any) => (
                            <option key={s.id} value={s.id}>
                              {s.plan_date} · {s.shift_code?.replace("SHIFT_", "Shift ")}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground" data-testid={`whole-card-delta-${r.stage}`}>
                  Good total <strong className="text-foreground">{fmt(goodOf(r))} {r.unit}</strong> · this adds {fmt(addOutput)} output, {fmt(addGood)} good
                  {inputFollowsOutput(r.stage) && r.produced !== "" ? ` · takes ${fmt(r.produced)} from ${label(previous(r.stage))} in total` : ""}
                  {r.produced !== "" && addOutput === 0 && addGood === 0 && Number(r.produced_total || 0) > 0 ? " · same as already logged: only the readings and the close are saved" : ""}
                </p>
                {(() => {
                  const count = countOf(r)
                  if (!count) return null
                  return (
                    <p className={cn("flex items-start gap-1.5 rounded-lg border px-3 py-2 text-sm", count.gap ? toneClass("amber") : "border-border bg-muted/40 text-muted-foreground")} data-testid={`whole-card-count-${r.stage}`}>
                      {count.gap ? <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                      <span>
                        {fmt(r.input)} bamboo × {fmt(count.pcs)} pcs = <b>{fmt(count.possible)} pcs</b>
                        {count.gap
                          ? ` · the card counts ${fmt(count.counted)} pcs (${fmt(r.produced)} made${Number(r.loss || 0) ? ` + ${fmt(r.loss)} cutting loss` : ""}) — ${count.gap > 0 ? `${fmt(count.gap)} pcs short` : `${fmt(-count.gap)} pcs more than the bamboo can give`}. It still saves and the run is flagged; nothing has to be written for it.`
                          : " · all pieces accounted for"}
                      </span>
                    </p>
                  )
                })()}
                {leftoverOf(r) > 0 ? (
                  <p className={cn("rounded-lg border px-3 py-2 text-sm", toneClass("amber"))} data-testid={`whole-card-leftover-${r.stage}`}>
                    {fmt(leftoverOf(r))} {flow.stages.find((s: any) => s.stage === previous(r.stage))?.unit || ""} from {label(previous(r.stage))} would be left over when {label(r.stage)} closes: they are held for follow-up with the reason chosen below.
                  </p>
                ) : null}
                {rules.length > 0 ? (
                  <div className="rounded-xl border border-border bg-muted/30 p-3">
                    <SeasonQcMatrix rules={rules} samples={r.samples} onChange={(v) => update(index, "samples", v)} stageLabel={label(r.stage)} />
                  </div>
                ) : null}
                {rules.some((p: any) => p.requires_instrument) ? <InstrumentFields value={r.instrument} onChange={(v) => update(index, "instrument", v)} /> : null}
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={r.close} onChange={(e) => update(index, "close", e.target.checked)} /> Close {label(r.stage).toLowerCase()} after saving
                </label>
                {r.close && (r.stage === "PROCESS" || r.stage === "PACKING") ? <p className="text-xs text-muted-foreground">Closing {label(r.stage)} completes the job card: its good pieces become finished goods, packing material is consumed from the spec sheet, and Dispatch opens.</p> : null}
                {r.close && r.stage === "PACKING" ? (
                  <label className="block text-sm">
                    Finished-good item (optional)
                    <select className={selectClass} value={fgItem} onChange={(e) => setFgItem(e.target.value)}>
                      <option value="">Automatic — from the order&apos;s product code</option>
                      {(items.data || [])
                        .filter((i: any) => i.type === "FINISHED_GOOD")
                        .map((i: any) => (
                          <option key={i.id} value={i.id}>
                            {i.item_code} · {i.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
          </fieldset>
        )
      })}

      {reasonPickers.length ? (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="whole-card-reasons">
          {reasonPickers.map((p) => (
            <ReasonPicker
              key={p.key}
              category={p.category}
              plantId={card.plant_id}
              rows={p.choice.rows}
              value={p.choice.value}
              onChange={p.choice.setValue}
              showErrors={Boolean(p.choice.value.code)}
              compact
              label={p.label}
              testIdPrefix={`whole-card:${p.key}`}
            />
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {missing.length ? <p className="text-sm text-muted-foreground">Still needed: {missing.join(", ")}.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="min-h-11" disabled={action.isPending || missing.length > 0} onClick={submit}>
          {action.isPending ? "Saving all stages…" : "Save the whole card"}
        </Button>
        <Button size="lg" variant="ghost" className="min-h-11" disabled={action.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
