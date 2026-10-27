"use client"

import { PauseCircle } from "lucide-react"
import { useEffect, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { OrderCloseReasonFields, closeReasonComplete, orderPlantId, useOrderCloseReasons } from "@/components/sales/order-closure-dialog"
import { useApp } from "@/context/AppContext"
import { useHoldSalesOrder } from "@/hooks/use-sales"
import { describeErrorDetail } from "@/lib/api-error"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

/**
 * Customer hold & close for one order or several at once (Orders list bulk action). The undelivered
 * balance becomes hold qty and the PO closes; it asks for an "Order cancel / short close" reason code
 * (client 2026-10-26) and can be lifted later with Resume.
 */
export function OrderHoldDialog({ orders, open, onOpenChange, testIdPrefix = "sales-orders:hold" }: {
  orders: any[]
  open: boolean
  onOpenChange: (open: boolean) => void
  testIdPrefix?: string
}) {
  const { showToast } = useApp()
  const holdSalesOrder = useHoldSalesOrder()
  const [reasonCode, setReasonCode] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const first = orders[0]
  const reasons = useOrderCloseReasons(first ? orderPlantId(first) : undefined, open && Boolean(first))

  useEffect(() => {
    if (open) { setReasonCode(""); setNote("") }
  }, [open])

  const willHold = orders.reduce((total, order) => total + (order.lines || []).reduce((sum: number, line: any) => sum + Math.max(0, Number(line.qty || 0) - Number(line.fulfilled_qty || 0)), 0), 0)

  const submit = async () => {
    if (!orders.length || !closeReasonComplete(reasonCode, note)) return
    setBusy(true)
    let done = 0
    for (const order of orders) {
      try {
        await holdSalesOrder.mutateAsync({ orderId: String(order.id), reasonCode, note, plantId: orderPlantId(order) })
        done += 1
      } catch (error: any) {
        const detail = error?.response?.data?.detail || error?.message || "Could not put the order on hold."
        showToast(`${order.order_no || "Order"}: ${describeErrorDetail(detail)}`, "error")
      }
    }
    setBusy(false)
    if (done) {
      showToast(done === 1 ? `${orders[0].order_no || "Order"} is on customer hold. The pending balance is held and the PO closed.` : `${done} orders are on customer hold.`, "success")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent data-testid={`${testIdPrefix}-dialog`} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PauseCircle className="h-4 w-4 text-signal-amber-ink" />Customer hold &amp; close{orders.length > 1 ? ` · ${orders.length} orders` : first?.order_no ? ` · ${first.order_no}` : ""}</DialogTitle>
          <DialogDescription>
            Use this when the customer is not lifting material. The undelivered balance becomes hold qty and the PO closes. Delivered quantities and job cards are not changed, and you can lift the hold later with Resume.
          </DialogDescription>
        </DialogHeader>
        {orders.length ? (
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border text-center">
            {[
              [orders.length > 1 ? "Orders" : "SO", orders.length > 1 ? String(orders.length) : first.order_no || "—"],
              ["PO", orders.length > 1 ? orders.map((order) => order.po_number || "Internal").slice(0, 2).join(", ") + (orders.length > 2 ? "…" : "") : first.po_number || "Internal"],
              ["Will hold", `${fmt(willHold)} pcs`],
            ].map(([label, value], index) => (
              <div key={label} className={`px-3 py-2 ${index ? "border-l border-border" : ""}`}>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="truncate text-[13px] font-semibold">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
        <OrderCloseReasonFields
          reasons={reasons}
          reasonCode={reasonCode}
          note={note}
          onReasonCodeChange={setReasonCode}
          onNoteChange={setNote}
          testIdPrefix={testIdPrefix}
          notePlaceholder="e.g. Customer has not lifted material since July; confirmed on call."
        />
        <DialogFooter>
          <button type="button" className="erp-btn-secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
          <button type="button" data-testid={`${testIdPrefix}-confirm`} className="erp-btn-primary !bg-signal-amber-ink !text-background" disabled={!closeReasonComplete(reasonCode, note) || busy} onClick={() => void submit()}>
            {busy ? "Holding…" : orders.length > 1 ? `Hold & close ${orders.length} POs` : "Hold & close PO"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
