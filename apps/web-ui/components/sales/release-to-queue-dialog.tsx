"use client"

import { AlertTriangle, CheckCircle2, Factory, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { StatusBadge } from "@/components/erp/shell"
import { ColorChip, swatchFor } from "@/components/production/lifecycle-chips"
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
import { useParchments } from "@/hooks/use-master-data"
import { useWinderLoad } from "@/hooks/use-lifecycle"
import { usePreflightSalesOrderRelease, useReleaseSyncSalesOrder } from "@/hooks/use-production"
import { useReleaseSalesOrderLinesBulk } from "@/hooks/use-sales"
import { type ReleaseMachine } from "@/lib/sales-release"
import { cn } from "@/lib/utils"

type ColorOption = { color: string; color_id: string | null; open: number }

type ReleaseDraftRow = {
  key: string
  sales_order_line_id: string
  line_label: string
  release_lot_id: string
  product_code: string
  /** Max releasable on this line (shared by all rows of the line). */
  line_open_qty: number
  release_qty: string
  winder_machine_id: string
  mode: "new" | "resume"
  parchment_required: boolean
  color: string
  color_id: string | null
  color_options: ColorOption[]
  unassigned_qty: number
  authorized_winders: ReleaseMachine[]
  compatibility_warning: string | null
  blocker: string | null
}

const fmt = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

function orderPlantId(order: any) {
  const value = String(order?.plant_id || order?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function assignedReleaseBlocker(selectedWinder: string, authorizedCount: number, preflightBlocker: string | null | undefined) {
  if (!authorizedCount) return String(preflightBlocker || "No authorized same-plant winder queue is available.")
  const text = String(preflightBlocker || "").trim()
  if (selectedWinder && /select a winder queue/i.test(text)) return null
  return text || null
}

function colorOptionsFor(line: any): { options: ColorOption[]; unassigned: number } {
  const splits = Array.isArray(line?.color_splits) ? line.color_splits : []
  return {
    options: splits.map((split: any) => ({ color: String(split.color || ""), color_id: split.color_id ? String(split.color_id) : null, open: Number(split.open_qty || 0) })),
    unassigned: Number(line?.unassigned_color_qty || 0),
  }
}

function newRow(line: any, overrides: Partial<ReleaseDraftRow> = {}): ReleaseDraftRow {
  const { options, unassigned } = colorOptionsFor(line)
  const lineOpen = Number(line.release_remaining_qty ?? line.remaining_qty ?? line.qty ?? 0)
  const firstOpen = options.find((option) => option.open > 0)
  const parchment = Boolean(line.parchment_required)
  return {
    key: crypto.randomUUID(),
    sales_order_line_id: String(line.id),
    line_label: `Line ${line.line_no || ""}`.trim(),
    release_lot_id: crypto.randomUUID(),
    product_code: String(line.product_code || "").trim(),
    line_open_qty: lineOpen,
    release_qty: (parchment ? Math.min(lineOpen, firstOpen?.open ?? lineOpen) : lineOpen).toFixed(0),
    winder_machine_id: "",
    mode: "new",
    parchment_required: parchment,
    color: parchment ? firstOpen?.color || "" : "",
    color_id: parchment ? firstOpen?.color_id || null : null,
    color_options: options,
    unassigned_qty: unassigned,
    authorized_winders: [],
    compatibility_warning: null,
    blocker: null,
    ...overrides,
  }
}

function buildReleaseRows(order: any, selectedLineIds: string[]) {
  return (order.lines || [])
    .filter((line: any) => selectedLineIds.includes(String(line.id)))
    .flatMap((line: any) => {
      const pendingLots = (Array.isArray(line.release_lots) ? line.release_lots : []).filter(
        (lot: any) => !lot.job_card_id && String(lot.status || "").toLowerCase() !== "cancelled",
      )
      if (pendingLots.length > 0) {
        return pendingLots.map((lot: any) =>
          newRow(line, {
            release_lot_id: String(lot.release_lot_id || lot.id),
            product_code: String(lot.product_code || line.product_code || "").trim(),
            line_open_qty: Number(lot.release_qty || 0),
            release_qty: Number(lot.release_qty || 0).toFixed(0),
            winder_machine_id: String(lot.winder_machine_id || ""),
            mode: "resume",
            color: String(lot.parchment_color || ""),
            color_id: lot.parchment_color_id ? String(lot.parchment_color_id) : null,
          }),
        )
      }
      return [newRow(line)]
    })
}

/** Open qty for a row's color = color open + (for colors not yet allocated) unassigned. */
function colorCapacity(row: ReleaseDraftRow) {
  if (!row.parchment_required) return Infinity
  const option = row.color_options.find((entry) => entry.color === row.color)
  return (option?.open || 0) + row.unassigned_qty
}

export function ReleaseToQueueDialog({
  order,
  selectedLineIds,
  open,
  onOpenChange,
  testIdPrefix = "sales-order-detail",
  onReleased,
}: {
  order: any
  selectedLineIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Keeps each page's stable test ids (register uses "sales-orders"). */
  testIdPrefix?: string
  onReleased?: (result: { lotIds: string[]; jobCardIds: string[]; syncPending: boolean }) => void
}) {
  const tid = (name: string) => `${testIdPrefix}:${name}`
  const { showToast } = useApp()
  const { setActivePlant } = useAuth()
  const releasePreflight = usePreflightSalesOrderRelease()
  const releaseLinesBulk = useReleaseSalesOrderLinesBulk()
  const releaseSync = useReleaseSyncSalesOrder()
  const winderLoad = useWinderLoad(open)
  const { data: parchments } = useParchments()
  const [rows, setRows] = useState<ReleaseDraftRow[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [outcome, setOutcome] = useState<{ winderMachineId: string; lotIds: string[]; syncPending: boolean; syncError?: string | null; syncPayload?: any } | null>(null)

  const masterColors = useMemo(
    () =>
      (Array.isArray(parchments) ? parchments : [])
        .filter((row: any) => row?.color_name && row?.id && !String(row.id).startsWith("vendor:"))
        .map((row: any) => ({ id: String(row.id), label: String(row.display_name || [row.color_name, row.vendor_name].filter(Boolean).join(" / ")) })),
    [parchments],
  )

  // Release lots are saved in sales first; the job card only exists after the
  // production sync. A failed sync must say why and be retryable here.
  const runSync = async (payload: any): Promise<{ pending: boolean; error: string | null }> => {
    try {
      const response = await releaseSync.mutateAsync({ salesOrderId: String(order.id), plantId: orderPlantId(order), data: payload })
      const jobCardIds = Array.isArray(response?.data?.line_results) ? response.data.line_results.map((row: any) => String(row.job_card_id)).filter(Boolean) : []
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
          release_qty: Number(row.release_qty) || 1,
          winder_machine_id: row.winder_machine_id || null,
        })),
      },
    })
    const results = Array.isArray(response?.data?.line_results) ? response.data.line_results : []
    setRows(
      draftRows.map((row) => {
        const result = results.find((entry: any) => String(entry.sales_order_line_id) === row.sales_order_line_id)
        const authorizedWinders = Array.isArray(result?.authorized_winders) && result.authorized_winders.length ? result.authorized_winders : Array.isArray(result?.compatible_winders) ? result.compatible_winders : []
        const selectedWinder = row.winder_machine_id || String(authorizedWinders[0]?.id || "")
        return {
          ...row,
          authorized_winders: authorizedWinders,
          winder_machine_id: selectedWinder,
          compatibility_warning: result?.compatibility_warning || null,
          blocker: assignedReleaseBlocker(selectedWinder, authorizedWinders.length, result?.blocker),
        }
      }),
    )
    setHydrated(true)
  }

  // Parents open this dialog programmatically, which never fires onOpenChange(true).
  useEffect(() => {
    if (!open || hydrated || !order) return
    hydrate().catch((error: any) => {
      const detail = error?.response?.data?.detail || error?.message || "Unable to load winder queues."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
      onOpenChange(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id])
  useEffect(() => {
    if (open) return
    setHydrated(false)
    setRows([])
    setOutcome(null)
  }, [open])

  const update = (key: string, patch: Partial<ReleaseDraftRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch, blocker: patch.winder_machine_id !== undefined ? null : row.blocker } : row)))

  const addColorRow = (template: ReleaseDraftRow) => {
    const used = rows.filter((row) => row.sales_order_line_id === template.sales_order_line_id).reduce((sum, row) => sum + Number(row.release_qty || 0), 0)
    const remaining = Math.max(0, template.line_open_qty - used)
    setRows((current) => {
      const index = current.map((row) => row.sales_order_line_id).lastIndexOf(template.sales_order_line_id)
      const next = [...current]
      next.splice(index + 1, 0, { ...template, key: crypto.randomUUID(), release_lot_id: crypto.randomUUID(), mode: "new", release_qty: remaining.toFixed(0), color: "", color_id: null, blocker: null })
      return next
    })
  }

  // Validation: per row color + qty; per line the rows together fit the open balance; per color the rows fit its open qty.
  const problems = useMemo(() => {
    const byRow = new Map<string, string>()
    const lineTotals = new Map<string, number>()
    const colorTotals = new Map<string, number>()
    for (const row of rows) {
      const qty = Number(row.release_qty || 0)
      lineTotals.set(row.sales_order_line_id, (lineTotals.get(row.sales_order_line_id) || 0) + qty)
      if (row.parchment_required && row.color) {
        const key = `${row.sales_order_line_id}|${row.color}`
        colorTotals.set(key, (colorTotals.get(key) || 0) + qty)
      }
    }
    for (const row of rows) {
      const qty = Number(row.release_qty || 0)
      if (row.blocker) byRow.set(row.key, row.blocker)
      else if (!row.winder_machine_id) byRow.set(row.key, "Pick a winder queue")
      else if (qty <= 0) byRow.set(row.key, "Enter a quantity")
      else if (row.parchment_required && !row.color) byRow.set(row.key, "Pick the parchment color — one job card is one color")
      else if ((lineTotals.get(row.sales_order_line_id) || 0) > row.line_open_qty + 0.001) byRow.set(row.key, `${row.line_label} has only ${fmt(row.line_open_qty)} pcs open`)
      else if (row.parchment_required && row.mode === "new") {
        const option = row.color_options.find((entry) => entry.color === row.color)
        const allowed = (option?.open || 0) + row.unassigned_qty
        if ((colorTotals.get(`${row.sales_order_line_id}|${row.color}`) || 0) > allowed + 0.001) {
          byRow.set(row.key, `Only ${fmt(allowed)} pcs available for ${row.color} (${fmt(option?.open || 0)} ${row.color} + ${fmt(row.unassigned_qty)} unassigned)`)
        }
      }
    }
    return byRow
  }, [rows])

  const confirm = async () => {
    const normalized = rows.map((row) => ({ ...row, qty: Number(row.release_qty || 0) })).filter((row) => row.qty > 0)
    if (!normalized.length || problems.size) {
      showToast(Array.from(problems.values())[0] || "Nothing to release.", "error")
      return
    }
    // One request: every row's lot is created or none is. Each row keeps its own lot id, so
    // pressing Release again after a lost response returns the same lots instead of new ones.
    let lots: any[] = []
    try {
      const response = await releaseLinesBulk.mutateAsync({
        plantId: orderPlantId(order),
        rows: normalized.map((row) => ({
          line_id: row.sales_order_line_id,
          release_qty: row.qty,
          winder_machine_id: row.winder_machine_id,
          product_code: row.product_code || null,
          release_lot_id: row.release_lot_id,
          parchment_color: row.parchment_required ? row.color : null,
          parchment_color_id: row.parchment_required ? row.color_id : null,
        })),
      })
      lots = Array.isArray(response?.data?.lots) ? response.data.lots : []
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      showToast(error?.response ? (typeof detail === "string" ? detail : "Release failed. Nothing was released.") : "No answer from the server. Press Release again — it will not release twice.", "error")
      return
    }
    const persisted = normalized.map((row, index) => ({
      ...row,
      release_lot_id: String(lots[index]?.release_lot_id || lots[index]?.id || row.release_lot_id),
      color: String(lots[index]?.parchment_color || row.color || ""),
    }))
    const syncPayload = {
      line_ids: Array.from(new Set(persisted.map((row) => row.sales_order_line_id))),
      release_rows: persisted.map((row) => ({
        release_lot_id: row.release_lot_id,
        sales_order_line_id: row.sales_order_line_id,
        release_qty: row.qty,
        winder_machine_id: row.winder_machine_id,
        product_code: row.product_code || null,
        parchment_color: row.parchment_required ? row.color || null : null,
      })),
    }
    const { pending: syncPending, error: syncError } = await runSync(syncPayload)
    const plantId = orderPlantId(order)
    if (plantId) setActivePlant(plantId)
    setOutcome({ winderMachineId: String(persisted[0]?.winder_machine_id || ""), lotIds: persisted.map((row) => String(row.release_lot_id)), syncPending, syncError, syncPayload })
    onReleased?.({ lotIds: persisted.map((row) => String(row.release_lot_id)), jobCardIds: [], syncPending })
    showToast(syncPending ? `Release recorded — planning sync pending: ${syncError}` : `${persisted.length} job card(s) created in the winder queue.`, syncPending ? "error" : "success")
  }

  const totalQty = rows.reduce((sum, row) => sum + Number(row.release_qty || 0), 0)
  const winders = useMemo(() => {
    const map = new Map<string, ReleaseMachine>()
    rows.forEach((row) => row.authorized_winders.forEach((machine) => map.set(String(machine.id), machine)))
    return Array.from(map.values())
  }, [rows])
  const addedByWinder = rows.reduce((acc: Record<string, number>, row) => {
    if (row.winder_machine_id) acc[row.winder_machine_id] = (acc[row.winder_machine_id] || 0) + Number(row.release_qty || 0)
    return acc
  }, {})
  const loadRows = winders.map((machine) => {
    const load = winderLoad.data?.machines.find((entry) => entry.machine_id === String(machine.id))
    return { id: String(machine.id), label: String(machine.code || machine.name || ""), queued: load?.queued_pcs || 0, scheduled: load?.scheduled_pcs || 0, running: load?.running_pcs || 0, cards: load?.cards || 0, adding: addedByWinder[String(machine.id)] || 0, openM: load?.open_m || 0, days: load?.days_of_work ?? null }
  })
  const maxLoad = Math.max(1, ...loadRows.map((row) => row.queued + row.scheduled + row.running + row.adding))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={tid("release-dialog")} className="max-h-[calc(100vh-2rem)] overflow-hidden rounded-xl border-border bg-muted p-0" style={{ width: "min(1120px, calc(100vw - 2rem))", maxWidth: "none" }}>
        <DialogHeader className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary ring-1 ring-inset ring-primary/20"><Factory className="h-5 w-5" /></div>
            <div>
              <DialogTitle>Release to winder queue</DialogTitle>
              <DialogDescription>Each row becomes one job card — one color, one lot. Split a line across colors or winders with “Add row”.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid max-h-[64vh] gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="px-6 py-5">
            {outcome ? (
              <div className="space-y-4" data-testid={tid("release-next-step")}>
                <div className={`rounded-2xl border px-4 py-3 text-sm ${outcome.syncPending ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"}`}>
                  {outcome.syncPending ? (
                    <>
                      <p className="font-semibold">Release recorded, but the job card is not in planning yet.</p>
                      {outcome.syncError ? <p className="mt-1" data-testid={tid("release-sync-error")}>Reason: {outcome.syncError}</p> : null}
                      <button type="button" onClick={() => { void retrySync() }} disabled={releaseSync.isPending} className="mt-2 rounded-lg border border-signal-amber-line bg-card px-3 py-1.5 text-xs font-semibold text-foreground" data-testid={tid("release-sync-retry")}>
                        {releaseSync.isPending ? "Retrying…" : "Retry planning sync"}
                      </button>
                    </>
                  ) : (
                    `${outcome.lotIds.length} job card(s) created. The release winder is a hint; schedule on any available winder.`
                  )}
                </div>
                <a href={`/planning/board?section=winder&machine_id=${outcome.winderMachineId}&order_id=${order.id}`} className="erp-btn-primary" data-testid={tid("open-winder-queue")}>
                  Open planning queue
                </a>
              </div>
            ) : !hydrated ? (
              <div className="space-y-3">{[0, 1].map((n) => <div key={n} className="skeleton h-28 rounded-xl" />)}</div>
            ) : (
              <div className="space-y-3">
                {rows.map((row, index) => {
                  const problem = problems.get(row.key)
                  const firstOfLine = rows.findIndex((entry) => entry.sales_order_line_id === row.sales_order_line_id) === index
                  const lastOfLine = rows.map((entry) => entry.sales_order_line_id).lastIndexOf(row.sales_order_line_id) === index
                  const capacity = colorCapacity(row)
                  return (
                    <div key={row.key} className={cn("rounded-xl border bg-card p-4 transition-colors", problem ? "border-signal-amber-line" : "border-border")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[13.5px] font-semibold">
                          {row.product_code || "Line"} <span className="font-normal text-muted-foreground">· {row.line_label}{firstOfLine ? ` · ${fmt(row.line_open_qty)} pcs open` : ""}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={row.mode === "resume" ? "PENDING" : "NEW"} />
                          {!firstOfLine && row.mode === "new" ? (
                            <button type="button" aria-label="Remove row" onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className={cn("mt-3 grid gap-3", row.parchment_required ? "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]" : "md:grid-cols-2")}>
                        {row.parchment_required ? (
                          <label className="space-y-1">
                            <span className="text-[12px] font-medium text-muted-foreground">Parchment color</span>
                            <select
                              aria-label="Parchment color"
                              value={row.color_id || row.color}
                              disabled={row.mode === "resume"}
                              onChange={(event) => {
                                const value = event.target.value
                                const known = row.color_options.find((option) => (option.color_id || option.color) === value)
                                const master = masterColors.find((option) => option.id === value)
                                update(row.key, known ? { color: known.color, color_id: known.color_id } : master ? { color: master.label, color_id: master.id } : { color: "", color_id: null })
                              }}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold"
                              data-testid={tid("release-color")}
                            >
                              <option value="">Choose color</option>
                              {row.color_options.length ? (
                                <optgroup label="On this order">
                                  {row.color_options.map((option) => (
                                    <option key={option.color_id || option.color} value={option.color_id || option.color}>
                                      {option.color} — {fmt(option.open)} open
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {row.unassigned_qty > 0 ? (
                                <optgroup label={`New color from ${fmt(row.unassigned_qty)} unassigned`}>
                                  {masterColors.filter((option) => !row.color_options.some((known) => known.color_id === option.id)).map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </optgroup>
                              ) : null}
                            </select>
                            {row.color ? (
                              <span className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                                <ColorChip color={row.color} className="!text-[11.5px]" />
                                <span className="tabular-nums">{Number.isFinite(capacity) ? `${fmt(capacity)} available` : ""}</span>
                              </span>
                            ) : null}
                          </label>
                        ) : null}
                        <label className="space-y-1">
                          <span className="text-[12px] font-medium text-muted-foreground">Qty (pcs)</span>
                          <input
                            type="number"
                            min="1"
                            max={row.line_open_qty}
                            readOnly={row.mode === "resume"}
                            value={row.release_qty}
                            onChange={(event) => update(row.key, { release_qty: event.target.value })}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold tabular-nums"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[12px] font-medium text-muted-foreground">Winder queue</span>
                          <select
                            value={row.winder_machine_id}
                            onChange={(event) => update(row.key, { winder_machine_id: event.target.value })}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold"
                            data-testid={tid("release-winder")}
                          >
                            <option value="">Select winder queue</option>
                            {row.authorized_winders.map((machine) => (
                              <option key={machine.id} value={machine.id}>{machine.code || machine.name}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {row.compatibility_warning ? <p className="mt-2 text-xs text-signal-amber-ink">{row.compatibility_warning}</p> : null}
                      {problem ? <p data-testid={tid("release-blocker")} className="mt-2 flex items-center gap-1.5 text-xs text-signal-amber-ink"><AlertTriangle className="h-3.5 w-3.5" />{problem}</p> : null}
                      {lastOfLine && row.mode === "new" ? (
                        <button type="button" onClick={() => addColorRow(row)} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline">
                          <Plus className="h-3.5 w-3.5" />{row.parchment_required ? "Add another color / card" : "Add another card"}
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <aside className="border-t border-border bg-card px-5 py-5 lg:border-l lg:border-t-0">
            <p className="text-[13px] font-semibold">Winder queues (pcs)</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Open work per winder. The striped part is what this release adds.</p>
            <div className="mt-4 space-y-3">
              {loadRows.length ? loadRows.map((row) => {
                const total = row.queued + row.scheduled + row.running
                const selected = row.adding > 0
                return (
                  <div key={row.id} className={cn("rounded-lg p-2 transition-colors", selected && "bg-primary/5 ring-1 ring-inset ring-primary/20")}>
                    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="font-semibold">{row.label}</span>
                      <span className="tabular-nums text-muted-foreground">{fmt(total)} pcs{row.adding ? <span className="font-semibold text-primary"> +{fmt(row.adding)}</span> : null}</span>
                    </div>
                    <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-muted">
                      <div className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-signal-amber-ink/80" style={{ width: `${(row.running / maxLoad) * 100}%` }} title={`Running ${fmt(row.running)}`} />
                      <div className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-[hsl(var(--chart-3))]" style={{ width: `${(row.scheduled / maxLoad) * 100}%` }} title={`Scheduled ${fmt(row.scheduled)}`} />
                      <div className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] bg-[hsl(var(--chart-2))]" style={{ width: `${(row.queued / maxLoad) * 100}%` }} title={`In queue ${fmt(row.queued)}`} />
                      <div className="h-full bg-[repeating-linear-gradient(45deg,hsl(var(--primary))_0_4px,hsl(var(--primary)/.45)_4px_8px)] transition-[width] duration-300" style={{ width: `${(row.adding / maxLoad) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{fmt(row.openM)} m · {row.cards} cards · {fmt(row.queued)} pcs queue · {fmt(row.scheduled)} scheduled{row.days !== null ? ` · ≈ ${row.days} days` : ""}</p>
                  </div>
                )
              }) : <p className="text-[12px] text-muted-foreground">{winderLoad.isLoading ? "Loading queues…" : "No winder queues yet."}</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {[["Running", "hsl(var(--signal-amber-ink) / .8)"], ["Scheduled", "hsl(var(--chart-3))"], ["Queue", "hsl(var(--chart-2))"], ["This release", "hsl(var(--primary))"]].map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
              ))}
            </div>
            {rows.some((row) => row.parchment_required) ? (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-[13px] font-semibold">Colors in this release</p>
                <ul className="mt-2 space-y-1">
                  {Object.entries(rows.reduce((acc: Record<string, number>, row) => { if (row.color) acc[row.color] = (acc[row.color] || 0) + Number(row.release_qty || 0); return acc }, {})).map(([color, qty]) => (
                    <li key={color} className="flex items-center justify-between text-[12.5px]"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: swatchFor(color) }} />{color}</span><span className="tabular-nums">{fmt(qty)}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
        <DialogFooter className="border-t border-border bg-card px-6 py-4">
          {outcome ? (
            <button type="button" onClick={() => onOpenChange(false)} className="erp-btn-secondary">Close</button>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{fmt(totalQty)} pcs · {rows.length} card(s) · {problems.size ? `${problems.size} to fix` : "ready"}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onOpenChange(false)} className="erp-btn-secondary">Cancel</button>
                <button
                  type="button"
                  data-testid={tid("confirm-release")}
                  disabled={!hydrated || problems.size > 0 || releasePreflight.isPending || releaseLinesBulk.isPending || releaseSync.isPending}
                  onClick={() => confirm().catch((error: any) => {
                    const detail = error?.response?.data?.detail || error?.message || "Release failed."
                    showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
                  })}
                  className="erp-btn-primary disabled:opacity-50"
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
