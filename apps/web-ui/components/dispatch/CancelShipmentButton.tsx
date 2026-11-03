"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { errorText } from "@/lib/season-api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"

/**
 * Cancel a shipment whose seal stopped half way (3 Nov 2026): the server puts back any stock it moved out and
 * the boxes are ready again for a new challan. Refused once the sales order counts it (Retry finishes it then).
 * Owner, Admin or Dispatch; the reason is an "Entry correction / void / reopen" code.
 */
export function CancelShipmentButton({ dispatchId, plantId, onCancelled }: { dispatchId: string; plantId?: string | null; onCancelled?: () => void }) {
    const [open, setOpen] = useState(false)
    const reason = useReasonChoice("ENTRY_CORRECTION", plantId, { enabled: open })
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: () => api.post(`/api/dispatch/${dispatchId}/cancel`, reason.payload(null), { headers: { "X-Plant-ID": String(plantId || "") } }),
        onSuccess: () => {
            setOpen(false)
            for (const key of ["ready-jobs", "dispatch-by-job", "card-boxes", "planning-job-card", "continuous-flow"]) queryClient.invalidateQueries({ queryKey: [key] })
            onCancelled?.()
        },
    })
    return (
        <>
            <Button variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-0" data-testid="challan-cancel-shipment" disabled={mutation.isPending}
                onClick={() => { reason.reset(); mutation.reset(); setOpen(true) }}>
                Cancel this shipment
            </Button>
            <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending) setOpen(value) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Cancel this shipment?</DialogTitle>
                        <DialogDescription>
                            The challan was not sealed. Any stock it took out goes back, and its boxes are ready again for a new challan. If the sales order already counts it, it cannot be cancelled; press Retry shipment instead.
                        </DialogDescription>
                    </DialogHeader>
                    <ReasonPicker category="ENTRY_CORRECTION" plantId={plantId} rows={reason.rows} value={reason.value} onChange={reason.setValue} showErrors={reason.touched}
                        disabled={mutation.isPending} compact label="Why is it cancelled?" testIdPrefix="cancel-shipment-reason" />
                    {mutation.isError && <p role="alert" className="text-sm text-destructive">{errorText(mutation.error)}</p>}
                    <DialogFooter>
                        <Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>Keep it</Button>
                        <Button variant="destructive" disabled={mutation.isPending} data-testid="challan-cancel-shipment-confirm"
                            onClick={() => { if (reason.validate()) mutation.mutate() }}>
                            {mutation.isPending ? "Cancelling…" : "Cancel shipment"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
