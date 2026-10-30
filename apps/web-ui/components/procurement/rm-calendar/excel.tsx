"use client"

import { useMemo, useState } from "react"
import { Download, FileSpreadsheet, Upload } from "lucide-react"

import { Field, MessageBar, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useProposeArrivals } from "@/hooks/use-rm-calendar"
import { apiErrorText, type ArrivalInput, type CalendarData, type CalendarMaterial } from "@/lib/api-rm-calendar"
import { scheduleImportFactor } from "@/lib/material-schedule"
import { parseScheduleSheet, type ScheduleSourceCell } from "@/lib/schedule-workbook"
import { cn } from "@/lib/utils"

import type { Notice, Vendor } from "./detail-sheet"
import { chipState, longDate, perUnit, qty, shortDate, unitWord } from "./format"
import { Sheet } from "./sheet"

type ParsedSheet = { name: string; rows: ScheduleSourceCell[]; ignoredDatedRows: number }
type SourceUnit = "" | "KG" | "MT" | "PCS" | "L"
const LEAVE_OUT = "LEAVE_OUT"
const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")

/** Material for a workbook column: its code, else its name, ignoring spaces and dashes. */
function autoMatch(header: string, materials: CalendarMaterial[]): string {
  const wanted = key(header)
  if (!wanted) return ""
  const byCode = materials.filter((row) => key(row.item_code) === wanted)
  if (byCode.length === 1) return byCode[0].item_id
  const byName = materials.filter((row) => key(row.item_name) === wanted)
  return byName.length === 1 ? byName[0].item_id : ""
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Excel in and out of the RM inward calendar. Download: the materials of this view day by day
 * (need, counted arrivals, QC stock, proposals, balance), every arrival, and an arrivals grid in
 * the client's workbook layout. Import: the client's schedule workbook (first dated block, one
 * column per material) becomes proposals for the Owner, never approved arrivals.
 */
export function ExcelSheet({ open, onOpenChange, data, materials, classLabel, canImport, vendors, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: CalendarData
  materials: CalendarMaterial[]
  classLabel: string
  canImport: boolean
  vendors: Vendor[]
  onDone: (notice: Notice) => void
}) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [sheetName, setSheetName] = useState("")
  const [fileName, setFileName] = useState("")
  const [unit, setUnit] = useState<SourceUnit>("")
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [vendorFor, setVendorFor] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const propose = useProposeArrivals()
  const sheet = sheets.find((row) => row.name === sheetName) || null
  const byId = useMemo(() => Object.fromEntries(data.materials.map((row) => [row.item_id, row])), [data.materials])
  const headers = useMemo(() => Array.from(new Set((sheet?.rows || []).map((row) => row.header))), [sheet])
  const mapped = (header: string) => mapping[header] ?? autoMatch(header, data.materials)

  const preview = useMemo(() => {
    const out = new Map<string, { item: CalendarMaterial; date: string; qty: number; cells: string[] }>()
    const problems: string[] = []
    let past = 0
    for (const row of sheet?.rows || []) {
      const itemId = mapped(row.header)
      if (!itemId || itemId === LEAVE_OUT) continue
      const item = byId[itemId]
      if (!item) continue
      const factor = unit ? scheduleImportFactor(unit, item.uom) : null
      if (factor === null) {
        if (unit) problems.push(`${row.header}: the sheet is in ${unit === "MT" ? "tonnes" : unitWord(unit)} but ${item.item_code} is kept in ${unitWord(item.uom)}`)
        continue
      }
      if (row.date < data.today) { past += 1; continue }
      const id = `${row.date}:${itemId}`
      const current = out.get(id) || { item, date: row.date, qty: 0, cells: [] }
      current.qty = Math.round((current.qty + row.qty * factor) * 1000) / 1000
      current.cells.push(row.cell)
      out.set(id, current)
    }
    const rows = Array.from(out.values()).sort((a, b) => a.date.localeCompare(b.date) || a.item.item_code.localeCompare(b.item.item_code))
    return { rows, past, problems: Array.from(new Set(problems)) }
  }, [sheet, mapping, unit, byId, data.today]) // eslint-disable-line react-hooks/exhaustive-deps
  const unmappedHeaders = headers.filter((header) => !mapped(header))
  const ready = Boolean(sheet && unit && preview.rows.length && !unmappedHeaders.length && !preview.problems.length)

  async function readFile(file: File) {
    setError("")
    try {
      const ExcelJS = await import("exceljs")
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const parsed = workbook.worksheets.map((worksheet) => ({ name: worksheet.name, ...parseScheduleSheet(worksheet) })).filter((row) => row.rows.length)
      if (!parsed.length) throw new Error("No dated quantities were found. The sheet needs a row of material codes, then one row per date.")
      const best = [...parsed].sort((a, b) => b.rows.filter((row) => row.date >= data.today).length - a.rows.filter((row) => row.date >= data.today).length)[0]
      setSheets(parsed)
      setSheetName(best.name)
      setFileName(file.name)
      setMapping({})
      const units = Array.from(new Set(best.rows.map((row) => byId[autoMatch(row.header, data.materials)]?.uom).filter(Boolean)))
      setUnit(units.length === 1 ? (units[0] as SourceUnit) : "")
    } catch (failure: any) {
      setError(failure?.message || "The workbook could not be read")
    }
  }

  async function addProposals() {
    if (!ready) return
    setBusy(true)
    setError("")
    try {
      const entries: ArrivalInput[] = preview.rows.map((row) => {
        const vendorId = vendorFor[row.item.item_id] ?? row.item.last_vendor?.supplier_id ?? ""
        const vendor = vendors.find((option) => String(option.id) === vendorId)
        return { item_id: row.item.item_id, entry_date: row.date, qty: row.qty, supplier_id: vendor?.id || null, supplier_name: vendor?.name || null,
          note: `From ${fileName} · ${sheetName} ${row.cells.join(", ")}`.slice(0, 1000), source: "MANUAL" }
      })
      for (let start = 0; start < entries.length; start += 500) await propose.mutateAsync(entries.slice(start, start + 500))
      onDone({ tone: "success", text: `${entries.length} arrival${entries.length === 1 ? "" : "s"} from ${fileName} added as proposals for the Owner.` })
      setSheets([]); setSheetName(""); setFileName("")
      onOpenChange(false)
    } catch (failure) {
      setError(apiErrorText(failure))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const title = `RM inward calendar · ${classLabel} · ${longDate(data.days[0])} to ${longDate(data.days[data.days.length - 1])}`
    const days = workbook.addWorksheet("Day by day")
    days.addRow([title]).font = { bold: true, size: 13 }
    days.addRow(["Date", "Material code", "Material", "Unit", "Need", "Arriving (counted)", "QC stock that starts to count", "Proposed (not counted)", "Balance at day end", "Short"]).font = { bold: true }
    for (const material of materials) {
      data.days.forEach((day, index) => {
        days.addRow([longDate(day), material.item_code, material.item_name, unitWord(material.uom), material.need[index] || null, material.arrive[index] || null,
          material.qc_in?.[index] || null, material.proposed[index] || null, material.balance[index], material.balance[index] < 0 ? "Short" : null])
      })
    }
    days.views = [{ state: "frozen", ySplit: 2 }]
    days.columns.forEach((column, index) => { column.width = index === 2 ? 32 : 16 })
    const arrivals = workbook.addWorksheet("Arrivals")
    arrivals.addRow(["Date", "Material code", "Material", "Unit", "Quantity", "State", "Vendor", "PO", "Note"]).font = { bold: true }
    for (const material of materials) {
      for (const row of material.arrivals) {
        arrivals.addRow([longDate(row.date), material.item_code, material.item_name, unitWord(material.uom), row.state === "RECEIVED" ? row.received_qty : row.qty,
          chipState(row).label, row.supplier_name || "", row.po_no || "", row.note || ""])
      }
    }
    arrivals.columns.forEach((column, index) => { column.width = [14, 16, 32, 8, 12, 14, 26, 14, 40][index] || 14 })
    // Same layout as the client's schedule workbook: a row of material codes, then one row per date.
    const grid = workbook.addWorksheet("Arrivals grid")
    grid.addRow(["Date", ...materials.map((row) => row.item_code)]).font = { bold: true }
    grid.addRow(["Unit", ...materials.map((row) => unitWord(row.uom))])
    for (const day of data.days) {
      const values = materials.map((material) => material.arrivals.filter((row) => row.shown_date === day && row.state !== "RECEIVED").reduce((sum, row) => sum + row.open_qty, 0))
      if (values.some(Boolean)) grid.addRow([new Date(`${day}T00:00:00Z`), ...values.map((value) => value || null)])
    }
    grid.getColumn(1).numFmt = "dd mmm yyyy"
    grid.getColumn(1).width = 14
    const buffer = await workbook.xlsx.writeBuffer()
    save(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `rm-inward-calendar-${classLabel.toLowerCase()}-${data.days[0]}.xlsx`)
  }

  const units = preview.rows.reduce((totals, row) => ({ ...totals, [row.item.uom]: (totals[row.item.uom] || 0) + row.qty }), {} as Record<string, number>)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} wide testId="rm-excel-sheet" eyebrow={<span className="inline-flex items-center gap-1"><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />Excel</span>}
      title="Excel in and out"
      description="Download what this view shows, or bring in a schedule workbook as proposals for the Owner."
      footer={sheet && canImport ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">{preview.rows.length} arrival{preview.rows.length === 1 ? "" : "s"} · {perUnit(units)}{preview.past ? ` · ${preview.past} past date${preview.past === 1 ? "" : "s"} left out` : ""}</p>
          <button type="button" className={cn(primaryButton, "w-full sm:w-auto")} disabled={!ready || busy} onClick={addProposals}>
            <Upload className="h-4 w-4" aria-hidden="true" />{busy ? "Adding…" : `Add ${preview.rows.length} as proposals`}
          </button>
        </div>
      ) : undefined}>
      <div className="space-y-5">
        <section className="space-y-2 rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3.5">
          <p className="text-[13.5px] font-semibold text-foreground">Download this view</p>
          <p className="text-[12.5px] leading-5 text-muted-foreground">{materials.length} material{materials.length === 1 ? "" : "s"} ({classLabel}), {data.days.length} days: need, counted arrivals, QC stock, proposals and the balance per day, every arrival, and an arrivals grid in the workbook layout.</p>
          <button type="button" className={secondaryButton} disabled={!materials.length} onClick={download}><Download className="h-4 w-4" aria-hidden="true" />Download Excel</button>
        </section>

        {canImport ? (
          <section className="space-y-3">
            <div>
              <p className="text-[13.5px] font-semibold text-foreground">Import a schedule workbook</p>
              <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">The first dated block is read: one column per material (its code), one row per date. Every quantity becomes a proposed arrival; the Owner still approves it. Past dates are left out.</p>
            </div>
            <label className={cn(secondaryButton, "cursor-pointer")}>
              <Upload className="h-4 w-4" aria-hidden="true" />{fileName ? "Choose another file" : "Choose a workbook (.xlsx)"}
              <input className="sr-only" type="file" accept=".xlsx,.xlsm" aria-label="Import a schedule workbook" onChange={(event) => { const file = event.target.files?.[0]; if (file) readFile(file); event.target.value = "" }} />
            </label>
            {error ? <MessageBar tone="error">{error}</MessageBar> : null}
            {sheet ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Sheet" hint={fileName}>
                    <select className={cn(fieldClass, "max-sm:h-11")} value={sheetName} onChange={(event) => { setSheetName(event.target.value); setMapping({}) }}>
                      {sheets.map((row) => <option key={row.name} value={row.name}>{row.name} · {row.rows.length} cells</option>)}
                    </select>
                  </Field>
                  <Field label="Quantities in the sheet are in">
                    <select className={cn(fieldClass, "max-sm:h-11")} value={unit} onChange={(event) => setUnit(event.target.value as SourceUnit)}>
                      <option value="">Pick the unit</option>
                      <option value="KG">kg</option>
                      <option value="MT">tonnes (× 1,000 kg)</option>
                      <option value="PCS">pieces</option>
                      <option value="L">litres</option>
                    </select>
                  </Field>
                </div>
                <div className="space-y-2">
                  <p className="text-[12.5px] font-semibold text-foreground">Columns → materials{unmappedHeaders.length ? <span className="font-normal text-signal-amber-ink"> · {unmappedHeaders.length} to match</span> : null}</p>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {headers.map((header) => {
                      const itemId = mapped(header)
                      const item = byId[itemId]
                      return (
                        <li key={header} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] sm:items-center">
                          <span className="truncate text-[13px] font-semibold text-foreground">{header}</span>
                          <select aria-label={`Material for column ${header}`} className={cn(fieldClass, "max-sm:h-11", !itemId && "border-signal-amber-line")} value={itemId}
                            onChange={(event) => setMapping({ ...mapping, [header]: event.target.value })}>
                            <option value="">Match a material…</option>
                            <option value={LEAVE_OUT}>Leave this column out</option>
                            {data.materials.map((row) => <option key={row.item_id} value={row.item_id}>{row.item_code} · {row.item_name}</option>)}
                          </select>
                          {item ? (
                            <select aria-label={`Vendor for ${item.item_code}`} className={cn(fieldClass, "max-sm:h-11")} value={vendorFor[item.item_id] ?? item.last_vendor?.supplier_id ?? ""}
                              onChange={(event) => setVendorFor({ ...vendorFor, [item.item_id]: event.target.value })}>
                              <option value="">Vendor not decided</option>
                              {vendors.filter((option) => option.is_active !== false).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                            </select>
                          ) : <span className="text-[12px] text-muted-foreground">{itemId === LEAVE_OUT ? "Not imported" : "Pick the material first"}</span>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                {preview.problems.length ? <MessageBar tone="error">{preview.problems.slice(0, 4).join(". ")}.</MessageBar> : null}
                {!unit ? <MessageBar tone="info">Pick the unit the sheet uses: a kg column is never added to pieces.</MessageBar> : null}
                {preview.rows.length ? (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-label="Arrivals to add">
                    {preview.rows.slice(0, 40).map((row) => (
                      <li key={`${row.date}:${row.item.item_id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                        <span className="min-w-0 truncate"><span className="font-semibold text-foreground">{shortDate(row.date)}</span> · {row.item.item_code}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">{qty(row.qty, row.item.uom)}</span>
                      </li>
                    ))}
                    {preview.rows.length > 40 ? <li className="px-3 py-2 text-[12.5px] text-muted-foreground">…and {preview.rows.length - 40} more</li> : null}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : <p className="text-[12.5px] text-muted-foreground">Importing a workbook adds proposals, so it is for the Planner, Store, plant head and Owner.</p>}
      </div>
    </Sheet>
  )
}
