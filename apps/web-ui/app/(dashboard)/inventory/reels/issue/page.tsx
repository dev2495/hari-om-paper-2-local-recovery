"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, Barcode, Check, CircleAlert, Clock3, ClipboardList, History, Hourglass, PackageCheck, Scissors, Search, Truck } from "lucide-react"

import { QrScanner } from "@/components/common/qr-scanner"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { FoundChoices } from "@/components/procurement/found-choices"
import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { Chip } from "@/components/sales/order-chips"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useCloseReelIssue, useCreateReelIssue, useInventoryItems, useInventoryLocations, usePendingInventoryQuality, useRecordSlittingCard, useReelIssues, useReels } from "@/hooks/use-inventory"
import { usePlants } from "@/hooks/use-system"
import { inventoryApi } from "@/lib/api"
import { canonicalPlantScopeValue, displayPlantScope } from "@/lib/plant-scope"
import { chooseFound, compactNumber, isReady, matchWords, sameNumber, type FoundResult, type FoundRow } from "@/lib/lot-find"
import { parseScanCode } from "@/lib/scan-code"
import { pickFromText, who } from "@/lib/stock-format"
import { shiftAt, shiftWords } from "@/lib/shift"
import { cn } from "@/lib/utils"

const ISSUABLE = ["UNRESTRICTED", "WIP"]
/** IST time of a naive-UTC server stamp, "21:45". */
const istTime = (value?: string | null) => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"
const kg = (value: any) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || "Action failed"
}
const isCoil = (row: any) => String(row?.physical_form || "REEL").toUpperCase() === "COIL"

/**
 * Why an in-stock reel or coil cannot go to the floor yet. Incoming QC is the only gate
 * (client 2026-10-27): invoice or rate questions never hold paper back.
 */
function waitingReason(row: any, queueState?: string): { text: string; tone: "blue" | "amber" | "rose"; action: string } {
  const state = String(queueState || "").toUpperCase()
  const status = String(row?.stock_status || "").toUpperCase()
  if (state === "FAILED") return { text: "Failed incoming QC", tone: "amber", action: "Re-check or concede" }
  if (state === "REJECTED" || status === "BLOCKED") return { text: "Rejected by QC", tone: "rose", action: "Return or concede" }
  return { text: "Waiting for incoming QC", tone: "blue", action: "Inspect now" }
}

const samePlant = (a?: string | null, b?: string | null) => canonicalPlantScopeValue(a).toLowerCase() === canonicalPlantScopeValue(b).toLowerCase()
const rowsOf = (data: any): any[] => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [])

type Notice = { tone: "success" | "error" | "info"; text: string; action?: { label: string; href?: string; onClick?: () => void } }

const EMPTY_CARD = { coils_made: "", wastage_kg: "", coil_width_mm: "", operator_name: "", notes: "" }

function Stat({ icon: Icon, label, value, hint, tone }: { icon: any; label: string; value: string | number; hint: string; tone: string }) {
  const tones: Record<string, string> = {
    emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    blue: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink",
    amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    slate: "border-border bg-muted text-muted-foreground",
  }
  return (
    <div className="erp-panel flex items-center gap-3 rounded-xl p-3.5">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", tones[tone] || tones.slate)}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-1 block text-[12.5px] font-semibold text-foreground/85">{label}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{hint}</span>
      </span>
    </div>
  )
}

/** Fields are 44 px tall on a phone (thumb targets), compact on a desk. */
const phoneField = `${fieldClass} max-sm:h-11`

export default function ReelAndCoilIssuePage() {
  const { user, activePlant, activeRole, setActivePlant } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const linkedScan = searchParams?.get("scan") || ""
  const linkedDone = useRef("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [scanCode, setScanCode] = useState("")
  // A scan made while stock is still loading waits here instead of saying "not in stock".
  const [queuedScan, setQueuedScan] = useState("")
  // Reels found by id outside the newest-500 stock window, so they can still be picked.
  const [extraRows, setExtraRows] = useState<any[]>([])
  // A typed number that fits more than one reel or coil (an old mark used twice, a part of a number): a short pick list.
  const [choices, setChoices] = useState<{ code: string; rows: FoundRow[]; count: number; truncated: boolean } | null>(null)
  const submitButton = useRef<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<"ALL" | "REEL" | "COIL">("ALL")
  const [picked, setPicked] = useState<string[]>([])
  // No shift or date is asked (client 2026-10-30): the server dates the issue from the moment it is
  // registered by the shift rule. The desk only shows which shift that is, from the IST clock.
  const [clock, setClock] = useState(() => shiftAt())
  useEffect(() => { const timer = window.setInterval(() => setClock(shiftAt()), 20_000); return () => window.clearInterval(timer) }, [])
  // One key per reel being issued: a double tap or a retry after a dropped line sends the same key, and the
  // server returns the first issue instead of issuing twice. Cleared once the reel is issued.
  const requestKeys = useRef(new Map<string, string>())
  const inFlight = useRef(false)
  const [issuing, setIssuing] = useState(false)
  const [cardFor, setCardFor] = useState<string | null>(null)
  const [card, setCard] = useState(EMPTY_CARD)
  const [legacyWeights, setLegacyWeights] = useState<Record<string, string>>({})

  const stockQuery = useReels({ status: "IN_STOCK", limit: 500 })
  const itemsQuery = useInventoryItems()
  // "Pick from <rack>" beside each reel (client 2026-10-28): where the store keeps it, read-only.
  const locationsQuery = useInventoryLocations()
  const placeOf = useMemo(() => {
    const map = new Map((Array.isArray(locationsQuery.data) ? locationsQuery.data : []).map((row: any) => [String(row.id), row]))
    return (row: any) => pickFromText(row?.location_id ? map.get(String(row.location_id)) : null)
  }, [locationsQuery.data])
  const plantsQuery = usePlants()
  const pendingQc = usePendingInventoryQuality()
  const openQuery = useReelIssues({ status: "OPEN", limit: 300 })
  const todayQuery = useReelIssues({ date_from: clock.businessDate, date_to: clock.businessDate, limit: 300 })
  const createIssue = useCreateReelIssue()
  const recordCard = useRecordSlittingCard()
  const closeLegacy = useCloseReelIssue()

  // Parchment is issued by colour and kg on the material tab, never by coil number (client 2026-10-26).
  const itemById = useMemo(() => new Map((Array.isArray(itemsQuery.data) ? itemsQuery.data : []).map((item: any) => [String(item.id), item])), [itemsQuery.data])
  const itemOf = (row: any): any => itemById.get(String(row?.paper_id))
  const isParchmentReel = (row: any) => String(itemOf(row)?.type || "").toUpperCase() === "PARCHMENT"
  const qcState = useMemo(() => {
    const out = new Map<string, string>()
    for (const row of Array.isArray(pendingQc.data) ? pendingQc.data : []) if (row?.entity_type === "REEL") out.set(String(row.entity_id), String(row.queue_state || ""))
    return out
  }, [pendingQc.data])

  const stockRows: any[] = useMemo(() => {
    const loaded = Array.isArray(stockQuery.data) ? stockQuery.data : []
    const known = new Set(loaded.map((row: any) => String(row.id)))
    return [...loaded, ...extraRows.filter((row) => !known.has(String(row.id)))]
  }, [stockQuery.data, extraRows])
  const inStock: any[] = useMemo(
    () => stockRows.filter((row: any) => Number(row.current_weight_kg || 0) > 0 && !isParchmentReel(row)),
    [stockRows, itemById], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const ready = useMemo(() => inStock.filter((row) => ISSUABLE.includes(String(row.stock_status || "").toUpperCase())), [inStock])
  const waiting = useMemo(() => inStock.filter((row) => !ISSUABLE.includes(String(row.stock_status || "").toUpperCase())), [inStock])
  const manyPlants = new Set(inStock.map((row) => String(row.plant_id || ""))).size > 1
  const needle = search.trim().toLowerCase()
  // The list search, like the scan box, ignores case, spaces and dashes in numbers: "chkr2 r1" finds CHKR2-R1.
  const describe = (row: any) => [row.reel_code, itemOf(row)?.item_code, itemOf(row)?.name, row.source_reel_no, row.inward_metadata?.old_mark, row.supplier_name_snapshot || row.supplier_name].filter(Boolean).map(String)
  const needleChars = compactNumber(needle)
  const listMatch = (row: any) => describe(row).some((value) => value.toLowerCase().includes(needle) || (needleChars.length > 0 && compactNumber(value).includes(needleChars)))
  const shown = ready.filter((row) => (form === "ALL" || (form === "COIL") === isCoil(row)) && (!needle || listMatch(row)))
  const selected = ready.filter((row) => picked.includes(String(row.id)))
  const selectedKg = selected.reduce((sum, row) => sum + Number(row.current_weight_kg || 0), 0)
  const readyKg = ready.reduce((sum, row) => sum + Number(row.current_weight_kg || 0), 0)

  const onHand = useMemo(() => {
    const rows = new Map<string, { id: string; code: string; name: string; reels: number; kg: number; waitingKg: number }>()
    const add = (row: any, cleared: boolean) => {
      const item: any = itemOf(row)
      const key = String(row.paper_id)
      const entry = rows.get(key) || { id: key, code: item?.item_code || "Paper", name: item?.name || "", reels: 0, kg: 0, waitingKg: 0 }
      if (cleared) { entry.reels += 1; entry.kg += Number(row.current_weight_kg || 0) } else entry.waitingKg += Number(row.current_weight_kg || 0)
      rows.set(key, entry)
    }
    ready.forEach((row) => add(row, true))
    waiting.forEach((row) => add(row, false))
    return Array.from(rows.values()).sort((a, b) => a.code.localeCompare(b.code))
  }, [ready, waiting, itemById]) // eslint-disable-line react-hooks/exhaustive-deps

  const openIssues: any[] = Array.isArray(openQuery.data) ? openQuery.data : []
  const cardsDue = openIssues.filter((row) => row.issue_mode === "FLOOR" && row.issue_section === "SLITTING_SECTION")
  const legacyOpen = openIssues.filter((row) => row.issue_mode !== "FLOOR")
  const parchmentCodes = new Set(Array.from(itemById.values()).filter((item: any) => String(item?.type || "").toUpperCase() === "PARCHMENT").map((item: any) => String(item.item_code)))
  const today: any[] = (Array.isArray(todayQuery.data) ? todayQuery.data : []).filter((row: any) => !parchmentCodes.has(String(row.paper_code || "")))
  const todayKg = today.reduce((sum, row) => sum + Number(row.issued_weight_kg || 0), 0)
  const busy = issuing || recordCard.isPending || closeLegacy.isPending

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))

  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  // The Incoming inspection page lets these roles in; everyone else is told to ask QC instead of a link they cannot open.
  const canOpenQc = ["QC", "InwardQC", "Store", "PlantManager", "Owner", "Admin"].some((role) => roles.has(role))
  // Same test as /scan and the server: Owner and Admin too are limited to their login's plants.
  const canSeePlant = (plantId: string) => Boolean(user?.is_owner_all_plants) || [...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].some((value) => samePlant(value, plantId))
  // Plain plant name for a label's plant; a plant this login cannot list is just "another plant".
  const plantName = (id: string) => {
    const plant = (Array.isArray(plantsQuery.data) ? plantsQuery.data : []).find((row: any) => samePlant(String(row.id), id))
    const known = displayPlantScope(canonicalPlantScopeValue(id))
    return plant?.name || (known !== canonicalPlantScopeValue(id) ? known : "another plant")
  }
  const stockReady = stockQuery.isSuccess && !itemsQuery.isLoading && !pendingQc.isLoading

  /** Picks a scanned reel or coil, or says exactly why it cannot go to the floor. */
  async function explainReel(row: any, queueState?: string, note?: string) {
    const code = row.reel_code
    if (isParchmentReel(row)) return setNotice({ tone: "info", text: `${code} is parchment. Parchment is issued by colour and kg on the Adhesive / parchment / packing tab.`, action: { label: "Open material issue", href: `/inventory/production-issue?item=${row.paper_id}` } })
    const status = String(row.status || "").toUpperCase()
    if (status === "CONSUMED" || status === "ISSUED") {
      let when = ""
      try {
        const last = rowsOf((await inventoryApi.getReelIssues({ reel_id: row.id, limit: 1 })).data)[0]
        if (last?.issue_date) when = ` (${shiftWords(last.shift, last.issue_date)}${last.issued_at ? `, ${istTime(last.issued_at)}` : ""})`
      } catch { /* the reason stands without the date */ }
      return setNotice({ tone: "error", text: `${code} was already issued to the floor${when} and is used up. Nothing is left to issue.` })
    }
    if (status === "SCRAP") return setNotice({ tone: "error", text: `${code} was scrapped. It cannot be issued.` })
    if (Number(row.current_weight_kg || 0) <= 0) return setNotice({ tone: "error", text: `${code} has no weight left. Nothing is left to issue.` })
    if (!ISSUABLE.includes(String(row.stock_status || "").toUpperCase())) {
      const { text } = waitingReason(row, queueState ?? qcState.get(String(row.id)))
      const reason = text.charAt(0).toLowerCase() + text.slice(1)
      return setNotice(canOpenQc
        ? { tone: "error", text: `${code} cannot go to the floor yet: ${reason}.`, action: { label: "Open in incoming QC", href: `/quality/incoming?lot=REEL:${row.id}` } }
        : { tone: "error", text: `${code} cannot go to the floor yet: ${reason}. Ask QC to inspect it.` })
    }
    if (!stockRows.some((item) => String(item.id) === String(row.id))) setExtraRows((current) => [...current, row])
    const again = picked.includes(String(row.id))
    setPicked((current) => (current.includes(String(row.id)) ? current : [...current, String(row.id)]))
    setScanCode("")
    // Scanned twice: it stays picked once and goes to the floor once.
    setNotice({ tone: "info", text: again ? `${code} is already picked. It goes to the floor once.` : `${code} added · ${isCoil(row) ? "coil → winders" : "reel → slitter"}.${note ? ` ${note}` : ""}` })
    // On a phone the issue button can be off screen: bring it up so the scan is one tap from issue.
    if (window.innerWidth < 1280) window.setTimeout(() => submitButton.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80)
  }

  async function resolveScan(value: string = scanCode) {
    const parsed = parseScanCode(value)
    setChoices(null)
    if (!parsed.raw) return setNotice({ tone: "error", text: "Scan the reel or coil label, or type its AT number." })
    if (parsed.kind === "BATCH") return setNotice({ tone: "error", text: "That is a material lot label. Adhesive, packing and parchment are issued on the Adhesive / parchment / packing tab.", action: { label: "Open material issue", href: `/inventory/production-issue?scan=${encodeURIComponent(parsed.raw)}` } })
    if (parsed.kind === "JOB_CARD" || parsed.kind === "TOOL") return setNotice({ tone: "error", text: `That is a ${parsed.kind === "TOOL" ? "tool" : "job card"} label. Scan the reel or coil label.` })
    if (parsed.kind === "LOCATION") return setNotice({ tone: "error", text: `That is a rack label (${parsed.code || "location"}). Scan the reel or coil label.`, action: { label: `See what is on ${parsed.code || "the rack"}`, href: `/inventory/locations/${parsed.id}` } })
    if (!stockReady) {
      setQueuedScan(value)
      return setNotice({ tone: "info", text: "Stock is still loading. The label is checked as soon as it is ready." })
    }
    // An AT number is short; anything long (another system's QR) is not a reel or coil label.
    if (!parsed.id && parsed.code.length > 60) return setNotice({ tone: "error", text: "That is not a reel or coil label. Scan the QR on the reel or coil, or type its AT number." })
    const label = parsed.code || "That label"
    if (parsed.plantId && !canSeePlant(parsed.plantId)) return setNotice({ tone: "error", text: `${label} is from ${plantName(parsed.plantId)}, which your login cannot open.` })
    if (parsed.plantId && activePlant && activePlant !== "ALL" && !samePlant(parsed.plantId, activePlant)) {
      const plant = plantName(parsed.plantId)
      return setNotice({
        tone: "error",
        text: `${label} is from ${plant}. You are working in ${displayPlantScope(activePlant)}: switch plant to issue it.`,
        action: { label: `Switch to ${plant}`, onClick: () => { setActivePlant(parsed.plantId); window.location.assign(`${pathname}?scan=${encodeURIComponent(parsed.raw)}`) } },
      })
    }
    const cleared = (row: any) => ISSUABLE.includes(String(row?.stock_status || "").toUpperCase())
    if (parsed.id) {
      // A scanned QR: the reel by its id.
      const id = parsed.id.toUpperCase()
      const local = stockRows.find((row) => String(row.id).toUpperCase() === id)
      if (local && cleared(local)) return explainReel(local)
      // Held in the loaded list (the desk stays open all shift while QC passes reels), or not in it at all:
      // older stock, already used, or never received here. Ask the server before refusing.
      try {
        const found = rowsOf((await inventoryApi.getReels({ reel_ids: parsed.id, limit: 1 })).data)[0]
        if (found) return explainFound(found, Boolean(local))
        if (local) return explainReel(local)
      } catch (error) {
        if (local) return explainReel(local)
        return setNotice({ tone: "error", text: `${label} could not be checked: ${errorText(error)}` })
      }
      return setNotice({ tone: "error", text: `${label} was not found in ${displayPlantScope(activePlant)}. Check the label, or type the AT number.` })
    }
    // A typed number: the AT number, the vendor reel number or an opening-stock old mark, in any case or spacing.
    // One reel ready on the desk with that number goes straight in; anything else is asked of the server, which
    // also finds a unique part of a number and reels outside the loaded list.
    const code = parsed.code
    const numbers = (row: any) => [row.reel_code, row.source_reel_no, row.inward_metadata?.amigo_no, row.inward_metadata?.old_mark]
    const local = stockRows.filter((row) => numbers(row).some((value) => sameNumber(value, code)))
    if (local.length === 1 && cleared(local[0]) && Number(local[0].current_weight_kg || 0) > 0) return explainReel(local[0])
    let found: FoundResult
    try {
      found = (await inventoryApi.findByNumber({ code })).data
    } catch (error) {
      return setNotice({ tone: "error", text: `${label} could not be checked: ${errorText(error)}` })
    }
    const rows = Array.isArray(found?.rows) ? found.rows : []
    const reels = rows.filter((row) => row.kind === "REEL")
    if (!reels.length && rows.length) {
      return setNotice({ tone: "error", text: `${rows.length === 1 ? `${rows[0].code} is a material lot` : `${code} is a material lot number`}. Adhesive, packing and parchment are issued on the Adhesive / parchment / packing tab.`, action: { label: "Open material issue", href: `/inventory/production-issue?scan=${encodeURIComponent(rows.length === 1 ? rows[0].code : code)}` } })
    }
    if (!reels.length) {
      return setNotice({ tone: "error", text: compactNumber(code).length < 3
        ? `No reel or coil is numbered ${code}. Type at least 3 letters or digits of the AT or vendor reel number.`
        : `${label} was not found in ${displayPlantScope(activePlant)}. Check the label, or type the AT number.` })
    }
    const choice = chooseFound({ match: found.match, rows: reels }, (row) => isReady(row) && String(row.item_type || "").toUpperCase() !== "PARCHMENT")
    if (choice.row) return openFound(choice.row, choice.note)
    setChoices({ code, rows: choice.rows, count: reels.length < rows.length ? reels.length : found.count || reels.length, truncated: Boolean(found.truncated) })
    setNotice({ tone: "info", text: `${matchWords(reels, code, reels.length < rows.length ? reels.length : found.count || reels.length)}. Tap the one in your hand${found.truncated ? ", or type more of the number" : ""}.` })
  }

  /** A reel read from the server: explained with its QC queue state when it is held; the stock list refreshed when QC passed it since. */
  async function explainFound(found: any, wasLoaded: boolean, note?: string) {
    const cleared = ISSUABLE.includes(String(found?.stock_status || "").toUpperCase())
    if (!cleared) {
      const queue = await pendingQc.refetch()
      return explainReel(found, rowsOf(queue.data).find((row: any) => row?.entity_type === "REEL" && String(row.entity_id) === String(found.id))?.queue_state)
    }
    if (wasLoaded) await stockQuery.refetch()
    return explainReel(found, undefined, note)
  }

  /** A reel from the typed-number list: read in full, then checked exactly like a scan of its label. */
  async function openFound(row: FoundRow, note?: string) {
    setChoices(null)
    try {
      const full = rowsOf((await inventoryApi.getReels({ reel_ids: row.id, limit: 1 })).data)[0]
      if (!full) return setNotice({ tone: "error", text: `${row.code} was not found in ${displayPlantScope(activePlant)}. Check the label, or type the AT number.` })
      const loaded = stockRows.find((item) => String(item.id) === String(row.id))
      return explainFound(full, Boolean(loaded && !ISSUABLE.includes(String(loaded.stock_status || "").toUpperCase())), note)
    } catch (error) {
      return setNotice({ tone: "error", text: `${row.code} could not be checked: ${errorText(error)}` })
    }
  }

  // The /scan page sends issue roles here with ?scan=<label>: check it once stock has loaded, then drop it from the URL.
  // scroll: false, or the URL change lands after the scroll to the issue button and jumps the phone back to the top.
  useEffect(() => {
    if (!linkedScan || !stockReady || linkedDone.current === linkedScan) return
    linkedDone.current = linkedScan
    void resolveScan(linkedScan)
    router.replace(pathname, { scroll: false })
  }, [linkedScan, stockReady]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!queuedScan || !stockReady) return
    setQueuedScan("")
    void resolveScan(queuedScan)
  }, [queuedScan, stockReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function issueSelected() {
    if (!selected.length) return setNotice({ tone: "error", text: "Pick or scan the reels and coils going to the floor." })
    if (inFlight.current) return
    inFlight.current = true
    setIssuing(true)
    const done: string[] = []
    const failed: string[] = []
    let dated = ""
    for (const row of selected) {
      const id = String(row.id)
      const key = requestKeys.current.get(id) || crypto.randomUUID()
      requestKeys.current.set(id, key)
      try {
        const { data } = await createIssue.mutateAsync({ plantId: row.plant_id || undefined, reel_id: row.id, issued_weight_kg: Number(row.current_weight_kg), request_id: key })
        dated = data?.shift_label || dated
        done.push(id)
        requestKeys.current.delete(id)
      } catch (error) {
        failed.push(`${row.reel_code}: ${errorText(error)}`)
      }
    }
    inFlight.current = false
    setIssuing(false)
    setClock(shiftAt())
    setPicked((current) => current.filter((id) => !done.includes(id)))
    setExtraRows((current) => current.filter((row) => !done.includes(String(row.id))))
    const slit = selected.filter((row) => done.includes(String(row.id)) && !isCoil(row)).length
    const when = dated || shiftAt().label
    if (failed.length) {
      setNotice({ tone: "error", text: `${done.length} issued (${when}). Not issued — ${failed.join(" · ")}` })
    } else {
      setNotice({ tone: "success", text: `${done.length} issued to the floor · ${when}.${slit ? ` Write the slitting card for ${slit === 1 ? "the reel" : `the ${slit} reels`} once slit.` : ""}`, action: { label: "Issue history", href: "/inventory/issue-history" } })
    }
  }

  async function saveCard(row: any) {
    const coils = Number(card.coils_made)
    const wastage = Number(card.wastage_kg)
    if (!Number.isInteger(coils) || coils <= 0) return setNotice({ tone: "error", text: "Enter how many coils came out of the reel." })
    if (card.wastage_kg === "" || !(wastage >= 0) || wastage > Number(row.issued_weight_kg)) return setNotice({ tone: "error", text: `Wastage must be between 0 and ${kg(row.issued_weight_kg)}.` })
    try {
      await recordCard.mutateAsync({ id: row.id, data: {
        plantId: row.plant_id || undefined,
        coils_made: coils, wastage_kg: wastage, coil_width_mm: card.coil_width_mm ? Number(card.coil_width_mm) : undefined,
        operator_name: card.operator_name.trim() || undefined, notes: card.notes.trim() || undefined, shift: row.shift,
      } })
      setNotice({ tone: "success", text: `Slitting card saved for ${row.reel_code}: ${coils} coils, ${kg(wastage)} wastage.` })
      setCardFor(null); setCard(EMPTY_CARD)
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  async function closeOld(row: any, override?: number) {
    const consumed = override ?? Number(legacyWeights[row.id] ?? row.issued_weight_kg)
    if (!Number.isFinite(consumed) || consumed < 0 || consumed > Number(row.issued_weight_kg)) return setNotice({ tone: "error", text: `Consumed must be between 0 and ${kg(row.issued_weight_kg)}.` })
    try {
      await closeLegacy.mutateAsync({ id: row.id, data: { plantId: row.plant_id || undefined, consumed_weight_kg: consumed } })
      setNotice({ tone: "success", text: `${row.reel_code} older issue closed.` })
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue"]}>
      <ProcurementShell
        eyebrow="Stores"
        title="Reel & coil issue to floor"
        description="Issue to the floor, never to a machine. The shift and date are taken from the clock when you press Issue. A reel goes to the slitter and gets a slitting card; a coil goes straight to the winders. Everything issued is used in full. Any reel that passed incoming QC can go — invoice or rate questions never hold it."
        actions={<IssueDeskTabs />}
        allPlants
      >
        {notice ? (
          <MessageBar tone={notice.tone}>
            <span data-testid="reel-issue-notice">{notice.text}</span>
            {notice.action ? (
              <span className="mt-2 flex" data-no-mirror>
                {notice.action.href
                  ? <Link href={notice.action.href} className={cn(secondaryButton, "h-11")}>{notice.action.label}<ArrowUpRight className="h-4 w-4" /></Link>
                  : <button type="button" className={cn(secondaryButton, "h-11")} onClick={notice.action.onClick}>{notice.action.label}</button>}
              </span>
            ) : null}
          </MessageBar>
        ) : null}
        {stockQuery.isError || openQuery.isError ? <MessageBar tone="error">Stock could not load. Refresh before issuing.</MessageBar> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="reel-issue-stats">
          <Stat icon={PackageCheck} label="Ready for the floor" value={ready.length} hint={kg(readyKg)} tone="emerald" />
          <Stat icon={Hourglass} label="Not cleared yet" value={waiting.length} hint={waiting.length ? "QC decides — see the list" : "Nothing waiting"} tone={waiting.length ? "blue" : "slate"} />
          <Stat icon={Scissors} label="Slitting cards to write" value={cardsDue.length} hint={cardsDue.length ? "Coils made + wastage" : "All written"} tone={cardsDue.length ? "amber" : "slate"} />
          <Stat icon={Truck} label={`Issued · ${clock.label.replace(/^Shift [AB] · /, "")}`} value={today.length} hint={kg(todayKg)} tone="slate" />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <WorkPanel title="Ready for the floor" description="Passed incoming QC and in stock. Tap to pick one or more, or scan the label or type its AT, vendor reel or old mark number; the whole reel or coil goes out.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[200px] flex-1 items-center gap-2">
                <Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input aria-label="Scan reel or coil label" className={cn(phoneField, "max-sm:h-11")} value={scanCode} placeholder="Scan QR or type AT / vendor reel no." onChange={(e) => setScanCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveScan() } }} />
              </label>
              <button type="button" className={secondaryButton} onClick={() => void resolveScan()}><PackageCheck className="h-4 w-4" />Add</button>
              <QrScanner className={secondaryButton} onScan={(value) => { setScanCode(parseScanCode(value).code || value); void resolveScan(value) }} label="Camera" title="Scan reel label" hint="Point the camera at the reel or coil QR label." />
            </div>
            {choices ? <FoundChoices choices={choices} testid="reel-issue-choices" onPick={(row) => void openFound(row)} onCancel={() => setChoices(null)} /> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input aria-label="Find reel" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find paper, AT no., vendor reel…" className={cn(phoneField, "pl-9 max-sm:h-11")} />
              </label>
              <div role="radiogroup" aria-label="Form" className="flex gap-1 rounded-lg bg-muted p-1">
                {([["ALL", "All"], ["REEL", "Reels → slitter"], ["COIL", "Coils → winders"]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={form === value} onClick={() => setForm(value)} className={cn("h-11 rounded-md px-3 text-[12.5px] font-semibold sm:h-8", form === value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{label}</button>
                ))}
              </div>
            </div>

            <div className="mt-3 max-h-[440px] space-y-1.5 overflow-y-auto pr-1" data-testid="floor-issue-ready">
              {stockQuery.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading stock…</p>
              ) : shown.length ? (
                shown.map((row) => {
                  const on = picked.includes(String(row.id))
                  const item = itemOf(row)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => toggle(String(row.id))}
                      aria-pressed={on}
                      data-testid={`floor-issue-reel-${row.reel_code}`}
                      className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all", on ? "border-primary bg-primary/[.06] ring-1 ring-primary/40" : "border-border bg-card hover:border-foreground/25")}
                    >
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>{on ? <Check className="h-3.5 w-3.5" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="text-[13.5px] font-semibold">{row.reel_code}</span>
                          <span className="truncate text-[12.5px] text-muted-foreground">{item?.item_code || ""}{item?.name ? ` · ${item.name}` : ""}</span>
                        </span>
                        <span className="block text-[12px] text-muted-foreground">
                          <span className="font-semibold text-foreground" data-testid="pick-from">{placeOf(row)}</span>{" · "}
                          {[manyPlants ? displayPlantScope(row.plant_id) : null, row.width_mm ? `${row.width_mm} mm` : null, row.gsm ? `${row.gsm} GSM` : null, row.source_reel_no ? `${row.genealogy_metadata?.source_document_type === "OPENING_LOAD" ? "old mark" : "vendor"} ${row.source_reel_no}` : null, row.supplier_name_snapshot || row.supplier_name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13.5px] font-semibold tabular-nums">{kg(row.current_weight_kg)}</span>
                        <Chip tone={isCoil(row) ? "emerald" : "blue"} size="xs" icon={isCoil(row) ? PackageCheck : Scissors}>{isCoil(row) ? "Coil → winders" : "Reel → slitter"}</Chip>
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
                  {ready.length ? "Nothing matches this search." : waiting.length ? "Nothing has passed incoming QC yet — see Not cleared yet." : "No reels or coils in stock. Receive them in Goods inward first."}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 -mx-4 mt-3 space-y-3 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur sm:-mx-5 sm:px-5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-border bg-muted/50 px-3 py-2 text-[13px]" data-testid="floor-issue-shift">
                <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <b className="font-semibold">{clock.label}</b>
                <span className="text-muted-foreground">(now {clock.clock})</span>
                <span className="basis-full text-[11.5px] text-muted-foreground sm:basis-auto">Shift and date are taken from the clock when you press Issue.</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {selected.length ? (
                  <button type="button" className="inline-flex min-h-11 items-center px-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setPicked([])}>Clear</button>
                ) : null}
                <button ref={submitButton} type="button" data-testid="floor-issue-submit" className={cn(primaryButton, "h-11 flex-1 justify-center")} disabled={busy || !selected.length} onClick={() => void issueSelected()}>
                  <PackageCheck className="h-4 w-4" />
                  {issuing ? "Issuing…" : selected.length ? `Issue ${selected.length} to floor · ${kg(selectedKg)}` : "Pick reels or coils to issue"}
                </button>
              </div>
            </div>
          </WorkPanel>

          <div className="space-y-4">
            <WorkPanel title={`Not cleared yet · ${waiting.length}`} description={canOpenQc ? "In stock but not passed by incoming QC. Open one to inspect it — once it passes it moves to Ready." : "In stock but not passed by incoming QC. Ask QC to inspect them — once one passes it moves to Ready."}>
              {waiting.length ? (
                <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1" data-testid="floor-issue-waiting">
                  {waiting.map((row) => {
                    const reason = waitingReason(row, qcState.get(String(row.id)))
                    const body = (
                      <>
                        <CircleAlert className={cn("h-4 w-4 shrink-0", reason.tone === "rose" ? "text-signal-rose-ink" : reason.tone === "amber" ? "text-signal-amber-ink" : "text-signal-blue-ink")} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">{row.reel_code} <span className="font-normal text-muted-foreground">· {itemOf(row)?.item_code || (isCoil(row) ? "Coil" : "Reel")} · {kg(row.current_weight_kg)}</span></span>
                          <Chip tone={reason.tone} size="xs">{reason.text}</Chip>
                        </span>
                      </>
                    )
                    return (
                      <li key={row.id}>
                        {canOpenQc ? (
                          <Link href={`/quality/incoming?lot=REEL:${row.id}`} className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 hover:border-foreground/25">
                            {body}
                            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">{reason.action}<ArrowUpRight className="h-3.5 w-3.5" /></span>
                          </Link>
                        ) : (
                          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
                            {body}
                            <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">Ask QC to inspect</span>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Everything in stock has passed QC.</p>
              )}
            </WorkPanel>

            <WorkPanel title={`Slitting cards to write · ${cardsDue.length}`} description="For every reel sent to the slitter: coils made and wastage. These feed the slitting report.">
              {cardsDue.length ? (
                <ul className="space-y-2" data-testid="slitting-cards-due">
                  {cardsDue.map((row) => (
                    <li key={row.id} className="rounded-xl border border-border">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-semibold">{row.reel_code} <span className="font-normal text-muted-foreground">· {row.paper_code || "paper"}{row.gsm ? ` · ${row.gsm} GSM` : ""}</span></p>
                          <p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · issued {shiftWords(row.shift, row.issue_date)}</p>
                        </div>
                        <button type="button" className={cardFor === row.id ? secondaryButton : primaryButton} onClick={() => { setCardFor(cardFor === row.id ? null : row.id); setCard(EMPTY_CARD) }}>{cardFor === row.id ? "Cancel" : <><ClipboardList className="h-4 w-4" />Write card</>}</button>
                      </div>
                      {cardFor === row.id ? (
                        <div className="grid gap-3 border-t border-border bg-muted/30 p-3 sm:grid-cols-2" data-testid="slitting-card-form">
                          <Field label="Coils made"><input autoFocus className={phoneField} type="number" min="1" step="1" inputMode="numeric" value={card.coils_made} onChange={(e) => setCard({ ...card, coils_made: e.target.value })} /></Field>
                          <Field label="Wastage kg" hint={`of ${kg(row.issued_weight_kg)}`}><input className={phoneField} type="number" min="0" step="0.001" inputMode="decimal" value={card.wastage_kg} onChange={(e) => setCard({ ...card, wastage_kg: e.target.value })} /></Field>
                          <Field label="Coil width mm" hint="optional"><input className={phoneField} type="number" min="0" step="0.1" value={card.coil_width_mm} onChange={(e) => setCard({ ...card, coil_width_mm: e.target.value })} /></Field>
                          <Field label="Slitter operator" hint="optional"><input className={phoneField} value={card.operator_name} onChange={(e) => setCard({ ...card, operator_name: e.target.value })} /></Field>
                          <div className="sm:col-span-2"><Field label="Notes" hint="optional"><input className={phoneField} value={card.notes} onChange={(e) => setCard({ ...card, notes: e.target.value })} /></Field></div>
                          {card.coils_made && card.wastage_kg !== "" ? <p className="text-[12.5px] text-muted-foreground sm:col-span-2">Good paper {kg(Number(row.issued_weight_kg) - Number(card.wastage_kg))} · wastage {((100 * Number(card.wastage_kg)) / Number(row.issued_weight_kg || 1)).toFixed(1)}% · about {kg((Number(row.issued_weight_kg) - Number(card.wastage_kg)) / Math.max(1, Number(card.coils_made)))} per coil</p> : null}
                          <button type="button" className={cn(primaryButton, "justify-center sm:col-span-2")} disabled={busy} onClick={() => void saveCard(row)}>Save slitting card</button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No reel is waiting for its slitting card.</p>}
              <Link href="/reports/slitting" className="mt-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary hover:underline sm:min-h-0">Slitting report<ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </WorkPanel>
          </div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <WorkPanel title="Stock on hand" description="Paper reels and coils in stock, by paper. Updates after every issue.">
            {onHand.length ? (
              <div className="overflow-x-auto" data-testid="reel-stock-on-hand">
                <table className="tube-grid w-full min-w-[460px]">
                  <thead><tr><th>Paper</th><th className="text-right">Ready</th><th className="text-right">Ready kg</th><th className="text-right">Not cleared kg</th></tr></thead>
                  <tbody>
                    {onHand.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium">{row.code}<span className="block text-[12px] font-normal text-muted-foreground">{row.name}</span></td>
                        <td className="text-right tabular-nums">{row.reels}</td>
                        <td className="text-right font-semibold tabular-nums">{kg(row.kg)}</td>
                        <td className="text-right tabular-nums text-muted-foreground">{row.waitingKg ? kg(row.waitingKg) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">No paper reels or coils in stock.</p>}
          </WorkPanel>

          <WorkPanel title={`Issued today · ${today.length}`} description={`Business day ${clock.label.replace(/^Shift [AB] · /, "")}: Shift A from 08:00 and Shift B until 08:00 next morning.`} action={<Link href="/inventory/issue-history" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary hover:underline sm:min-h-0" data-testid="reel-issue-history-link"><History className="h-4 w-4" aria-hidden="true" />Issue history</Link>}>
            {today.length ? (
              <div className="overflow-x-auto">
                <table className="tube-grid w-full min-w-[560px]">
                  <thead><tr><th>Reel / coil</th><th>Went to</th><th>Shift · time</th><th className="text-right">Weight</th><th>Slitting card</th></tr></thead>
                  <tbody>
                    {today.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium">{row.reel_code}<span className="block text-[12px] font-normal text-muted-foreground">{row.paper_code || ""}</span></td>
                        <td>{row.issue_section === "SLITTING_SECTION" ? "Slitter" : "Winders"}</td>
                        <td>{shiftWords(row.shift, row.issue_date).replace(/ · .*$/, "")} · {istTime(row.issued_at || row.created_at)}<span className="block text-[12px] text-muted-foreground">{row.issued_by ? who(row.issued_by) : ""}</span></td>
                        <td className="text-right tabular-nums">{kg(row.issued_weight_kg)}</td>
                        <td>{row.issue_section !== "SLITTING_SECTION" ? <span className="text-muted-foreground">—</span> : row.slitting_card ? `${row.slitting_card.coils_made} coils · ${kg(row.slitting_card.wastage_kg)} wastage` : <span className="font-semibold text-signal-amber-ink">To write</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted-foreground">Nothing issued yet today.</p>}
          </WorkPanel>
        </div>

        {legacyOpen.length ? (
          <WorkPanel title={`Older open issues · ${legacyOpen.length}`} description="Issued before floor issue started, to a machine with a return expected. Close each once with what was used; from now on nothing comes back.">
            <ul className="divide-y divide-border">
              {legacyOpen.map((row) => (
                <li key={row.id} className="flex flex-wrap items-end justify-between gap-3 py-2.5">
                  <div><p className="font-medium">{row.reel_code}</p><p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · {row.issue_section === "SLITTING_SECTION" ? "slitting" : "winder"} · {shiftWords(row.shift, row.issue_date)}</p></div>
                  {row.issue_section === "SLITTING_SECTION" ? (
                    <button type="button" className={secondaryButton} disabled={busy} onClick={() => void closeOld(row, 0)} title="The reel comes back into stock unchanged; issue it to the floor again from above">Back to stock, then issue to floor</button>
                  ) : (
                    <div className="flex items-end gap-2">
                      <Field label="Used kg"><input className={cn(phoneField, "w-28")} type="number" min="0" step="0.001" value={legacyWeights[row.id] ?? String(row.issued_weight_kg)} onChange={(e) => setLegacyWeights({ ...legacyWeights, [row.id]: e.target.value })} /></Field>
                      <button type="button" className={secondaryButton} disabled={busy} onClick={() => void closeOld(row)}>Close</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </WorkPanel>
        ) : null}
      </ProcurementShell>
    </RoleGate>
  )
}
