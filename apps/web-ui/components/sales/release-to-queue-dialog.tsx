"use client"

import { CheckCircle2, Factory } from "lucide-react"
import { useMemo, useState } from "react"

import { StatusBadge } from "@/components/erp/shell"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { usePreflightSalesOrderRelease, useReleaseSyncSalesOrder } from "@/hooks/use-production"
import { useReleaseSalesOrderLine } from "@/hooks/use-sales"
import { type ReleaseMachine } from "@/lib/sales-release"

type ReleaseDraftRow = {
  sales_order_line_id: string
  release_lot_id: string
  product_code: string
  remaining_qty: number
  release_qty: string
  winder_machine_id: string
  mode: "new" | "resume"
  authorized_winders: ReleaseMachine[]
  compatibility_warning: string | null
  blocker: string | null
}

function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function assignedReleaseBlocker(
  selectedWinder: string,
  authorizedCount: number,
  preflightBlocker: string | null | undefined,
) {
  if (!authorizedCount) {
    return String(preflightBlocker || "No authorized same-plant winder queue is available.")
  }
  const text = String(preflightBlocker || "").trim()
  if (selectedWinder && /select a winder queue/i.test(text)) {
    return null
  }
  return text || null
}

function buildReleaseRows(order: any, selectedLineIds: string[]) {
  return (order.lines || [])
    .filter((line: any) => selectedLineIds.includes(String(line.id)))
    .flatMap((line: any) => {
      const pendingLots = (Array.isArray(line.release_lots) ? line.release_lots : [])
        .filter((lot: any) => !lot.job_card_id && String(lot.status || "").toLowerCase() !== "cancelled")
      if (pendingLots.length > 0) {
        return pendingLots.map((lot: any) => ({
          sales_order_line_id: String(line.id),
          release_lot_id: String(lot.release_lot_id || lot.id),
          product_code: String(lot.product_code || line.product_code || "").trim(),
          remaining_qty: Number(lot.release_qty || 0),
          release_qty: Number(lot.release_qty || 0).toFixed(0),
          winder_machine_id: String(lot.winder_machine_id || ""),
          mode: "resume" as const,
          authorized_winders: [],
          compatibility_warning: null,
          blocker: null,
        }))
      }
      const releaseRemainingQty = Number(line.release_remaining_qty ?? line.remaining_qty ?? line.qty ?? 0)
      return [{
        sales_order_line_id: String(line.id),
        release_lot_id: crypto.randomUUID(),
        product_code: String(line.product_code || "").trim(),
        remaining_qty: releaseRemainingQty,
        release_qty: releaseRemainingQty.toFixed(0),
        winder_machine_id: "",
        mode: "new" as const,
        authorized_winders: [],
        compatibility_warning: null,
        blocker: null,
      }]
    })
}

export function ReleaseToQueueDialog({
  order,
  selectedLineIds,
  open,
  onOpenChange,
}: {
  order: any
  selectedLineIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { showToast } = useApp()
  const { setActivePlant } = useAuth()
  const releasePreflight = usePreflightSalesOrderRelease()
  const releaseOrderLine = useReleaseSalesOrderLine()
  const releaseSync = useReleaseSyncSalesOrder()
  const [rows, setRows] = useState<ReleaseDraftRow[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [outcome, setOutcome] = useState<{
    winderMachineId: string
    lotIds: string[]
    syncPending: boolean
    syncError?: string | null
    syncPayload?: any
  } | null>(null)

  // Release lots are saved in sales first; the job card only exists after the
  // production sync. A failed sync must say why and be retryable here, or the
  // released quantity never reaches the planner's open queue.
  const runSync = async (payload: any): Promise<{ pending: boolean; error: string | null }> => {
    try {
      const response = await releaseSync.mutateAsync({ salesOrderId: String(order.id), plantId: orderPlantId(order), data: payload })
      const jobCardIds = Array.isArray(response?.data?.line_results)
        ? response.data.line_results.map((row: any) => String(row.job_card_id)).filter(Boolean)
        : []
      return { pending: jobCardIds.length === 0, error: jobCardIds.length ? null : "Planning returned no job card." }
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      const text = typeof detail === "string" ? detail : detail?.message || error?.message || "Planning service did not respond."
      return { pending: true, error: text }
    }
  }

  const retrySync = async () => {
    if (!outcome?.syncPayload) return
    const result = await runSync(outcome.syncPayload)
    setOutcome({ ...outcome, syncPending: result.pending, syncError: result.error })
    showToast(result.pending ? `Planning sync still pending: ${result.error}` : "Job card created in the winder queue.", result.pending ? "error" : "success")
  }

  const hydrate = async () => {
    const draftRows = buildReleaseRows(order, selectedLineIds)
    const response = await releasePreflight.mutateAsync({
      salesOrderId: String(order.id),
      plantId: orderPlantId(order),
      data: {
        release_rows: draftRows.map((row) => ({
          sales_order_line_id: row.sales_order_line_id,
          release_lot_id: row.mode === "resume" ? row.release_lot_id : null,
          release_qty: Number(row.release_qty),
          winder_machine_id: row.winder_machine_id || null,
        })),
      },
    })
    const results = Array.isArray(response?.data?.line_results) ? response.data.line_results : []
    setRows(draftRows.map((row) => {
      const result = results.find((entry: any) => String(entry.sales_order_line_id) === row.sales_order_line_id)
      const authorizedWinders = Array.isArray(result?.authorized_winders) && result.authorized_winders.length
        ? result.authorized_winders
        : Array.isArray(result?.compatible_winders) ? result.compatible_winders : []
      const selectedWinder = row.winder_machine_id || String(authorizedWinders[0]?.id || "")
      return {
        ...row,
        authorized_winders: authorizedWinders,
        winder_machine_id: selectedWinder,
        compatibility_warning: result?.compatibility_warning || null,
        blocker: assignedReleaseBlocker(selectedWinder, authorizedWinders.length, result?.blocker),
      }
    }))
    setHydrated(true)
  }

  const blockers = rows.filter((row) => {
    const quantity = Number(row.release_qty || 0)
    return row.blocker || !row.winder_machine_id || quantity <= 0 || quantity > row.remaining_qty
  }).length

  const confirm = async () => {
    const normalized = rows.map((row) => ({ ...row, release_qty: Number(row.release_qty || 0) })).filter((row) => row.release_qty > 0)
    if (!normalized.length || normalized.some((row) => !row.winder_machine_id || row.release_qty > row.remaining_qty)) {
      showToast("Each release row needs a winder queue and a quantity within the remaining balance.", "error")
      return
    }
    const persisted = []
    for (const row of normalized) {
      const response = await releaseOrderLine.mutateAsync({
        lineId: row.sales_order_line_id,
        plantId: orderPlantId(order),
        data: {
          release_qty: row.release_qty,
          winder_machine_id: row.winder_machine_id,
          product_code: row.product_code || null,
          release_lot_id: row.release_lot_id,
        },
      })
      persisted.push({ ...row, release_lot_id: String(response?.data?.release_lot_id || row.release_lot_id) })
    }
    const syncPayload = {
      line_ids: persisted.map((row) => row.sales_order_line_id),
      release_rows: persisted.map((row) => ({
        release_lot_id: row.release_lot_id,
        sales_order_line_id: row.sales_order_line_id,
        release_qty: row.release_qty,
        winder_machine_id: row.winder_machine_id,
        product_code: row.product_code || null,
      })),
    }
    const { pending: syncPending, error: syncError } = await runSync(syncPayload)
    const plantId = orderPlantId(order)
    if (plantId) setActivePlant(plantId)
    setOutcome({
      winderMachineId: String(persisted[0]?.winder_machine_id || ""),
      lotIds: persisted.map((row) => String(row.release_lot_id)),
      syncPending,
      syncError,
      syncPayload,
    })
    showToast(syncPending ? `Release recorded — planning sync pending: ${syncError}` : "Released into the selected winder queue.", syncPending ? "error" : "success")
  }

  const totalQty = useMemo(() => rows.reduce((sum, row) => sum + Number(row.release_qty || 0), 0), [rows])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && !hydrated) {
          hydrate().catch((error: any) => {
            const detail = error?.response?.data?.detail || error?.message || "Unable to load winder queues."
            showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
            onOpenChange(false)
          })
        }
        if (!next) {
          setHydrated(false)
          setRows([])
          setOutcome(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden rounded-[1.75rem] border-border bg-muted p-0" style={{ width: "min(980px, calc(100vw - 2rem))", maxWidth: "none" }}>
        <DialogHeader className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-slate-950 p-2.5 text-white"><Factory className="h-5 w-5" /></div>
            <div>
              <DialogTitle>Approve + release to winder queue</DialogTitle>
              <DialogDescription>Select an authorized same-plant winder. Geometry mismatch is advisory only.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {outcome ? (
            <div className="space-y-4" data-testid="sales-order-detail:release-next-step">
              <div className={`rounded-2xl border px-4 py-3 text-sm ${outcome.syncPending ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"}`}>
                {outcome.syncPending ? (
                  <>
                    <p className="font-semibold">Release recorded, but the job card is not in planning yet.</p>
                    {outcome.syncError ? <p className="mt-1" data-testid="sales-order-detail:release-sync-error">Reason: {outcome.syncError}</p> : null}
                    <button
                      type="button"
                      onClick={() => { void retrySync() }}
                      disabled={releaseSync.isPending}
                      className="mt-2 rounded-lg border border-signal-amber-line bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                      data-testid="sales-order-detail:release-sync-retry"
                    >
                      {releaseSync.isPending ? "Retrying…" : "Retry planning sync"}
                    </button>
                  </>
                ) : "Job card created. The release winder is a hint; schedule on any available winder."}
              </div>
              <a
                href={`/planning/board?section=winder&machine_id=${outcome.winderMachineId}&order_id=${order.id}`}
                className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
                data-testid="sales-order-detail:open-winder-queue"
              >
                Open planning queue
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.release_lot_id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{row.product_code || "Line"}</p>
                    <StatusBadge value={row.mode === "resume" ? "PENDING" : "NEW"} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      type="number"
                      min="1"
                      max={row.remaining_qty}
                      readOnly={row.mode === "resume"}
                      value={row.release_qty}
                      onChange={(event) => setRows((current) => current.map((entry) => entry.release_lot_id === row.release_lot_id ? { ...entry, release_qty: event.target.value, blocker: null } : entry))}
                      className="h-11 rounded-xl border border-border px-3 text-sm font-semibold"
                    />
                    <select
                      value={row.winder_machine_id}
                      onChange={(event) => setRows((current) => current.map((entry) => entry.release_lot_id === row.release_lot_id ? { ...entry, winder_machine_id: event.target.value, blocker: null } : entry))}
                      className="h-11 rounded-xl border border-border px-3 text-sm font-semibold"
                      data-testid="sales-order-detail:release-winder"
                    >
                      <option value="">Select winder queue</option>
                      {row.authorized_winders.map((machine) => (
                        <option key={machine.id} value={machine.id}>{machine.code || machine.name}</option>
                      ))}
                    </select>
                  </div>
                  {row.compatibility_warning ? <p className="mt-2 text-xs text-signal-amber-ink">{row.compatibility_warning}</p> : null}
                  {row.blocker ? <p className="mt-2 text-xs text-signal-rose-ink">{row.blocker}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border bg-card px-6 py-4">
          {outcome ? (
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">Close</button>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{totalQty.toFixed(0)} pcs · {blockers ? `${blockers} blocker(s)` : "ready"}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onOpenChange(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">Cancel</button>
                <button
                  type="button"
                  data-testid="sales-order-detail:confirm-release"
                  disabled={blockers > 0 || releasePreflight.isPending || releaseOrderLine.isPending || releaseSync.isPending}
                  onClick={() => confirm().catch((error: any) => {
                    const detail = error?.response?.data?.detail || error?.message || "Release failed."
                    showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
                  })}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Release to queue
                </button>
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
