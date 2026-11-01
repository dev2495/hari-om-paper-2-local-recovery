"use client"

import { PlayCircle } from "lucide-react"
import { useEffect, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { orderPlantId } from "@/components/sales/order-closure-dialog"
import { useApp } from "@/context/AppContext"
import { apiErrorText } from "@/hooks/use-lifecycle"
import { useResumeSalesOrder } from "@/hooks/use-sales"

/**
 * Lift a customer hold with a reason (owner decision 4, 1 Nov 2026): a code from the "Order hold lifted"
 * list (ORDER_RESUME). The hold and the resume both stay in the order's history and timeline.
 */
export function OrderResumeDialog({ order, open, onOpenChange, onDone, testIdPrefix = "sales-order:resume" }: {
  order: any | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
  testIdPrefix?: string
}) {
  const { showToast } = useApp()
  const resume = useResumeSalesOrder()
  const plantId = orderPlantId(order)
  const reason = useReasonChoice("ORDER_RESUME", plantId, { enabled: open })
  const [error, setError] = useState<string | null>(null)
  const { reset } = reason

  useEffect(() => { if (open) { reset(); setError(null) } }, [open, reset])

  const submit = async () => {
    if (!order || !reason.validate()) return
    setError(null)
    try {
      await resume.mutateAsync({ orderId: String(order.id), plantId, reasonCode: reason.value.code, note: reason.value.note })
      showToast(`Customer hold lifted on ${order.order_no || "the order"} — ${reason.text}.`, "success")
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      setError(apiErrorText(err, "The hold could not be lifted."))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!resume.isPending) onOpenChange(next) }}>
      <DialogContent data-testid={`${testIdPrefix}-dialog`} className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlayCircle className="h-4 w-4 text-signal-emerald-ink" />Lift customer hold{order?.order_no ? ` · ${order.order_no}` : ""}</DialogTitle>
          <DialogDescription>
            The order opens again with the status it had before the hold. Held since {order?.held_at ? new Date(order.held_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            {order?.hold_reason ? <> for: <strong>{order.hold_reason}</strong></> : null}.
          </DialogDescription>
        </DialogHeader>
        <ReasonPicker
          category="ORDER_RESUME"
          plantId={plantId}
          rows={reason.list.data}
          value={reason.value}
          onChange={reason.setValue}
          showErrors={reason.touched}
          label="Why is the hold lifted?"
          notePlaceholder="e.g. Customer confirmed new schedule on call, 1 Nov"
          testIdPrefix={testIdPrefix}
        />
        {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink">{error}</p> : null}
        <DialogFooter>
          <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => onOpenChange(false)} disabled={resume.isPending}>Back</button>
          <button type="button" data-testid={`${testIdPrefix}-confirm`} className="erp-btn-primary !h-11 sm:!h-9" disabled={resume.isPending} onClick={() => void submit()}>
            {resume.isPending ? "Lifting…" : "Lift hold"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
