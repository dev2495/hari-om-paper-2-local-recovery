"use client"

import { useState, type InputHTMLAttributes } from "react"

import { cn } from "@/lib/utils"
import { formatQty, fromDisplay, toDisplay, type LaneFigures, type VarietyGroup } from "@/lib/material-schedule"

export type DisplayUnit = "KG" | "MT" | "PCS"
export const unitLabel = (unit: DisplayUnit) => (unit === "MT" ? "MT" : unit === "PCS" ? "pcs" : "kg")

/** Number input that shows the display unit (kg / MT / pcs) but always writes the base unit. */
export function QtyInput({ value, unit, onChange, className, ...rest }: {
  value: string | number | undefined
  unit: DisplayUnit
  onChange: (baseValue: string) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [draft, setDraft] = useState<string | null>(null)
  const numeric = Number(value)
  const shown = draft ?? (value === "" || value === undefined || value === null || !Number.isFinite(numeric) ? "" : String(toDisplay(numeric, unit)))
  return (
    <input
      {...rest}
      type="number"
      min="0"
      step={unit === "PCS" ? "1" : "0.001"}
      className={className}
      value={shown}
      onFocus={(event) => { setDraft(shown); rest.onFocus?.(event) }}
      onBlur={(event) => { setDraft(null); rest.onBlur?.(event) }}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        onChange(text === "" ? "" : String(fromDisplay(Number(text), unit)))
      }}
    />
  )
}

const stickyHead = "sticky left-0 z-30 border-r border-border bg-[hsl(var(--surface-2))] px-3 text-left"

export function ScheduleGrid({
  lanes, days, cells, cellKey, editable, unit, vendors, laneVendors, onVendor, onCell, figures, varieties,
  demandCell, vehicles, today, manual, onManual, onFill, onRemoveLane,
}: {
  lanes: any[]
  days: Date[]
  cells: Record<string, string>
  cellKey: (day: string, itemId: string) => string
  editable: boolean
  unit: DisplayUnit
  vendors: any[]
  laneVendors: Record<string, string>
  onVendor: (itemId: string, vendorId: string) => void
  onCell: (key: string, baseValue: string) => void
  figures: Record<string, LaneFigures>
  varieties: VarietyGroup[] | null
  demandCell: (day: string, itemId: string) => number
  vehicles: Record<string, number>
  today: string
  manual: Record<string, string>
  onManual: (itemId: string, baseValue: string) => void
  onFill: (itemId: string, qty: number) => void
  onRemoveLane: (itemId: string) => void
}) {
  const label = unitLabel(unit)
  const fmt = (value: number) => formatQty(value, unit)
  // Lanes in variety order so each GSM group is contiguous, like the workbook columns.
  const ordered = varieties ? varieties.flatMap((group) => group.itemIds.map((id) => lanes.find((lane) => String(lane.id) === id)).filter(Boolean)) : lanes
  const dayKey = (date: Date) => date.toISOString().slice(0, 10)
  const dayTotal = (day: string) => ordered.reduce((sum, lane) => sum + Number(cells[cellKey(day, String(lane.id))] || 0), 0)
  const monthTotal = ordered.reduce((sum, lane) => sum + (figures[String(lane.id)]?.scheduled || 0), 0)
  const totalVehicles = Object.values(vehicles).reduce((sum, value) => sum + value, 0)
  const footCell = "border-t border-r border-border bg-[hsl(var(--surface-2))] px-2 py-1.5 text-right font-semibold tabular-nums"
  return (
    <div className="max-h-[72dvh] overflow-auto rounded-lg border border-border" data-testid="schedule-grid">
      <table className="w-full min-w-max border-separate border-spacing-0 text-[12.5px]">
        <thead className="sticky top-0 z-20">
          {varieties ? (
            <tr>
              <th className={cn(stickyHead, "border-b py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground")}>Variety</th>
              {varieties.map((group, index) => (
                <th key={group.key} colSpan={group.itemIds.length} className={cn("border-b border-r border-border px-2 py-1 text-left text-[11.5px] font-semibold", index % 2 ? "bg-[hsl(var(--surface-2))]" : "bg-primary/[.06] text-primary")}>
                  {group.label}
                  <span className="ml-1.5 font-normal text-muted-foreground">· {group.itemIds.length} lane{group.itemIds.length === 1 ? "" : "s"}</span>
                </th>
              ))}
              <th colSpan={2} className="border-b border-border bg-[hsl(var(--surface-2))]" />
            </tr>
          ) : null}
          <tr>
            <th className={cn(stickyHead, "min-w-[118px] border-b py-2 font-semibold text-muted-foreground")}>Date</th>
            {ordered.map((item: any) => (
              <th key={item.id} className="min-w-[128px] border-b border-r border-border bg-[hsl(var(--surface-2))] px-2 py-2 text-left align-top">
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate font-semibold text-foreground" title={item.name}>{item.item_code}</p>
                  {editable && !(figures[String(item.id)]?.scheduled) ? (
                    <button type="button" className="rounded px-1 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground" aria-label={`Remove ${item.item_code} lane`} onClick={() => onRemoveLane(String(item.id))}>×</button>
                  ) : null}
                </div>
                <p className="truncate text-[11px] font-normal text-muted-foreground">{item.name}</p>
                <select disabled={!editable} aria-label={`${item.item_code} vendor`} className="mt-1.5 h-7 w-full rounded-md border border-border bg-card px-1.5 text-[11.5px] text-foreground" value={laneVendors[item.id] || ""} onChange={(e) => onVendor(String(item.id), e.target.value)}>
                  <option value="">Assign vendor</option>
                  {vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
              </th>
            ))}
            <th className="min-w-[92px] border-b border-r border-border bg-[hsl(var(--surface-2))] px-2 py-2 text-right font-semibold text-muted-foreground">Day total</th>
            <th className="min-w-[64px] border-b border-border bg-[hsl(var(--surface-2))] px-2 py-2 text-right font-semibold text-muted-foreground" title="Deliveries (vehicles) planned that day">Vehicles</th>
          </tr>
          <tr>
            <th className={cn(stickyHead, "border-b bg-card py-1.5 font-semibold text-foreground")}>Op stk</th>
            {ordered.map((item: any) => (
              <td key={item.id} className="border-b border-r border-border bg-card px-2 py-1.5 text-right font-semibold tabular-nums text-foreground/85" title="Stock on hand today">{fmt(figures[String(item.id)]?.opening || 0)}</td>
            ))}
            <td className="border-b border-r border-border bg-card px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(ordered.reduce((sum, lane) => sum + (figures[String(lane.id)]?.opening || 0), 0))}</td>
            <td className="border-b border-border bg-card" />
          </tr>
        </thead>
        <tbody>
          {days.map((date) => {
            const key = dayKey(date); const sunday = date.getUTCDay() === 0; const isToday = key === today
            const total = dayTotal(key)
            return (
              <tr key={key} className={sunday ? "bg-[hsl(var(--surface-sunken))]" : "bg-card"}>
                <th className={cn("sticky left-0 z-10 border-b border-r border-border px-3 py-1 text-left font-normal", sunday ? "bg-[hsl(var(--surface-sunken))]" : "bg-card", isToday && "!bg-primary/10")}>
                  <span className={cn("font-semibold tabular-nums", isToday && "text-primary")}>{String(date.getUTCDate()).padStart(2, "0")}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span>
                </th>
                {ordered.map((item: any) => {
                  const need = demandCell(key, String(item.id))
                  const cell = cellKey(key, String(item.id))
                  return (
                    <td key={item.id} className="relative border-b border-r border-border p-0.5">
                      <QtyInput
                        disabled={!editable}
                        aria-label={`${item.item_code} ${key} ${label}`}
                        unit={unit}
                        className={cn("h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right font-medium tabular-nums outline-none transition-colors hover:border-border focus:border-ring/60 focus:bg-primary/5 disabled:text-foreground/80", Number(cells[cell]) > 0 && "bg-signal-cyan-soft/60 font-semibold text-signal-cyan-ink")}
                        value={cells[cell] || ""}
                        onChange={(value) => onCell(cell, value)}
                      />
                      {need > 0 ? <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 rounded bg-signal-amber-soft px-1 text-[10px] font-semibold text-signal-amber-ink" title={`Open orders need ${fmt(need)} ${label} by ${key}`}>need {fmt(need)}</span> : null}
                    </td>
                  )
                })}
                <td className="border-b border-r border-border px-2 py-1 text-right font-semibold tabular-nums text-foreground/85">{total > 0 ? fmt(total) : ""}</td>
                <td className="border-b border-border px-2 py-1 text-right tabular-nums">{vehicles[key] ? <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-signal-cyan-soft px-1 text-[11px] font-semibold text-signal-cyan-ink">{vehicles[key]}</span> : ""}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20">
          <tr>
            <th className={cn(stickyHead, "border-t py-1.5 font-semibold")}>Scheduled</th>
            {ordered.map((item: any) => <td key={item.id} className={footCell}>{fmt(figures[String(item.id)]?.scheduled || 0)}</td>)}
            <td className={footCell}>{fmt(monthTotal)}</td>
            <td className={cn(footCell, "border-r-0")}>{totalVehicles || ""}</td>
          </tr>
          <tr>
            <th className={cn(stickyHead, "border-t py-1.5 font-semibold text-signal-amber-ink")}>Required</th>
            {ordered.map((item: any) => {
              const row = figures[String(item.id)]
              return (
                <td key={item.id} className="border-t border-r border-border bg-[hsl(var(--surface-2))] p-0.5">
                  <QtyInput
                    disabled={!editable}
                    aria-label={`${item.item_code} monthly requirement ${label}`}
                    unit={unit}
                    placeholder={row ? `BOM ${fmt(row.bomRequired)}` : ""}
                    title={row?.manual ? `Manual requirement. BOM from open orders: ${fmt(row.bomRequired)} ${label}` : "From open orders through the spec BOM. Type a figure to plan a different monthly requirement."}
                    className={cn("h-7 w-full rounded-md border border-transparent bg-transparent px-2 text-right font-semibold tabular-nums text-signal-amber-ink outline-none placeholder:font-semibold placeholder:text-signal-amber-ink hover:border-border focus:border-ring/60 disabled:placeholder:text-signal-amber-ink", row?.manual && "bg-signal-amber-soft")}
                    value={manual[String(item.id)] ?? ""}
                    onChange={(value) => onManual(String(item.id), value)}
                  />
                </td>
              )
            })}
            <td className={cn(footCell, "text-signal-amber-ink")}>{fmt(ordered.reduce((sum, lane) => sum + (figures[String(lane.id)]?.required || 0), 0))}</td>
            <td className={cn(footCell, "border-r-0")} />
          </tr>
          <tr>
            <th className={cn(stickyHead, "border-t py-1.5 font-semibold")}>Cl stk</th>
            {ordered.map((item: any) => {
              const row = figures[String(item.id)]
              const closing = row?.closing ?? 0
              return (
                <td key={item.id} className={cn("border-t border-r border-border px-2 py-1.5 text-right font-semibold tabular-nums", closing < 0 ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-emerald-soft/50 text-signal-emerald-ink")}>
                  {fmt(closing)}
                  {closing < 0 && editable ? <button type="button" className="mt-1 block w-full rounded bg-primary/10 px-1 py-0.5 text-[10.5px] font-semibold text-primary hover:bg-primary/15" onClick={() => onFill(String(item.id), -closing)}>+ fill {fmt(-closing)}</button> : null}
                </td>
              )
            })}
            <td className={footCell}>{fmt(ordered.reduce((sum, lane) => sum + (figures[String(lane.id)]?.closing || 0), 0))}</td>
            <td className={cn(footCell, "border-r-0")} />
          </tr>
          {varieties ? (
            <tr>
              <th className={cn(stickyHead, "border-t py-1.5 text-[11.5px] font-semibold text-muted-foreground")}>Variety cl stk</th>
              {varieties.map((group) => (
                <td key={group.key} colSpan={group.itemIds.length} className={cn("border-t border-r border-border px-2 py-1.5 text-center text-[12px] font-semibold tabular-nums", group.closing < 0 ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-[hsl(var(--surface-2))]")}>
                  {group.label}: {fmt(group.opening)} + {fmt(group.scheduled)} − {fmt(group.required)} = {fmt(group.closing)}
                </td>
              ))}
              <td colSpan={2} className="border-t border-border bg-[hsl(var(--surface-2))]" />
            </tr>
          ) : null}
        </tfoot>
      </table>
    </div>
  )
}
