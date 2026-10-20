"use client"

import Link from "next/link"
import { Ban, CircleSlash2, Info } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { apiErrorText } from "@/hooks/use-lifecycle"
import { useCloseSalesOrder } from "@/hooks/use-sales"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Cancel or short-close a sales order with a reason code (client 2026-10-20).
 *
 * The server says which one the order allows (order.closure_options) so the screen never offers an
 * action the rules would refuse: Cancel while nothing is released or dispatched, Short close once
 * work has started. Reasons come from Masters › Reason codes, category "Order cancel / short close".
 */
export type OrderClosureKind = "cancel" | "short_close"

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

export function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

/** The one closing action this order allows now, or null with the reason why none applies. */
export function orderClosureAction(order: any): { kind: OrderClosureKind | null; reason: string | null } {
  const options = order?.closure_options || {}
  if (options.cancel?.allowed) return { kind: "cancel", reason: null }
  if (options.short_close?.allowed) return { kind: "short_close", reason: null }
  return { kind: null, reason: options.short_close?.reason || options.cancel?.reason || null }
}

export function OrderClosureDialog({ order: incoming, open, onOpenChange }: { order: any | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  // The order as it was when the dialog opened: after a save the order refreshes (or the caller clears
  // it) while the dialog animates closed, and the dialog must not flip to "nothing to close".
  const [order, setOrder] = useState<any | null>(incoming)
  useEffect(() => { if (open && incoming) setOrder(incoming) }, [open, incoming?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeOrder = useCloseSalesOrder()
  const [reasonCode, setReasonCode] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const plantId = orderPlantId(order)
  const { kind, reason: blockedReason } = orderClosureAction(order)
  const options = order?.closure_options || {}

  useEffect(() => {
    if (open) { setReasonCode(""); setNote(""); setError(null) }
  }, [open, order?.id])

  const reasons = useQuery({
    queryKey: ["reason-codes", "SO_CLOSE", plantId],
    enabled: open && Boolean(plantId),
    queryFn: async () => {
      const { data } = await api.get("/api/master/reason-codes", { params: { category: "SO_CLOSE" }, headers: plantId ? { "X-Plant-ID": plantId } : undefined })
      return (Array.isArray(data) ? data : []).filter((row: any) => row.category === "SO_CLOSE" && row.active !== false && row.is_active !== false)
    },
  })
  const rows: any[] = reasons.data || []
  const chosen = rows.find((row) => row.code === reasonCode)
  const needsNote = /OTHER/i.test(reasonCode)
  const lines: any[] = order?.lines || []
  const ordered = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)
  const cancelQty = ordered
  const dropQty = Number(options.drop_qty || 0)
  const onCards = Math.max(0, Number(options.released_qty || 0) - Number(options.dispatched_qty || 0))
  const canSubmit = Boolean(kind && reasonCode && (!needsNote || note.trim().length >= 5) && !closeOrder.isPending)

  const effects = useMemo(() => {
    if (kind === "cancel") {
      return [
        `The whole order (${fmt(cancelQty)} pcs) is cancelled. It cannot be released or dispatched any more.`,
        "Its customer delivery call-offs are cancelled too.",
        ...(options.held ? ["The customer hold on it ends."] : []),
        "This cannot be undone. If the customer comes back, enter a new order.",
      ]
    }
    return [
      `${fmt(dropQty)} pcs not yet released are dropped from the order.`,
      onCards > 0
        ? `${fmt(onCards)} pcs already on job cards finish and are dispatched as usual; the order closes once they are dispatched.`
        : "Nothing is left on job cards, so the order closes now.",
      "If a job card of this order is force-closed later, its leftover is dropped too (not released again).",
      ...(options.held ? ["The customer hold on it ends."] : []),
    ]
  }, [kind, cancelQty, dropQty, onCards, options.held])

  const submit = async () => {
    if (!order || !kind) return
    setError(null)
    try {
      await closeOrder.mutateAsync({ orderId: String(order.id), kind, reasonCode, note, plantId })
      showToast(
        kind === "cancel"
          ? `${order.order_no || "Order"} cancelled — ${chosen?.label || reasonCode}.`
          : `${order.order_no || "Order"} short-closed: ${fmt(dropQty)} pcs dropped — ${chosen?.label || reasonCode}.`,
        "success",
      )
      onOpenChange(false)
    } catch (err) {
      setError(apiErrorText(err, kind === "cancel" ? "The order could not be cancelled." : "The order could not be short-closed."))
    }
  }

  const title = kind === "cancel" ? "Cancel order" : kind === "short_close" ? "Short close order" : "Cancel or short close"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sales-order:closure-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "cancel" ? <Ban className="h-4 w-4 text-signal-rose-ink" /> : <CircleSlash2 className="h-4 w-4 text-signal-amber-ink" />}
            {title} · {order?.order_no || ""}
          </DialogTitle>
          <DialogDescription>
            {kind === "cancel"
              ? "Nothing of this order is released to production or dispatched, so it can be cancelled as a whole."
              : kind === "short_close"
                ? "Work on this order has started. Short close stops the rest; what is on job cards still finishes."
                : "This order cannot be cancelled or short-closed right now."}
          </DialogDescription>
        </DialogHeader>

        {order ? (
          <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border text-center">
            {[
              ["Ordered", fmt(ordered)],
              ["Dispatched", fmt(options.dispatched_qty)],
              ["On job cards", fmt(onCards)],
              [kind === "cancel" ? "Cancels" : "Drops", fmt(kind === "cancel" ? cancelQty : dropQty)],
            ].map(([label, value], index) => (
              <div key={label} className={cn("px-2 py-2", index && "border-l border-border", index === 3 && kind && (kind === "cancel" ? "bg-signal-rose-soft" : "bg-signal-amber-soft"))}>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={cn("text-[14px] font-semibold tabular-nums", index === 3 && kind && (kind === "cancel" ? "text-signal-rose-ink" : "text-signal-amber-ink"))}>{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {kind ? (
          <>
            <ul className="grid gap-1.5 text-[13px]">
              {effects.map((text) => (
                <li key={text} className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{text}</li>
              ))}
            </ul>
            <label className="grid gap-1.5 text-[13px] font-medium">
              Reason *
              {reasons.isLoading ? (
                <span role="status" className="text-[12.5px] font-normal text-muted-foreground">Loading reasons…</span>
              ) : reasons.isError ? (
                <span role="alert" className="text-[12.5px] font-normal text-signal-rose-ink">
                  Reasons could not be loaded: {apiErrorText(reasons.error)}.{" "}
                  <button type="button" className="font-semibold underline" onClick={() => void reasons.refetch()}>Try again</button>
                </span>
              ) : rows.length ? (
                <select
                  data-testid="sales-order:closure-reason"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-[13px] font-normal"
                >
                  <option value="">Choose why</option>
                  {rows.map((row) => <option key={row.id || row.code} value={row.code}>{row.label} ({row.code})</option>)}
                </select>
              ) : (
                <span className="text-[12.5px] font-normal text-muted-foreground">
                  No order cancel / short close reasons are set up for this plant.{" "}
                  <Link href="/masters/reason-codes" className="font-semibold text-primary underline">Add them in Masters › Reason codes</Link>.
                </span>
              )}
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium">
              <span>Note {needsNote ? "*" : <span className="font-normal text-muted-foreground">(optional)</span>}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={needsNote ? "Say what happened (needed for Other)" : "e.g. Confirmed by the customer on call, 20 Oct"}
                className="rounded-lg border border-input bg-card px-3 py-2 text-[13px] font-normal"
              />
            </label>
          </>
        ) : (
          <p role="status" className="rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-[13px]">{blockedReason || "Nothing to close on this order."}</p>
        )}

        {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink">{error}</p> : null}

        <DialogFooter>
          <button type="button" className="erp-btn-secondary" onClick={() => onOpenChange(false)}>Back</button>
          {kind ? (
            <button
              type="button"
              data-testid="sales-order:closure-confirm"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className={cn("erp-btn-primary", kind === "cancel" ? "!bg-signal-rose-ink !text-background" : "!bg-signal-amber-ink !text-background")}
            >
              {closeOrder.isPending ? "Saving…" : kind === "cancel" ? "Cancel order" : `Short close · drop ${fmt(dropQty)} pcs`}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
