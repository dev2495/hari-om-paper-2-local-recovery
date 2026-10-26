"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Undo2, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

import { RESULT_ORDER, STAGE_ORDER, fmtDay, fmtNum, isSilentSlot, machineName, requeueCountdown, shiftLabel, stageLabel, unitLabel } from "./lib"
import { Checkbox, DueChip, ResultChip } from "./ui"
import type { OverviewMachine, OverviewSlot } from "./types"

type SortKey = "card" | "customer" | "stage" | "machine" | "when" | "planned" | "pcs" | "made" | "result" | "due" | "order"
type Sort = { key: SortKey; dir: 1 | -1 }
const PAGE = 60

function compare(a: OverviewSlot, b: OverviewSlot, key: SortKey, machines: Map<string, OverviewMachine>) {
  switch (key) {
    case "card": return a.job_card_no.localeCompare(b.job_card_no) || a.part_no - b.part_no
    case "customer": return String(a.customer_name || "").localeCompare(String(b.customer_name || ""))
    case "stage": return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
    case "machine": return machineName(machines, a.machine_id).localeCompare(machineName(machines, b.machine_id))
    case "when": return a.plan_date.localeCompare(b.plan_date) || a.shift_code.localeCompare(b.shift_code)
    case "planned": return Number(a.planned_qty || 0) - Number(b.planned_qty || 0)
    case "pcs": return Number(a.planned_pcs || 0) - Number(b.planned_pcs || 0)
    case "made": return Number(a.made_in_slot || 0) - Number(b.made_in_slot || 0)
    case "result": return RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result)
    case "due": return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"))
    case "order": return String(a.sales_order_no || "").localeCompare(String(b.sales_order_no || ""))
    default: return 0
  }
}

export function SlotTable({ slots, machines, now, today, onOpenSlot, selected, onToggleSelect, onSelectMany }: { slots: OverviewSlot[]; machines: Map<string, OverviewMachine>; now: Date; today: string; onOpenSlot: (slot: OverviewSlot) => void; selected: Set<string>; onToggleSelect: (slot: OverviewSlot) => void; onSelectMany: (ids: string[], on: boolean) => void }) {
  const [sort, setSort] = useState<Sort>({ key: "when", dir: 1 })
  const [page, setPage] = useState(0)
  const sorted = useMemo(() => slots.slice().sort((a, b) => compare(a, b, sort.key, machines) * sort.dir || compare(a, b, "when", machines)), [slots, sort, machines])
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE)
  const allShownSelected = shown.length > 0 && shown.every((slot) => selected.has(slot.id))
  const someShownSelected = shown.some((slot) => selected.has(slot.id))

  const toggleSort = (key: SortKey) => setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  const Head = ({ label, sortKey, className }: { label: string; sortKey: SortKey; className?: string }) => (
    <th className={className} aria-sort={sort.key === sortKey ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(sortKey)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === sortKey ? "text-foreground" : "")}>
        {label}
        {sort.key === sortKey ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
      </button>
    </th>
  )

  if (!slots.length) return <p className="p-6 text-center text-sm text-muted-foreground">No planned slots match these filters.</p>

  return (
    <div className="-mx-4 -mb-4 overflow-x-auto" data-testid="slot-table">
      <table className="tube-grid w-full min-w-[1080px]">
        <thead>
          <tr>
            <th className="w-9">
              <Checkbox checked={allShownSelected} indeterminate={someShownSelected && !allShownSelected} onChange={(on) => onSelectMany(shown.map((slot) => slot.id), on)} label={<span className="sr-only">Select all rows shown for print</span>} className="!min-h-0" />
            </th>
            <Head label="Job card" sortKey="card" />
            <Head label="Customer" sortKey="customer" />
            <Head label="Stage" sortKey="stage" />
            <Head label="Machine" sortKey="machine" />
            <Head label="Date · shift" sortKey="when" />
            <Head label="Planned" sortKey="planned" className="num" />
            <Head label="Pcs" sortKey="pcs" className="num" />
            <Head label="Made in slot" sortKey="made" className="num" />
            <Head label="Result" sortKey="result" />
            <Head label="Due" sortKey="due" />
            <Head label="Order · PO" sortKey="order" />
          </tr>
        </thead>
        <tbody>
          {shown.map((slot) => {
            const silent = isSilentSlot(slot) ? requeueCountdown(slot, now) : null
            return (
              <tr key={slot.id} data-state={selected.has(slot.id) ? "selected" : undefined} className="cursor-pointer hover:bg-muted/60" onClick={() => onOpenSlot(slot)}>
                <td onClick={(event) => event.stopPropagation()}>
                  <Checkbox checked={selected.has(slot.id)} onChange={() => onToggleSelect(slot)} label={<span className="sr-only">Select {slot.job_card_no} for print</span>} className="!min-h-0" />
                </td>
                <td>
                  <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-primary">
                    {slot.job_card_no}
                    {slot.is_emergency ? <Zap className="h-3 w-3 text-signal-rose-ink" aria-label="Emergency" /> : null}
                  </span>
                  {slot.parts > 1 ? <span className="ml-1 rounded border border-border bg-muted px-1 text-[10.5px] font-semibold">part {slot.part_no}/{slot.parts}</span> : null}
                  <span className="block text-[11.5px] text-muted-foreground">{slot.product_size_label || ""}{slot.parchment_color ? ` · ${slot.parchment_color}` : ""}</span>
                </td>
                <td>
                  <span className="block max-w-[200px] truncate">{slot.customer_name || "—"}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{slot.customer_code || ""}</span>
                </td>
                <td>{stageLabel(slot.stage)}</td>
                <td className="max-w-[180px] truncate">{machineName(machines, slot.machine_id)}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {fmtDay(slot.plan_date)} · {shiftLabel(slot.shift_code)}
                </td>
                <td className="num">
                  {fmtNum(slot.planned_qty, 1)} <span className="text-[11px] text-muted-foreground">{unitLabel(slot.unit)}</span>
                </td>
                <td className="num">{fmtNum(slot.planned_pcs)}</td>
                <td className="num">
                  {fmtNum(slot.made_in_slot, 1)}
                  {Number(slot.made_elsewhere || 0) > 0 ? <span className="block text-[11px] text-muted-foreground">+{fmtNum(slot.made_elsewhere, 1)} elsewhere</span> : null}
                </td>
                <td>
                  <ResultChip result={slot.result} short />
                  {silent ? (
                    <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-signal-rose-ink">
                      <Undo2 className="h-3 w-3" aria-hidden="true" />
                      Back to queue {silent.text}
                    </span>
                  ) : null}
                </td>
                <td>
                  <DueChip due={slot.due_date} today={today} />
                </td>
                <td className="whitespace-nowrap text-[12px]">
                  {slot.sales_order_no || "—"}
                  {slot.po_number ? <span className="block text-[11.5px] text-muted-foreground">PO {slot.po_number}</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {sorted.length > PAGE ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-[12.5px]">
          <span className="text-muted-foreground">
            {page * PAGE + 1}–{Math.min(sorted.length, page * PAGE + PAGE)} of {sorted.length}
          </span>
          <button type="button" className="erp-btn-secondary !h-8" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <button type="button" className="erp-btn-secondary !h-8" disabled={(page + 1) * PAGE >= sorted.length} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  )
}
