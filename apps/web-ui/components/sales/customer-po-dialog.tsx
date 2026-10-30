"use client"

import { FileCheck2, Lock, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

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
import { api } from "@/lib/api"
import { formatShortDate } from "@/lib/sales-order-tracker"
import { plantToday } from "@/lib/due-risk"
import { peopleInText, personLabel } from "@/lib/people"
import { cn } from "@/lib/utils"

/**
 * Customer PO number of an order (client 2026-10-28).
 *
 * - An order made without a customer PO is an internal order "waiting for customer PO"; adding the
 *   number (and its date) confirms it as a customer order.
 * - Before release the number is freely editable. After release it can change ONCE, recorded in the
 *   order history with who and when, and then it locks. The server decides (order.po_change_options).
 */
export type PoChangeOptions = { allowed?: boolean; mode?: "free" | "once" | "locked"; reason?: string | null; changed_by?: string | null }

export function poChangeOptions(order: any): PoChangeOptions {
  return (order?.po_change_options || {}) as PoChangeOptions
}

/** "Internal order · waiting for customer PO" — an order made without a customer PO number. */
export function awaitingCustomerPo(order: any) {
  if (typeof order?.awaiting_customer_po === "boolean") return order.awaiting_customer_po
  return String(order?.origin || "").toUpperCase() !== "CUSTOMER_PO" && !String(order?.po_number || "").trim()
}

function orderPlant(order: any) {
  const value = String(order?.plant_id || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

export function CustomerPoDialog({ order, open, onOpenChange }: { order: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  const queryClient = useQueryClient()
  const options = poChangeOptions(order)
  const waiting = awaitingCustomerPo(order)
  const [poNumber, setPoNumber] = useState("")
  const [poDate, setPoDate] = useState("")
  const [note, setNote] = useState("")
  const [confirmOnce, setConfirmOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncIssue, setSyncIssue] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPoNumber(waiting ? "" : String(order?.po_number || ""))
    setPoDate(String(order?.po_date || "").slice(0, 10) || plantToday())
    setNote("")
    setConfirmOnce(false)
    setError(null)
  }, [open, order?.id, order?.po_number, order?.po_date, waiting])

  // Only a fresh open clears a job-card sync problem: the order refreshing after the save must not.
  useEffect(() => { if (open) setSyncIssue(null) }, [open])

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(
        `/api/sales/orders/${order.id}/customer-po`,
        { po_number: poNumber.trim(), po_date: poDate || null, note: note.trim() || null },
        orderPlant(order) ? { headers: { "X-Plant-ID": orderPlant(order) as string } } : undefined,
      )
      return data
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["sales", "orders"] })
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["job-card"] })
      queryClient.invalidateQueries({ queryKey: ["sales", "order", String(order.id)] })
      queryClient.invalidateQueries({ queryKey: ["sales", "timeline", String(order.id)] })
      queryClient.invalidateQueries({ queryKey: ["sales", "history", String(order.id)] })
      const done = waiting ? "Customer PO added — this is now a confirmed customer order." : options.mode === "once" ? "Customer PO changed. It is now locked." : "Customer PO saved."
      const sync = data?.job_card_po_sync
      if (sync && sync.ok === false) {
        // The PO is saved; only the copy on the job cards is behind. Keep the dialog open to retry.
        showToast(done, "success")
        setSyncIssue(sync.detail || "The job cards still show the old PO.")
        return
      }
      showToast(sync?.updated?.length ? `${done} Job cards updated: ${sync.updated.join(", ")}.` : done, "success")
      onOpenChange(false)
    },
    onError: (failure) => setError(apiErrorText(failure, "The customer PO was not saved.")),
  })

  const retrySync = useMutation({
    mutationFn: async () => (await api.post(`/api/sales/orders/${order.id}/job-card-po-sync`, {}, orderPlant(order) ? { headers: { "X-Plant-ID": orderPlant(order) as string } } : undefined)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-cards"] })
      queryClient.invalidateQueries({ queryKey: ["job-card"] })
      showToast("Job cards now show the new PO.", "success")
      setSyncIssue(null)
      onOpenChange(false)
    },
    onError: (failure) => setSyncIssue(apiErrorText(failure, "The job cards could not be updated with the new PO.")),
  })

  const once = options.mode === "once"
  const numberMissing = !poNumber.trim()
  const unchanged = !waiting && poNumber.trim() === String(order?.po_number || "").trim() && poDate === String(order?.po_date || "").slice(0, 10)
  const blocked = !options.allowed || numberMissing || !poDate || unchanged || (once && !confirmOnce) || save.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border-border bg-card p-0" style={{ width: "min(520px, calc(100vw - 2rem))", maxWidth: "none" }} data-testid="customer-po-dialog">
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary ring-1 ring-inset ring-primary/20"><FileCheck2 className="h-5 w-5" aria-hidden="true" /></div>
            <div className="min-w-0">
              <DialogTitle>{waiting ? "Add the customer PO" : "Change the customer PO"}</DialogTitle>
              <DialogDescription>
                {waiting
                  ? `${order?.order_no || "This order"} was made as an internal order. Adding the customer's PO turns it into a confirmed customer order.`
                  : `${order?.order_no || "This order"} · now PO ${order?.po_number || "—"}${order?.po_date ? ` dated ${formatShortDate(order.po_date)}` : ""}.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          {!options.allowed ? (
            <p role="alert" className="flex gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-[13px] text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{peopleInText(options.reason) || "The customer PO cannot change now."}{options.changed_by ? ` Changed by ${personLabel(options.changed_by)}.` : ""}</p>
          ) : once ? (
            <p className="flex gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2.5 text-[13px] text-signal-amber-ink" data-testid="customer-po-once-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Job cards are already released. The customer PO can be {waiting ? "added" : "changed"} only <strong>once</strong> from now on. It is recorded in the order history with your name and the time, and then it locks.</span>
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Before release the customer PO can be changed freely. Every change is kept in the order history.</p>
          )}
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="customer-po-number">
              Customer PO number <span className="sr-only">(required)</span>
              <input
                id="customer-po-number"
                data-testid="customer-po-number"
                value={poNumber}
                onChange={(event) => { setPoNumber(event.target.value); setError(null) }}
                maxLength={100}
                autoComplete="off"
                disabled={!options.allowed}
                aria-invalid={numberMissing}
                aria-describedby="customer-po-help"
                placeholder="e.g. 4500012345"
                className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal"
              />
              {/* The help sits right under the field it explains. */}
              <span id="customer-po-help" className={cn("text-[12px] font-normal", unchanged ? "text-muted-foreground" : numberMissing ? "text-signal-amber-ink" : "text-muted-foreground")}>
                {unchanged ? "This is already the order's PO number and date." : numberMissing ? "Enter the PO number exactly as on the customer's PO." : "As printed on the customer's PO."}
              </span>
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="customer-po-date">
              Customer PO date
              <input
                id="customer-po-date"
                data-testid="customer-po-date"
                type="date"
                value={poDate}
                onChange={(event) => { setPoDate(event.target.value); setError(null) }}
                max={plantToday()}
                disabled={!options.allowed}
                className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal"
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="customer-po-note">
            <span>Note <span className="font-normal text-muted-foreground">(optional)</span></span>
            <textarea id="customer-po-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} disabled={!options.allowed} placeholder="e.g. Customer sent the PO by mail on 28 Oct" className="rounded-lg border border-input bg-card px-3 py-2 text-[13px] font-normal" />
          </label>
          {once && options.allowed ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-[13px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={confirmOnce} onChange={(event) => setConfirmOnce(event.target.checked)} data-testid="customer-po-confirm-once" />
              <span>I understand this is the one change allowed after release. After this the customer PO is locked.</span>
            </label>
          ) : null}
          {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink">{error}</p> : null}
          {syncIssue ? (
            <p role="alert" className="flex gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2.5 text-[13px] text-signal-amber-ink" data-testid="customer-po-sync-issue">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>The customer PO is saved on the order. {syncIssue} Press “Update job cards” to try again.</span>
            </p>
          ) : null}
        </div>
        <DialogFooter className="flex-row justify-end gap-2 border-t border-border px-5 py-3.5">
          <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => onOpenChange(false)}>{syncIssue ? "Close" : "Cancel"}</button>
          {syncIssue ? (
            <button type="button" className="erp-btn-primary !h-11 sm:!h-9" disabled={retrySync.isPending} onClick={() => retrySync.mutate()} data-testid="customer-po-sync-retry">
              {retrySync.isPending ? "Updating…" : "Update job cards"}
            </button>
          ) : (
            <button type="button" className="erp-btn-primary !h-11 sm:!h-9" disabled={blocked} onClick={() => save.mutate()} data-testid="customer-po-save">
              {save.isPending ? "Saving…" : waiting ? "Confirm customer order" : once ? "Change PO once" : "Save PO"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
