"use client"

import { Fragment, useMemo } from "react"
import dayjs from "dayjs"

import { cn } from "@/lib/utils"

import { STAGE_LABEL, STAGE_ORDER, fmtDay, fmtDayLong, fmtNum, machineMap, machineName, shiftLabel, unitLabel, type PrintSelection } from "./lib"
import type { OverviewSlot, PlanningOverview, Stage } from "./types"

export type PrintGroup = { key: string; date: string; shift: string; machineId: string; machineLabel: string; rows: OverviewSlot[] }
export type PrintStage = { stage: Stage; label: string; unit: string; slots: number; cards: number; plannedQty: number; plannedPcs: number; groups: PrintGroup[] }

/** The slots a print selection keeps, grouped per stage → day → shift → machine, in the order the floor reads them. */
export function buildPrintStages(data: PlanningOverview | undefined, selection: PrintSelection): PrintStage[] {
  if (!data) return []
  const machines = machineMap(data.machines)
  const stages = selection.stages.length ? selection.stages : STAGE_ORDER
  const machineSet = selection.machines.length ? new Set(selection.machines) : null
  const shiftSet = selection.shifts.length ? new Set<string>(selection.shifts) : null
  const slotSet = selection.slots.length ? new Set(selection.slots) : null
  return STAGE_ORDER.filter((stage) => stages.includes(stage))
    .map((stage) => {
      const rows = (data.slots || [])
        .filter(
          (slot) =>
            slot.stage === stage &&
            slot.plan_date >= selection.from &&
            slot.plan_date <= selection.to &&
            (!machineSet || machineSet.has(String(slot.machine_id))) &&
            (!shiftSet || shiftSet.has(slot.shift_code)) &&
            (!slotSet || slotSet.has(slot.id)),
        )
        .sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.shift_code.localeCompare(b.shift_code) || machineName(machines, a.machine_id).localeCompare(machineName(machines, b.machine_id)) || a.job_card_no.localeCompare(b.job_card_no) || a.part_no - b.part_no)
      const groups: PrintGroup[] = []
      for (const slot of rows) {
        const key = `${slot.plan_date}|${slot.shift_code}|${slot.machine_id}`
        const last = groups[groups.length - 1]
        if (last && last.key === key) last.rows.push(slot)
        else groups.push({ key, date: slot.plan_date, shift: slot.shift_code, machineId: String(slot.machine_id), machineLabel: machineName(machines, slot.machine_id), rows: [slot] })
      }
      return {
        stage,
        label: STAGE_LABEL[stage],
        unit: rows[0]?.unit || (stage === "PROCESS" || stage === "SLITTING" ? "pcs" : "bamboo"),
        slots: rows.length,
        cards: new Set(rows.map((slot) => slot.job_card_id)).size,
        plannedQty: rows.reduce((sum, slot) => sum + Number(slot.planned_qty || 0), 0),
        plannedPcs: rows.reduce((sum, slot) => sum + Number(slot.planned_pcs || 0), 0),
        groups,
      }
    })
}

const cell = "border border-foreground/60 px-1.5 py-1 align-top"

export function PlanningPrintSheet({ data, selection, plantLabel, printedAt }: { data: PlanningOverview | undefined; selection: PrintSelection; plantLabel: string; printedAt?: string }) {
  const stages = useMemo(() => buildPrintStages(data, selection), [data, selection])
  const withRows = stages.filter((stage) => stage.slots > 0)
  const empty = stages.filter((stage) => stage.slots === 0)
  const stamp = printedAt || dayjs().format("DD MMM YYYY HH:mm")
  const windowLabel = selection.from === selection.to ? fmtDayLong(selection.from) : `${fmtDayLong(selection.from)} – ${fmtDayLong(selection.to)}`

  return (
    <div className="pp-sheet tube-paper mx-auto w-full max-w-[1100px] bg-card text-foreground print:max-w-none" data-testid="planning-print-sheet" data-stages={withRows.length}>
      {!withRows.length ? (
        <section className="pp-stage rounded-lg border-2 border-foreground p-6 text-center text-[13px]">
          <p className="font-bold">No planned slots for this selection.</p>
          <p className="mt-1 text-[12px]">{windowLabel} · {stages.map((stage) => stage.label).join(", ") || "no stage"}</p>
        </section>
      ) : null}
      {withRows.map((stage, index) => (
        <section key={stage.stage} className={cn("pp-stage border-2 border-foreground p-4", index > 0 ? "mt-6" : "")} data-testid={`print-stage-${stage.stage}`}>
          <div className="pp-stage-head flex items-start justify-between gap-4 border-b-2 border-foreground pb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]">Shop floor planning sheet</p>
              <h1 className="mt-0.5 text-[22px] font-black leading-tight">{stage.label} plan</h1>
              <p className="mt-0.5 text-[12px]">
                {windowLabel} · {plantLabel}
                {selection.shifts.length === 1 ? ` · ${shiftLabel(selection.shifts[0])} only` : ""}
                {selection.slots.length ? ` · ${selection.slots.length} selected slot${selection.slots.length === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <div className="text-right text-[10.5px] leading-snug">
              <p>Printed {stamp}</p>
              <p>Sheet {index + 1} of {withRows.length}</p>
              <p className="mt-1">Write what was made in the Made column; the supervisor enters it in TubeOS.</p>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10.5px]">
            <div className="border border-foreground/60 px-2 py-1">
              <p className="font-bold uppercase">Slots</p>
              <p className="text-[16px] font-black tabular-nums">{fmtNum(stage.slots)}</p>
            </div>
            <div className="border border-foreground/60 px-2 py-1">
              <p className="font-bold uppercase">Job cards</p>
              <p className="text-[16px] font-black tabular-nums">{fmtNum(stage.cards)}</p>
            </div>
            <div className="border border-foreground/60 px-2 py-1">
              <p className="font-bold uppercase">Planned {unitLabel(stage.unit)}</p>
              <p className="text-[16px] font-black tabular-nums">{fmtNum(stage.plannedQty, 1)}</p>
            </div>
            <div className="border border-foreground/60 px-2 py-1">
              <p className="font-bold uppercase">Planned pieces</p>
              <p className="text-[16px] font-black tabular-nums">{fmtNum(stage.plannedPcs)}</p>
            </div>
          </div>

          <table className="pp-table mt-3 w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-muted">
                <th className={cn(cell, "w-[5%] text-left")}>#</th>
                <th className={cn(cell, "w-[11%] text-left")}>Job card</th>
                <th className={cn(cell, "w-[17%] text-left")}>Customer</th>
                <th className={cn(cell, "w-[12%] text-left")}>Size</th>
                <th className={cn(cell, "w-[8%] text-left")}>Colour</th>
                <th className={cn(cell, "w-[9%] text-right")}>Qty ({unitLabel(stage.unit)})</th>
                <th className={cn(cell, "w-[7%] text-right")}>Pcs</th>
                <th className={cn(cell, "w-[9%] whitespace-nowrap text-left")}>Due</th>
                <th className={cn(cell, "w-[9%] text-left")}>Made</th>
                <th className={cn(cell, "text-left")}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {stage.groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="pp-group bg-muted/60">
                    <td colSpan={10} className={cn(cell, "py-0.5 font-bold")}>
                      {fmtDayLong(group.date)} · {shiftLabel(group.shift)} · {group.machineLabel}
                      <span className="ml-2 font-normal">
                        {group.rows.length} slot{group.rows.length === 1 ? "" : "s"} · {fmtNum(group.rows.reduce((sum, slot) => sum + Number(slot.planned_qty || 0), 0), 1)} {unitLabel(stage.unit)}
                      </span>
                    </td>
                  </tr>
                  {group.rows.map((slot, rowIndex) => {
                    const made = Number(slot.made_in_slot || 0)
                    return (
                      <tr key={slot.id} className="pp-row">
                        <td className={cn(cell, "tabular-nums")}>{rowIndex + 1}</td>
                        <td className={cn(cell, "font-bold tabular-nums")}>
                          {slot.job_card_no}
                          {slot.is_emergency ? <span className="ml-1 rounded border border-foreground px-0.5 text-[9px] font-black uppercase">Emergency</span> : null}
                          {slot.parts > 1 ? <span className="block text-[9.5px] font-semibold">part {slot.part_no} of {slot.parts}</span> : null}
                        </td>
                        <td className={cell}>
                          {slot.customer_name || "—"}
                          {slot.customer_code ? <span className="block text-[9.5px]">{slot.customer_code}</span> : null}
                          {slot.sales_order_no ? <span className="block text-[9.5px]">{slot.sales_order_no}{slot.po_number ? ` · PO ${slot.po_number}` : ""}</span> : null}
                        </td>
                        <td className={cell}>{slot.product_size_label || "—"}</td>
                        <td className={cell}>{slot.parchment_color || "—"}</td>
                        <td className={cn(cell, "text-right font-bold tabular-nums")}>{fmtNum(slot.planned_qty, 1)}</td>
                        <td className={cn(cell, "text-right tabular-nums")}>{fmtNum(slot.planned_pcs)}</td>
                        <td className={cn(cell, "whitespace-nowrap tabular-nums")}>{fmtDay(slot.due_date)}</td>
                        <td className={cell}>{made > 0 ? <span className="text-[9.5px] tabular-nums">{fmtNum(made, 1)} logged</span> : null}</td>
                        <td className={cell} />
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-3 gap-6 text-[10.5px]">
            {["Planner", "Shift supervisor", "Plant head"].map((role) => (
              <div key={role} className="border-t border-foreground pt-1">
                <p className="font-bold">{role}</p>
                <p>Name / sign / date</p>
              </div>
            ))}
          </div>
          {index === 0 && empty.length ? <p className="mt-3 text-[10px]">No slots planned in this window for: {empty.map((stage) => stage.label).join(", ")}.</p> : null}
        </section>
      ))}
    </div>
  )
}
