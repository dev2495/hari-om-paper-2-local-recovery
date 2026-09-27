"use client"

import { parseScheduleSheet, mergeScheduleCells } from "@/lib/schedule-workbook"
import { businessDate } from "@/lib/business-date"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Boxes, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FlaskConical, Layers, Play, Plus, Printer, RefreshCw, Save, ScrollText, Send, ShoppingCart, Target, Truck, Upload, Warehouse } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { EmptyState } from "@/components/erp/shell"
import { RequestErrors, Field, MessageBar, ProcurementShell, StateBadge, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { QtyInput, ScheduleGrid, unitLabel, type DisplayUnit } from "@/components/procurement/schedule/schedule-grid"
import { CoverageBars, DemandIssues, VendorPositionTable, laneRows, varietyRows, type UnmappedMaterial } from "@/components/procurement/schedule/schedule-panels"
import { useInventoryBalances, useInventoryItems } from "@/hooks/use-inventory"
import { useVendors } from "@/hooks/use-master-data"
import { purchaseApi } from "@/lib/api"
import { MATERIAL_CLASSES, classOfDemand, classOfItem, formatQty, laneFigures, openPoBalances, varietyGroups, vehiclesPerDay, vendorPositions, type MaterialClass } from "@/lib/material-schedule"
import type { ProcurementPlan, ProcurementPlanEntry } from "@/lib/procurement-types"
import { cn } from "@/lib/utils"

const currentMonth = () => businessDate().slice(0, 7)
const dateKey = (date: Date) => date.toISOString().slice(0, 10)
const cellKey = (day: string, itemId: string) => `${day}:${itemId}`
const aliasKey = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ")
function daysIn(month: string) { const [year, value] = month.split("-").map(Number); const end = new Date(Date.UTC(year, value, 0)).getUTCDate(); return Array.from({ length: end }, (_, index) => new Date(Date.UTC(year, value - 1, index + 1))) }
const CLASS_ICONS = { PAPER: ScrollText, CHEMICAL: FlaskConical, PACKING: Boxes } as const
const errorText = (error: any) => { const detail = error?.response?.data?.detail; return typeof detail === "string" ? detail : detail?.message || error?.message || "Request failed" }

export default function PurchaseSchedulerPage() {
  const { activePlant } = useAuth(); const client = useQueryClient(); const itemsQuery = useInventoryItems(); const vendorsQuery = useVendors(); const balancesQuery = useInventoryBalances()
  const plantReady = Boolean(activePlant && activePlant !== "ALL")
  const allItems: any[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data.filter((row: any) => classOfItem(row)) : []), [itemsQuery.data])
  const vendors: any[] = Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []
  const [materialClass, setMaterialClass] = useState<MaterialClass>("PAPER")
  const [weightUnit, setWeightUnit] = useState<"KG" | "MT">("KG")
  const classMeta = MATERIAL_CLASSES.find((entry) => entry.id === materialClass)!
  const unit: DisplayUnit = classMeta.baseUnit === "PCS" ? "PCS" : weightUnit
  const u = unitLabel(unit)
  const fmt = (value: number) => formatQty(value, unit)
  const items = useMemo(() => allItems.filter((item) => classOfItem(item) === materialClass), [allItems, materialClass])
  const [view, setView] = useState<"calendar" | "grid">("grid"); const [selectedDay, setSelectedDay] = useState(""); const [mrpResult, setMrpResult] = useState<any>(null)
  const editSnapshot = useRef<{ id: string; version: number; dirty: boolean } | null>(null)
  const [month, setMonth] = useState(currentMonth()); const [selectedPlanId, setSelectedPlanId] = useState("")
  const [laneIds, setLaneIds] = useState<string[]>([]); const [cells, setCells] = useState<Record<string, string>>({})
  const [manualReq, setManualReq] = useState<Record<string, string>>({})
  const [targetLane, setTargetLane] = useState(""); const [laneVendors, setLaneVendors] = useState<Record<string, string>>({}); const [target, setTarget] = useState("")
  const [workbookSheets, setWorkbookSheets] = useState<any[]>([]); const [importSheetName, setImportSheetName] = useState("")
  const [importRows, setImportRows] = useState<Array<{ date: string; header: string; qty: number; cell: string; item_id?: string }>>([])
  const [importAliases, setImportAliases] = useState<Record<string, string>>({})
  const [importUnit, setImportUnit] = useState<"" | "KG" | "MT">("")
  const [importSource, setImportSource] = useState<{ hash: string; sheet: string; file: string } | null>(null)
  const [importEvidence, setImportEvidence] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const plansQuery = useQuery({ queryKey: ["purchase-v2", "plans", activePlant, month], enabled: plantReady, refetchOnWindowFocus: false, queryFn: () => purchaseApi.getPlans({ month: `${month}-01` }) })
  const plans: ProcurementPlan[] = useMemo(() => plansQuery.data?.data?.items || [], [plansQuery.data]); const selected = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) || plans[0], [plans, selectedPlanId])
  const dates = useMemo(() => daysIn(month), [month])
  const dayKeys = useMemo(() => dates.map(dateKey), [dates])
  const demand = useQuery({ queryKey: ["purchase-v2", "sales-bom-demand", activePlant, month], enabled: plantReady, queryFn: () => purchaseApi.getMaterialDemand({ as_of_date: `${month}-01`, horizon_end: dateKey(daysIn(month).at(-1)!) }) })
  const ordersQuery = useQuery({ queryKey: ["purchase-v2", "open-po-balance", activePlant], enabled: plantReady, refetchOnWindowFocus: false, queryFn: () => purchaseApi.getOrders({ limit: 500 }) })
  const demandData = demand.data?.data
  const blocked: any[] = demandData?.blocked || []
  // Paper rows come from `requirements`; adhesive, parchment and packing from `material_requirements`.
  const allDemand: any[] = useMemo(() => [
    ...(demandData?.requirements || []).map((row: any) => ({ ...row, material_class: "PAPER", qty: row.qty_kg, uom: "KG" })),
    ...(demandData?.material_requirements || []),
  ], [demandData])
  const classDemand = useMemo(() => allDemand.filter((row) => classOfDemand(row) === materialClass), [allDemand, materialClass])
  const paperRequirements: any[] = useMemo(() => demandData?.requirements || [], [demandData])
  const { demandTotals, demandByDay, demandByItem } = useMemo(() => {
    const totals: Record<string, number> = {}; const byDay: Record<string, number> = {}; const byItem: Record<string, any[]> = {}
    for (const row of classDemand) {
      totals[row.item_id] = (totals[row.item_id] || 0) + Number(row.qty || 0)
      byDay[row.date] = (byDay[row.date] || 0) + Number(row.qty || 0)
      ;(byItem[row.item_id] ||= []).push(row)
    }
    return { demandTotals: totals, demandByDay: byDay, demandByItem: byItem }
  }, [classDemand])
  const unmapped: UnmappedMaterial[] = useMemo(() => {
    if (materialClass === "PAPER") return (demandData?.unmapped_papers || []).map((row: any) => ({ key: `paper:${row.paper_id || row.paper_code}`, code: row.paper_code || row.name, name: row.name, qty: Number(row.qty_kg || 0), uom: "KG", orderNos: row.order_nos || [], paperId: row.paper_id, materialClass: "PAPER" }))
    return (demandData?.unmapped_materials || []).filter((row: any) => classOfDemand(row) === materialClass).map((row: any) => ({ key: `${row.material_class}:${row.code}`, code: row.code, qty: Number(row.qty || 0), uom: row.uom, orderNos: row.order_nos || [], materialClass: row.material_class }))
  }, [demandData, materialClass])
  const classWarnings: any[] = useMemo(() => (demandData?.warnings || []).filter((row: any) => {
    const reason = String(row.reason || "")
    const isOther = /^(Adhesive|Parchment|Packing|Box) /.test(reason) || reason.includes("pcs-per-box")
    if (reason.includes("has no stock item yet")) return false // listed in the stock-item panel
    return materialClass === "PAPER" ? !isOther : isOther
  }), [demandData, materialClass])
  const editable = selected?.status === "DRAFT"
  const allLanes = useMemo(() => laneIds.map((id) => allItems.find((row) => String(row.id) === id)).filter(Boolean) as any[], [laneIds, allItems])
  const lanes = useMemo(() => allLanes.filter((item) => classOfItem(item) === materialClass), [allLanes, materialClass])
  const vendorName = (id: string) => vendors.find((vendor: any) => String(vendor.id) === id)?.name || "Vendor"

  useEffect(() => { if (plans[0] && !selectedPlanId) setSelectedPlanId(plans[0].id) }, [plans, selectedPlanId])
  useEffect(() => {
    if (!selected) { editSnapshot.current = null; setCells({}); setLaneVendors({}); setLaneIds([]); setManualReq({}); return }
    if (editSnapshot.current?.id === selected.id && editSnapshot.current.dirty) return
    editSnapshot.current = { id: selected.id, version: selected.version, dirty: false }
    const nextCells: Record<string, string> = {}; const nextVendors: Record<string, string> = {}; const nextLanes: string[] = []
    selected.entries.forEach((entry) => { nextCells[cellKey(entry.entry_date, entry.item_id)] = String(entry.qty_kg); if (entry.supplier_id) nextVendors[entry.item_id] = entry.supplier_id; if (!nextLanes.includes(entry.item_id)) nextLanes.push(entry.item_id) })
    const savedRequirements = ((selected.working_calendar || {}) as any).lane_requirements || {}
    Object.keys(savedRequirements).forEach((itemId) => { if (!nextLanes.includes(itemId)) nextLanes.push(itemId) })
    setCells(nextCells); setLaneVendors(nextVendors); setLaneIds(nextLanes)
    setManualReq(Object.fromEntries(Object.entries(savedRequirements).map(([itemId, qty]) => [itemId, String(qty)])))
  }, [selected])

  function markCalendarDirty() { if (editSnapshot.current) editSnapshot.current.dirty = true }
  useEffect(() => { setSelectedPlanId(""); setMrpResult(null); setSelectedDay(""); setImportRows([]); setWorkbookSheets([]); setImportSource(null); setImportEvidence({}); setImportUnit(""); setNotice(null) }, [activePlant, month])
  useEffect(() => { setSelectedDay(""); setTargetLane("") }, [materialClass])
  const refresh = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const createPlan = useMutation({ mutationFn: () => purchaseApi.createPlan({ request_id: crypto.randomUUID(), month: `${month}-01`, name: `RM Schedule ${month}`, target_mode: "ARRIVAL", working_calendar: { sunday: "OFF", source: "LIVE_CALENDAR" }, entries: [] }), onSuccess: ({ data }) => { setSelectedPlanId(data.id); setNotice({ tone: "success", text: "Monthly procurement plan created. Add material lanes and daily quantities." }); refresh() } })
  function entries(): ProcurementPlanEntry[] {
    return dates.flatMap((day) => allLanes.map((item: any) => {
      const key = cellKey(dateKey(day), item.id); const old = selected?.entries.find((entry) => entry.entry_date === dateKey(day) && entry.item_id === item.id)
      return { id: old?.id, entry_date: dateKey(day), item_id: item.id, supplier_id: laneVendors[item.id] || old?.supplier_id || undefined, supplier_name: vendors.find((vendor: any) => String(vendor.id) === (laneVendors[item.id] || old?.supplier_id))?.name || old?.supplier_name || undefined, material_form: old?.material_form || (classOfItem(item) === "PAPER" ? "REEL" : "BULK"), qty_kg: Number(cells[key] || 0), expected_unit_count: old?.expected_unit_count, notes: importEvidence[key] || old?.notes } as ProcurementPlanEntry
    }).filter((entry) => entry.qty_kg > 0 || Boolean(entry.id)))
  }
  const laneRequirementsPayload = () => Object.fromEntries(Object.entries(manualReq).filter(([itemId, value]) => value !== "" && Number.isFinite(Number(value)) && laneIds.includes(itemId)).map(([itemId, value]) => [itemId, Number(value)]))
  const save = useMutation({ mutationFn: () => purchaseApi.updatePlanEntries(selected!.id, { expected_version: editSnapshot.current?.version ?? selected!.version, entries: entries(), lane_requirements: laneRequirementsPayload(), source_hash: importSource?.hash, source_metadata: importSource ? { file_name: importSource.file, sheet: importSource.sheet, original_unit: importUnit, factor_to_kg: importUnit === "MT" ? 1000 : 1 } : undefined }), onSuccess: () => { if (editSnapshot.current) editSnapshot.current.dirty = false; setNotice({ tone: "success", text: "All daily kg entries and import evidence saved with a new plan version." }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: errorText(error) }) })
  const planAction = useMutation({ mutationFn: async (action: string) => {
    let version = editSnapshot.current?.version ?? selected!.version
    if (action === "SUBMIT") {
      const saved = await purchaseApi.updatePlanEntries(selected!.id, { expected_version: version, entries: entries(), lane_requirements: laneRequirementsPayload() })
      version = saved.data.version
      if (editSnapshot.current) { editSnapshot.current.version = version; editSnapshot.current.dirty = false }
    }
    return purchaseApi.actOnPlan(selected!.id, { action, expected_version: version, reason: action === "REJECT" ? "Planning revision required" : undefined })
  }, onSuccess: ({ data }) => { setNotice({ tone: "success", text: `Plan moved to ${data.status}.` }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: errorText(error) }) })
  const convert = useMutation({ mutationFn: () => purchaseApi.convertPlan(selected!.id, { request_id: crypto.randomUUID(), expected_plan_version: selected!.version, entry_ids: selected!.entries.filter((entry) => entry.qty_kg > Number(entry.converted_qty_kg || 0)).map((entry) => entry.id) }), onSuccess: ({ data }) => { setNotice({ tone: "success", text: `${data.purchase_order_ids.length} vendor-grouped PO draft(s) created once.` }); refresh() }, onError: (error: any) => setNotice({ tone: "error", text: errorText(error) }) })
  const paperTotals = useMemo(() => {
    const totals: Record<string, { demand_kg: number; dated: any[] }> = {}
    for (const row of paperRequirements) {
      if (row.mapped === false || String(row.item_id).startsWith("paper:")) continue
      const entry = (totals[row.item_id] ||= { demand_kg: 0, dated: [] })
      entry.demand_kg += Number(row.qty_kg || 0); entry.dated.push({ date: row.date, qty_kg: row.qty_kg })
    }
    return totals
  }, [paperRequirements])
  const mrp = useMutation({ mutationFn: () => purchaseApi.runMrp({ as_of_date: `${month}-01`, horizon_end: dateKey(dates[dates.length - 1]), demand_source_version: demandData!.source_version, items: Object.entries(paperTotals).map(([item_id, row]) => ({ item_id, demand_kg: row.demand_kg, dated_demand: row.dated })) }), onSuccess: ({ data }) => { setMrpResult(data); setNotice({ tone: "info", text: "Shortage check saved from open sales-order BOM requirements. Stage any shortage straight into the grid." }) }, onError: (error: any) => setNotice({ tone: "error", text: errorText(error) }) })
  const createItems = useMutation({
    mutationFn: async (rows: UnmappedMaterial[]) => {
      const papers = rows.filter((row) => row.materialClass === "PAPER" && row.paperId).map((row) => String(row.paperId))
      const others = rows.filter((row) => row.materialClass !== "PAPER").map((row) => ({ material_class: row.materialClass, code: row.code }))
      const results = await Promise.all([papers.length ? purchaseApi.createPaperItems(papers) : null, others.length ? purchaseApi.createMaterialItems(others) : null])
      return results.filter(Boolean).map((result: any) => result.data)
    },
    onSuccess: (results: any[]) => {
      const created = results.reduce((sum, row) => sum + (row.created?.length || 0), 0)
      const failed = results.flatMap((row) => row.failed || [])
      setNotice({ tone: failed.length ? "error" : "success", text: failed.length ? `${created} stock item(s) created; ${failed.length} failed: ${failed.map((row: any) => `${row.item_code || row.code || row.paper_id}: ${row.reason}`).join("; ")}` : `${created} stock item(s) created. Requirements now plan against stock and POs.` })
      client.invalidateQueries({ queryKey: ["inventory-items"] }); client.invalidateQueries({ queryKey: ["inventory-balances"] }); refresh()
    },
    onError: (error: any) => setNotice({ tone: "error", text: errorText(error) }),
  })

  // ---- workbook figures for the active class ----
  const openingByItem = useMemo(() => Object.fromEntries((balancesQuery.data || []).map((row: any) => [String(row.item_id), Number(row.balance ?? row.available_qty ?? 0)])), [balancesQuery.data])
  const laneIdList = useMemo(() => lanes.map((lane: any) => String(lane.id)), [lanes])
  const scheduledByItem = useMemo(() => {
    const out: Record<string, number> = {}
    for (const id of laneIdList) out[id] = dayKeys.reduce((sum, day) => sum + Number(cells[cellKey(day, id)] || 0), 0)
    return out
  }, [laneIdList, dayKeys, cells])
  const manualByItem = useMemo(() => Object.fromEntries(Object.entries(manualReq).filter(([, value]) => value !== "" && Number.isFinite(Number(value))).map(([id, value]) => [id, Number(value)])), [manualReq])
  const figures = useMemo(() => laneFigures({ itemIds: laneIdList, scheduledByItem, openingByItem, bomByItem: demandTotals, manualByItem }), [laneIdList, scheduledByItem, openingByItem, demandTotals, manualByItem])
  const varieties = useMemo(() => (materialClass === "PAPER" ? varietyGroups(lanes, figures) : null), [materialClass, lanes, figures])
  const classItemIds = useMemo(() => new Set(items.map((item: any) => String(item.id))), [items])
  const openPo = useMemo(() => openPoBalances(ordersQuery.data?.data?.items || [], classItemIds), [ordersQuery.data, classItemIds])
  const vendorRows = useMemo(() => vendorPositions({ laneIds: laneIdList, laneVendors, scheduledByItem, openPo, vendorName }), [laneIdList, laneVendors, scheduledByItem, openPo, vendors]) // eslint-disable-line react-hooks/exhaustive-deps
  const vehicles = useMemo(() => vehiclesPerDay(dayKeys, laneIdList, (day, id) => Number(cells[cellKey(day, id)] || 0)), [dayKeys, laneIdList, cells])
  const sum = (pick: (row: any) => number) => laneIdList.reduce((total, id) => total + pick(figures[id] || {}), 0)
  const openingTotal = sum((row) => row.opening || 0); const scheduledTotal = sum((row) => row.scheduled || 0)
  const unlanedDemand = Object.entries(demandTotals).filter(([id]) => !laneIdList.includes(id)).reduce((total, [, qty]) => total + qty, 0)
  const requiredTotal = sum((row) => row.required || 0) + unlanedDemand
  const closingTotal = openingTotal + scheduledTotal - requiredTotal
  const shortLanes = laneIdList.filter((id) => (figures[id]?.closing || 0) < 0)
  const poToRaise = vendorRows.reduce((total, row) => total + Math.max(0, row.shortPo), 0)
  const deliveryDays = Object.values(vehicles).filter((count) => count > 0).length
  const vehicleTotal = Object.values(vehicles).reduce((total, count) => total + count, 0)
  const classCounts = useMemo(() => Object.fromEntries(MATERIAL_CLASSES.map((entry) => [entry.id, {
    lanes: allLanes.filter((item) => classOfItem(item) === entry.id).length,
    demand: allDemand.filter((row) => classOfDemand(row) === entry.id).length,
  }])), [allLanes, allDemand])

  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
  const shiftMonth = (delta: number) => { const [y, m] = month.split("-").map(Number); const next = new Date(Date.UTC(y, m - 1 + delta, 1)); setMonth(next.toISOString().slice(0, 7)); setSelectedPlanId(""); setMrpResult(null); setSelectedDay("") }
  const addRequiredLanes = () => { markCalendarDirty(); setLaneIds((current) => Array.from(new Set([...current, ...Object.keys(demandTotals).filter((id) => allItems.some((item) => String(item.id) === id))]))) }
  const missingRequiredLanes = Object.keys(demandTotals).filter((id) => !laneIds.includes(id) && allItems.some((item) => String(item.id) === id))
  const today = businessDate()
  const demandCell = (day: string, itemId: string) => (demandByItem[itemId] || []).filter((row) => row.date === day).reduce((total, row) => total + Number(row.qty || 0), 0)
  const setCell = (key: string, value: string) => { markCalendarDirty(); setCells((current) => ({ ...current, [key]: value })) }
  const setLaneVendor = (itemId: string, vendorId: string) => { markCalendarDirty(); setLaneVendors((current) => ({ ...current, [itemId]: vendorId })) }
  const setManual = (itemId: string, value: string) => { markCalendarDirty(); setManualReq((current) => ({ ...current, [itemId]: value })) }
  const removeLane = (itemId: string) => { markCalendarDirty(); setLaneIds((current) => current.filter((id) => id !== itemId)); setManualReq((current) => { const next = { ...current }; delete next[itemId]; return next }) }

  function fillLane(itemId: string, qty: number) {
    const firstNeed = (demandByItem[itemId] || []).map((row) => row.date).sort()[0]
    const day = firstNeed && firstNeed.startsWith(month) ? firstNeed : dayKeys.find((key) => key >= today) || dayKeys[0]
    const key = cellKey(day, itemId)
    setCell(key, String(Math.round((Number(cells[key] || 0) + qty) * 1000) / 1000))
    setSelectedDay(day)
    const item = allItems.find((row) => String(row.id) === itemId)
    setNotice({ tone: "info", text: `${item?.item_code || "Lane"}: ${fmt(qty)} ${u} staged for ${day} to bring closing stock to zero. Split it across delivery days, assign the vendor and save.` })
  }
  function stageSuggestion(row: any) {
    const alreadyPlanned = dayKeys.reduce((total, day) => total + Number(cells[cellKey(day, row.item_id)] || 0), 0)
    const additional = Math.max(0, row.suggested_order_kg - alreadyPlanned)
    if (additional <= 0) { setNotice({ tone: "info", text: `${row.item_code}: this calendar already covers the suggested ${row.suggested_order_kg.toLocaleString("en-IN")} kg. Review delivery timing before adding more.` }); return }
    const day = row.first_shortage_date || paperRequirements.filter((requirement) => requirement.item_id === row.item_id).map((requirement) => requirement.date).sort()[0] || `${month}-01`
    markCalendarDirty()
    setLaneIds((current) => Array.from(new Set([...current, row.item_id])))
    setCells((current) => ({ ...current, [cellKey(day, row.item_id)]: String(Number(current[cellKey(day, row.item_id)] || 0) + additional) }))
    setSelectedDay(day); setNotice({ tone: "info", text: `${row.item_code}: ${additional.toLocaleString("en-IN")} additional kg staged for ${day}. Assign the vendor, review timing and save.` })
  }
  async function exportCalendar() {
    const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(`${classMeta.label} ${month}`.slice(0, 31))
    const ordered = varieties ? varieties.flatMap((group) => group.itemIds.map((id) => lanes.find((lane: any) => String(lane.id) === id)).filter(Boolean)) : lanes
    const shown = (value: number) => Number(formatQty(value, unit).replace(/,/g, ""))
    sheet.addRow([`${classMeta.label} schedule · ${monthLabel} · ${u}`]).font = { bold: true, size: 13 }
    sheet.addRow(["", "", ...ordered.map((item: any) => item.item_code), "Day total", "Vehicles"]).font = { bold: true }
    sheet.addRow(["", "Vendor", ...ordered.map((item: any) => (laneVendors[item.id] ? vendorName(laneVendors[item.id]) : ""))])
    sheet.addRow(["op stk", "", ...ordered.map((item: any) => shown(figures[String(item.id)]?.opening || 0))]).font = { bold: true }
    dates.forEach((day) => {
      const key = dateKey(day); const quantities = ordered.map((item: any) => Number(cells[cellKey(key, item.id)] || 0))
      sheet.addRow([key, day.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" }), ...quantities.map((qty) => (qty ? shown(qty) : null)), shown(quantities.reduce((a, b) => a + b, 0)) || null, vehicles[key] || null])
    })
    sheet.addRow(["Scheduled", "", ...ordered.map((item: any) => shown(figures[String(item.id)]?.scheduled || 0)), shown(scheduledTotal), vehicleTotal]).font = { bold: true }
    sheet.addRow(["Total required", "", ...ordered.map((item: any) => shown(figures[String(item.id)]?.required || 0))]).font = { bold: true }
    sheet.addRow(["cl stk", "", ...ordered.map((item: any) => shown(figures[String(item.id)]?.closing || 0))]).font = { bold: true }
    if (varieties) {
      sheet.addRow([])
      sheet.addRow(["VARIETY", "Lanes", `Op stk`, "Scheduled", "Required", "cl stk"]).font = { bold: true }
      varieties.forEach((group) => sheet.addRow([group.label, group.itemIds.length, shown(group.opening), shown(group.scheduled), shown(group.required), shown(group.closing)]))
    }
    sheet.addRow([])
    sheet.addRow(["VENDOR", "Scheduled", "Pending PO", "PO to raise"]).font = { bold: true }
    vendorRows.forEach((row) => sheet.addRow([row.vendorName, shown(row.scheduled), shown(row.pendingPo), row.shortPo > 0 ? shown(row.shortPo) : 0]))
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }]; sheet.columns.forEach((column) => { column.width = 14 })
    sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${classMeta.tag}-${materialClass.toLowerCase()}-schedule-${month}.xlsx`; link.click(); URL.revokeObjectURL(url)
  }

  function fillTarget() {
    const targetMaterial = lanes.find((lane: any) => lane.id === targetLane) || lanes[0]
    if (!targetMaterial || Number(target) <= 0) return
    const baseTarget = unit === "MT" ? Number(target) * 1000 : Number(target)
    const working = dates.filter((day) => day.getUTCDay() !== 0); const decimals = unit === "PCS" ? 0 : 3; const scale = 10 ** decimals
    const base = Math.floor((baseTarget * scale) / working.length) / scale
    let remaining = Math.round(baseTarget * scale) / scale; const next = { ...cells }
    dates.forEach((day) => { delete next[cellKey(dateKey(day), targetMaterial.id)] })
    working.forEach((day, index) => { const qty = index === working.length - 1 ? remaining : base; next[cellKey(dateKey(day), targetMaterial.id)] = qty.toFixed(decimals); remaining = Math.round((remaining - qty) * scale) / scale })
    markCalendarDirty()
    setCells(next); setNotice({ tone: "info", text: `${Number(target).toLocaleString("en-IN")} ${u} allocated across ${working.length} working days. Review vendor capacity before saving.` })
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
    const preview = sheet.rows.map((row: any) => ({ ...row, item_id: allItems.find((item) => aliasKey(row.header) === aliasKey(String(item.item_code)))?.id }))
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
  const scheduledFor = (itemId: string) => dayKeys.reduce((total, day) => total + Number(cells[cellKey(day, itemId)] || 0), 0)
  const coverage = requiredTotal > 0 ? Math.min(999, ((openingTotal + scheduledTotal) / requiredTotal) * 100) : null
  const ClassIcon = CLASS_ICONS[materialClass]
  const itemNoun = materialClass === "PAPER" ? "paper" : materialClass === "PACKING" ? "packing item" : "chemical"

  return <ProcurementShell eyebrow="Purchase planning" title="RM & PM purchase schedule"
    description="The monthly workbook, live: op stk + scheduled arrivals − requirement = cl stk for every paper, chemical and packing lane, GSM variety totals, and what each vendor still needs a PO for. Requirement comes from open sales orders through each spec's BOM.">
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
        {!selected ? <button className={primaryButton} disabled={!plantReady || plansQuery.isPending || plansQuery.isFetching || plansQuery.isError || createPlan.isPending} onClick={() => createPlan.mutate()}><Plus className="h-4 w-4" />Create month plan</button> : null}
        {selected && editable ? <button className={primaryButton} disabled={save.isPending || !allLanes.length} onClick={() => save.mutate()}><Save className="h-4 w-4" />Save calendar</button> : null}
        {selected && editable ? <button className="erp-btn-secondary" disabled={planAction.isPending || !allLanes.length} onClick={() => planAction.mutate("SUBMIT")}><Send className="h-4 w-4" />Submit for approval</button> : null}
        {selected?.status === "SUBMITTED" ? <button className={primaryButton} disabled={planAction.isPending} onClick={() => planAction.mutate("APPROVE")}><CheckCircle2 className="h-4 w-4" />Approve plan</button> : null}
        {selected && ["APPROVED", "LOCKED"].includes(selected.status) ? <button className={primaryButton} disabled={convert.isPending || !selected.entries.length} onClick={() => convert.mutate()}><ShoppingCart className="h-4 w-4" />Generate vendor PO drafts</button> : null}
      </div>
    </section>

    <section className="flex flex-wrap items-center justify-between gap-3" aria-label="Material class">
      <div className="tube-segment" role="tablist" aria-label="Material class">
        {MATERIAL_CLASSES.map((entry) => {
          const Icon = CLASS_ICONS[entry.id]
          const counts = classCounts[entry.id]
          return (
            <button key={entry.id} type="button" role="tab" aria-selected={materialClass === entry.id} onClick={() => setMaterialClass(entry.id)} data-testid={`schedule-class-${entry.id.toLowerCase()}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {entry.label}
              <span className="rounded bg-foreground/[.06] px-1 text-[10.5px] font-semibold text-muted-foreground">{entry.tag}</span>
              {counts?.lanes ? <span className="text-[11px] tabular-nums text-muted-foreground">{counts.lanes}</span> : null}
            </button>
          )
        })}
      </div>
      {classMeta.baseUnit === "KG" ? (
        <div className="tube-segment" role="group" aria-label="Quantity unit">
          <button type="button" aria-pressed={weightUnit === "KG"} onClick={() => setWeightUnit("KG")}>kg</button>
          <button type="button" aria-pressed={weightUnit === "MT"} onClick={() => setWeightUnit("MT")}>MT</button>
        </div>
      ) : <span className="text-[12px] text-muted-foreground">Packing is planned in pcs</span>}
    </section>

    {workbookSheets.length || importRows.length ? <WorkPanel title="Workbook import" description="Match each workbook column to a material in your masters, choose the unit, then stage the cells into this month.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workbookSheets.length ? <Field label="Worksheet"><select className={fieldClass} value={importSheetName} onChange={(event) => selectImportSheet(workbookSheets.find((sheet) => sheet.name === event.target.value))}>{workbookSheets.map((sheet) => <option key={sheet.name}>{sheet.name}</option>)}</select></Field> : null}
        <Field label="Workbook quantity unit" hint="required"><select className={fieldClass} value={importUnit} onChange={(e) => setImportUnit(e.target.value as "" | "KG" | "MT")}><option value="">Select source unit</option><option value="KG">kg · factor 1</option><option value="MT">MT · factor 1,000</option></select></Field>
      </div>
      {importRows.length ? <div className="mt-4 rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3">
        <p className="text-[13px] font-semibold text-signal-amber-ink">Workbook preview: {importRows.length} positive dated cells · {importRows.filter((row) => importedItemId(row)).length} mapped · {importRows.filter((row) => !importedItemId(row)).length} to map · {importRows.filter((row) => !row.date.startsWith(month)).length} outside {monthLabel}</p>
        {Array.from(new Set(importRows.filter((row) => !row.item_id).map((row) => row.header))).length ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{Array.from(new Set(importRows.filter((row) => !row.item_id).map((row) => row.header))).map((header) => <label key={header} className="rounded-lg border border-signal-amber-line bg-card p-2.5 text-[12px] font-medium text-foreground/80"><span className="block truncate" title={header}>{header}</span><select aria-label={`Map ${header}`} className={`${fieldClass} mt-1.5`} value={importAliases[header] || ""} onChange={(e) => setImportAliases((current) => ({ ...current, [header]: e.target.value }))}><option value="">Choose exact material</option><option value="IGNORE">Exclude helper column</option>{MATERIAL_CLASSES.map((entry) => <optgroup key={entry.id} label={`${entry.label} (${entry.tag})`}>{allItems.filter((item) => classOfItem(item) === entry.id).map((item) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</optgroup>)}</select></label>)}</div> : null}
        <button className={`${secondaryButton} mt-3`} onClick={applyImport} disabled={!editable || !importUnit || importRows.some((row) => !importedItemId(row) || !row.date.startsWith(month))}>Stage mapped cells as kg</button>
      </div> : null}
    </WorkPanel> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label={`${classMeta.label} month position`}>
      <SummaryCard label="Op stk" value={`${fmt(openingTotal)} ${u}`} detail={`Stock on hand today across ${lanes.length} ${itemNoun} lane${lanes.length === 1 ? "" : "s"}`} icon={Warehouse} tone="slate" />
      <SummaryCard label="Scheduled arrivals" value={`${fmt(scheduledTotal)} ${u}`} detail={`${deliveryDays} delivery days · ${vehicleTotal} vehicle${vehicleTotal === 1 ? "" : "s"} in ${monthLabel}`} icon={Truck} tone="cyan" />
      <SummaryCard label="Requirement" value={`${fmt(requiredTotal)} ${u}`} detail={demand.isFetching ? "Refreshing from open orders…" : `${classDemand.length} BOM line${classDemand.length === 1 ? "" : "s"} due by month end${unlanedDemand > 0 ? ` · ${fmt(unlanedDemand)} not yet in a lane` : ""}`} icon={Target} tone="amber" />
      <SummaryCard label="Cl stk" value={`${fmt(closingTotal)} ${u}`} detail={shortLanes.length ? `${shortLanes.length} lane${shortLanes.length === 1 ? "" : "s"} short · coverage ${coverage === null ? "—" : `${Math.round(coverage)}%`}` : coverage === null ? "No requirement this month" : `All lanes covered · ${Math.round(coverage)}%`} icon={shortLanes.length || closingTotal < 0 ? AlertTriangle : CheckCircle2} tone={shortLanes.length || closingTotal < 0 ? "rose" : "emerald"} />
      <SummaryCard label="PO to raise" value={poToRaise > 0.5 ? `${fmt(poToRaise)} ${u}` : "—"} detail={poToRaise > 0.5 ? `Scheduled beyond pending POs with ${vendorRows.filter((row) => row.shortPo > 0.5).length} vendor(s)` : "Every scheduled lane is covered by an open PO"} icon={ShoppingCart} tone={poToRaise > 0.5 ? "rose" : "emerald"} />
    </section>

    <DemandIssues blocked={materialClass === "PAPER" ? blocked : []} unmapped={unmapped} warnings={classWarnings} creating={createItems.isPending} canCreate={plantReady} onCreate={(rows) => createItems.mutate(rows)} />
    {demand.isError ? <MessageBar tone="error">Requirement could not load. Nothing has been assumed as zero — retry when services are available.</MessageBar> : null}

    <WorkPanel title={view === "grid" ? "Monthly grid" : monthLabel} description={view === "grid" ? `One column per ${itemNoun}, one row per day — the workbook layout. Amber “need” marks when open orders need it; footer rows give scheduled, required (type to override the BOM figure) and closing stock${materialClass === "PAPER" ? ", plus the GSM variety balance" : ""}.` : "Tap a day to enter its arrivals. Amber is what open orders need; teal is a planned arrival."} action={<div className="flex flex-wrap items-center gap-2">
      <div className="tube-segment" role="group" aria-label="Planner view">
        <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>Workbook grid</button>
        <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Month calendar</button>
      </div>
      <select aria-label="Add material lane" className={`${fieldClass} !w-[210px]`} value="" disabled={!editable} onChange={(e) => { if (!e.target.value) return; markCalendarDirty(); setLaneIds((current) => current.includes(e.target.value) ? current : [...current, e.target.value]) }}><option value="">+ Add {itemNoun}</option>{items.filter((item) => !laneIds.includes(String(item.id))).map((item) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}</select>
      {editable && missingRequiredLanes.length ? <button className="erp-btn-secondary" onClick={addRequiredLanes}><Plus className="h-4 w-4" />Add {missingRequiredLanes.length} required</button> : null}
    </div>}>
      {!selected ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/[.04] px-4 py-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[13px]"><span className="font-semibold">No plan for {monthLabel} yet.</span> <span className="text-muted-foreground">Requirement from open orders is shown below. Create the plan to start scheduling arrivals.</span></p>
        </div>
      ) : null}
      {view === "grid" ? (
        !selected ? <EmptyState label={`Create the ${monthLabel} plan to use the workbook grid.`} /> : !lanes.length ? <EmptyState label={`Add the ${itemNoun}s open orders need, or pick one from “+ Add ${itemNoun}”.`} /> : (
          <ScheduleGrid lanes={lanes} days={dates} cells={cells} cellKey={cellKey} editable={editable} unit={unit} vendors={vendors} laneVendors={laneVendors} onVendor={setLaneVendor} onCell={setCell}
            figures={figures} varieties={varieties} demandCell={demandCell} vehicles={vehicles} today={today} manual={manualReq} onManual={setManual} onFill={fillLane} onRemoveLane={removeLane} />
        )
      ) : (
        <>
          <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-border">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-3 py-2 text-[11.5px] font-semibold text-muted-foreground">{day}</div>)}</div><div className="grid grid-cols-7 border-l border-border">{Array.from({ length: (dates[0].getUTCDay() + 6) % 7 }, (_, index) => <div key={`blank-${index}`} className="border-b border-r border-border bg-[hsl(var(--surface-sunken))]" />)}{dates.map((date) => {
            const day = dateKey(date); const arrivals = lanes.filter((item: any) => Number(cells[cellKey(day, item.id)]) > 0); const needed = demandByDay[day] || 0; const planned = arrivals.reduce((total: number, item: any) => total + Number(cells[cellKey(day, item.id)] || 0), 0)
            return <button type="button" key={day} aria-label={`Plan arrivals ${day}`} aria-pressed={selectedDay === day} onClick={() => setSelectedDay(day)} className={`group flex min-h-[104px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors ${selectedDay === day ? "bg-primary/[.06] ring-2 ring-inset ring-primary/50" : date.getUTCDay() === 0 ? "bg-[hsl(var(--surface-sunken))]" : "bg-card hover:bg-foreground/[.025]"}`}>
              <span className="flex items-center justify-between"><span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold ${day === today ? "bg-primary text-primary-foreground" : "text-foreground/80"}`}>{date.getUTCDate()}</span>{planned > 0 ? <span className="text-[11px] font-semibold tabular-nums text-signal-cyan-ink">{fmt(planned)}{vehicles[day] ? <span className="ml-1 font-normal text-muted-foreground">· {vehicles[day]} veh</span> : null}</span> : null}</span>
              {needed > 0 ? <span className="rounded border border-signal-amber-line bg-signal-amber-soft px-1.5 py-0.5 text-[11px] font-medium text-signal-amber-ink">Need {fmt(needed)} {u}</span> : null}
              {arrivals.slice(0, 3).map((item: any) => <span key={item.id} className="truncate rounded border border-signal-cyan-line bg-signal-cyan-soft px-1.5 py-0.5 text-[11px] font-medium text-signal-cyan-ink">{item.item_code} · {fmt(Number(cells[cellKey(day, item.id)]))}</span>)}
              {arrivals.length > 3 ? <span className="px-1 text-[11px] text-muted-foreground">+{arrivals.length - 3} more</span> : null}
            </button>
          })}</div></div></div>
          {selectedDay ? <div className="mt-4 animate-slide-down rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4"><h3 className="text-[14px] font-semibold">Arrivals · {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3>{!lanes.length ? <p className="mt-2 text-[13px] text-muted-foreground">Add a {itemNoun} above to enter arrivals.</p> : <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">{lanes.map((item: any) => {
            const need = demandCell(selectedDay, String(item.id)); const key = cellKey(selectedDay, item.id)
            return <div key={item.id} className="rounded-lg border border-border bg-card p-3"><Field label={`${item.item_code} ${u}`} hint={need > 0 ? `need ${fmt(need)}` : undefined}><QtyInput className={fieldClass} unit={unit} disabled={!editable} value={cells[key] || ""} onChange={(value) => setCell(key, value)} /></Field><select aria-label={`${item.item_code} arrival vendor`} className={`${fieldClass} mt-2`} disabled={!editable} value={laneVendors[item.id] || ""} onChange={(event) => setLaneVendor(String(item.id), event.target.value)}><option value="">Assign vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div>
          })}</div>}</div> : null}
        </>
      )}
    </WorkPanel>

    <div className="grid gap-4 xl:grid-cols-2">
      <WorkPanel title={materialClass === "PAPER" ? "Variety balance" : "Lane balance"} description={materialClass === "PAPER" ? "Each GSM variety across all its vendors: op stk + scheduled against what open orders need." : `Each ${itemNoun}: op stk + scheduled against what open orders need.`}>
        <CoverageBars rows={varieties ? varietyRows(varieties, lanes) : laneRows(lanes, figures)} unit={unit} />
      </WorkPanel>
      <WorkPanel title="Vendor position" description="What each vendor is scheduled to deliver this month against its pending PO balance. PO to raise = scheduled − pending." action={<span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"><Layers className="h-3.5 w-3.5" />{Object.keys(openPo).length} vendor(s) with open POs</span>}>
        <VendorPositionTable rows={vendorRows} unit={unit} />
      </WorkPanel>
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <WorkPanel title="What open orders need" description={materialClass === "PAPER" ? demandData?.basis || "Approved sales-order quantities through their canonical recipe BOMs." : materialClass === "PACKING" ? "Boxes = pcs ÷ pcs per box on the spec; plastic and fadda follow the box count." : "Adhesive parts and parchment by weight per bamboo from the spec BOM; parchment follows each line's colour breakup."} action={<button className="erp-btn-secondary" onClick={() => demand.refetch()} disabled={demand.isFetching}><RefreshCw className={`h-4 w-4 ${demand.isFetching ? "animate-spin" : ""}`} />Refresh</button>}>
        {classDemand.length ? <div className="max-h-[420px] overflow-auto rounded-lg border border-border"><table className="tube-grid"><thead><tr>{["Need by", "Order", "Material", "Pcs", `Required ${u}`].map((heading) => <th key={heading} className={heading.startsWith("Required") || heading === "Pcs" ? "num" : undefined}>{heading}</th>)}</tr></thead><tbody>{[...classDemand].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map((row, index) => <tr key={`${row.line_id}:${row.item_id}:${row.job_id || ""}:${index}`}><td className="whitespace-nowrap">{row.due_date}{row.overdue ? <span className="ml-1.5 rounded bg-signal-rose-soft px-1 text-[10.5px] font-semibold text-signal-rose-ink">late</span> : null}</td><td>{row.order_no}{row.job_id ? <span className="ml-1 text-[11px] text-muted-foreground">job</span> : null}</td><td className="font-medium">{row.item_code}{row.mapped === false ? <span className="ml-1.5 rounded bg-signal-amber-soft px-1 text-[10.5px] font-semibold text-signal-amber-ink">no item</span> : null}</td><td className="num">{Number(row.open_units || 0).toLocaleString("en-IN")}</td><td className="num font-semibold">{fmt(Number(row.qty || 0))}</td></tr>)}</tbody></table></div> : !demand.isFetching && !demand.isError ? <EmptyState label={`No approved sales-order ${itemNoun} demand due by the end of ${monthLabel}.`} /> : null}
      </WorkPanel>
      {materialClass === "PAPER" ? (
        <WorkPanel title="Shortage check" description="Uses opening stock, confirmed open POs, stock targets and this requirement to suggest what to buy." action={<button className={primaryButton} disabled={mrp.isPending || blocked.length > 0 || demand.isFetching || !Object.keys(paperTotals).length} onClick={() => mrp.mutate()}><Play className="h-4 w-4" />{mrp.isPending ? "Calculating…" : "Calculate purchase shortages"}</button>}>
          {!mrpResult ? <p className="text-[13px] text-muted-foreground">Run the check to see opening stock, closing balance and suggested buy quantity per paper. Suggestions can be staged straight into the plan.</p> : mrpResult.results.length === 0 ? <EmptyState label="No paper needs buying for this month." /> : <div className="space-y-2">{mrpResult.results.map((row: any) => { const remaining = Math.max(0, Number(row.suggested_order_kg || 0) - scheduledFor(String(row.item_id))); return <div className={`rounded-lg border p-3 ${remaining > 0.5 ? "border-signal-rose-line bg-signal-rose-soft/40" : "border-signal-emerald-line bg-signal-emerald-soft/40"}`} key={row.item_id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] font-semibold">{row.item_code}</p>{remaining > 0.5 ? <button className="erp-btn-secondary !h-8" disabled={!editable} onClick={() => stageSuggestion(row)}><Plus className="h-3.5 w-3.5" />Stage {formatQty(remaining, "KG")} kg</button> : <span className="inline-flex items-center gap-1 text-[12px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" />Covered</span>}</div><p className="mt-1 text-[12px] text-muted-foreground">Need {formatQty(row.demand_kg, "KG")} + target {formatQty(row.target_stock_kg, "KG")} − stock {formatQty(row.opening_stock_kg, "KG")} − open POs {formatQty(row.committed_supply_kg, "KG")} = buy {formatQty(row.suggested_order_kg, "KG")} kg</p>{row.peak_timing_shortfall_kg > row.suggested_order_kg ? <p className="mt-1 text-[12px] font-medium text-signal-amber-ink">Timing gap {formatQty(row.peak_timing_shortfall_kg, "KG")} kg from {row.first_shortage_date} — expedite existing POs before adding more.</p> : null}{row.unconfirmed_supply_kg > 0 ? <p className="mt-1 text-[12px] text-signal-amber-ink">{formatQty(row.unconfirmed_supply_kg, "KG")} kg has tentative dates and isn&apos;t counted.</p> : null}{row.overdue_supply_kg > 0 ? <p className="mt-1 text-[12px] text-signal-amber-ink">{formatQty(row.overdue_supply_kg, "KG")} kg is overdue — re-confirm before counting it.</p> : null}</div> })}</div>}
        </WorkPanel>
      ) : (
        <WorkPanel title="To schedule" description={`Lanes whose closing stock goes below zero this month. “Fill” stages the gap on the first need date.`}>
          {!lanes.length ? <EmptyState label={`Add ${itemNoun} lanes to see what to schedule.`} /> : !shortLanes.length ? <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-signal-emerald-ink"><CheckCircle2 className="h-4 w-4" />Every {itemNoun} lane closes at or above zero.</p> : (
            <ul className="space-y-2">{shortLanes.map((id) => { const item = lanes.find((lane: any) => String(lane.id) === id); const row = figures[id]; return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft/40 p-3">
                <div className="min-w-0"><p className="text-[13px] font-semibold">{item?.item_code}</p><p className="text-[12px] text-muted-foreground">Op {fmt(row.opening)} + scheduled {fmt(row.scheduled)} − required {fmt(row.required)} = {fmt(row.closing)} {u}</p></div>
                <button className="erp-btn-secondary !h-8" disabled={!editable} onClick={() => fillLane(id, -row.closing)}><Plus className="h-3.5 w-3.5" />Fill {fmt(-row.closing)} {u}</button>
              </li>
            ) })}</ul>
          )}
        </WorkPanel>
      )}
    </div>

    {lanes.length && editable ? <WorkPanel title="Spread a monthly quantity" description={`Distribute a ${itemNoun}'s monthly quantity evenly over working days (Sundays off), then fine-tune individual days.`}><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><Field label={classMeta.label}><select className={fieldClass} value={targetLane || lanes[0]?.id || ""} onChange={(event) => setTargetLane(event.target.value)}>{lanes.map((lane: any) => <option key={lane.id} value={lane.id}>{lane.item_code}</option>)}</select></Field><Field label={`Monthly ${u}`}><input className={fieldClass} type="number" min="0" step="1" value={target} onChange={(e) => setTarget(e.target.value)} /></Field><button className={`${secondaryButton} self-end`} onClick={fillTarget}>Fill working days</button></div></WorkPanel> : null}
    <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><ClassIcon className="h-3.5 w-3.5" />Op stk is stock on hand today; requirement is every open order due by the end of {monthLabel} (overdue included). Quantities are stored in {classMeta.baseUnit === "PCS" ? "pcs" : "kg"}; MT is display only.</p>
  </ProcurementShell>
}
