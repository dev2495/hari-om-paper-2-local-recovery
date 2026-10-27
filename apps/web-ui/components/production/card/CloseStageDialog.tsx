"use client"

// Closing a stage: the plant manager / owner / admin who is logged in confirms the totals; no supervisor is
// picked (client 2026-10-27), the login is recorded as who closed it. Short of target needs a reason,
// unused input needs a disposition, Packing / the completing Process step may name the finished-good item
// and location, Winding may link reel issues. QC must be ready (at least 2 readings per required check on the
// stage — the same rule for a short close) and drafts must be submitted or voided first; the server refuses
// otherwise and its words are shown. Anyone may open this to see what is missing; only those logins confirm.

import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Lock } from "lucide-react"
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useCardMutation, useEntryApi, useStableCommand } from "./data"
import { fieldLabel, selectClass } from "./EntrySheet"
import { fmt, runNo, runsWithoutQc, stageLabel, stageParameters, toneClass, useCardRoles } from "./model"

export function closeBlockedReason(state: any, card?: any): string {
  if (!state) return "No stage to close"
  if (state.status === "COMPLETED") return `${stageLabel(state.stage)} is closed`
  if (!["WINDER", "OVEN", "PROCESS", "PACKING", "QC"].includes(state.stage)) return `${stageLabel(state.stage)} closes by itself`
  if (state.draft_count) return `${state.draft_count} draft${state.draft_count === 1 ? "" : "s"} must be submitted or voided first`
  if (!state.qc?.ready) {
    const words = Object.fromEntries(stageParameters(card, state.stage).map((p: any) => [p.code, p.label]))
    return `QC readings missing: ${(state.qc?.missing || []).map((r: any) => `${words[r.parameter] || r.label} ${r.have}/${r.need}`).join(", ") || "see QC tab"}`
  }
  return ""
}

/** The required checks a stage still needs readings for, in words: "I.D. — 1 of 2 readings". */
export function missingQcLines(state: any, card?: any): string[] {
  // The card's own words for each check (e.g. "Height of bamboo" at Winding), not the rule-set label.
  const words = Object.fromEntries(stageParameters(card, state?.stage).map((p: any) => [p.code, p.label]))
  return (state?.qc?.missing || []).map((r: any) => `${words[r.parameter] || r.label || r.parameter} — ${r.have} of ${r.need} reading${Number(r.need) === 1 ? "" : "s"}`)
}

export function CloseStageDialog({
  card,
  flow,
  stage,
  entries = [],
  open,
  onOpenChange,
  onClosed,
  onLogQc,
}: {
  card: any
  flow: any
  stage: string
  /** The card's runs, to name the ones still without QC. */
  entries?: any[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: (notice: string, completed: boolean) => void
  /** Jump to Log QC on this stage (from the "cannot close yet" note). */
  onLogQc?: (stage: string) => void
}) {
  const entryApi = useEntryApi(card)
  const { canSubmit } = useCardRoles()
  const { mutation, error, setError } = useCardMutation(String(card.id))
  const { stableCommand, reset } = useStableCommand()
  const state = (flow?.stages || []).find((s: any) => s.stage === stage)
  const [closeReason, setCloseReason] = useState("")
  const [fgItem, setFgItem] = useState("")
  const [location, setLocation] = useState("")
  const [reelLinks, setReelLinks] = useState<string[]>([])
  const [residual, setResidual] = useState("HOLD")
  const winderMachine = card.stages?.find((s: any) => s.stage_type === "WINDER")?.machine_id
  const items = useQuery({
    queryKey: ["continuous-items", card.plant_id],
    queryFn: async () => (await entryApi.items()).data,
    enabled: open,
  })
  const locations = useQuery({
    queryKey: ["continuous-locations", card.plant_id],
    queryFn: async () => (await entryApi.locations()).data,
    enabled: open,
  })
  const reelIssues = useQuery({
    queryKey: ["continuous-reel-issues", card.id, winderMachine],
    queryFn: async () => (await entryApi.reelIssues(winderMachine)).data,
    enabled: Boolean(winderMachine && open && stage === "WINDER"),
  })
  useEffect(() => {
    if (open) {
      setError("")
      setCloseReason("")
      setReelLinks([])
      setResidual("HOLD")
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage])
  if (!state) return null
  const short = Number(state.accepted_total) < Number(state.target)
  const completes = state.completes_card || stage === "QC" || stage === "PACKING"
  const blocked = closeBlockedReason(state, card)
  const needsReason = short || Number(state.available_from_upstream) > 0
  const canConfirm = canSubmit && !mutation.isPending && Boolean(state.qc?.ready) && !state.draft_count && (!needsReason || closeReason.trim().length > 0)
  const missingLines = missingQcLines(state, card)
  const unchecked = runsWithoutQc(card, entries, stage).filter((e: any) => e.status === "SUBMITTED")
  const confirmHint = !canSubmit
    ? ""
    : blocked
      ? "The stage can be closed once the note above is cleared."
      : needsReason && !closeReason.trim()
        ? short
          ? "Write why the stage closes short."
          : "Write the reason for the unused input."
        : ""

  const confirm = () =>
    mutation.mutate(async () => {
      const result = await entryApi.close(
        card.id,
        stage,
        stableCommand({
          expected_version: state.row_version,
          reel_issue_ids: stage === "WINDER" ? reelLinks : [],
          fg_item_id: stage === "PACKING" || state.completes_card ? fgItem || null : null,
          location_id: location || null,
          short_close: short,
          residual_disposition: residual,
          reason: closeReason,
        }),
      )
      onOpenChange(false)
      onClosed?.(completes ? `Job card complete: ${fmt(state.accepted_total)} pcs go to finished goods and are ready for dispatch.` : `${stageLabel(stage)} closed${short ? " short" : ""}.`, Boolean(completes))
      return result
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" data-testid="close-stage-dialog">
        <DialogHeader>
          <DialogTitle>{state.completes_card || stage === "QC" ? `Close ${stageLabel(stage)} and complete the job card` : `Close ${stageLabel(stage)}`}</DialogTitle>
          <DialogDescription>
            {fmt(state.accepted_total)} of {fmt(state.target)} {state.unit} good
            {short ? " — closing now is a short close and needs a reason; the balance goes back to the order" : ""}.
          </DialogDescription>
        </DialogHeader>

        {!canSubmit ? (
          <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", toneClass("blue"))} data-testid="close-stage-role">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <b>The plant manager closes the stage.</b> A plant manager, owner or admin login confirms the totals here; no supervisor needs to be picked. You can keep logging runs and QC; this shows what is still needed.
            </span>
          </p>
        ) : null}
        {blocked ? (
          <div className={cn("rounded-lg border px-3 py-2.5 text-[13px]", toneClass("amber"))} data-testid="close-stage-blocked">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <b>Cannot close yet.</b>{" "}
                {[
                  state.draft_count ? `${state.draft_count} draft${state.draft_count === 1 ? "" : "s"} must be submitted or voided first (Output log).` : "",
                  !state.qc?.ready ? `${stageLabel(stage)} needs at least 2 readings per required check before it can close — a short close too.` : "",
                  !state.draft_count && state.qc?.ready ? `${blocked}.` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </span>
            </p>
            {!state.qc?.ready && missingLines.length ? (
              <ul className="mt-1.5 space-y-0.5 pl-6" data-testid="close-stage-missing">
                {missingLines.map((line) => (
                  <li key={line} className="list-disc">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {!state.qc?.ready && onLogQc ? (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  onOpenChange(false)
                  onLogQc(stage)
                }}
                data-testid="close-stage-log-qc"
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> Log QC on {stageLabel(stage)}
              </Button>
            ) : null}
          </div>
        ) : null}
        {unchecked.length && !blocked ? (
          <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", toneClass("amber"))} data-testid="close-stage-unchecked">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              No QC yet on {unchecked.map((e: any) => runNo(e)).join(", ")} ({fmt(unchecked.reduce((n: number, e: any) => n + Number(e.accepted || 0), 0))} {state.unit}). The stage may close, but the next stage takes these only after their QC is
              recorded.
            </span>
          </p>
        ) : null}
        {state.blockers?.some((b: string) => !/short-close reason/i.test(b)) && !blocked ? (
          <ul className="space-y-0.5 rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground" data-testid="close-stage-notes">
            {state.blockers
              .filter((b: string) => !/short-close reason/i.test(b))
              .map((b: string) => (
                <li key={b}>· {b}</li>
              ))}
          </ul>
        ) : null}
        {state.qc?.unrecorded?.length ? (
          <p className={cn("rounded-lg border px-3 py-2 text-[13px]", toneClass("amber"))}>
            Not recorded (optional): {state.qc.unrecorded.map((r: any) => `${r.label} ${r.have}/${r.need}`).join(", ")} — the stage can still close; this is flagged for the owner.
          </p>
        ) : null}

        {state.completes_card ? (
          <div className="rounded-lg border border-primary/25 bg-primary/[.04] p-3 text-sm" data-testid="process-completion-preview">
            <p className="font-semibold">Closing Process completes this card:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                {fmt(state.completion_preview?.fg_qty ?? state.accepted_total)} pcs become finished goods
                {state.completion_preview?.fg_code ? ` (item ${state.completion_preview.fg_code}, created if new)` : ""} and are ready for dispatch.
              </li>
              {Number(state.completion_preview?.packing?.box_count) > 0 ? (
                <li>
                  Packing from the spec sheet is consumed: {fmt(state.completion_preview.packing.box_count)} box
                  {Number(state.completion_preview.packing.box_count) === 1 ? "" : "es"}
                  {state.completion_preview.packing.box_code ? ` ${state.completion_preview.packing.box_code}` : ""} ({fmt(state.completion_preview.packing.qty_per_box)} per box)
                  {Number(state.completion_preview.packing.plastic?.consumed_pcs) > 0
                    ? `, ${fmt(state.completion_preview.packing.plastic.consumed_pcs)} plastic sheet${state.completion_preview.packing.plastic.sku ? ` ${state.completion_preview.packing.plastic.sku}` : ""}`
                    : ""}
                  {Number(state.completion_preview.packing.fadda?.consumed_pcs) > 0
                    ? `, ${fmt(state.completion_preview.packing.fadda.consumed_pcs)} fadda${state.completion_preview.packing.fadda.sku ? ` ${state.completion_preview.packing.fadda.sku}` : ""}`
                    : ""}
                  .
                </li>
              ) : (
                <li className="text-signal-amber-ink">The spec sheet has no Qty / box, so no packing material is posted. Add it on the spec sheet to post boxes, plastic and fadda.</li>
              )}
              <li>Theoretical paper, adhesive and parchment use is posted for the month; it is reconciled with issues and the stock count.</li>
              <li>Process QC is the final QC: there is no separate packing or final QC step.</li>
            </ul>
          </div>
        ) : null}

        {canSubmit && !blocked ? (
          <>
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
            {stage === "PACKING" || state.completes_card ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className={fieldLabel}>
                    Finished-good item <span className="font-normal">(optional)</span>
                  </span>
                  <select className={selectClass} value={fgItem} onChange={(e) => setFgItem(e.target.value)}>
                    <option value="">Automatic — from the order&apos;s product code</option>
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
                  <span className={fieldLabel}>Stock location</span>
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
            {Number(state.available_from_upstream) > 0 ? (
              <label className="block text-sm">
                <span className={fieldLabel}>
                  Unused input ({fmt(state.available_from_upstream)} {state.input_unit})
                </span>
                <select className={selectClass} value={residual} onChange={(e) => setResidual(e.target.value)} data-testid="close-stage-residual">
                  <option value="HOLD">Hold for follow-up</option>
                  <option value="RETURN">Return unused input</option>
                  <option value="SCRAP">Scrap with reason</option>
                </select>
              </label>
            ) : null}
            <label className="block text-sm">
              <span className={fieldLabel}>Reason {needsReason ? "(required — short close or unused input)" : "(optional)"}</span>
              <Input
                className="h-11"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder={short ? "Why the stage closes short of target" : "Material exception, unused input…"}
                aria-label="Close reason"
                data-testid="close-stage-reason"
              />
            </label>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink" data-testid="close-stage-error">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmHint ? (
            <span className="mr-auto text-[12px] text-muted-foreground" data-testid="close-stage-hint">
              {confirmHint}
            </span>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {canSubmit && !blocked ? "Cancel" : "Close"}
          </Button>
          {canSubmit && !blocked ? (
            <Button disabled={!canConfirm} onClick={confirm} data-testid="close-stage-confirm">
              <CheckCircle2 className="h-4 w-4" />
              {mutation.isPending ? "Closing…" : short ? "Confirm short close" : "Confirm close"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
