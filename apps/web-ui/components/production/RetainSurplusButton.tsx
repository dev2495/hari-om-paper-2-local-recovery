"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { errorText } from "@/lib/season-api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"

export function RetainSurplusButton({ job }: { job: any }) {
  const [open, setOpen] = useState(false)
  // Why the surplus is kept: a SURPLUS_RETAIN code from Masters › Reason codes (owner decision 4).
  const reason = useReasonChoice("SURPLUS_RETAIN", job.plant_id, { enabled: open })
  const [command, setCommand] = useState<any>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState("")
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (body: any) => api.post(`/api/dispatch/retain-surplus/${job.id}`, body, { headers: { "X-Plant-ID": String(job.plant_id) } }),
    onSuccess: () => {
      setOpen(false)
      for (const key of ["ready-jobs", "dispatch-by-job", "planning-job-card", "planning-job-cards", "continuous-flow"])
        queryClient.invalidateQueries({ queryKey: [key] })
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ["ready-jobs"] }),
  })
  function settle() {
    if (!command && !reason.validate()) return
    const body = command || { request_id: crypto.randomUUID(), expected_remaining_qty: Number(job.remaining_qty), ...reason.payload("reason") }
    setCommand(body)
    mutation.mutate(body)
  }
  const staleRemaining = mutation.isError && (mutation.error as any)?.response?.status === 409 && /remaining quantity changed/i.test(errorText(mutation.error))
  const reviewedQuantity = command?.expected_remaining_qty ?? Number(job.remaining_qty)
  async function reviewAgain() {
    setReviewing(true)
    setReviewError("")
    try {
      await queryClient.invalidateQueries({ queryKey: ["ready-jobs"] }, { throwOnError: true })
      setCommand(null)
      reason.reset()
      mutation.reset()
    } catch (error) {
      setReviewError(`Could not refresh the balance: ${errorText(error)}`)
    } finally {
      setReviewing(false)
    }
  }
  return <>
    <Button size="sm" variant="outline" className="mt-2" disabled={mutation.isPending || reviewing} onClick={() => { reason.reset(); setCommand(null); setReviewError(""); mutation.reset(); setOpen(true) }}>Retain surplus FG</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending && !reviewing) setOpen(value) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Retain {reviewedQuantity} surplus pcs</DialogTitle><DialogDescription>{job.box_mode
          ? "No box left on this card fits in the released quantity still to ship (a box is never split). These boxes stay in stock as surplus with their labels; any released quantity not shipped goes back to the sales order, so Sales can release it again or short-close it. This closes the job card and records your reason. Any unposted challan draft is discarded and kept in the audit."
          : "The released quantity has shipped. These extra pieces remain in the existing finished-goods batch. This closes the job card and records your reason; stock and Sales fulfillment stay unchanged. Any unposted challan draft is discarded and its full contents are preserved in the audit."}</DialogDescription></DialogHeader>
        <ReasonPicker category="SURPLUS_RETAIN" plantId={job.plant_id} rows={reason.list.data} value={reason.value} onChange={reason.setValue} showErrors={reason.touched}
          disabled={mutation.isPending || reviewing || Boolean(command)} notePlaceholder="e.g. part box kept for the next PO" compact testIdPrefix="retain-surplus-reason" />
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{errorText(mutation.error)} {staleRemaining ? "Refresh the balance and review a new settlement before confirming." : "Retry uses the same settlement command."}</p>}
        {reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
        <DialogFooter><Button variant="outline" disabled={mutation.isPending || reviewing} onClick={() => setOpen(false)}>Keep card open</Button>{staleRemaining ? <Button disabled={reviewing} onClick={() => { void reviewAgain() }}>{reviewing ? "Refreshing balance…" : "Review again"}</Button> : <Button disabled={mutation.isPending || reviewing || (!command && !reason.complete)} onClick={settle}>{mutation.isPending ? "Recording…" : mutation.isError ? "Retry settlement" : "Confirm retention and close"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
