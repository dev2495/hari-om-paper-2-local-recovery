"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, productionApi } from "@/lib/api"
import { matchesShortageReview, shortageRecoveryIsConclusive, type ShortageDecision, type ShortageRecord, type ShortageReview } from "@/lib/job-card-shortage"
import { errorText, seasonTimestamp } from "@/lib/season-api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const decisionLabel: Record<ShortageDecision, string> = { CARRY_FORWARD: "Carry forward", HOLD: "Hold for follow-up", SHORT_CLOSE_SO: "Reduce sales order quantity" }
const decisionDescription: Record<ShortageDecision, string> = {
  CARRY_FORWARD: "Create a linked job card to remake the shortage using this card’s frozen recipe and QC contract. The sales order quantity stays the same.",
  HOLD: "Record the shortage for follow-up. It remains open until a manager chooses carry-forward or reduces the sales order quantity.",
  SHORT_CLOSE_SO: "Reduce the linked sales order quantity by this shortage. The missing pieces will no longer be owed to the customer; no remake card is created.",
}
const selectClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"

export function JobCardShortagePanel({ card, flow }: { card: any; flow: any }) {
  const cache = useQueryClient()
  const [decision, setDecision] = useState<ShortageDecision>("CARRY_FORWARD")
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [resolving, setResolving] = useState(false)
  const [review, setReview] = useState<ShortageReview | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState("")
  const qc = flow.stages?.find((stage: any) => stage.stage === "QC")
  const qcClosed = qc?.status === "COMPLETED"
  const planned = Number(card.released_qty ?? card.planned_qty)
  const accepted = Number(qc?.accepted_total ?? 0)
  const gap = planned - accepted
  const concretePlant = Boolean(card.plant_id && String(card.plant_id).toUpperCase() !== "ALL")
  const queryKey = ["job-card-shortage", card.id, card.plant_id]
  async function loadRecord(): Promise<ShortageRecord | null> {
    const { data } = await productionApi.listShortCloses({ job_card_id: card.id }, card.plant_id)
    if (!Array.isArray(data)) throw new Error("Shortage history returned an invalid response")
    return data.find((row: ShortageRecord) => row.job_card_id === card.id && row.stage_type === "JOB_CARD") || null
  }
  const history = useQuery({ queryKey, queryFn: loadRecord, enabled: qcClosed && concretePlant, refetchInterval: 15000 })
  const record = history.data
  const openHold = record?.decision === "HOLD" && record.hold_status === "OPEN"
  const reasons = useQuery({
    queryKey: ["job-card-shortage-reasons", card.plant_id],
    queryFn: async () => {
      const { data } = await api.get("/api/master/reason-codes", { params: { category: "SHORT_CLOSE" }, headers: { "X-Plant-ID": String(card.plant_id) } })
      if (!Array.isArray(data)) throw new Error("Reason codes returned an invalid response")
      return data.filter((row: any) => row.active !== false && row.category === "SHORT_CLOSE")
    },
    enabled: qcClosed && concretePlant && history.isSuccess && !record && gap > 0,
  })
  const mutation = useMutation({
    mutationFn: async (snapshot: ShortageReview): Promise<ShortageRecord> => {
      try {
        const response = snapshot.kind === "RESOLVE"
          ? await productionApi.resolveHold(snapshot.short_close_id!, { decision: snapshot.decision, notes: snapshot.notes || null }, card.plant_id)
          : await productionApi.shortCloseJobCard(card.id, { produced_qty: snapshot.produced_qty, reason_code: snapshot.reason_code, decision: snapshot.decision, stage_type: "JOB_CARD", notes: snapshot.notes || null }, card.plant_id)
        return response.data
      } catch (writeError) {
        try {
          const saved = await loadRecord()
          cache.setQueryData(queryKey, saved)
          if (matchesShortageReview(saved, snapshot)) return saved!
        } catch { /* Keep the exact reviewed action when recovery cannot be verified. */ }
        throw writeError
      }
    },
    onSuccess: saved => {
      cache.setQueryData(queryKey, saved)
      setOpen(false); setReview(null); setResolving(false); setReason(""); setNotes(""); setRefreshError("")
      for (const key of ["continuous-flow", "planning-job-card", "planning-job-cards", "planning", "sales", "short-closes", "short-close-holds", "ready-jobs"])
        void cache.invalidateQueries({ queryKey: [key] })
      void cache.invalidateQueries({ queryKey: ["purchase-v2", "sales-bom-demand"] })
    },
  })
  const busy = mutation.isPending || refreshing
  const frozen = busy || Boolean(review)
  const upstreamClosed = flow.stages?.every((stage: any) => stage.stage === "DISPATCH" || stage.status === "COMPLETED")
  const selectedReason = reasons.data?.find((row: any) => row.code === reason)
  const canReview = concretePlant && history.isSuccess && upstreamClosed && !frozen
    && (resolving ? openHold : !record && gap > 0 && Boolean(selectedReason))
    && (decision !== "SHORT_CLOSE_SO" || Boolean(card.sales_order_line_id) && notes.trim().length > 0)

  function openReview() {
    if (!canReview) return
    setReview({ kind: resolving ? "RESOLVE" : "CREATE", job_card_id: card.id, short_close_id: resolving ? record!.id : undefined,
      planned_qty: resolving ? Number(record!.planned_qty) : planned, produced_qty: resolving ? Number(record!.produced_qty) : accepted,
      gap_qty: resolving ? Number(record!.gap_qty) : gap, reason_code: resolving ? record!.reason_code : reason,
      reason_label: resolving ? record!.reason_code : selectedReason.label, decision, notes: notes.trim() })
    mutation.reset(); setRefreshError(""); setOpen(true)
  }
  async function refreshReview() {
    setRefreshing(true); setRefreshError("")
    try {
      const result = await history.refetch({ throwOnError: true })
      await cache.invalidateQueries({ queryKey: ["continuous-flow", card.id] }, { throwOnError: true })
      const saved = result.data
      // A confirmed server rejection can be reviewed afresh; timeouts and 5xx
      // keep the original payload so a late committed request cannot be changed.
      const status = Number((mutation.error as any)?.response?.status)
      if (review && shortageRecoveryIsConclusive(saved, review, status)) {
        setOpen(false); setReview(null); setResolving(false); mutation.reset()
      } else setRefreshError(review?.kind === "RESOLVE" ? "The hold is still open and the resolution outcome is not confirmed. Retry the same reviewed action to finish recovery." : "No saved decision is visible yet. Retry the same reviewed action to finish recovery.")
    } catch (error) { setRefreshError(`Could not verify the decision: ${errorText(error)}`) }
    finally { setRefreshing(false) }
  }

  if (!qcClosed || !record && !(gap > 0)) return null
  return <section aria-labelledby="shortage-title" className="space-y-4 rounded-xl border border-signal-amber-line bg-card p-5">
    <div><h2 id="shortage-title" className="text-lg font-semibold">Sales quantity shortage</h2><p className="text-sm text-muted-foreground">Released {record?.planned_qty ?? planned} pcs · Final QC accepted {record?.produced_qty ?? accepted} pcs · Shortage {record?.gap_qty ?? gap} pcs. Only accepted finished goods count toward this gap.</p></div>
    {!concretePlant ? <p role="alert" className="text-sm text-destructive">This card needs a concrete plant before a shortage decision can be recorded.</p>
      : history.isLoading ? <p role="status" className="text-sm">Checking this card’s shortage history…</p>
      : history.isError ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">Could not verify the existing shortage decision: {errorText(history.error)}</p><Button variant="outline" onClick={() => { void history.refetch() }}>Retry history</Button></div>
      : <>
        {record && <div className="space-y-2 rounded-lg border border-border bg-muted p-3 text-sm">
          <p className="font-medium">{record.decision === "HOLD" ? openHold ? "Open hold · follow-up required" : `Hold resolved · ${decisionLabel[record.resolution_decision || "CARRY_FORWARD"]}` : decisionLabel[record.decision]}</p>
          <p>{record.reason_code} · {seasonTimestamp(record.created_at)}{record.notes ? ` · ${record.notes}` : ""}</p>
          {record.resolved_at && <p className="text-muted-foreground">Resolved {seasonTimestamp(record.resolved_at)}{record.resolved_by ? ` · ${record.resolved_by}` : ""}{record.resolution_note ? ` · ${record.resolution_note}` : ""}</p>}
          {record.carry_forward_job_card_id && <Button asChild size="sm" variant="outline"><Link href={`/production/job-cards/${record.carry_forward_job_card_id}`}>Open carry-forward job card</Link></Button>}
          {openHold && !resolving && <div><p className="mb-2 text-muted-foreground">This shortage still needs a final decision, even if the original card has finished dispatch.</p><Button size="sm" variant="outline" disabled={frozen} onClick={() => { setResolving(true); setDecision("CARRY_FORWARD"); setNotes("") }}>Resolve hold</Button></div>}
        </div>}
        {(!record || resolving && openHold) && <div className="space-y-3">
          {!upstreamClosed && <p className="text-sm text-muted-foreground">Close Packing, QC and every upstream stage before confirming the shortage decision.</p>}
          {!resolving && (reasons.isLoading ? <p role="status" className="text-sm">Loading shortage reasons…</p> : reasons.isError ? <div><p role="alert" className="text-sm text-destructive">Could not load shortage reasons: {errorText(reasons.error)}</p><Button size="sm" variant="outline" onClick={() => { void reasons.refetch() }}>Retry reasons</Button></div> : reasons.data?.length ? <label className="grid gap-1 text-sm">Reason code *<select className={selectClass} value={reason} onChange={event => setReason(event.target.value)} disabled={frozen}><option value="">Choose shortage reason</option>{reasons.data.map((row: any) => <option key={row.id} value={row.code}>{row.code} · {row.label}</option>)}</select></label> : <p className="text-sm text-muted-foreground">No active shortage reasons are available for this plant. <Link className="underline" href="/masters/reason-codes">Add a SHORT_CLOSE reason code</Link>.</p>)}
          <label className="grid gap-1 text-sm">{resolving ? "Final decision" : "Decision"}<select className={selectClass} value={decision} onChange={event => setDecision(event.target.value as ShortageDecision)} disabled={frozen}><option value="CARRY_FORWARD">Carry forward · remake shortage</option>{!resolving && <option value="HOLD">Hold for follow-up</option>}<option value="SHORT_CLOSE_SO" disabled={!card.sales_order_line_id}>Reduce sales order quantity</option></select></label>
          <p className={`text-sm ${decision === "SHORT_CLOSE_SO" ? "text-signal-amber-ink" : "text-muted-foreground"}`}>{decisionDescription[decision]}</p>
          <label className="grid gap-1 text-sm">Notes {decision === "SHORT_CLOSE_SO" ? "* · explain the order reduction" : "(optional)"}<textarea className="min-h-20 rounded-lg border border-border bg-background p-3" value={notes} onChange={event => setNotes(event.target.value)} disabled={frozen} /></label>
          <div className="flex flex-wrap gap-2"><Button disabled={!canReview} onClick={openReview}>Review {resolving ? "hold resolution" : "shortage decision"}</Button>{resolving && <Button variant="ghost" disabled={frozen} onClick={() => setResolving(false)}>Cancel resolution</Button>}</div>
        </div>}
      </>}
    {review && !open && <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>Resume reviewed decision</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (!value && !mutation.isError) setReview(null) } }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader><DialogTitle>{review ? decisionLabel[review.decision] : "Confirm shortage decision"}</DialogTitle><DialogDescription>{review && decisionDescription[review.decision]}</DialogDescription></DialogHeader>
        {review && <div className="space-y-2 text-sm"><p className="font-medium">{card.job_card_no} · shortage {review.gap_qty} pcs</p><p>Original release {review.planned_qty} pcs · Final QC accepted {review.produced_qty} pcs</p><p>Reason: {review.reason_label}</p>{review.notes && <p className="whitespace-pre-wrap break-words">Notes: {review.notes}</p>}{review.decision === "SHORT_CLOSE_SO" && <p className="rounded-lg bg-signal-amber-soft p-3 text-signal-amber-ink">Confirming reduces the customer’s sales order by {review.gap_qty} pcs.</p>}</div>}
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{errorText(mutation.error)} The reviewed quantity, reason and decision stay fixed while recovery is pending.</p>}
        {refreshError && <p role="alert" className="text-sm text-destructive">{refreshError}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setOpen(false); if (!mutation.isError) setReview(null) }}>{mutation.isError ? "Close recovery view" : "Back to review"}</Button>{mutation.isError && <Button variant="outline" disabled={busy} onClick={() => { void refreshReview() }}>{refreshing ? "Checking…" : "Check saved decision"}</Button>}<Button disabled={busy || !review} onClick={() => { if (review) mutation.mutate(review) }}>{mutation.isPending ? "Recording…" : mutation.isError ? "Retry same decision" : "Confirm decision"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
