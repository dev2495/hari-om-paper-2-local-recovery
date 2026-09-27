"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, PackagePlus } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatQty, type LaneFigures, type VarietyGroup, type VendorPosition } from "@/lib/material-schedule"
import { unitLabel, type DisplayUnit } from "./schedule-grid"

/** Opening + scheduled against requirement, one bar per variety (paper) or lane (others). */
export function CoverageBars({ rows, unit }: {
  rows: Array<{ key: string; label: string; sub?: string; opening: number; scheduled: number; required: number; closing: number }>
  unit: DisplayUnit
}) {
  const fmt = (value: number) => formatQty(value, unit)
  const max = Math.max(1, ...rows.map((row) => Math.max(row.opening + row.scheduled, row.required)))
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No lanes in this class yet.</p>
  return (
    <div className="space-y-2.5" data-testid="schedule-coverage-bars">
      {rows.map((row) => {
        const short = row.closing < 0
        return (
          <div key={row.key} className="grid grid-cols-[92px_minmax(0,1fr)_96px] items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold">{row.label}</p>
              {row.sub ? <p className="truncate text-[11px] text-muted-foreground">{row.sub}</p> : null}
            </div>
            <div className="relative h-5 overflow-hidden rounded-md bg-muted" title={`Op ${fmt(row.opening)} + scheduled ${fmt(row.scheduled)} vs required ${fmt(row.required)} ${unitLabel(unit)}`}>
              <span className="absolute inset-y-0 left-0 bg-foreground/25" style={{ width: `${(row.opening / max) * 100}%` }} />
              <span className="absolute inset-y-0 bg-[hsl(var(--chart-2))]" style={{ left: `${(row.opening / max) * 100}%`, width: `${(row.scheduled / max) * 100}%` }} />
              {row.required > 0 ? <span className="absolute inset-y-[-2px] w-[3px] rounded bg-signal-amber-ink" style={{ left: `calc(${Math.min(100, (row.required / max) * 100)}% - 1.5px)` }} /> : null}
            </div>
            <p className={cn("text-right text-[12.5px] font-semibold tabular-nums", short ? "text-signal-rose-ink" : "text-signal-emerald-ink")}>
              {short ? "short " : "cl "}{fmt(Math.abs(row.closing))}
            </p>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-foreground/25" />Op stk</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[hsl(var(--chart-2))]" />Scheduled</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-[3px] rounded bg-signal-amber-ink" />Required</span>
      </div>
    </div>
  )
}

export function varietyRows(groups: VarietyGroup[], lanes: any[]) {
  return groups.map((group) => ({
    key: group.key, label: group.label,
    sub: group.itemIds.map((id) => lanes.find((lane) => String(lane.id) === id)?.item_code).filter(Boolean).join(" · "),
    opening: group.opening, scheduled: group.scheduled, required: group.required, closing: group.closing,
  }))
}

export function laneRows(lanes: any[], figures: Record<string, LaneFigures>) {
  return lanes.map((lane) => {
    const row = figures[String(lane.id)]
    return { key: String(lane.id), label: String(lane.item_code), sub: lane.name, opening: row?.opening || 0, scheduled: row?.scheduled || 0, required: row?.required || 0, closing: row?.closing || 0 }
  })
}

/** Workbook vendor block: scheduled with each vendor vs its pending PO -> PO to raise. */
export function VendorPositionTable({ rows, unit }: { rows: VendorPosition[]; unit: DisplayUnit }) {
  const fmt = (value: number) => formatQty(value, unit)
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">Assign a vendor to each lane to see what every vendor must deliver against its open POs.</p>
  const total = rows.reduce((acc, row) => ({ scheduled: acc.scheduled + row.scheduled, pendingPo: acc.pendingPo + row.pendingPo, raise: acc.raise + Math.max(0, row.shortPo) }), { scheduled: 0, pendingPo: 0, raise: 0 })
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="schedule-vendor-position">
      <table className="tube-grid">
        <thead>
          <tr><th>Vendor</th><th className="num">Scheduled</th><th className="num">Pending PO</th><th className="num">PO to raise</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vendorId}>
              <td className="font-medium">{row.vendorName}{row.lanes.length ? <span className="ml-1.5 text-[11px] text-muted-foreground">{row.lanes.length} lane{row.lanes.length === 1 ? "" : "s"}</span> : null}</td>
              <td className="num">{fmt(row.scheduled)}</td>
              <td className="num">{fmt(row.pendingPo)}</td>
              <td className={cn("num font-semibold", row.shortPo > 0.5 ? "text-signal-rose-ink" : "text-muted-foreground")}>{row.shortPo > 0.5 ? fmt(row.shortPo) : "—"}</td>
              <td>
                {row.vendorId === "unassigned" ? <span className="text-[12px] font-medium text-signal-amber-ink">Assign vendor</span>
                  : row.shortPo > 0.5 ? <span className="text-[12px] font-medium text-signal-rose-ink">Raise PO</span>
                  : row.shortPo < -0.5 ? <span className="text-[12px] text-muted-foreground">{fmt(-row.shortPo)} on PO not scheduled</span>
                  : <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" />Matched</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold"><td>Total</td><td className="num">{fmt(total.scheduled)}</td><td className="num">{fmt(total.pendingPo)}</td><td className="num text-signal-rose-ink">{total.raise > 0.5 ? fmt(total.raise) : "—"}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  )
}

export type UnmappedMaterial = { key: string; code: string; name?: string; qty: number; uom: string; orderNos: string[]; paperId?: string | null; materialClass: string }

/**
 * BOM problems that do not stop planning: materials with no stock item yet (quantities still
 * counted, one click creates the item) and per-line notes. Hard blockers stay separate.
 */
export function DemandIssues({ blocked, unmapped, warnings, creating, onCreate, canCreate }: {
  blocked: any[]
  unmapped: UnmappedMaterial[]
  warnings: any[]
  creating: boolean
  onCreate: (rows: UnmappedMaterial[]) => void
  canCreate: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!blocked.length && !unmapped.length && !warnings.length) return null
  return (
    <section className="space-y-2" aria-label="Requirement notes" data-testid="schedule-demand-issues">
      {blocked.length ? (
        <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-[13px] text-signal-rose-ink">
          <p className="font-semibold">{blocked.length} started job card(s) need their material issues reconciled before net buying:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{blocked.slice(0, 6).map((row, index) => <li key={index}>{row.order_no}: {row.reason}</li>)}</ul>
        </div>
      ) : null}
      {unmapped.length ? (
        <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 items-start gap-2 text-[13px] text-signal-amber-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span><span className="font-semibold">{unmapped.length} BOM material(s) have no stock item yet.</span> Their requirement is still counted below; create the stock items so stock, POs and arrivals can be planned against them.</span>
            </p>
            {canCreate ? (
              <button type="button" className="erp-btn-secondary !h-8" disabled={creating} onClick={() => onCreate(unmapped)} data-testid="schedule-create-stock-items">
                <PackagePlus className="h-4 w-4" />{creating ? "Creating…" : `Create ${unmapped.length} stock item${unmapped.length === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unmapped.map((row) => (
              <span key={row.key} className="rounded-md border border-signal-amber-line bg-card px-2 py-1 text-[12px]" title={row.orderNos.join(", ")}>
                <span className="font-semibold">{row.code}</span>
                <span className="ml-1.5 tabular-nums text-muted-foreground">{row.qty.toLocaleString("en-IN", { maximumFractionDigits: row.uom === "PCS" ? 0 : 1 })} {row.uom === "PCS" ? "pcs" : "kg"} · {row.orderNos.length} order{row.orderNos.length === 1 ? "" : "s"}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {warnings.length ? (
        <div className="rounded-xl border border-border bg-card">
          <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <span><span className="font-semibold">{warnings.length} planning note{warnings.length === 1 ? "" : "s"}</span> <span className="text-muted-foreground">— quantities are counted; review when convenient</span></span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
          {open ? (
            <ul className="max-h-[220px] space-y-1 overflow-auto border-t border-border px-4 py-2.5 text-[12.5px]">
              {warnings.map((row, index) => <li key={index}><span className="font-medium">{row.order_no || "Production"}</span>: <span className="text-muted-foreground">{row.reason}</span></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
