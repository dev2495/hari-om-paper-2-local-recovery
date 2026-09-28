"use client"

import dayjs from "dayjs"
import { useEffect, useMemo, useState } from "react"
import { CalendarPlus, Lock, Plus, Trash2, Wand2 } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useCommitDeliverySchedules, usePreviewDeliverySchedules } from "@/hooks/use-sales"
import { cn } from "@/lib/utils"

type Row = { key: string; id?: string; delivery_date: string; quantity: string; status: string; immutable: boolean }
const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  return typeof detail === "string" ? detail : detail?.message || detail?.errors?.[0]?.message || error?.message || "Could not save the delivery schedule."
}

/**
 * Customer delivery call-offs for one order line: a plain editable table.
 * Saved call-offs drive the planner calendar (customer deliveries), job-card due dates and the
 * dated material requirement in the RM & PM schedule. Delivered / locked rows are read-only.
 */
export function LineDeliveryEditor({ orderId, line, schedule, revision, disabled }: {
  orderId: string
  line: any
  schedule: any[]
  revision: number
  disabled?: boolean
}) {
  const { showToast } = useApp()
  const preview = usePreviewDeliverySchedules()
  const commit = useCommitDeliverySchedules()
  const initial = useMemo<Row[]>(() => schedule
    .filter((row) => String(row.line_id) === String(line.id) && row.status !== "cancelled")
    .sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)))
    .map((row) => ({ key: String(row.id), id: String(row.id), delivery_date: row.delivery_date, quantity: String(row.quantity), status: row.status, immutable: Boolean(row.immutable) })), [line.id, schedule])
  const [rows, setRows] = useState<Row[]>(initial)
  const [error, setError] = useState("")
  const [spread, setSpread] = useState<{ mode: "once" | "weekly" | "monthly"; start: string; count: string }>({ mode: "once", start: line.due_date || dayjs().add(7, "day").format("YYYY-MM-DD"), count: "4" })
  useEffect(() => { setRows(initial); setError("") }, [initial])

  const lineQty = Number(line.qty || 0)
  const delivered = Number(line.fulfilled_qty || 0)
  const scheduled = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  const openToSchedule = Math.max(0, lineQty - scheduled)
  const over = scheduled > lineQty + 0.001
  const dirty = JSON.stringify(rows.map(({ key, ...rest }) => rest)) !== JSON.stringify(initial.map(({ key, ...rest }) => rest))
  const editable = rows.filter((row) => !row.immutable)
  const busy = preview.isPending || commit.isPending

  const update = (key: string, patch: Partial<Row>) => { setError(""); setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row))) }
  const addRow = (date?: string, quantity?: number) => {
    setError("")
    setRows((current) => [...current, { key: `new-${Date.now()}-${Math.random()}`, delivery_date: date || dayjs(current.at(-1)?.delivery_date || undefined).add(7, "day").format("YYYY-MM-DD"), quantity: quantity ? String(quantity) : String(Math.max(0, Math.round(openToSchedule))), status: "committed", immutable: false }])
  }
  const spreadRemaining = () => {
    const remaining = Math.round(openToSchedule)
    const count = spread.mode === "once" ? 1 : Math.max(1, Math.min(52, Number(spread.count) || 1))
    if (remaining <= 0) { setError("Nothing left to schedule on this line."); return }
    const base = Math.floor(remaining / count)
    const created: Row[] = Array.from({ length: count }, (_, index) => ({
      key: `spread-${Date.now()}-${index}`,
      delivery_date: dayjs(spread.start).add(index, spread.mode === "monthly" ? "month" : "week").format("YYYY-MM-DD"),
      quantity: String(index === count - 1 ? remaining - base * (count - 1) : base),
      status: "committed",
      immutable: false,
    }))
    setError("")
    setRows((current) => [...current, ...created])
  }
  const save = async () => {
    if (!editable.length) { setError("Keep at least one open call-off, or shift dates instead of removing them all."); return }
    if (editable.some((row) => !row.delivery_date || !(Number(row.quantity) > 0))) { setError("Every call-off needs a date and a quantity above zero."); return }
    if (over) { setError(`Call-offs add up to ${fmt(scheduled)} pcs, more than the line's ${fmt(lineQty)}.`); return }
    const payload = editable.map((row) => ({ ...(row.id ? { id: row.id } : {}), line_id: String(line.id), delivery_date: row.delivery_date, quantity: Number(row.quantity), status: "committed" }))
    try {
      const checked = await preview.mutateAsync({ orderId, data: { rows: payload } })
      if (!checked.data?.valid) { setError((checked.data?.errors || []).map((row: any) => row.message).join(" ") || "The schedule was not accepted."); return }
      await commit.mutateAsync({ orderId, data: { expected_revision: checked.data.schedule_revision ?? revision, rows: payload } })
      showToast(`Line ${line.line_no}: delivery schedule saved — planner calendar and material plan updated.`, "success")
    } catch (err: any) {
      setError(err?.response?.status === 409 ? "Someone changed this order's schedule meanwhile. Reloaded — check and save again." : errorText(err))
    }
  }

  return (
    <div className="space-y-2.5" data-testid={`line-delivery-editor:${line.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        <span><strong className="tabular-nums">{fmt(scheduled)}</strong> of {fmt(lineQty)} pcs on call-offs</span>
        <span className={cn("tabular-nums", openToSchedule > 0 ? "text-signal-amber-ink" : "text-signal-emerald-ink")}>
          {openToSchedule > 0 ? `${fmt(openToSchedule)} pcs still expected on the line date (${dayjs(line.due_date).format("DD MMM")})` : "Fully scheduled"}
        </span>
        {delivered ? <span className="text-muted-foreground">{fmt(delivered)} delivered</span> : null}
      </div>

      {rows.length ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-[hsl(var(--surface-2))] text-left text-[11.5px] text-muted-foreground">
              <tr><th className="px-3 py-1.5 font-semibold">Delivery date</th><th className="px-3 py-1.5 text-right font-semibold">Pcs</th><th className="px-3 py-1.5 font-semibold">Status</th><th className="w-10" /></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const late = !row.immutable && row.delivery_date && dayjs(row.delivery_date).isBefore(dayjs(), "day")
                return (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-2 py-1">
                      {row.immutable ? <span className="px-1">{dayjs(row.delivery_date).format("ddd DD MMM YYYY")}</span> : (
                        <input type="date" aria-label={`Line ${line.line_no} call-off date`} disabled={disabled || busy} value={row.delivery_date} onChange={(event) => update(row.key, { delivery_date: event.target.value })} className={cn("h-8 rounded-md border border-input bg-card px-2 text-[13px]", late && "border-signal-rose-line text-signal-rose-ink")} />
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {row.immutable ? <span className="px-1 tabular-nums">{fmt(row.quantity)}</span> : (
                        <input type="number" min="1" aria-label={`Line ${line.line_no} call-off pcs`} disabled={disabled || busy} value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} className="h-8 w-28 rounded-md border border-input bg-card px-2 text-right text-[13px] tabular-nums" />
                      )}
                    </td>
                    <td className="px-3 py-1 text-[12px]">
                      {row.immutable ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="h-3 w-3" />{row.status}</span>
                        : !row.id ? <span className="font-semibold text-primary">new</span>
                        : late ? <span className="font-semibold text-signal-rose-ink">date passed</span>
                        : <span className="text-muted-foreground">{row.status}</span>}
                    </td>
                    <td className="px-1 py-1 text-right">
                      {!row.immutable ? <button type="button" aria-label="Remove call-off" disabled={disabled || busy} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink"><Trash2 className="h-3.5 w-3.5" /></button> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg bg-[hsl(var(--surface-2))] px-3 py-2 text-[12.5px] text-muted-foreground">No call-offs yet — the whole line is expected on {dayjs(line.due_date).format("DD MMM YYYY")}. Add call-offs if the customer takes it in parts.</p>
      )}

      {!disabled ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
          <button type="button" onClick={() => addRow()} disabled={busy} className="erp-btn-secondary !h-8"><Plus className="h-3.5 w-3.5" />Add call-off</button>
          <span className="mx-1 h-6 w-px bg-border" />
          <label className="grid gap-0.5 text-[11px] text-muted-foreground">Spread what&apos;s left
            <select value={spread.mode} onChange={(event) => setSpread((current) => ({ ...current, mode: event.target.value as any }))} className="h-8 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground">
              <option value="once">all on one date</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
            </select>
          </label>
          <label className="grid gap-0.5 text-[11px] text-muted-foreground">{spread.mode === "once" ? "on" : "from"}
            <input type="date" value={spread.start} onChange={(event) => setSpread((current) => ({ ...current, start: event.target.value }))} className="h-8 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground" />
          </label>
          {spread.mode !== "once" ? (
            <label className="grid gap-0.5 text-[11px] text-muted-foreground">deliveries
              <input type="number" min="1" max="52" value={spread.count} onChange={(event) => setSpread((current) => ({ ...current, count: event.target.value }))} className="h-8 w-16 rounded-md border border-input bg-card px-2 text-right text-[12.5px] text-foreground" />
            </label>
          ) : null}
          <button type="button" onClick={spreadRemaining} disabled={busy || openToSchedule <= 0} className="erp-btn-secondary !h-8"><Wand2 className="h-3.5 w-3.5" />Spread {fmt(openToSchedule)} pcs</button>
          <div className="ml-auto flex items-center gap-2">
            {dirty ? <button type="button" onClick={() => { setRows(initial); setError("") }} disabled={busy} className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">Undo changes</button> : null}
            <button type="button" onClick={() => void save()} disabled={!dirty || busy || over} className="erp-btn-primary !h-8" data-testid={`line-delivery-save:${line.id}`}>
              <CalendarPlus className="h-3.5 w-3.5" />{busy ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-md border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink">{error}</p> : null}
    </div>
  )
}
