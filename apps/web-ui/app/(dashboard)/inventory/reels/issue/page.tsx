"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, Barcode, Check, CircleAlert, ClipboardList, Hourglass, PackageCheck, Scissors, Search, Truck } from "lucide-react"

import { QrScanner } from "@/components/common/qr-scanner"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { Chip } from "@/components/sales/order-chips"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useCloseReelIssue, useCreateReelIssue, useInventoryItems, useInventoryLocations, usePendingInventoryQuality, useRecordSlittingCard, useReelIssues, useReels } from "@/hooks/use-inventory"
import { usePlants } from "@/hooks/use-system"
import { inventoryApi } from "@/lib/api"
import { businessDate } from "@/lib/business-date"
import { canonicalPlantScopeValue, displayPlantScope } from "@/lib/plant-scope"
import { parseScanCode } from "@/lib/scan-code"
import { pickFromText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const ISSUABLE = ["UNRESTRICTED", "WIP"]
const SHIFTS = [{ value: "A", label: "Shift A" }, { value: "B", label: "Shift B" }, { value: "GENERAL", label: "General" }]
const clockShift = () => { const hour = new Date().getHours(); return hour >= 8 && hour < 20 ? "A" : "B" }
const kg = (value: any) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
const day = (value?: string) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"
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
  const submitButton = useRef<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<"ALL" | "REEL" | "COIL">("ALL")
  const [picked, setPicked] = useState<string[]>([])
  const [shift, setShift] = useState(clockShift())
  const [issueDate, setIssueDate] = useState(businessDate())
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
  const todayQuery = useReelIssues({ date_from: businessDate(), date_to: businessDate(), limit: 300 })
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
  const describe = (row: any) => [row.reel_code, itemOf(row)?.item_code, itemOf(row)?.name, row.source_reel_no, row.supplier_name_snapshot || row.supplier_name].filter(Boolean).join(" ").toLowerCase()
  const shown = ready.filter((row) => (form === "ALL" || (form === "COIL") === isCoil(row)) && (!needle || describe(row).includes(needle)))
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
  async function explainReel(row: any, queueState?: string) {
    const code = row.reel_code
    if (isParchmentReel(row)) return setNotice({ tone: "info", text: `${code} is parchment. Parchment is issued by colour and kg on the Adhesive / parchment / packing tab.`, action: { label: "Open material issue", href: `/inventory/production-issue?item=${row.paper_id}` } })
    const status = String(row.status || "").toUpperCase()
    if (status === "CONSUMED" || status === "ISSUED") {
      let when = ""
      try {
        const last = rowsOf((await inventoryApi.getReelIssues({ reel_id: row.id, limit: 1 })).data)[0]
        if (last?.issue_date) when = ` on ${day(last.issue_date)}${last.shift ? `, shift ${last.shift}` : ""}`
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
    setPicked((current) => (current.includes(String(row.id)) ? current : [...current, String(row.id)]))
    setScanCode("")
    setNotice({ tone: "info", text: `${code} added · ${isCoil(row) ? "coil → winders" : "reel → slitter"}.` })
    // On a phone the issue button can be off screen: bring it up so the scan is one tap from issue.
    if (window.innerWidth < 1280) window.setTimeout(() => submitButton.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80)
  }

  async function resolveScan(value: string = scanCode) {
    const parsed = parseScanCode(value)
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
    const id = parsed.id.toUpperCase()
    const code = parsed.code.toUpperCase()
    const same = (row: any) => (id && String(row.id).toUpperCase() === id) || (code && String(row.reel_code || "").toUpperCase() === code)
    const local = stockRows.find(same)
    const cleared = (row: any) => ISSUABLE.includes(String(row?.stock_status || "").toUpperCase())
    if (local && cleared(local)) return explainReel(local)
    // Held in the loaded list (the desk stays open all shift while QC passes reels), or not in it at all:
    // older stock, already used, or never received here. Ask the server before refusing.
    try {
      const found = id
        ? rowsOf((await inventoryApi.getReels({ reel_ids: parsed.id, limit: 1 })).data)[0]
        : rowsOf((await inventoryApi.getReels({ search: parsed.code, limit: 20 })).data).find(same)
      if (found && local && cleared(found)) await stockQuery.refetch()
      if (found && !cleared(found)) {
        const queue = await pendingQc.refetch()
        return explainReel(found, rowsOf(queue.data).find((row: any) => row?.entity_type === "REEL" && String(row.entity_id) === String(found.id))?.queue_state)
      }
      if (found || local) return explainReel(found || local)
    } catch (error) {
      if (local) return explainReel(local)
      return setNotice({ tone: "error", text: `${label} could not be checked: ${errorText(error)}` })
    }
    setNotice({ tone: "error", text: `${label} was not found in ${displayPlantScope(activePlant)}. Check the label, or type the AT number.` })
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
    setIssuing(true)
    const done: string[] = []
    const failed: string[] = []
    for (const row of selected) {
      try {
        await createIssue.mutateAsync({ plantId: row.plant_id || undefined, reel_id: row.id, shift, issue_date: issueDate, issued_weight_kg: Number(row.current_weight_kg) })
        done.push(String(row.id))
      } catch (error) {
        failed.push(`${row.reel_code}: ${errorText(error)}`)
      }
    }
    setIssuing(false)
    setPicked((current) => current.filter((id) => !done.includes(id)))
    setExtraRows((current) => current.filter((row) => !done.includes(String(row.id))))
    const slit = selected.filter((row) => done.includes(String(row.id)) && !isCoil(row)).length
    if (failed.length) {
      setNotice({ tone: "error", text: `${done.length} issued. Not issued — ${failed.join(" · ")}` })
    } else {
      setNotice({ tone: "success", text: `${done.length} issued to the floor for shift ${shift}.${slit ? ` Write the slitting card for ${slit === 1 ? "the reel" : `the ${slit} reels`} once slit.` : ""}` })
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
        description="Issue to the floor by shift, never to a machine. A reel goes to the slitter and gets a slitting card; a coil goes straight to the winders. Everything issued is used in full. Any reel that passed incoming QC can go — invoice or rate questions never hold it."
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
          <Stat icon={Truck} label="Issued today" value={today.length} hint={kg(todayKg)} tone="slate" />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <WorkPanel title="Ready for the floor" description="Passed incoming QC and in stock. Tap to pick one or more, or scan the label; the whole reel or coil goes out.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[200px] flex-1 items-center gap-2">
                <Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input aria-label="Scan reel or coil label" className={cn(phoneField, "max-sm:h-11")} value={scanCode} placeholder="Scan QR or type AT number" onChange={(e) => setScanCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveScan() } }} />
              </label>
              <button type="button" className={secondaryButton} onClick={() => void resolveScan()}><PackageCheck className="h-4 w-4" />Add</button>
              <QrScanner className={secondaryButton} onScan={(value) => { setScanCode(parseScanCode(value).code || value); void resolveScan(value) }} label="Camera" title="Scan reel label" hint="Point the camera at the reel or coil QR label." />
            </div>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Shift">
                  <div role="radiogroup" aria-label="Shift" className="flex gap-1 rounded-lg bg-muted p-1">
                    {SHIFTS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={shift === item.value} onClick={() => setShift(item.value)} className={cn("min-h-11 flex-1 rounded-md text-[13px] font-semibold sm:min-h-9", shift === item.value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{item.label}</button>)}
                  </div>
                </Field>
                <Field label="Issue date"><input className={phoneField} type="date" value={issueDate} max={businessDate()} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selected.length ? (
                  <button type="button" className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setPicked([])}>Clear</button>
                ) : null}
                <button ref={submitButton} type="button" data-testid="floor-issue-submit" className={cn(primaryButton, "h-10 flex-1 justify-center")} disabled={busy || !selected.length} onClick={() => void issueSelected()}>
                  <PackageCheck className="h-4 w-4" />
                  {issuing ? "Issuing…" : selected.length ? `Issue ${selected.length} to floor · ${kg(selectedKg)} · shift ${shift}` : "Pick reels or coils to issue"}
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
                          <p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · issued {day(row.issue_date)} · shift {row.shift}</p>
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

          <WorkPanel title={`Issued today · ${today.length}`} description="Reels and coils that went to the floor on today's business date.">
            {today.length ? (
              <div className="overflow-x-auto">
                <table className="tube-grid w-full min-w-[520px]">
                  <thead><tr><th>Reel / coil</th><th>Went to</th><th>Shift</th><th className="text-right">Weight</th><th>Slitting card</th></tr></thead>
                  <tbody>
                    {today.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium">{row.reel_code}<span className="block text-[12px] font-normal text-muted-foreground">{row.paper_code || ""}</span></td>
                        <td>{row.issue_section === "SLITTING_SECTION" ? "Slitter" : "Winders"}</td>
                        <td>{row.shift}</td>
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
                  <div><p className="font-medium">{row.reel_code}</p><p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · {row.issue_section === "SLITTING_SECTION" ? "slitting" : "winder"} · {day(row.issue_date)} · shift {row.shift}</p></div>
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
