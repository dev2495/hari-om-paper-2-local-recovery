"use client"

import dayjs from "dayjs"
import { useMemo, useState } from "react"

import { EmptyState, Panel, StatusBadge } from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import {
  useCommitScheduleEntirePo,
  useOrderDeliverySchedules,
  usePreviewScheduleEntirePo,
} from "@/hooks/use-sales"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY") : String(value)
}

export function DeliverySchedulePanel({ order }: { order: any }) {
  const { showToast } = useApp()
  const schedulesQuery = useOrderDeliverySchedules(order?.id)
  const previewEntire = usePreviewScheduleEntirePo()
  const commitEntire = useCommitScheduleEntirePo()
  const [defaultDate, setDefaultDate] = useState(() => dayjs().add(3, "day").format("YYYY-MM-DD"))
  const [preview, setPreview] = useState<any | null>(null)

  const scheduleData = schedulesQuery.data || {}
  const items = Array.isArray(scheduleData.items) ? scheduleData.items : []
  const lines = Array.isArray(scheduleData.lines) ? scheduleData.lines : order?.lines || []
  const revision = Number(scheduleData.schedule_revision ?? order?.schedule_revision ?? 0)

  const proposedByLine = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const row of preview?.proposed_rows || []) {
      const bucket = map.get(String(row.line_id)) || []
      bucket.push(row)
      map.set(String(row.line_id), bucket)
    }
    return map
  }, [preview])

  const handlePreview = async () => {
    try {
      const response = await previewEntire.mutateAsync({
        orderId: String(order.id),
        data: { expected_revision: revision, default_date: defaultDate },
      })
      setPreview(response.data)
      if (response.data?.valid === false) {
        showToast(response.data?.errors?.[0]?.message || "Preview rejected.", "error")
      }
    } catch (error: any) {
      showToast(error?.response?.data?.detail?.message || error?.message || "Preview failed.", "error")
    }
  }

  const handleCommit = async () => {
    if (!preview?.valid) {
      showToast("Review a valid preview before committing.", "error")
      return
    }
    try {
      const response = await commitEntire.mutateAsync({
        orderId: String(order.id),
        data: { expected_revision: revision, default_date: defaultDate },
      })
      setPreview(null)
      showToast(response.data?.message || "Customer delivery schedule committed.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      const message = typeof detail === "string" ? detail : detail?.message || detail?.errors?.[0]?.message || error?.message
      showToast(message || "Commit failed.", "error")
    }
  }

  return (
    <div className="space-y-6" data-testid="delivery-schedule-panel">
      <Panel title="Customer delivery schedule" subtitle="Call-off calendar only. This is not production scheduling and not a supplier receipt.">
        {items.length === 0 ? (
          <EmptyState label="No customer delivery call-offs are persisted yet." />
        ) : (
          <div className="overflow-x-auto rounded-[1.2rem] border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Line</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Rev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {items.map((row: any) => (
                  <tr key={row.id} data-testid={`delivery-schedule-row:${row.id}`}>
                    <td className="px-3 py-2">{String(row.line_id).slice(0, 8)}</td>
                    <td className="px-3 py-2">{formatDate(row.delivery_date)}</td>
                    <td className="px-3 py-2 text-right">{Number(row.quantity || 0).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2"><StatusBadge value={row.status} />{row.immutable ? " · locked" : ""}</td>
                    <td className="px-3 py-2">{row.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Schedule entire PO"
        subtitle="Preview then commit remaining unscheduled quantity. Partial releases and started job cards stay untouched."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Default date
              <input type="date" value={defaultDate} onChange={(event) => setDefaultDate(event.target.value)} className="ml-2 rounded-lg border border-slate-200 px-2 py-1 text-sm font-medium text-slate-800" />
            </label>
            <button type="button" data-testid="schedule-entire-po:preview" onClick={() => void handlePreview()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold">
              Preview
            </button>
            <button type="button" data-testid="schedule-entire-po:commit" onClick={() => void handleCommit()} disabled={!preview?.valid || commitEntire.isPending} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Commit schedule
            </button>
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Existing commitments</p>
            <ul className="mt-3 space-y-2">
              {lines.map((line: any) => (
                <li key={line.line_id || line.id}>
                  Line {line.line_no || ""} · remaining to schedule {Number(line.remaining_to_schedule_qty ?? 0).toLocaleString("en-IN")}
                  <div className="text-xs text-slate-500">{(line.release_lots || []).length} preserved release lot(s)</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm" data-testid="schedule-entire-po:preview-body">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Reviewable preview</p>
            {!preview ? (
              <p className="mt-3 text-slate-600">Choose a date and preview the call-offs before saving.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {(preview.proposed_rows || []).filter((row: any) => !row.immutable).map((row: any, index: number) => (
                  <div key={`${row.line_id}:${index}`}>
                    {formatDate(row.delivery_date)} · {Number(row.quantity || 0).toLocaleString("en-IN")} pcs · line {String(row.line_id).slice(0, 8)}
                  </div>
                ))}
                <p className="text-xs text-slate-500">{(preview.preserved_release_lots || []).length} release lot(s) will be preserved.</p>
              </div>
            )}
          </div>
        </div>
        {proposedByLine.size > 0 ? <p className="sr-only">{proposedByLine.size} line(s) in preview</p> : null}
      </Panel>
    </div>
  )
}
