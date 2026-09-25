"use client"

import dayjs from "dayjs"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react"

import { EmptyState, Panel, StatusBadge } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useCommitScheduleEntirePo, useMoveDeliverySchedule, useOrderDeliverySchedules, usePreviewScheduleEntirePo } from "@/hooks/use-sales"

type Split = { delivery_date: string; quantity: string }
type Proposal = { expected_revision: number; default_date: string; line_splits: Record<string, { delivery_date: string; quantity: number }[]> }
const qty = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 4 })
const dateLabel = (value?: string) => value && dayjs(value).isValid() ? dayjs(value).format("DD MMM YYYY") : "No date"
const fieldClass = "min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-50"

function errorMessage(error: any) {
  const detail = error?.response?.data?.detail
  return typeof detail === "string" ? detail : detail?.message || detail?.errors?.[0]?.message || error?.message || "Unable to save schedule. Try again."
}

export function DeliverySchedulePanel({ order }: { order: any }) {
  const { showToast } = useApp()
  const schedulesQuery = useOrderDeliverySchedules(order?.id)
  const previewEntire = usePreviewScheduleEntirePo()
  const commitEntire = useCommitScheduleEntirePo()
  const moveSchedule = useMoveDeliverySchedule()
  const [dayShift, setDayShift] = useState("1")
  const [movePreview, setMovePreview] = useState<any>(null)
  const [defaultDate, setDefaultDate] = useState(() => dayjs().add(3, "day").format("YYYY-MM-DD"))
  const [month, setMonth] = useState(() => dayjs().format("YYYY-MM"))
  const [splits, setSplits] = useState<Record<string, Split[]>>({})
  const [preview, setPreview] = useState<any>(null)
  const [reviewedRequest, setReviewedRequest] = useState<Proposal | null>(null)
  const [message, setMessage] = useState("")
  const requestSequence = useRef(0)
  const data = schedulesQuery.data || {}
  const items: any[] = useMemo(() => Array.isArray(data.items) ? data.items : [], [data.items])
  const lines: any[] = useMemo(() => Array.isArray(data.lines) ? data.lines : [], [data.lines])
  const revision = Number(data.schedule_revision ?? order?.schedule_revision ?? 0)
  const busy = previewEntire.isPending || commitEntire.isPending || moveSchedule.isPending
  const lineName = (id: string) => {
    const line = lines.find((row) => String(row.line_id || row.id) === String(id))
    return line ? `${line.product_code || "Line"} · ${line.line_no}` : String(id).slice(0, 8)
  }
  const clearPreview = () => { requestSequence.current += 1; setPreview(null); setReviewedRequest(null); setMessage("") }

  useEffect(() => {
    requestSequence.current += 1
    setPreview(null); setReviewedRequest(null)
    setMovePreview(null)
  }, [order?.id, revision])
  useEffect(() => { setSplits({}); setMessage("") }, [order?.id])

  const updateSplits = (id: string, rows: Split[]) => {
    clearPreview()
    setSplits((current) => ({ ...current, [id]: rows }))
  }
  const changeDate = (value: string) => { clearPreview(); setDefaultDate(value); if (value) setMonth(value.slice(0, 7)) }
  const handlePreview = async () => {
    clearPreview()
    if (!defaultDate) { setMessage("Choose the delivery date before previewing."); return }
    const line_splits: Proposal["line_splits"] = {}
    for (const [id, rows] of Object.entries(splits)) {
      if (!rows.length) continue
      if (rows.some((row) => !row.delivery_date || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0)) {
        setMessage(`${lineName(id)}: every split needs a date and a quantity greater than zero.`); return
      }
      line_splits[id] = rows.map((row) => ({ delivery_date: row.delivery_date, quantity: Number(row.quantity) }))
    }
    const payload: Proposal = { expected_revision: revision, default_date: defaultDate, line_splits }
    const sequence = requestSequence.current
    try {
      const response = await previewEntire.mutateAsync({ orderId: String(order.id), data: payload })
      if (sequence !== requestSequence.current) return
      setPreview(response.data)
      if (response.data?.valid) setReviewedRequest({ ...payload, expected_revision: response.data.schedule_revision })
      else setMessage((response.data?.errors || []).map((row: any) => row.message).join(" ") || "Preview rejected.")
    } catch (error) { if (sequence === requestSequence.current) setMessage(errorMessage(error)) }
  }
  const handleCommit = async () => {
    if (!preview?.valid || !reviewedRequest) return
    try {
      // Save the exact payload and revision reviewed, never current form/query values.
      const response = await commitEntire.mutateAsync({ orderId: String(order.id), data: reviewedRequest })
      clearPreview(); setSplits({})
      showToast(response.data?.message || "Customer delivery schedule saved.", "success")
    } catch (error: any) {
      setMessage(errorMessage(error))
      if (error?.response?.status === 409) { setPreview(null); setReviewedRequest(null); void schedulesQuery.refetch() }
    }
  }
  const handleMove = async (previewOnly: boolean) => {
    const delta = Number(dayShift)
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 366) {
      setMessage("Choose a non-zero whole-day shift between -366 and 366."); return
    }
    if (!previewOnly && !movePreview) return
    setMessage("")
    try {
      const response = await moveSchedule.mutateAsync({ orderId: String(order.id), data: {
        day_delta: previewOnly ? delta : movePreview.day_delta,
        expected_revision: previewOnly ? revision : movePreview.schedule_revision,
        preview_only: previewOnly,
      } })
      if (previewOnly) setMovePreview(response.data)
      else { setMovePreview(null); clearPreview(); showToast(response.data.message, "success") }
    } catch (error) { setMovePreview(null); setMessage(errorMessage(error)) }
  }
  const newRows: any[] = (preview?.proposed_rows || []).filter((row: any) => !row.kept && !row.immutable)
  const visibleItems = [...items.filter((row) => row.status !== "cancelled"), ...newRows.map((row) => ({ ...row, status: "preview" }))]
  const first = dayjs(`${month}-01`)
  const calendarStart = first.subtract((first.day() + 6) % 7, "day")
  const days = Array.from({ length: Math.ceil((first.daysInMonth() + (first.day() + 6) % 7) / 7) * 7 }, (_, index) => calendarStart.add(index, "day"))

  if (schedulesQuery.isLoading) return <div role="status" className="p-6 text-sm">Loading saved delivery commitments…</div>
  if (schedulesQuery.isError) return <div role="alert" className="rounded-xl border border-signal-red-line p-4 text-sm">Delivery commitments could not be loaded. <button type="button" onClick={() => void schedulesQuery.refetch()} className="underline">Retry</button></div>

  return <div className="space-y-6" data-testid="delivery-schedule-panel">
    <Panel title="Customer delivery calendar" subtitle="Saved customer commitments and the proposed delivery quantities. Production and supplier receipt dates remain separate."
      actions={<div className="flex items-center gap-2"><button type="button" aria-label="Previous delivery month" onClick={() => setMonth(first.subtract(1, "month").format("YYYY-MM"))}><ChevronLeft size={18} /></button><label className="sr-only" htmlFor="delivery-month">Delivery calendar month</label><input id="delivery-month" type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value) }} className={fieldClass} /><button type="button" aria-label="Next delivery month" onClick={() => setMonth(first.add(1, "month").format("YYYY-MM"))}><ChevronRight size={18} /></button></div>}>
      <div className="overflow-x-auto rounded-xl border border-border" data-testid="customer-delivery-calendar">
        <div className="grid min-w-[630px] grid-cols-7 bg-muted text-center text-xs font-semibold text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="p-2">{day}</div>)}</div>
        <div className="grid min-w-[630px] grid-cols-7">{days.map((day) => {
          const key = day.format("YYYY-MM-DD"); const rows = visibleItems.filter((row) => row.delivery_date === key)
          return <div key={key} className={`min-h-24 border-t border-r border-border p-2 ${day.format("YYYY-MM") !== month ? "bg-muted" : "bg-card"}`}>
            <button type="button" disabled={busy} aria-label={`Schedule delivery on ${key}`} aria-pressed={defaultDate === key} onClick={() => changeDate(key)} className={`mb-1 rounded-md px-2 py-1 text-xs font-semibold ${defaultDate === key ? "bg-slate-900 text-white" : "text-muted-foreground hover:bg-muted"}`}>{day.format("D")}</button>
            {rows.map((row, index) => <div key={row.id || `preview-${index}`} title={lineName(row.line_id)} className={`mb-1 rounded p-1 text-[11px] ${row.status === "preview" ? "border border-dashed border-signal-amber-line bg-signal-amber-soft" : "bg-signal-blue-soft"}`}><div className="truncate">{lineName(row.line_id)}</div><strong>{qty(row.quantity)} pcs</strong><div>{row.immutable ? "Locked" : row.status}</div></div>)}
          </div>
        })}</div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Select a day or enter dates below. Dashed entries are proposals until saved.</p>
    </Panel>

    <Panel title="Schedule entire PO" subtitle="Schedule each line’s remaining quantity on one date, or add dated splits. Existing commitments and release lots are preserved.">
      <fieldset disabled={busy} className="space-y-4">
        <label className="flex flex-wrap items-center gap-3 text-sm font-medium">Default delivery date<input type="date" value={defaultDate} onChange={(event) => changeDate(event.target.value)} className={fieldClass} /></label>
        <div className="space-y-3">{lines.map((line) => {
          const id = String(line.line_id || line.id); const custom = splits[id] || []; const total = custom.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
          return <div key={id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{lineName(id)}</p><p className="mt-1 text-xs text-muted-foreground">Ordered {qty(line.qty)} · Delivered {qty(line.fulfilled_qty)} · Remaining to schedule <strong>{qty(line.remaining_to_schedule_qty)} pcs</strong></p><p className="mt-1 text-xs text-muted-foreground">{(line.release_lots || []).length} release lot(s) preserved</p></div>
              {Number(line.remaining_to_schedule_qty) > 0 && <button type="button" onClick={() => updateSplits(id, [...custom, { delivery_date: defaultDate, quantity: String(Math.max(0, Number(line.remaining_to_schedule_qty) - total)) }])} className="flex items-center gap-1 text-sm font-medium"><Plus size={15} />Add date split</button>}
            </div>
            {custom.map((row, index) => <div key={index} className="mt-3 flex flex-wrap items-center gap-2">
              <input aria-label={`${lineName(id)} split ${index + 1} date`} type="date" value={row.delivery_date} onChange={(event) => updateSplits(id, custom.map((item, i) => i === index ? { ...item, delivery_date: event.target.value } : item))} className={fieldClass} />
              <input aria-label={`${lineName(id)} split ${index + 1} quantity`} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateSplits(id, custom.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} className={`${fieldClass} w-32`} /><span className="text-xs">pcs</span>
              <button type="button" aria-label={`Remove ${lineName(id)} split ${index + 1}`} onClick={() => updateSplits(id, custom.filter((_, i) => i !== index))} className="p-2 text-muted-foreground"><Trash2 size={16} /></button>
            </div>)}
            {custom.length > 0 && <p className={`mt-2 text-xs ${total > Number(line.remaining_to_schedule_qty) ? "text-signal-red-ink" : "text-muted-foreground"}`}>Split total {qty(total)} · Unscheduled after these splits {qty(Math.max(0, Number(line.remaining_to_schedule_qty) - total))} pcs</p>}
          </div>
        })}</div>
      </fieldset>
      {message && <p role="alert" className="my-3 rounded-lg border border-signal-red-line bg-signal-red-soft p-3 text-sm text-signal-red-ink">{message}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" data-testid="schedule-entire-po:preview" onClick={() => void handlePreview()} disabled={busy || !lines.some((line) => Number(line.remaining_to_schedule_qty) > 0)} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40">{previewEntire.isPending ? "Preparing preview…" : "Preview"}</button><button type="button" data-testid="schedule-entire-po:commit" onClick={() => void handleCommit()} disabled={busy || !reviewedRequest || !preview?.valid || !newRows.length} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{commitEntire.isPending ? "Saving schedule…" : "Commit schedule"}</button></div>
      <div className="mt-4 rounded-xl bg-muted p-4 text-sm" data-testid="schedule-entire-po:preview-body" aria-live="polite">
        {!preview ? <p>Review the proposed quantities and dates before saving. Changing any input requires a fresh preview.</p> : <><p className="mb-2 font-semibold">Review delivery commitments</p>{newRows.map((row, index) => <p key={index}>{lineName(row.line_id)} · {dateLabel(row.delivery_date)} · {qty(row.quantity)} pcs</p>)}{(preview.unscheduled_remainder || []).filter((row: any) => row.remaining_to_schedule_qty > 0).map((row: any) => <p key={row.line_id} className="mt-2 text-signal-amber-ink">{lineName(row.line_id)}: {qty(row.remaining_to_schedule_qty)} pcs remain unscheduled.</p>)}</>}
      </div>
    </Panel>

    <Panel title="Shift saved commitments" subtitle="Shift editable dates by the same number of days, keeping the spacing between deliveries. Review the server’s protected rows before saving.">
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">Shift by days<input className={`${fieldClass} w-32`} type="number" step="1" min="-366" max="366" value={dayShift} onChange={(event) => { setDayShift(event.target.value); setMovePreview(null) }} /></label>
        <button type="button" disabled={!items.length} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40" onClick={() => void handleMove(true)}>Preview date shift</button>
        <button type="button" disabled={!movePreview?.moved?.length} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void handleMove(false)}>Save date shift</button>
      </fieldset>
      {movePreview && <div className="mt-3 space-y-1 text-sm" aria-live="polite" data-testid="delivery-shift-preview">
        {movePreview.moved.map((row: any) => <p key={row.id}>{lineName(row.line_id)} · {qty(row.quantity)} pcs · {dateLabel(row.previous_date)} → {dateLabel(row.delivery_date)}</p>)}
        {movePreview.kept.map((row: any) => <p className="text-signal-amber-ink" key={row.id}>{lineName(row.line_id)} · {dateLabel(row.delivery_date)} · {qty(row.quantity)} pcs · preserved ({row.reason.replaceAll("_", " ")})</p>)}
        {!movePreview.moved.length && <p>No editable commitments can move.</p>}
      </div>}
    </Panel>

    <Panel title="Saved delivery commitments" subtitle="Persisted call-offs, including locked history and cancelled entries.">
      {!items.length ? <EmptyState label="No customer delivery call-offs are persisted yet." /> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-muted text-left"><tr>{["Product / line", "Delivery date", "Quantity (pcs)", "Status", "Revision"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{items.map((row) => <tr key={row.id} data-testid={`delivery-schedule-row:${row.id}`} className="border-t border-border"><td className="px-3 py-2">{lineName(row.line_id)}</td><td className="px-3 py-2">{dateLabel(row.delivery_date)}</td><td className="px-3 py-2">{qty(row.quantity)}</td><td className="px-3 py-2"><StatusBadge value={row.status} />{row.immutable ? " · locked" : ""}</td><td className="px-3 py-2">{row.revision}</td></tr>)}</tbody></table></div>}
    </Panel>
  </div>
}
