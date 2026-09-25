"use client"

import { parseScheduleSheet, mergeScheduleCells } from "@/lib/schedule-workbook"
import { businessDate } from "@/lib/business-date"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, Gauge, Play, Plus, Printer, RefreshCw, Save, Send, ShoppingCart, Target, Upload } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"
import type { ProcurementPlan, ProcurementPlanEntry } from "@/lib/procurement-types"

const currentMonth = () => businessDate().slice(0, 7)
const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const cellKey = (day: string, itemId: string) => `${day}:${itemId}`
const aliasKey = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ")
function daysIn(month: string) { const [year, value] = month.split("-").map(Number); const end = new Date(Date.UTC(year, value, 0)).getUTCDate(); return Array.from({ length: end }, (_, index) => new Date(Date.UTC(year, value - 1, index + 1))) }

export default function PurchaseSchedulerPage() {
  const { activePlant } = useAuth(); const client = useQueryClient(); const itemsQuery = useInventoryItems(); const vendorsQuery = useVendors()
  const items: any[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((row: any) => String(row.type) === "RAW_PAPER") : []), [itemsQuery.data])
  const vendors: any[] = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const [view, setView] = useState<"calendar" | "grid">("calendar"); const [selectedDay, setSelectedDay] = useState(""); const [mrpResult, setMrpResult] = useState<any>(null)
  const editSnapshot = useRef<{ id: string; version: number; dirty: boolean } | null>(null)
  const [month, setMonth] = useState(currentMonth()); const [selectedPlanId, setSelectedPlanId] = useState("")
  const [laneIds, setLaneIds] = useState<string[]>([]); const [cells, setCells] = useState<Record<string, string>>({})
  const [targetLane, setTargetLane] = useState(""); const [laneVendors, setLaneVendors] = useState<Record<string, string>>({}); const [target, setTarget] = useState("")
  const [workbookSheets, setWorkbookSheets] = useState<any[]>([]); const [importSheetName, setImportSheetName] = useState("")
  const [importRows, setImportRows] = useState<Array<{ date: string; header: string; qty: number; cell: string; item_id?: string }>>([])
  const [importAliases, setImportAliases] = useState<Record<string, string>>({})
  const [importUnit, setImportUnit] = useState<"" | "KG" | "MT">("")
  const [importSource, setImportSource] = useState<{ hash: string; sheet: string; file: string } | null>(null)
  const [importEvidence, setImportEvidence] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const plansQuery = useQuery({ queryKey: ["purchase-v2", "plans", activePlant, month], enabled: Boolean(activePlant && activePlant !== "ALL"), refetchOnWindowFocus: false, queryFn: () => purchaseApi.getPlans({ month: `${month}-01` }) })
  const plans: ProcurementPlan[] = useMemo(() => plansQuery.data?.data?.items || [], [plansQuery.data]); const selected = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) || plans[0], [plans, selectedPlanId])
  const demand = useQuery({ queryKey: ["purchase-v2", "sales-bom-demand", activePlant, month], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getMaterialDemand({ as_of_date: `${month}-01`, horizon_end: dateKey(daysIn(month).at(-1)!) }) })
  const requirements: any[] = useMemo(() => demand.data?.data?.requirements || [], [demand.data])
  const blocked: any[] = demand.data?.data?.blocked || []
  const { demandTotals, demandByDay, demandByItem } = useMemo(() => {
    const totals: Record<string, number> = {}; const byDay: Record<string, number> = {}; const byItem: Record<string, any[]> = {}
    for (const row of requirements) {
      totals[row.item_id] = (totals[row.item_id] || 0) + row.qty_kg
      byDay[row.date] = (byDay[row.date] || 0) + row.qty_kg
      ;(byItem[row.item_id] ||= []).push(row)
    }
    return { demandTotals: totals, demandByDay: byDay, demandByItem: byItem }
  }, [requirements])
  const editable = selected?.status === "DRAFT"
  const dates = useMemo(() => daysIn(month), [month]); const lanes = laneIds.map((id) => items.find((row) => String(row.id) === id)).filter(Boolean)

  useEffect(() => { if (plans[0] && !selectedPlanId) setSelectedPlanId(plans[0].id) }, [plans, selectedPlanId])
  useEffect(() => {
    if (!selected) { editSnapshot.current = null; setCells({}); setLaneVendors({}); setLaneIds([]); return }
    if (editSnapshot.current?.id === selected.id && editSnapshot.current.dirty) return
    editSnapshot.current = { id: selected.id, version: selected.version, dirty: false }
    const nextCells: Record<string, string> = {}; const nextVendors: Record<string, string> = {}; const nextLanes: string[] = []
    selected.entries.forEach((entry) => { nextCells[cellKey(entry.entry_date, entry.item_id)] = String(entry.qty_kg); if (entry.supplier_id) nextVendors[entry.item_id] = entry.supplier_id; if (!nextLanes.includes(entry.item_id)) nextLanes.push(entry.item_id) })
    setCells(nextCells); setLaneVendors(nextVendors); setLaneIds(nextLanes)
  }, [selected])

  function markCalendarDirty() { if (editSnapshot.current) editSnapshot.current.dirty = true }
  useEffect(() => { setSelectedPlanId(""); setMrpResult(null); setSelectedDay(""); setImportRows([]); setWorkbookSheets([]); setImportSource(null); setImportEvidence({}); setImportUnit(""); setNotice(null) }, [activePlant, month])
  const total = Object.values(cells).reduce((sum, value) => sum + Number(value || 0), 0); const activeDays = new Set(Object.entries(cells).filter(([, value]) => Number(value) > 0).map(([key]) => key.slice(0, 10))).size
  const refresh = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const createPlan = useMutation({ mutationFn: () => purchaseApi.createPlan({ request_id: crypto.randomUUID(), month: `${month}-01`, name: `RM Schedule ${month}`, target_mode: "ARRIVAL", working_calendar: { sunday: "OFF", source: "LIVE_CALENDAR" }, entries: [] }), onSuccess: ({ data }) => { setSelectedPlanId(data.id); setNotice({ tone: "success", text: "Monthly procurement plan created. Add material lanes and daily kg." }); refresh() } })
  function entries(): ProcurementPlanEntry[] { return dates.flatMap((day) => lanes.map((item: any) => { const key = cellKey(dateKey(day), item.id); const old = selected?.entries.find((entry) => entry.entry_date === dateKey(day) && entry.item_id === item.id); return { id: old?.id, entry_date: dateKey(day), item_id: item.id, supplier_id: laneVendors[item.id] || old?.supplier_id || undefined, supplier_name: vendors.find((vendor: any) => String(vendor.id) === (laneVendors[item.id] || old?.supplier_id))?.name || old?.supplier_name || undefined, material_form: old?.material_form || "REEL", qty_kg: Number(cells[key] || 0), expected_unit_count: old?.expected_unit_count, notes: importEvidence[key] || old?.notes } as ProcurementPlanEntry }).filter((entry) => entry.qty_kg > 0 || Boolean(entry.id))) }
  const save = useMutation({ mutationFn: () => purchaseApi.updatePlanEntries(selected!.id, { expected_version: editSnapshot.current?.version ?? selected!.version, entries: entries(), source_hash: importSource?.hash, source_metadata: importSource ? { file_name: importSource.file, sheet: importSource.sheet, original_unit: importUnit, factor_to_kg: importUnit === "MT" ? 1000 : 1 } : undefined }), onSuccess: () => { if (editSnapshot.current) editSnapshot.current.dirty = false; setNotice({ tone: "success", text: "All daily kg entries and import evidence saved with a new plan version." }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const planAction = useMutation({ mutationFn: async (action: string) => {
    let version = editSnapshot.current?.version ?? selected!.version
    if (action === "SUBMIT") {
      const saved = await purchaseApi.updatePlanEntries(selected!.id, { expected_version: version, entries: entries() })
      version = saved.data.version
      if (editSnapshot.current) { editSnapshot.current.version = version; editSnapshot.current.dirty = false }
    }
    return purchaseApi.actOnPlan(selected!.id, { action, expected_version: version, reason: action === "REJECT" ? "Planning revision required" : undefined })
  }, onSuccess: ({ data }) => { setNotice({ tone: "success", text: `Plan moved to ${data.status}.` }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const convert = useMutation({ mutationFn: () => purchaseApi.convertPlan(selected!.id, { request_id: crypto.randomUUID(), expected_plan_version: selected!.version, entry_ids: selected!.entries.filter((entry) => entry.qty_kg > Number(entry.converted_qty_kg || 0)).map((entry) => entry.id) }), onSuccess: ({ data }) => { setNotice({ tone: "success", text: `${data.purchase_order_ids.length} vendor-grouped PO draft(s) created once.` }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  const mrp = useMutation({ mutationFn: () => purchaseApi.runMrp({ as_of_date: `${month}-01`, horizon_end: dateKey(dates[dates.length - 1]), demand_source_version: demand.data!.data.source_version, items: Object.entries(demandTotals).map(([item_id, demand_kg]) => ({ item_id, demand_kg, dated_demand: (demandByItem[item_id] || []).map((row) => ({ date: row.date, qty_kg: row.qty_kg })) })) }), onSuccess: ({ data }) => { setMrpResult(data); setNotice({ tone: "info", text: "MRP saved from open sales-order BOM requirements. Review each material and stage shortages into the calendar." }) }, onError: (error: any) => setNotice({ tone: "error", text: error?.response?.data?.detail || error.message }) })
  function stageSuggestion(row: any) {
    const alreadyPlanned = Object.entries(cells).filter(([key]) => key.endsWith(`:${row.item_id}`)).reduce((sum, [, value]) => sum + Number(value || 0), 0)
    const additional = Math.max(0, row.suggested_order_kg - alreadyPlanned)
    if (additional <= 0) { setNotice({ tone: "info", text: `${row.item_code}: this calendar already covers the suggested ${row.suggested_order_kg.toLocaleString("en-IN")} kg. Review delivery timing before adding more.` }); return }
    const day = row.first_shortage_date || requirements.filter((requirement) => requirement.item_id === row.item_id).map((requirement) => requirement.date).sort()[0] || `${month}-01`
    markCalendarDirty()
    setLaneIds((current) => Array.from(new Set([...current, row.item_id])))
    setCells((current) => ({ ...current, [cellKey(day, row.item_id)]: String(Number(current[cellKey(day, row.item_id)] || 0) + additional) }))
    setSelectedDay(day); setNotice({ tone: "info", text: `${row.item_code}: ${additional.toLocaleString("en-IN")} additional kg staged for ${day}. Assign the vendor, review timing and save.` })
  }
  async function exportCalendar() {
    const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(month)
    sheet.addRow(["Date", "Day", ...lanes.map((item: any) => item.item_code), "Total kg"])
    dates.forEach((day) => { const quantities = lanes.map((item: any) => Number(cells[cellKey(dateKey(day), item.id)] || 0)); sheet.addRow([dateKey(day), day.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" }), ...quantities, quantities.reduce((a, b) => a + b, 0)]) })
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }]; sheet.columns.forEach((column) => { column.width = 18 })
    sheet.getRow(1).font = { bold: true }; sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `RM-Schedule-${month}.xlsx`; link.click(); URL.revokeObjectURL(url)
  }

  function fillTarget() {
    const targetMaterial = lanes.find((lane: any) => lane.id === targetLane) || lanes[0]
    if (!targetMaterial || Number(target) <= 0) return
    const working = dates.filter((day) => day.getUTCDay() !== 0); const base = Math.floor(Number(target) * 1000 / working.length) / 1000
    let remaining = Math.round(Number(target) * 1000) / 1000; const next = { ...cells }
    dates.forEach((day) => { delete next[cellKey(dateKey(day), targetMaterial.id)] })
    working.forEach((day, index) => { const qty = index === working.length - 1 ? remaining : base; next[cellKey(dateKey(day), targetMaterial.id)] = qty.toFixed(3); remaining = Math.round((remaining - qty) * 1000) / 1000 })
    markCalendarDirty()
    setCells(next); setNotice({ tone: "info", text: `${Number(target).toLocaleString("en-IN")} kg allocated across ${working.length} working days. Review vendor capacity before saving.` })
  }

  async function importWorkbook(file: File) {
    try {
      const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook(); const buffer = await file.arrayBuffer(); await workbook.xlsx.load(buffer)
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map((byte) => byte.toString(16).padStart(2, "0")).join("")
      const sheets = workbook.worksheets.map((sheet) => ({ name: sheet.name, ...parseScheduleSheet(sheet) }))
      if (!sheets.length) throw new Error("Workbook has no worksheet")
      setWorkbookSheets(sheets)
      const matchedSheet = sheets.find((sheet) => sheet.rows.some((row) => row.date.startsWith(month))) || sheets[0]
      selectImportSheet(matchedSheet, { hash: digest, sheet: matchedSheet.name, file: file.name })
    } catch (error: any) { setNotice({ tone: "error", text: error.message || "Workbook could not be read" }) }
  }
  function selectImportSheet(sheet: any, source = importSource) {
    const preview = sheet.rows.map((row: any) => ({ ...row, item_id: items.find((item) => aliasKey(row.header) === aliasKey(String(item.item_code)))?.id }))
    setImportSheetName(sheet.name); setImportRows(preview); setImportAliases({})
    if (source) setImportSource({ ...source, sheet: sheet.name })
    setNotice({ tone: "info", text: `${sheet.name}: ${preview.length} cells from the first daily scheduling block. ${sheet.ignoredDatedRows} dated rows outside that block excluded (for example finished-goods targets). Choose units and map materials; explicitly exclude helper columns.` })
  }
  const importedItemId = (row: { header: string; item_id?: string }) => row.item_id || importAliases[row.header]
  function applyImport() {
    if (!importUnit || importRows.some((row) => !importedItemId(row) || !row.date.startsWith(month))) return
    const matched = importRows.filter((row) => importedItemId(row) !== "IGNORE").map((row) => ({ ...row, item_id: importedItemId(row)! }))
    const merged = mergeScheduleCells(matched, importUnit === "MT" ? 1000 : 1)
    markCalendarDirty()
    setLaneIds((current) => Array.from(new Set([...current, ...matched.map((row) => row.item_id)])))
    setCells((current) => ({ ...current, ...merged.cells }))
    setImportEvidence((current) => ({ ...current, ...Object.fromEntries(Object.entries(merged.sources).map(([key, sources]) => [key, JSON.stringify({ source_file: importSource?.file, source_hash: importSource?.hash, sheet: importSource?.sheet, sources, original_unit: importUnit, factor_to_kg: importUnit === "MT" ? 1000 : 1 })])) }))
    setNotice({ tone: "success", text: `${matched.length} source cells combined into ${Object.keys(merged.cells).length} material/date totals in kg. Matching existing calendar cells were replaced; other dates are unchanged. Review and save.` })
  }

  const mrpByItem = useMemo(() => new Map<string, any>((mrpResult?.results || []).map((row: any) => [String(row.item_id), row])), [mrpResult])
  const scheduledFor = (itemId: string) => dates.reduce((sum, day) => sum + Number(cells[cellKey(dateKey(day), itemId)] || 0), 0)
  const requiredTotal = Object.values(demandTotals).reduce((sum, value) => sum + Number(value || 0), 0)
  const demandCell = (day: string, itemId: string) => (demandByItem[itemId] || []).filter((row) => row.date === day).reduce((sum, row) => sum + Number(row.qty_kg || 0), 0)
  const shortItems = Array.from(mrpByItem.values()).filter((row: any) => Number(row.suggested_order_kg || 0) - scheduledFor(String(row.item_id)) > 0.5)
  const coverage = requiredTotal > 0 ? Math.min(999, (total / requiredTotal) * 100) : null
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
  const shiftMonth = (delta: number) => { const [y, m] = month.split("-").map(Number); const next = new Date(Date.UTC(y, m - 1 + delta, 1)); setMonth(next.toISOString().slice(0, 7)); setSelectedPlanId(""); setMrpResult(null); setSelectedDay("") }
  const addRequiredLanes = () => { markCalendarDirty(); setLaneIds((current) => Array.from(new Set([...current, ...Object.keys(demandTotals)]))) }
  const kg = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
  const today = businessDate()

  return <ProcurementShell eyebrow="Purchase planning" title="Paper purchase planner"
    description="Plan each paper's daily arrivals against what open sales orders need. Opening stock, requirement and closing balance work like the monthly workbook; approved plans become vendor PO drafts.">
    <RequestErrors errors={[createPlan.error, plansQuery.error]} />
    {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}

    <section className="erp-panel flex flex-wrap items-center gap-2 rounded-xl p-3" aria-label="Plan controls">
      <div className="flex items-center gap-1">
        <button type="button" className="tube-icon-button border !border-border bg-card" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft /></button>
        <label className="sr-only" htmlFor="rm-plan-month">Month</label>
        <input id="rm-plan-month" aria-label="Month" className={`${fieldClass} !w-[150px]`} type="month" value={month} onChange={(e) => { if (!e.target.value) return; setMonth(e.target.value); setSelectedPlanId(""); setMrpResult(null); setSelectedDay("") }} />
        <button type="button" className="tube-icon-button border !border-border bg-card" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight /></button>
      </div>
      {plans.length > 1 ? <select aria-label="Plan" className={`${fieldClass} !w-auto`} value={selected?.id || ""} onChange={(e) => setSelectedPlanId(e.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.status}</option>)}</select> : null}
      {selected ? <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground"><StateBadge value={selected.status} /> v{selected.version}</span> : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="erp-btn-secondary cursor-pointer">
          <Upload className="h-4 w-4" />Import workbook
          <input aria-label="Import Excel" className="sr-only" type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && importWorkbook(e.target.files[0])} />
        </label>
        <button className="erp-btn-secondary" disabled={!lanes.length} onClick={exportCalendar}><Download className="h-4 w-4" />Excel</button>
        <button className="erp-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
        {!selected ? <button className={primaryButton} disabled={!activePlant || activePlant === "ALL" || plansQuery.isPending || plansQuery.isFetching || plansQuery.isError || createPlan.isPending} onClick={() => createPlan.mutate()}><Plus className="h-4 w-4" />Create month plan</button> : null}
        {selected && editable ? <button className={primaryButton} disabled={save.isPending || !lanes.length} onClick={() => save.mutate()}><Save className="h-4 w-4" />Save calendar</button> : null}
        {selected && editable ? <button className="erp-btn-secondary" disabled={planAction.isPending || !lanes.length} onClick={() => planAction.mutate("SUBMIT")}><Send className="h-4 w-4" />Submit for approval</button> : null}
        {selected?.status === "SUBMITTED" ? <button className={primaryButton} disabled={planAction.isPending} onClick={() => planAction.mutate("APPROVE")}><CheckCircle2 className="h-4 w-4" />Approve plan</button> : null}
        {selected && ["APPROVED", "LOCKED"].includes(selected.status) ? <button className={primaryButton} disabled={convert.isPending || !selected.entries.length} onClick={() => convert.mutate()}><ShoppingCart className="h-4 w-4" />Generate vendor PO drafts</button> : null}
      </div>
    </section>

    {workbookSheets.length || importRows.length ? <WorkPanel title="Workbook import" description="Match each workbook column to a paper in your masters, choose the unit, then stage the cells into this month.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workbookSheets.length ? <Field label="Worksheet"><select className={fieldClass} value={importSheetName} onChange={(event) => selectImportSheet(workbookSheets.find((sheet) => sheet.name === event.target.value))}>{workbookSheets.map((sheet) => <option key={sheet.name}>{sheet.name}</option>)}</select></Field> : null}
        <Field label="Workbook quantity unit" hint="required"><select className={fieldClass} value={importUnit} onChange={(e) => setImportUnit(e.target.value as "" | "KG" | "MT")}><option value="">Select source unit</option><option value="KG">kg · factor 1</option><option value="MT">MT · factor 1,000</option></select></Field>
      </div>
      {importRows.length ? <div className="mt-4 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3"><p className="text-[13px] font-semibold text-signal-amber-ink">Workbook preview: {importRows.length} positive dated cells · {importRows.filter((row) => importedItemId(row)).length} mapped · {importRows.filter((row) => !importedItemId(row)).length} to map · {importRows.filter((row) => !row.date.startsWith(month)).length} outside {monthLabel}</p>{Array.from(new Set(importRows.filter((row) => !row.item_id).map((row) => row.header))).length ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{Array.from(new Set(importRows.filter((row) => !row.item_id).map((row) => row.header))).map((header) => <label key={header} className="rounded-lg border border-signal-amber-line bg-card p-2.5 text-[12px] font-medium text-foreground/80"><span className="block truncate" title={header}>{header}</span><select aria-label={`Map ${header}`} className={`${fieldClass} mt-1.5`} value={importAliases[header] || ""} onChange={(e) => setImportAliases((current) => ({ ...current, [header]: e.target.value }))}><option value="">Choose exact material</option><option value="IGNORE">Exclude helper / non-paper column</option>{items.map((item) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select></label>)}</div> : null}<button className={`${secondaryButton} mt-3`} onClick={applyImport} disabled={!editable || !importUnit || importRows.some((row) => !importedItemId(row) || !row.date.startsWith(month))}>Stage mapped cells as kg</button></div> : null}
    </WorkPanel> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Required by open orders" value={`${kg(requiredTotal)} kg`} detail={demand.isFetching ? "Refreshing requirement…" : `${Object.keys(demandTotals).length} papers · ${requirements.length} order lines in ${monthLabel}`} icon={Target} tone="amber" />
      <SummaryCard label="Scheduled arrivals" value={`${kg(total)} kg`} detail={`${activeDays} delivery days · ${lanes.length} papers`} icon={CalendarDays} tone="cyan" />
      <SummaryCard label="Coverage" value={coverage === null ? "—" : `${kg(coverage)}%`} detail={coverage === null ? "No open-order requirement this month" : "Scheduled arrivals ÷ requirement (before opening stock)"} icon={Gauge} tone={coverage !== null && coverage < 100 ? "rose" : "emerald"} />
      <SummaryCard label="Papers still short" value={mrpResult ? shortItems.length : "—"} detail={mrpResult ? "After opening stock, open POs and this plan" : "Run the shortage check to include stock and open POs"} icon={AlertTriangle} tone={mrpResult && shortItems.length ? "rose" : "slate"} />
    </section>

    {blocked.length ? <MessageBar tone="error">{blocked.length} order line(s) need a BOM or material mapping fix before shortages can be calculated: {blocked.map((row) => `${row.order_no}: ${row.reason}`).join("; ")}</MessageBar> : null}

    <WorkPanel title={view === "grid" ? "Monthly grid" : monthLabel} description={view === "grid" ? "One column per paper, one row per day — like the workbook. Amber shows what open orders need that day. Footer rows give scheduled, required and closing balance." : "Tap a day to enter its arrivals. Amber is what open orders need; teal is a planned arrival."} action={<div className="flex flex-wrap gap-2">
      <div className="tube-segment" role="group" aria-label="Planner view">
        <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>Workbook grid</button>
        <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Month calendar</button>
      </div>
      <select aria-label="Add material lane" className={`${fieldClass} !w-[200px]`} value="" disabled={!editable} onChange={(e) => { if (!e.target.value) return; markCalendarDirty(); setLaneIds((current) => current.includes(e.target.value) ? current : [...current, e.target.value]) }}><option value="">+ Add paper</option>{items.filter((item) => !laneIds.includes(String(item.id))).map((item) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select>
      {editable && Object.keys(demandTotals).some((id) => !laneIds.includes(id)) ? <button className="erp-btn-secondary" onClick={addRequiredLanes}><Plus className="h-4 w-4" />Add required papers</button> : null}
    </div>}>
      {!selected ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/[.04] px-4 py-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[13px]"><span className="font-semibold">No plan for {monthLabel} yet.</span> <span className="text-muted-foreground">Requirement from open orders is shown below. Create the plan to start scheduling arrivals.</span></p>
        </div>
      ) : null}
      {view === "grid" ? (
        !selected ? <EmptyState label={`Create the ${monthLabel} plan to use the workbook grid.`} /> : !lanes.length ? <EmptyState label="Add the papers open orders need, or pick a paper from “+ Add paper”." /> : (
          <div className="max-h-[70dvh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-max border-separate border-spacing-0 text-[12.5px]">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[110px] border-b border-r border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-left font-semibold text-muted-foreground">Date</th>
                  {lanes.map((item: any) => (
                    <th key={item.id} className="min-w-[132px] border-b border-r border-border bg-[hsl(var(--surface-2))] px-2 py-2 text-left align-top">
                      <p className="truncate font-semibold text-foreground" title={item.name}>{item.item_code}</p>
                      <p className="truncate text-[11px] font-normal text-muted-foreground">{item.name}</p>
                      <select disabled={!editable} aria-label={`${item.item_code} vendor`} className="mt-1.5 h-7 w-full rounded-md border border-border bg-card px-1.5 text-[11.5px] text-foreground" value={laneVendors[item.id] || ""} onChange={(e) => { markCalendarDirty(); setLaneVendors({ ...laneVendors, [item.id]: e.target.value }) }}><option value="">Assign vendor</option>{vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r border-border bg-card px-3 py-1.5 text-left font-medium text-muted-foreground">Opening stock</th>
                  {lanes.map((item: any) => { const row = mrpByItem.get(String(item.id)); return <td key={item.id} className="border-b border-r border-border bg-card px-2 py-1.5 text-right tabular-nums text-foreground/85">{row ? kg(row.opening_stock_kg) : <span className="text-muted-foreground">run check</span>}</td> })}
                </tr>
              </thead>
              <tbody>
                {dates.map((day) => {
                  const key = dateKey(day); const sunday = day.getUTCDay() === 0; const isToday = key === today
                  return (
                    <tr key={key} className={sunday ? "bg-[hsl(var(--surface-sunken))]" : "bg-card"}>
                      <th className={`sticky left-0 z-10 border-b border-r border-border px-3 py-1 text-left font-normal ${sunday ? "bg-[hsl(var(--surface-sunken))]" : "bg-card"} ${isToday ? "!bg-primary/10" : ""}`}>
                        <span className={`font-semibold tabular-nums ${isToday ? "text-primary" : ""}`}>{String(day.getUTCDate()).padStart(2, "0")}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">{day.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span>
                      </th>
                      {lanes.map((item: any) => {
                        const need = demandCell(key, String(item.id))
                        return (
                          <td key={item.id} className="relative border-b border-r border-border p-0.5">
                            <input disabled={!editable} aria-label={`${item.item_code} ${key} kg`} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right font-medium tabular-nums outline-none transition-colors hover:border-border focus:border-ring/60 focus:bg-primary/5 disabled:text-foreground/80" type="number" min="0" step="0.001" value={cells[cellKey(key, item.id)] || ""} onChange={(e) => { markCalendarDirty(); setCells({ ...cells, [cellKey(key, item.id)]: e.target.value }) }} />
                            {need > 0 ? <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 rounded bg-signal-amber-soft px-1 text-[10px] font-semibold text-signal-amber-ink" title={`Open orders need ${kg(need)} kg on ${key}`}>need {kg(need)}</span> : null}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                {[
                  ["Scheduled", (id: string) => scheduledFor(id), "text-foreground"],
                  ["Required", (id: string) => Number(demandTotals[id] || 0), "text-signal-amber-ink"],
                ].map(([label, fn, tone]: any) => (
                  <tr key={label}>
                    <th className="sticky left-0 z-30 border-t border-r border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-left font-semibold">{label}</th>
                    {lanes.map((item: any) => <td key={item.id} className={`border-t border-r border-border bg-[hsl(var(--surface-2))] px-2 py-1.5 text-right font-semibold tabular-nums ${tone}`}>{kg(fn(String(item.id)))}</td>)}
                  </tr>
                ))}
                <tr>
                  <th className="sticky left-0 z-30 border-t border-r border-border bg-[hsl(var(--surface-2))] px-3 py-1.5 text-left font-semibold">Closing stock</th>
                  {lanes.map((item: any) => {
                    const row = mrpByItem.get(String(item.id))
                    const closing = row ? Number(row.opening_stock_kg || 0) + Number(row.committed_supply_kg || 0) + scheduledFor(String(item.id)) - Number(demandTotals[String(item.id)] || 0) : null
                    const gap = row ? Math.max(0, Number(row.suggested_order_kg || 0) - scheduledFor(String(item.id))) : 0
                    return (
                      <td key={item.id} className={`border-t border-r border-border px-2 py-1.5 text-right tabular-nums ${closing !== null && closing < 0 ? "bg-signal-rose-soft font-semibold text-signal-rose-ink" : "bg-[hsl(var(--surface-2))] font-semibold"}`}>
                        {closing === null ? <span className="font-normal text-muted-foreground">—</span> : kg(closing)}
                        {gap > 0.5 && editable ? <button type="button" className="mt-1 block w-full rounded bg-primary/10 px-1 py-0.5 text-[10.5px] font-semibold text-primary hover:bg-primary/15" onClick={() => stageSuggestion(row)}>+ fill {kg(gap)}</button> : null}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : (
        <>
          <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-border">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-3 py-2 text-[11.5px] font-semibold text-muted-foreground">{day}</div>)}</div><div className="grid grid-cols-7 border-l border-border">{Array.from({ length: (dates[0].getUTCDay() + 6) % 7 }, (_, index) => <div key={`blank-${index}`} className="border-b border-r border-border bg-[hsl(var(--surface-sunken))]" />)}{dates.map((date) => { const day = dateKey(date); const arrivals = lanes.filter((item: any) => Number(cells[cellKey(day, item.id)]) > 0); const needed = (demandByDay[day] || 0); const planned = arrivals.reduce((sum: number, item: any) => sum + Number(cells[cellKey(day, item.id)] || 0), 0); return <button type="button" key={day} aria-label={`Plan arrivals ${day}`} aria-pressed={selectedDay === day} onClick={() => setSelectedDay(day)} className={`group flex min-h-[104px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors ${selectedDay === day ? "bg-primary/[.06] ring-2 ring-inset ring-primary/50" : date.getUTCDay() === 0 ? "bg-[hsl(var(--surface-sunken))]" : "bg-card hover:bg-foreground/[.025]"}`}><span className="flex items-center justify-between"><span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold ${day === today ? "bg-primary text-primary-foreground" : "text-foreground/80"}`}>{date.getUTCDate()}</span>{planned > 0 ? <span className="text-[11px] font-semibold tabular-nums text-signal-cyan-ink">{kg(planned)}</span> : null}</span>{needed > 0 ? <span className="rounded border border-signal-amber-line bg-signal-amber-soft px-1.5 py-0.5 text-[11px] font-medium text-signal-amber-ink">Need {kg(needed)} kg</span> : null}{arrivals.slice(0, 3).map((item: any) => <span key={item.id} className="truncate rounded border border-signal-cyan-line bg-signal-cyan-soft px-1.5 py-0.5 text-[11px] font-medium text-signal-cyan-ink">{item.item_code} · {kg(Number(cells[cellKey(day, item.id)]))}</span>)}{arrivals.length > 3 ? <span className="px-1 text-[11px] text-muted-foreground">+{arrivals.length - 3} more</span> : null}</button> })}</div></div></div>
          {selectedDay ? <div className="mt-4 animate-slide-down rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4"><h3 className="text-[14px] font-semibold">Arrivals · {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3>{!lanes.length ? <p className="mt-2 text-[13px] text-muted-foreground">Add a paper above to enter arrivals.</p> : <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">{lanes.map((item: any) => { const need = demandCell(selectedDay, String(item.id)); return <div key={item.id} className="rounded-lg border border-border bg-card p-3"><Field label={`${item.item_code} kg`} hint={need > 0 ? `need ${kg(need)}` : undefined}><input className={fieldClass} type="number" min="0" step="0.001" disabled={!editable} value={cells[cellKey(selectedDay, item.id)] || ""} onChange={(event) => { markCalendarDirty(); setCells({ ...cells, [cellKey(selectedDay, item.id)]: event.target.value }) }} /></Field><select aria-label={`${item.item_code} arrival vendor`} className={`${fieldClass} mt-2`} disabled={!editable} value={laneVendors[item.id] || ""} onChange={(event) => { markCalendarDirty(); setLaneVendors({ ...laneVendors, [item.id]: event.target.value }) }}><option value="">Assign vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div> })}</div>}</div> : null}
        </>
      )}
    </WorkPanel>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <WorkPanel title="What open orders need" description={demand.data?.data?.basis || "Approved sales-order quantities through their canonical recipe BOMs."} action={<button className="erp-btn-secondary" onClick={() => demand.refetch()} disabled={demand.isFetching}><RefreshCw className={`h-4 w-4 ${demand.isFetching ? "animate-spin" : ""}`} />Refresh</button>}>
        {demand.isError ? <MessageBar tone="error">Requirement could not load. Nothing has been assumed as zero — retry when services are available.</MessageBar> : null}
        {requirements.length ? <div className="max-h-[420px] overflow-auto rounded-lg border border-border"><table className="tube-grid"><thead><tr>{["Need by", "Order", "Paper", "Units", "Required kg"].map((heading) => <th key={heading} className={heading.includes("kg") || heading === "Units" ? "num" : undefined}>{heading}</th>)}</tr></thead><tbody>{[...requirements].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map((row, index) => <tr key={`${row.line_id}:${row.item_id}:${index}`}><td className="whitespace-nowrap">{row.due_date}{row.overdue ? <span className="ml-1.5 rounded bg-signal-rose-soft px-1 text-[10.5px] font-semibold text-signal-rose-ink">late</span> : null}</td><td>{row.order_no}</td><td className="font-medium">{row.item_code}</td><td className="num">{Number(row.open_units || 0).toLocaleString("en-IN")}</td><td className="num font-semibold">{kg(row.qty_kg)}</td></tr>)}</tbody></table></div> : !demand.isFetching && !demand.isError ? <EmptyState label={`No approved sales-order paper demand in ${monthLabel}.`} /> : null}
      </WorkPanel>
      <WorkPanel title="Shortage check" description="Uses opening stock, confirmed open POs, stock targets and this requirement to suggest what to buy." action={<button className={primaryButton} disabled={mrp.isPending || blocked.length > 0 || demand.isFetching || !requirements.length} onClick={() => mrp.mutate()}><Play className="h-4 w-4" />{mrp.isPending ? "Calculating…" : "Calculate purchase shortages"}</button>}>
        {!mrpResult ? <p className="text-[13px] text-muted-foreground">Run the check to see opening stock, closing balance and suggested buy quantity per paper. Suggestions can be staged straight into the plan.</p> : mrpResult.results.length === 0 ? <EmptyState label="No paper needs buying for this month." /> : <div className="space-y-2">{mrpResult.results.map((row: any) => { const remaining = Math.max(0, Number(row.suggested_order_kg || 0) - scheduledFor(String(row.item_id))); return <div className={`rounded-lg border p-3 ${remaining > 0.5 ? "border-signal-rose-line bg-signal-rose-soft/40" : "border-signal-emerald-line bg-signal-emerald-soft/40"}`} key={row.item_id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] font-semibold">{row.item_code}</p>{remaining > 0.5 ? <button className="erp-btn-secondary !h-8" disabled={!editable} onClick={() => stageSuggestion(row)}><Plus className="h-3.5 w-3.5" />Stage {kg(remaining)} kg</button> : <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" />Covered</span>}</div><p className="mt-1 text-[12px] text-muted-foreground">Need {kg(row.demand_kg)} + target {kg(row.target_stock_kg)} − stock {kg(row.opening_stock_kg)} − open POs {kg(row.committed_supply_kg)} = buy {kg(row.suggested_order_kg)} kg</p>{row.peak_timing_shortfall_kg > row.suggested_order_kg ? <p className="mt-1 text-[12px] font-medium text-signal-amber-ink">Timing gap {kg(row.peak_timing_shortfall_kg)} kg from {row.first_shortage_date} — expedite existing POs before adding more.</p> : null}{row.unconfirmed_supply_kg > 0 ? <p className="mt-1 text-[12px] text-signal-amber-ink">{kg(row.unconfirmed_supply_kg)} kg has tentative dates and isn&apos;t counted.</p> : null}{row.overdue_supply_kg > 0 ? <p className="mt-1 text-[12px] text-signal-amber-ink">{kg(row.overdue_supply_kg)} kg is overdue — re-confirm before counting it.</p> : null}</div> })}</div>}
      </WorkPanel>
    </div>

    {lanes.length && editable ? <WorkPanel title="Spread a monthly quantity" description="Distribute a paper's monthly quantity evenly over working days (Sundays off), then fine-tune individual days."><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label="Paper"><select className={fieldClass} value={targetLane || lanes[0]?.id || ""} onChange={(event) => setTargetLane(event.target.value)}>{lanes.map((lane: any) => <option key={lane.id} value={lane.id}>{lane.item_code}</option>)}</select></Field><Field label="Monthly kg"><input className={fieldClass} type="number" min="0" step="1" value={target} onChange={(e) => setTarget(e.target.value)} /></Field><button className={`${secondaryButton} self-end`} onClick={fillTarget}>Fill working days</button></div></WorkPanel> : null}
  </ProcurementShell>
}
