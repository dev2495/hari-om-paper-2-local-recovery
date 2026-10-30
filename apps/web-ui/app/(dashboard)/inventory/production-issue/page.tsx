"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, Barcode, Clock3, History, MapPin, PackageCheck, Search } from "lucide-react"

import { QrScanner } from "@/components/common/qr-scanner"
import { FoundChoices } from "@/components/procurement/found-choices"
import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useParchmentCoils } from "@/hooks/use-stock"
import { useCreateTransaction, useInventoryBalances, useInventoryItemBalance, useInventoryItems, useInventoryLocations, useInventoryTransactions, useIssueParchmentByWeight, useReelIssues } from "@/hooks/use-inventory"
import { usePlants } from "@/hooks/use-system"
import { inventoryApi } from "@/lib/api"
import { chooseFound, compactNumber, matchWords, type FoundResult, type FoundRow } from "@/lib/lot-find"
import { canonicalPlantScopeValue, displayPlantScope } from "@/lib/plant-scope"
import { parseScanCode } from "@/lib/scan-code"
import { shiftAt } from "@/lib/shift"
import { pickFromText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const unitText = (uom?: string) => ({ KG: "kg", PCS: "pcs", L: "L" } as Record<string, string>)[String(uom || "").toUpperCase()] || String(uom || "").toLowerCase()
const qtyText = (value: any, uom?: string) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unitText(uom)}`.trim()
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || "Issue failed"
}
const isParchment = (item: any) => String(item?.type || "").toUpperCase() === "PARCHMENT"
// Issued here: bulk materials, plus parchment colours (stored as coils, issued by kg). Paper goes by reel, tubes by dispatch.
const isFinishedGood = (item: any) => String(item?.type || "").toUpperCase() === "FINISHED_GOOD"
const isReelPaper = (item: any) => String(item?.tracking_mode || "").toUpperCase() === "REEL" && !isParchment(item)
const issuableHere = (item: any) => !isFinishedGood(item) && !isReelPaper(item)
const USABLE = ["UNRESTRICTED", "WIP"]
const lotQty = (batch: any) => Number(batch?.available_qty ?? batch?.current_balance ?? 0)
const lotName = (batch: any) => batch?.inward_no || batch?.grn_no || batch?.batch_no || "this lot"
const samePlant = (a?: string | null, b?: string | null) => canonicalPlantScopeValue(a).toLowerCase() === canonicalPlantScopeValue(b).toLowerCase()
const rowsOf = (data: any): any[] => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [])
const isPieces = (item: any) => String(item?.uom || "").toUpperCase() === "PCS"
const KIND_ORDER = ["ADHESIVE", "PARCHMENT", "PACKING", "OTHER"]
const KIND_LABEL: Record<string, string> = { ADHESIVE: "Adhesive", PARCHMENT: "Parchment", PACKING: "Packing", OTHER: "Other" }
const KIND_TONE: Record<string, string> = {
  ADHESIVE: "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line",
  PARCHMENT: "bg-signal-violet-soft text-signal-violet-ink ring-signal-violet-line",
  PACKING: "bg-signal-teal-soft text-signal-teal-ink ring-signal-teal-line",
  OTHER: "bg-muted text-muted-foreground ring-border",
}
const kindOf = (item: any) => {
  const type = String(item?.type || "").toUpperCase()
  if (type === "ADHESIVE" || type === "PARCHMENT") return type
  if (type === "PACKAGING" || type === "PACKING") return "PACKING"
  return "OTHER"
}

type Notice = { tone: "success" | "error" | "info"; text: string; action?: { label: string; href?: string; onClick?: () => void } }
/** Lot rows to tap: 44 px tall everywhere (a phone at the rack, a desk at the store). */
const lotChoice = "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition"
const lotOn = "border-primary bg-primary/[.06] ring-2 ring-primary/25"
const lotOff = "border-border bg-card hover:border-foreground/25 hover:bg-muted/40"
/** IST day of a naive-UTC server stamp, "28 Oct". */
const dayOf = (value: string) => new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
const istDay = (value: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })

/**
 * Adhesive, parchment and packing go to the floor by shift (client rule 2026-10-18).
 * Units follow the item master (client 2026-10-26): parchment by colour and kg (no coil number),
 * plastic in kg, boxes in pieces. Stock on hand shows next to every material and lot.
 */
function MaterialFloorIssuePage() {
  const { user, activePlant, activeRole, setActivePlant } = useAuth()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const linkedScan = searchParams?.get("scan") || ""
  const linkedItem = searchParams?.get("item") || ""
  const linkedDone = useRef("")
  const { data: items = [], isLoading: itemsLoading } = useInventoryItems()
  const balancesQuery = useInventoryBalances()
  const plantsQuery = usePlants()
  const createIssue = useCreateTransaction()
  const issueParchment = useIssueParchmentByWeight()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [itemSearch, setItemSearch] = useState("")
  const [scan, setScan] = useState("")
  // A scanned lot waits here until its material's lots have loaded, then it is selected.
  const [pendingBatch, setPendingBatch] = useState<{ key: string; label: string; note?: string } | null>(null)
  const [queuedScan, setQueuedScan] = useState("")
  // A typed number that matches more than one lot (a GRN with two lots, a part of a number): a short pick list.
  const [choices, setChoices] = useState<{ code: string; rows: FoundRow[]; count: number; truncated: boolean } | null>(null)
  const [allLots, setAllLots] = useState(false)
  const formPanel = useRef<HTMLDivElement | null>(null)
  // On a phone the issue form sits below the material list: bring it up after a scan picks the material.
  const showForm = () => { if (window.innerWidth < 1280) window.setTimeout(() => formPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80) }
  const [kind, setKind] = useState("ALL")
  const [showEach, setShowEach] = useState(false)
  const [form, setForm] = useState({ item_id: "", batch_id: "", qty: "", notes: "" })
  // No shift or date is asked (client 2026-10-30): the server dates the issue from the moment it is registered
  // by the shift rule; the desk shows which shift that is from the IST clock.
  const [clock, setClock] = useState(() => shiftAt())
  useEffect(() => { const timer = window.setInterval(() => setClock(shiftAt()), 20_000); return () => window.clearInterval(timer) }, [])
  // The same issue sent again (double tap, retry after a dropped line) carries the same key and is issued once.
  const requestKey = useRef({ body: "", id: "" })
  const inFlight = useRef(false)
  const keyFor = (body: unknown) => {
    const text = JSON.stringify(body)
    if (text !== requestKey.current.body) requestKey.current = { body: text, id: crypto.randomUUID() }
    return requestKey.current.id
  }
  const balance = useInventoryItemBalance(form.item_id, Boolean(form.item_id))
  const today = useInventoryTransactions({ transaction_type: "ISSUE_PRODUCTION", date_from: clock.businessDate, date_to: clock.businessDate })
  const todayReels = useReelIssues({ date_from: clock.businessDate, date_to: clock.businessDate, limit: 300 })

  const onHand = useMemo(() => {
    const out: Record<string, number> = {}
    for (const row of Array.isArray(balancesQuery.data) ? balancesQuery.data : []) out[String(row.item_id)] = Number(row.usable_qty || 0)
    return out
  }, [balancesQuery.data])
  const allItems: any[] = useMemo(() => (Array.isArray(items) ? items : []), [items])
  const materials = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase()
    return allItems
      .filter(issuableHere)
      .filter((item: any) => !needle || `${item.item_code} ${item.name} ${item.type}`.toLowerCase().includes(needle))
  }, [allItems, itemSearch])
  const manyPlants = new Set(allItems.map((item: any) => String(item.plant_id || ""))).size > 1
  const itemFor = (id: string) => allItems.find((row: any) => String(row.id) === String(id))
  const itemName = (id: string) => { const item = itemFor(id); return item ? `${item.item_code} · ${item.name}` : "Material" }
  const selectedItem = materials.find((item: any) => String(item.id) === form.item_id)
  const parchment = isParchment(selectedItem)
  const allBatches: any[] = useMemo(() => (Array.isArray(balance.data?.batches) ? balance.data.batches : []), [balance.data])
  // Cleared lots with stock, oldest first: the order issue takes them in when no lot is picked (FIFO).
  const batches = useMemo(() => allBatches
    .filter((batch: any) => lotQty(batch) > 0 && USABLE.includes(String(batch.stock_status || "").toUpperCase()))
    .sort((a: any, b: any) => String(a.received_on || a.created_at || "").localeCompare(String(b.received_on || b.created_at || ""))), [allBatches])
  const selectedBatch = batches.find((batch: any) => String(batch.batch_id) === form.batch_id)
  // "Pick from <rack>" (client 2026-10-28): where the chosen lot, or the oldest lot issue takes first, sits.
  const locationsQuery = useInventoryLocations()
  const pickFrom = useMemo(() => {
    const map = new Map((Array.isArray(locationsQuery.data) ? locationsQuery.data : []).map((row: any) => [String(row.id), row]))
    // The rack's plain name, its label code in brackets (the same words as the reel desk); "No rack yet" when unplaced.
    return (batch: any) => pickFromText(batch?.location_id ? map.get(String(batch.location_id)) : null)
  }, [locationsQuery.data])
  const pickBatch = selectedBatch || batches[0]
  const LOTS_SHOWN = 4
  const shownLots = allLots || batches.length <= LOTS_SHOWN + 1 ? batches : [...batches.slice(0, LOTS_SHOWN), ...(selectedBatch && batches.indexOf(selectedBatch) >= LOTS_SHOWN ? [selectedBatch] : [])]
  const itemOnHand = selectedItem ? (parchment ? Number(onHand[String(selectedItem.id)] || 0) : batches.reduce((sum: number, batch: any) => sum + Number(batch.available_qty ?? batch.current_balance ?? 0), 0)) : 0
  const available = selectedBatch ? Number(selectedBatch.available_qty ?? selectedBatch.current_balance ?? 0) : itemOnHand
  const issuedToday = useMemo(() => {
    const bulk = (Array.isArray(today.data) ? today.data : []).filter((row: any) => row.movement_metadata?.destination === "FLOOR").map((row: any) => ({
      key: row.transaction_id, name: itemName(row.item_id), shift: row.movement_metadata?.shift, notes: row.movement_metadata?.notes,
      qty: Math.abs(Number(row.qty_change || 0)), uom: itemFor(row.item_id)?.uom,
    }))
    const parchmentCodes = new Set(allItems.filter(isParchment).map((item: any) => String(item.item_code)))
    const parchmentIssues = (Array.isArray(todayReels.data) ? todayReels.data : []).filter((row: any) => parchmentCodes.has(String(row.paper_code || ""))).map((row: any) => ({
      key: row.id, name: `${row.paper_code} · ${row.paper_name || "Parchment"}`, shift: row.shift, notes: `from coil ${row.reel_code}`, qty: Number(row.issued_weight_kg || 0), uom: "KG",
    }))
    return [...bulk, ...parchmentIssues]
  }, [today.data, todayReels.data, allItems]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setForm((current) => ({ ...current, batch_id: "" })); setAllLots(false) }, [form.item_id])
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  // The Incoming inspection page lets these roles in; everyone else is told to ask QC instead.
  const canOpenQc = ["QC", "InwardQC", "Store", "PlantManager", "Owner", "Admin"].some((role) => roles.has(role))
  // Same test as /scan and the server: Owner and Admin too are limited to their login's plants.
  const canSeePlant = (plantId: string) => Boolean(user?.is_owner_all_plants) || [...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].some((value) => samePlant(value, plantId))
  // Plain plant name for a label's plant; a plant this login cannot list is just "another plant".
  const plantName = (id: string) => {
    const plant = (Array.isArray(plantsQuery.data) ? plantsQuery.data : []).find((row: any) => samePlant(String(row.id), id))
    const known = displayPlantScope(canonicalPlantScopeValue(id))
    return plant?.name || (known !== canonicalPlantScopeValue(id) ? known : "another plant")
  }
  const lotMatches = (wanted: string) => (batch: any) => [batch.batch_id, batch.batch_no, batch.inward_no, batch.grn_no].some((value) => String(value || "").toUpperCase() === wanted.toUpperCase())

  useEffect(() => {
    if (!pendingBatch || !form.item_id || !balance.isSuccess) return
    setPendingBatch(null)
    const matched = batches.find(lotMatches(pendingBatch.key))
    if (matched) {
      setForm((current) => ({ ...current, batch_id: matched.batch_id }))
      setNotice({ tone: "info", text: `Lot ${lotName(matched)} selected: ${qtyText(lotQty(matched), selectedItem?.uom)} on hand.${pendingBatch.note ? ` ${pendingBatch.note}` : ""}` })
      showForm()
    } else {
      // Checked before the material was picked, so this only happens when stock moved in between.
      setNotice({ tone: "error", text: `Lot ${pendingBatch.label} is no longer cleared stock of this material. Scan it again before issuing.` })
    }
  }, [balance.isSuccess, batches, pendingBatch]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Why a lot on hold cannot be issued, in the words of the incoming QC queue. */
  async function heldNotice(name: string, batchId: string, status: string): Promise<Notice> {
    let state = String(status || "").toUpperCase() === "BLOCKED" ? "REJECTED" : ""
    if (!state) {
      try {
        state = String(rowsOf((await inventoryApi.getPendingQuality()).data).find((row: any) => row.entity_type === "BATCH" && String(row.entity_id) === batchId)?.queue_state || "")
      } catch { /* the general reason below still holds */ }
    }
    const why = state === "REJECTED" ? "was rejected by incoming QC" : state === "FAILED" ? "failed incoming QC" : state === "AWAITING_INSPECTION" ? "is waiting for incoming QC" : "is waiting for incoming QC (or failed it)"
    const text = `Lot ${name} ${why}: it cannot be issued until QC passes it.`
    return canOpenQc
      ? { tone: "error", text, action: { label: "Open in incoming QC", href: `/quality/incoming?lot=BATCH:${batchId}` } }
      : { tone: "error", text: `${text} Ask QC to inspect it.` }
  }

  /** Plant on the label vs the plant this desk is working in. Returns a notice when they differ. */
  function plantNotice(plantId: string, label: string, raw: string): Notice | null {
    if (!plantId) return null
    const plant = plantName(plantId)
    if (!canSeePlant(plantId)) return { tone: "error", text: `${label} is from ${plant}, which your login cannot open.` }
    if (!activePlant || activePlant === "ALL" || samePlant(plantId, activePlant)) return null
    return {
      tone: "error",
      text: `${label} is from ${plant}. You are working in ${displayPlantScope(activePlant)}: switch plant to issue it.`,
      action: { label: `Switch to ${plant}`, onClick: () => { setActivePlant(plantId); window.location.assign(`${pathname}?scan=${encodeURIComponent(raw)}`) } },
    }
  }

  async function scanBatch(id: string, code: string, plantId: string, raw: string, note?: string) {
    const name = code || "This lot"
    const wrongPlant = plantNotice(plantId, `Lot ${name}`, raw)
    if (wrongPlant) return setNotice(wrongPlant)
    let label: any
    try {
      label = (await inventoryApi.getBatchLabel(id)).data
    } catch (error: any) {
      return setNotice({ tone: "error", text: error?.response?.status === 404 ? `Lot ${name} was not found in ${displayPlantScope(activePlant)}. Check the label.` : `Lot ${name} could not be checked: ${errorText(error)}` })
    }
    const lot = label?.code || label?.amigo_no || name
    const item = itemFor(String(label?.item_id || ""))
    if (!label?.item_id || !item) return setNotice({ tone: "error", text: `Lot ${lot} is not a material this desk issues.` })
    if (isFinishedGood(item)) return setNotice({ tone: "error", text: `Lot ${lot} is finished goods (${item.name}). Finished goods leave on a dispatch, not to the floor.` })
    if (isReelPaper(item)) return setNotice({ tone: "error", text: `Lot ${lot} is paper, issued by reel or coil.`, action: { label: "Open Reel & coil issue", href: `/inventory/reels/issue?scan=${encodeURIComponent(raw)}` } })
    const status = String(label.stock_status || "").toUpperCase()
    if (!USABLE.includes(status)) return setNotice(await heldNotice(lot, id, status))
    if (isParchment(item)) return pickScanned(item, `Parchment is issued by colour and kg, oldest coil first. ${item.name} selected.`)
    let stock: any
    try {
      const fresh = (await inventoryApi.getItemBalance(item.id)).data
      // Keep this read as the material's lots: the desk may have loaded them hours ago, before QC passed this lot.
      queryClient.setQueryData(["inventory-item-balance", String(item.id)], fresh)
      stock = rowsOf(fresh?.batches).find(lotMatches(id))
    } catch (error) {
      return setNotice({ tone: "error", text: `Lot ${lot} could not be checked: ${errorText(error)}` })
    }
    if (!stock) return setNotice({ tone: "error", text: `Lot ${lot} was not found in the stock of ${item.name}. Check the label.` })
    if (lotQty(stock) <= 0) return setNotice({ tone: "error", text: `Lot ${lot} has no stock left: it was already issued. Scan or pick another lot of ${item.name}.` })
    setItemSearch("")
    setPendingBatch({ key: id, label: lot, note })
    setForm((current) => ({ ...current, item_id: String(item.id), batch_id: "", qty: "" }))
    setScan("")
  }

  async function scanReel(id: string, code: string, plantId: string, raw: string) {
    const name = code || "This label"
    const wrongPlant = plantNotice(plantId, name, raw)
    if (wrongPlant) return setNotice(wrongPlant)
    const toReels: Notice = { tone: "error", text: `${name} is a paper reel or coil. Issue it on the Reel & coil tab.`, action: { label: "Open Reel & coil issue", href: `/inventory/reels/issue?scan=${encodeURIComponent(raw)}` } }
    let label: any
    try {
      label = (await inventoryApi.getReelLabel(id)).data
    } catch (error: any) {
      return setNotice(error?.response?.status === 404 ? toReels : { tone: "error", text: `${name} could not be checked: ${errorText(error)}` })
    }
    const item = itemFor(String(label?.item_id || ""))
    if (!isParchment(item)) return setNotice(toReels)
    const held = !USABLE.includes(String(label.stock_status || "").toUpperCase())
    pickScanned(item, `${label.code || name} is parchment: issued by colour and kg, oldest cleared coil first. ${item.name} selected.${held ? " This coil itself has not passed incoming QC yet, so it will not be used." : ""}`)
  }

  function pickScanned(item: any, text: string) {
    setItemSearch("")
    setForm((current) => ({ ...current, item_id: String(item.id), batch_id: "", qty: "" }))
    setScan("")
    setNotice({ tone: "info", text })
    showForm()
  }

  async function resolveScan(raw: string = scan) {
    const parsed = parseScanCode(raw)
    if (!parsed.raw) return setNotice({ tone: "error", text: "Scan the lot label, or type its Amigo inward number." })
    if (parsed.kind === "JOB_CARD" || parsed.kind === "TOOL") return setNotice({ tone: "error", text: `That is a ${parsed.kind === "TOOL" ? "tool" : "job card"} label. Scan the material lot label.` })
    if (parsed.kind === "LOCATION") return setNotice({ tone: "error", text: `That is a rack label (${parsed.code || "location"}). Scan the material lot label.`, action: { label: `See what is on ${parsed.code || "the rack"}`, href: `/inventory/locations/${parsed.id}` } })
    // A new label replaces the lot picked before, so a refused scan never leaves the old lot ready to issue.
    setPendingBatch(null)
    setChoices(null)
    setForm((current) => ({ ...current, batch_id: "", qty: "" }))
    if (itemsLoading) {
      setQueuedScan(raw)
      return setNotice({ tone: "info", text: "Materials are still loading. The label is checked as soon as they are ready." })
    }
    if (parsed.kind === "BATCH" && parsed.id) return scanBatch(parsed.id, parsed.code, parsed.plantId, parsed.raw)
    if (parsed.kind === "REEL" && parsed.id) return scanReel(parsed.id, parsed.code, parsed.plantId, parsed.raw)
    // A typed lot / Amigo inward number (any case or spacing, or a unique part): found across every material
    // this desk issues, then checked exactly like a scan of its label.
    return findTyped(parsed.code)
  }

  /** The material a found lot or coil belongs to, as this desk knows it (the row's own words if not loaded). */
  const foundItem = (row: FoundRow) => itemFor(row.item_id) || { id: row.item_id, type: row.item_type, tracking_mode: row.tracking_mode, name: row.item_name }
  /** Something this desk can issue: a cleared lot with stock of a desk material, or a parchment coil (issued by colour). */
  const readyHere = (row: FoundRow) => row.kind === "REEL"
    ? isParchment(foundItem(row)) && String(row.status || "").toUpperCase() === "IN_STOCK" && USABLE.includes(String(row.stock_status || "").toUpperCase())
    : issuableHere(foundItem(row)) && lotQty({ available_qty: row.qty }) > 0 && USABLE.includes(String(row.stock_status || "").toUpperCase())

  async function findTyped(code: string) {
    setChoices(null)
    if (compactNumber(code).length === 0) return setNotice({ tone: "error", text: "Scan the lot label, or type its Amigo inward number." })
    let found: FoundResult
    try {
      found = (await inventoryApi.findByNumber({ code })).data
    } catch (error) {
      return setNotice({ tone: "error", text: `${code} could not be checked: ${errorText(error)}` })
    }
    const rows = Array.isArray(found?.rows) ? found.rows : []
    if (!rows.length) {
      return setNotice({ tone: "error", text: compactNumber(code).length < 3
        ? `No lot is numbered ${code}. Type at least 3 letters or digits of the number, or pick the material below.`
        : `No lot, reel or coil numbered ${code} in ${displayPlantScope(activePlant)}. Check the number on the label, or pick the material below.` })
    }
    const choice = chooseFound(found, readyHere)
    if (choice.row) return openFound(choice.row, choice.note)
    setChoices({ code, rows: choice.rows, count: found.count || rows.length, truncated: Boolean(found.truncated) })
    setNotice({ tone: "info", text: `${matchWords(rows, code, found.count || rows.length)}. Tap the one in your hand${found.truncated ? ", or type more of the number" : ""}.` })
  }

  /** A found lot or coil goes through the same checks as a scan of its label (plant, QC, stock left, desk). */
  function openFound(row: FoundRow, note?: string) {
    setChoices(null)
    if (row.kind === "REEL") return scanReel(row.id, row.code, row.plant_id, row.code)
    return scanBatch(row.id, row.code, row.plant_id, row.code, note)
  }

  // The /scan page sends issue roles here with ?scan=<label> (or ?item=<material>): act once materials have loaded, then drop it from the URL.
  // scroll: false, or the URL change lands after the scroll to the issue form and jumps the phone back to the top.
  useEffect(() => {
    const linked = linkedScan || linkedItem
    if (!linked || itemsLoading || linkedDone.current === linked) return
    linkedDone.current = linked
    if (linkedScan) void resolveScan(linkedScan)
    else {
      const item = allItems.find((row: any) => String(row.id) === linkedItem)
      if (item && issuableHere(item)) pickScanned(item, isParchment(item) ? `Parchment is issued by colour and kg, oldest coil first. ${item.name} selected.` : `${item.name} selected.`)
      else setNotice({ tone: "error", text: "That material is not issued from this desk." })
    }
    router.replace(pathname, { scroll: false })
  }, [linkedScan, linkedItem, itemsLoading]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!queuedScan || itemsLoading) return
    setQueuedScan("")
    void resolveScan(queuedScan)
  }, [queuedScan, itemsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault()
    const qty = Number(form.qty)
    if (!selectedItem) return setNotice({ tone: "error", text: parchment ? "Choose the parchment colour." : "Choose the material." })
    if (!(qty > 0)) return setNotice({ tone: "error", text: `Enter the ${isPieces(selectedItem) ? "number of pieces" : "quantity"} going to the floor.` })
    if (isPieces(selectedItem) && !Number.isInteger(qty)) return setNotice({ tone: "error", text: `${selectedItem.name} is counted in pieces. Enter a whole number.` })
    if (qty > available + 1e-9) return setNotice({ tone: "error", text: `Only ${qtyText(available, selectedItem.uom)} of ${selectedItem.name} is in stock and cleared for issue${selectedBatch ? " in this lot" : ""}. You asked for ${qtyText(qty, selectedItem.uom)}.` })
    const before = itemOnHand
    if (inFlight.current) return
    inFlight.current = true
    const notes = form.notes.trim() || undefined
    const historyLink = { label: "Issue history", href: "/inventory/issue-history" }
    try {
      if (parchment) {
        const key = keyFor({ kind: "PARCHMENT", item: form.item_id, qty, notes })
        const { data } = await issueParchment.mutateAsync({ plantId: selectedItem.plant_id || undefined, item_id: form.item_id, qty_kg: qty, notes, request_id: key })
        setNotice({ tone: "success", text: data?.message || `${qtyText(qty, "KG")} of ${selectedItem.name} issued to the floor · ${shiftAt().label}.`, action: historyLink })
      } else {
        const key = keyFor({ kind: "LOT", item: form.item_id, batch: form.batch_id, qty, notes })
        const { data } = await createIssue.mutateAsync({
          plantId: selectedItem.plant_id || undefined,
          item_id: form.item_id, batch_id: form.batch_id || undefined, qty, reason_code: "FLOOR_ISSUE", notes,
          external_ref: `FLOOR:${key}`,
        })
        const when = data?.shift_label || shiftAt().label
        setNotice({ tone: "success", text: data?.idempotent ? data.message : `${qtyText(qty, selectedItem.uom)} of ${selectedItem.name} issued to the floor · ${when}. ${qtyText(Math.max(0, before - qty), selectedItem.uom)} left in stock.`, action: historyLink })
      }
      requestKey.current = { body: "", id: "" }
      setForm((current) => ({ ...current, batch_id: "", qty: "", notes: "" }))
      setClock(shiftAt())
      void balancesQuery.refetch(); void balance.refetch()
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) } finally { inFlight.current = false }
  }

  const busy = createIssue.isPending || issueParchment.isPending
  const kindCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of materials) out[kindOf(item)] = (out[kindOf(item)] || 0) + 1
    return out
  }, [materials])
  const shownMaterials = useMemo(() => materials
    .filter((item: any) => kind === "ALL" || kindOf(item) === kind)
    .sort((a: any, b: any) => KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) || Number((onHand[String(b.id)] || 0) > 0) - Number((onHand[String(a.id)] || 0) > 0) || String(a.name).localeCompare(String(b.name))), [materials, kind, onHand])
  const inStock = materials.filter((item: any) => Number(onHand[String(item.id)] || 0) > 0).length
  const todayByItem = useMemo(() => {
    const map = new Map<string, { name: string; uom?: string; shifts: Record<string, number>; total: number; count: number }>()
    for (const row of issuedToday) {
      const bucket = map.get(row.name) || { name: row.name, uom: row.uom, shifts: {}, total: 0, count: 0 }
      const shift = String(row.shift || "—").toUpperCase()
      bucket.shifts[shift] = (bucket.shifts[shift] || 0) + row.qty
      bucket.total += row.qty
      bucket.count += 1
      map.set(row.name, bucket)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [issuedToday])
  // Shift A and B; "General" only for older issues written before the shift came from the clock.
  const shiftColumns = issuedToday.some((row) => String(row.shift || "").toUpperCase() === "GENERAL") ? ["A", "B", "GENERAL"] : ["A", "B"]
  const qtyNumber = Number(form.qty)
  const quick = selectedItem ? (isPieces(selectedItem) ? [10, 25, 50, 100] : [5, 10, 25, 50]).filter((value) => value <= available) : []
  const pick = (id: string) => { setForm((current) => ({ ...current, item_id: id, qty: "" })); setNotice(null); setChoices(null) }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue"]}>
      <ProcurementShell eyebrow="Stores" title="Material issue to floor" description="Adhesive, parchment and packing go to the floor — not to a job card or machine. The shift and date are taken from the clock when you press Issue. What goes to the floor is consumed in full. Parchment is issued by colour and kg, plastic in kg, boxes in pieces." actions={<IssueDeskTabs />} allPlants>
        {notice ? (
          <MessageBar tone={notice.tone}>
            <span data-testid="material-issue-notice">{notice.text}</span>
            {notice.action ? (
              <span className="mt-2 flex" data-no-mirror>
                {notice.action.href
                  ? <Link href={notice.action.href} className={cn(secondaryButton, "h-11")}>{notice.action.label}<ArrowUpRight className="h-4 w-4" /></Link>
                  : <button type="button" className={cn(secondaryButton, "h-11")} onClick={notice.action.onClick}>{notice.action.label}</button>}
              </span>
            ) : null}
          </MessageBar>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3" data-testid="material-issue-stats">
          <StatTile label="Materials in stock" value={String(inStock)} hint={`of ${materials.length} adhesive, parchment and packing items`} />
          <StatTile label={`Issued · ${clock.label.replace(/^Shift [AB] · /, "")}`} value={String(issuedToday.length)} hint={todayByItem.length ? `${todayByItem.length} material${todayByItem.length === 1 ? "" : "s"}` : "nothing yet"} />
          <StatTile label="Out of stock" value={String(materials.length - inStock)} hint="inward or pass incoming QC to issue" tone={materials.length - inStock ? "amber" : undefined} />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <WorkPanel title="1 · Pick the material" description="Tap a material, or scan the lot label or type its lot / Amigo inward number: the material and the lot are picked for you. Only stock that passed incoming QC is counted.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-input px-3"><Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Scan lot label" className="h-11 w-full bg-transparent text-[13px] outline-none" value={scan} placeholder="Scan lot QR or type the lot / Amigo inward no." onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveScan() } }} /></label>
              <button type="button" className={secondaryButton} onClick={() => void resolveScan()}><PackageCheck className="h-4 w-4" />Find lot</button>
              <QrScanner className={secondaryButton} onScan={(value) => { setScan(parseScanCode(value).code || value); void resolveScan(value) }} label="Camera" title="Scan lot label" hint="Point the camera at the QR on the lot label." />
            </div>
            {choices ? <FoundChoices choices={choices} testid="material-issue-choices" onPick={(row) => void openFound(row)} onCancel={() => setChoices(null)} /> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex h-11 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-input px-3 sm:h-9"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="h-full w-full bg-transparent text-[13px] outline-none" aria-label="Find material" placeholder="Find adhesive, parchment colour, plastic, box…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} /></label>
              <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                {(["ALL", ...KIND_ORDER] as string[]).filter((key) => key === "ALL" || kindCounts[key]).map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={kind === key} onClick={() => setKind(key)} className={cn("h-11 rounded-md px-2.5 text-[12.5px] font-semibold sm:h-8", kind === key ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                    {key === "ALL" ? "All" : KIND_LABEL[key]} <span className="tabular-nums text-muted-foreground">{key === "ALL" ? materials.length : kindCounts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Material" data-testid="floor-issue-material">
              {shownMaterials.map((item: any) => {
                const stock = Number(onHand[String(item.id)] || 0)
                const chosen = String(item.id) === form.item_id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={stock <= 0}
                    onClick={() => pick(String(item.id))}
                    data-testid={`floor-issue-material-${item.item_code}`}
                    className={cn(
                      "flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left transition",
                      chosen ? "border-primary bg-primary/[.06] ring-2 ring-primary/25" : "border-border bg-card hover:border-foreground/25 hover:bg-muted/40",
                      stock <= 0 && "cursor-not-allowed opacity-55 hover:border-border hover:bg-card",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-foreground" title={item.name}>{item.name}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{manyPlants ? `${displayPlantScope(item.plant_id)} · ` : ""}{item.item_code}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset", KIND_TONE[kindOf(item)])}>{KIND_LABEL[kindOf(item)]}</span>
                    </span>
                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      <span className={cn("text-[15px] font-semibold tabular-nums", stock > 0 ? "text-foreground" : "text-signal-amber-ink")}>{stock > 0 ? qtyText(stock, item.uom) : "None in stock"}</span>
                      <span className="text-[11px] text-muted-foreground">{isParchment(item) ? "by colour · kg" : isPieces(item) ? "pieces" : unitText(item.uom)}</span>
                    </span>
                  </button>
                )
              })}
              {!shownMaterials.length ? <p className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground sm:col-span-2">No material matches. Clear the search or pick another kind.</p> : null}
            </div>
          </WorkPanel>

          <div ref={formPanel} className="scroll-mt-24 xl:sticky xl:top-4">
            <WorkPanel title="2 · Issue to the floor" description={selectedItem ? "Oldest lot goes first unless you choose one." : "Pick a material on the left first."}>
              {selectedItem ? (
                <form onSubmit={submit} className="grid gap-3" data-testid="floor-issue-form">
                  <div data-testid="floor-issue-on-hand" className={cn("rounded-xl border px-3 py-2.5", itemOnHand > 0 ? "border-border bg-muted/50" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")}>
                    <p className="text-[14px] font-semibold text-foreground">{selectedItem.name}</p>
                    <p className="text-[12.5px] text-muted-foreground">{selectedItem.item_code}{manyPlants ? ` · ${displayPlantScope(selectedItem.plant_id)}` : ""}</p>
                    <p className="mt-1.5 text-[13px]">Cleared for issue: <strong className="tabular-nums">{qtyText(itemOnHand, selectedItem.uom)}</strong>{parchment ? " · all coils of this colour, oldest first" : batches.length ? ` in ${batches.length} lot${batches.length === 1 ? "" : "s"}` : ""}</p>
                  </div>
                  {parchment ? (
                    <ParchmentPickFrom itemId={String(selectedItem.id)} qtyKg={Number(form.qty) || undefined} />
                  ) : (
                    <div className="grid gap-1.5">
                      <div className="grid gap-1.5" role="radiogroup" aria-label="Lot" data-testid="floor-issue-lots">
                        <p className="text-[12.5px] font-semibold text-foreground">Lot (Amigo inward no.) <span className="font-normal text-muted-foreground">· optional: oldest cleared lot goes first</span></p>
                        <button type="button" role="radio" aria-checked={!form.batch_id} data-testid="floor-issue-lot-oldest" onClick={() => setForm({ ...form, batch_id: "" })} className={cn(lotChoice, !form.batch_id ? lotOn : lotOff)}>
                          <span className="min-w-0"><span className="block text-[13px] font-semibold">Oldest first (FIFO)</span><span className="block truncate text-[12px] text-muted-foreground">{batches.length ? `starts with ${lotName(batches[0])}` : "no cleared lot yet"}</span></span>
                          <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">{qtyText(itemOnHand, selectedItem.uom)}</span>
                        </button>
                        {shownLots.map((batch: any) => {
                          const on = String(batch.batch_id) === form.batch_id
                          return (
                            <button key={batch.batch_id} type="button" role="radio" aria-checked={on} data-testid={`floor-issue-lot-${lotName(batch)}`} onClick={() => setForm({ ...form, batch_id: String(batch.batch_id) })} className={cn(lotChoice, on ? lotOn : lotOff)}>
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold">{lotName(batch)}{batch === batches[0] ? <span className="rounded-full bg-signal-teal-soft px-1.5 py-px text-[10.5px] font-semibold text-signal-teal-ink ring-1 ring-inset ring-signal-teal-line">oldest · goes first</span> : null}</span>
                                <span className="block truncate text-[12px] text-muted-foreground">{pickFrom(batch).replace(/^Pick from /, "")}{batch.received_on ? ` · in ${dayOf(batch.received_on)}` : batch.created_at ? ` · in ${istDay(batch.created_at)}` : ""}</span>
                              </span>
                              <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">{qtyText(lotQty(batch), selectedItem.uom)}</span>
                            </button>
                          )
                        })}
                        {batches.length > shownLots.length ? <button type="button" className="inline-flex min-h-11 items-center self-start px-1 text-[12.5px] font-semibold text-primary hover:underline sm:min-h-8" onClick={() => setAllLots(true)}>Show all {batches.length} lots</button> : null}
                      </div>
                      {pickBatch ? (
                        <p className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] leading-5", pickBatch.location_id ? "border-border bg-muted/50 text-foreground" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")} data-testid="floor-issue-pick-from">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0"><b className="font-semibold">{pickFrom(pickBatch)}</b><span className="block text-[12px] text-muted-foreground">{pickBatch.inward_no || pickBatch.grn_no || pickBatch.batch_no}{selectedBatch ? "" : " · oldest lot, issued first"}{pickBatch.location_id ? "" : " · ask the store where it is kept"}</span></span>
                        </p>
                      ) : null}
                    </div>
                  )}
                  <Field label={`Quantity · ${isPieces(selectedItem) ? "pieces" : unitText(selectedItem.uom)}`} hint={`${qtyText(available, selectedItem.uom)} available`}>
                    <input aria-label="Quantity" data-testid="floor-issue-qty" className={cn(fieldClass, "max-sm:h-11 sm:h-11 text-[16px] font-semibold tabular-nums")} type="number" min={isPieces(selectedItem) ? "1" : "0.001"} step={isPieces(selectedItem) ? "1" : "0.001"} inputMode={isPieces(selectedItem) ? "numeric" : "decimal"} value={form.qty} placeholder="0" onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                  {quick.length ? (
                    <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Quick quantity">
                      {quick.map((value) => <button key={value} type="button" onClick={() => setForm({ ...form, qty: String(value) })} className={cn("h-11 rounded-full border px-3 text-[12px] font-semibold tabular-nums sm:h-8", qtyNumber === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{qtyText(value, selectedItem.uom)}</button>)}
                    </div>
                  ) : null}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-border bg-muted/50 px-3 py-2 text-[13px]" data-testid="floor-issue-shift">
                    <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <b className="font-semibold">{clock.label}</b>
                    <span className="text-muted-foreground">(now {clock.clock})</span>
                    <span className="basis-full text-[11.5px] text-muted-foreground">Shift and date are taken from the clock when you press Issue.</span>
                  </p>
                  <Field label="Note" hint="optional"><input className={cn(fieldClass, "max-sm:h-11")} value={form.notes} placeholder="e.g. for the night shift" onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
                  <button type="submit" data-testid="floor-issue-submit" className={cn(primaryButton, "h-11 justify-center text-[14px]")} disabled={busy || !(qtyNumber > 0)}>
                    <PackageCheck className="h-4 w-4" />
                    {busy ? "Issuing…" : qtyNumber > 0 ? `Issue ${qtyText(qtyNumber, selectedItem.uom)} to floor` : "Enter the quantity"}
                  </button>
                </form>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-5 text-center text-[13px] text-muted-foreground">
                  <PackageCheck className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                  Tap a material that has stock, or scan its lot label. The quantity comes next; the shift and date come from the clock.
                </div>
              )}
            </WorkPanel>
          </div>
        </div>

        <WorkPanel title={`Issued to the floor today · ${issuedToday.length}`} description={`Business day ${clock.label.replace(/^Shift [AB] · /, "")} by material and shift (Shift B runs until 08:00 next morning). Parchment shows the coil it came from.`} action={<Link href="/inventory/issue-history" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary hover:underline sm:min-h-0" data-testid="material-issue-history-link"><History className="h-4 w-4" aria-hidden="true" />Issue history</Link>}>
          {todayByItem.length ? (
            <div className="overflow-x-auto" data-testid="floor-issue-today">
              <table className="tube-grid w-full min-w-[560px] !text-[13px]">
                <thead><tr><th>Material</th><th className="num">Shift A</th><th className="num">Shift B</th>{shiftColumns.includes("GENERAL") ? <th className="num">General (older)</th> : null}<th className="num">Total today</th></tr></thead>
                <tbody>
                  {todayByItem.map((row) => (
                    <tr key={row.name}>
                      <td><span className="font-medium">{row.name}</span><span className="block text-[11.5px] text-muted-foreground">{row.count} issue{row.count === 1 ? "" : "s"}</span></td>
                      {shiftColumns.map((shift) => <td key={shift} className="num tabular-nums">{row.shifts[shift] ? qtyText(row.shifts[shift], row.uom) : "—"}</td>)}
                      <td className="num font-semibold tabular-nums">{qtyText(row.total, row.uom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="mt-2 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-primary hover:underline sm:min-h-0" onClick={() => setShowEach((value) => !value)}>{showEach ? "Hide each issue" : `Show each issue (${issuedToday.length})`}</button>
              {showEach ? (
                <ul className="mt-1 divide-y divide-border">
                  {issuedToday.map((row) => (
                    <li key={row.key} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                      <span className="min-w-0 truncate"><span className="font-medium">{row.name}</span><span className="text-muted-foreground"> · shift {row.shift || "—"}{row.notes ? ` · ${row.notes}` : ""}</span></span>
                      <span className="shrink-0 font-semibold tabular-nums">{qtyText(row.qty, row.uom)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : <p className="text-sm text-muted-foreground">Nothing issued to the floor yet today.</p>}
        </WorkPanel>
      </ProcurementShell>
    </RoleGate>
  )
}

function StatTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "amber" }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3", tone === "amber" ? "border-signal-amber-line" : "border-border")}>
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-[22px] font-semibold tabular-nums", tone === "amber" ? "text-signal-amber-ink" : "text-foreground")}>{value}</p>
      <p className="truncate text-[11.5px] text-muted-foreground">{hint}</p>
    </div>
  )
}

/** Parchment goes by colour and kg, so the desk shows the coils that weight takes, oldest cleared first,
 * each with "Pick from <rack>" (spec 2.7), the same words as the lot desks. */
function ParchmentPickFrom({ itemId, qtyKg }: { itemId: string; qtyKg?: number }) {
  const qty = useDeferredValue(qtyKg)
  const query = useParchmentCoils(itemId, qty)
  const coils = query.data?.coils || []
  if (query.isLoading || !coils.length) return null
  const shown = coils.slice(0, 4)
  return (
    <div className="grid gap-1.5" data-testid="floor-issue-pick-from">
      <p className="text-[12.5px] font-semibold text-foreground">{qty ? `Coils this issue takes (${coils.length})` : "Next coils, oldest first"}</p>
      <ul className="grid gap-1.5">
        {shown.map((coil) => (
          <li key={coil.reel_id} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] leading-5", coil.location ? "border-border bg-muted/50 text-foreground" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")}>
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <b className="font-semibold">{pickFromText(coil.location)}</b>
              <span className="block text-[12px] text-muted-foreground">{coil.reel_code} · {coil.take_kg != null && coil.take_kg < coil.kg ? `${qtyText(coil.take_kg, "KG")} of ${qtyText(coil.kg, "KG")}` : qtyText(coil.kg, "KG")}{coil.location ? "" : " · ask the store where it is kept"}</span>
            </span>
          </li>
        ))}
      </ul>
      {coils.length > shown.length ? <p className="text-[12px] text-muted-foreground">and {coils.length - shown.length} more coil{coils.length - shown.length === 1 ? "" : "s"}</p> : null}
    </div>
  )
}

// useSearchParams needs a Suspense boundary in Next 15 (SPEC section 6), or the build bails out.
export default function MaterialFloorIssuePageWithSearch() {
  return (
    <Suspense fallback={null}>
      <MaterialFloorIssuePage />
    </Suspense>
  )
}
