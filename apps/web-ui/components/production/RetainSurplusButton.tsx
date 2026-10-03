"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { errorText } from "@/lib/season-api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function RetainSurplusButton({ job }: { job: any }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
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
    const body = command || { request_id: crypto.randomUUID(), expected_remaining_qty: Number(job.remaining_qty), reason: reason.trim() }
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
      setReason("")
      mutation.reset()
    } catch (error) {
      setReviewError(`Could not refresh the balance: ${errorText(error)}`)
    } finally {
      setReviewing(false)
    }
  }
  return <>
    <Button size="sm" variant="outline" className="mt-2" disabled={mutation.isPending || reviewing} onClick={() => { setReason(""); setCommand(null); setReviewError(""); mutation.reset(); setOpen(true) }}>Retain surplus FG</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending && !reviewing) setOpen(value) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Retain {reviewedQuantity} surplus pcs</DialogTitle><DialogDescription>The released quantity has shipped. These extra pieces remain in the existing finished-goods batch. This closes the job card and records your reason; stock and Sales fulfillment stay unchanged. Any unposted challan draft is discarded and its full contents are preserved in the audit.</DialogDescription></DialogHeader>
        <label className="grid gap-2 text-sm">Reason<textarea className="min-h-24 rounded-md border border-border bg-background p-3" value={reason} onChange={(event) => setReason(event.target.value)} disabled={mutation.isPending || reviewing || Boolean(command)} /></label>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{errorText(mutation.error)} {staleRemaining ? "Refresh the balance and review a new settlement before confirming." : "Retry uses the same settlement command."}</p>}
        {reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
        <DialogFooter><Button variant="outline" disabled={mutation.isPending || reviewing} onClick={() => setOpen(false)}>Keep card open</Button>{staleRemaining ? <Button disabled={reviewing} onClick={() => { void reviewAgain() }}>{reviewing ? "Refreshing balance…" : "Review again"}</Button> : <Button disabled={mutation.isPending || reviewing || reason.trim().length < 5} onClick={settle}>{mutation.isPending ? "Recording…" : mutation.isError ? "Retry settlement" : "Confirm retention and close"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
