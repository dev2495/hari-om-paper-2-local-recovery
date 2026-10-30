"use client"

// Every printed QR opens here (client 2026-10-27): new job cards, lot labels and tool labels carry
// https://<site>/scan?c=<payload>, so the phone's own Camera app (iPhone too) lands on this page and,
// after sign-in, on the page the person's role works on. Job card → floor entry; lot waiting for or
// failed incoming QC → incoming QC; cleared reel or coil → Reel & coil issue; cleared batch → Material
// issue; tool → tools register; rack label → its location page for every role (2026-10-28). Anyone else, and lots used up or finished goods, get a lot card with the
// next step in plain words. Older plain labels (HARIOM|…, hariom://tool/…) and typed codes read the same.

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, Clock3, Factory, LoaderCircle, PackageCheck, PackageX, ScanLine, Search, ShieldAlert, Truck, Wrench, XCircle } from "lucide-react"
import { FormEvent, Suspense, useEffect, useRef, useState } from "react"

import { QrScanner } from "@/components/common/qr-scanner"
import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { usePlants } from "@/hooks/use-system"
import { api } from "@/lib/api"
import { PLANT_SCOPE_LABELS, canonicalPlantScopeValue } from "@/lib/plant-scope"
import { serverTime } from "@/lib/job-card-tracking"
import { parseScanCode } from "@/lib/scan-code"
import { cn } from "@/lib/utils"

type Tone = "emerald" | "amber" | "rose" | "blue" | "slate"

type Lot = {
  kind: "REEL" | "BATCH"
  id: string
  /** The lot's saved QR payload; the issue desks read it from ?scan=. */
  qr: string
  code: string
  plantId: string
  form: string
  item: string
  itemType: string
  /** Reel status (IN_STOCK, ISSUED, CONSUMED, SCRAP); a batch is IN_STOCK while it has a balance. */
  status: string
  stock: string
  left: number | null
  received: number | null
  uom: string
  receivedOn: string | null
  grnNo: string | null
  receiptId: string | null
  supplier: string | null
  lastQc: { status: string; at: string } | null
  /** Incoming QC queue state (AWAITING_INSPECTION, FAILED, REJECTED) for a held lot, when this login reads the queue. */
  qcQueue: string | null
  /** Whether this login could see the lot's QC result at all (inspections, or the lot in the QC queue). */
  qcSeen: boolean
}

type Outcome =
  /** "Opening <page> for <code>…" while the next page loads. */
  | { type: "redirect"; href: string; page: string; code?: string; switchedTo?: string }
  | { type: "lot"; lot: Lot; switchedTo?: string }
  | { type: "tool"; code: string }
  | { type: "plant"; plantId: string }
  | { type: "missing"; code: string; detail: string }
  | { type: "empty" }

type View = Outcome | { type: "opening"; code: string }

/** plants: each plant this login can open, tried one by one where an API needs a single plant ("All plants" view). */
type Who = { roles: Set<string>; allowedPlants: Set<string>; allPlants: boolean; activePlant: string; plants: string[] }

const unitText = (uom?: string) => ({ KG: "kg", PCS: "pcs", L: "L" } as Record<string, string>)[String(uom || "").toUpperCase()] || String(uom || "").toLowerCase()
const qtyText = (value: number | null, uom: string) => (value == null ? "—" : `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unitText(uom)}`.trim())
const indianDate = (value?: string | null) => {
  if (!value) return "—"
  // Server timestamps carry no zone and are UTC (a night receipt is the next day in the plant).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : serverTime(value)
  return !date ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}
const upper = (value: unknown) => String(value || "").trim().toUpperCase()

const can = (who: Who, ...roles: string[]) => who.roles.has("Owner") || who.roles.has("Admin") || roles.some((role) => who.roles.has(role))
// Same roles as each target page's own gate (incoming QC, the two issue desks, the GRN register).
const canInspect = (who: Who) => can(who, "QC", "InwardQC", "Store", "PlantManager")
const canIssue = (who: Who) => can(who, "Store", "RMIssue", "PlantManager")
const canOpenReceipts = (who: Who) => can(who, "Store", "Planner", "PlantManager", "GRN", "InwardQC")
const canReadQc = (who: Who) => can(who, "QC", "InwardQC", "Store", "PlantManager", "Dispatch", "Sales")
// The incoming QC queue (queue state and last inspection) also opens to the issue and production desks.
const canReadQcQueue = (who: Who) => can(who, "QC", "InwardQC", "Store", "PlantManager", "Production", "RMIssue")

/** These reads carry the label's plant explicitly, so a label from another plant is checked before the app switches to it. */
const read = (path: string, plantId?: string, params?: Record<string, unknown>) =>
  api.get(path, { params, ...(plantId ? { headers: { "X-Plant-ID": plantId } } : {}) })

function entryHref(id: string, inner: string, outer: URLSearchParams | null) {
  // ?mode=qc&stage=WINDER&entry=<run> on the link (or on the /scan link itself) carry to the card.
  let innerParams: URLSearchParams | null = null
  try { if (/^(https?:\/\/|\/)/i.test(inner)) innerParams = new URL(inner, "http://scan.local").searchParams } catch { innerParams = null }
  const query = new URLSearchParams()
  for (const key of ["mode", "stage", "entry"]) {
    const value = outer?.get(key) || innerParams?.get(key)
    if (value) query.set(key, value)
  }
  return `/production/entry/${encodeURIComponent(id)}${query.toString() ? `?${query}` : ""}`
}

async function loadLot(kind: "REEL" | "BATCH", id: string, plantId: string | undefined, who: Who): Promise<Lot> {
  const { data: label } = await read(`/api/inventory/labels/${kind === "REEL" ? "reels" : "batches"}/${encodeURIComponent(id)}`, plantId)
  const inspections = canReadQc(who)
  const queue = !inspections && canReadQcQueue(who)
  const [reelRes, itemRes, qcRes, queueRes] = await Promise.allSettled([
    kind === "REEL" ? read("/api/inventory/reels", plantId, { reel_ids: id, limit: 1 }) : Promise.resolve(null),
    label?.item_id ? read(`/api/inventory/balance/${encodeURIComponent(String(label.item_id))}`, plantId) : Promise.resolve(null),
    inspections ? read("/api/inventory/quality/inspections", plantId, { entity_id: id, limit: 1 }) : Promise.resolve(null),
    // Roles that cannot read inspections (RMIssue) still see why a lot is held, as on their own issue desk.
    queue ? read("/api/inventory/quality/pending", plantId) : Promise.resolve(null),
  ])
  const reel = reelRes.status === "fulfilled" && Array.isArray(reelRes.value?.data) ? reelRes.value.data[0] : null
  const item = itemRes.status === "fulfilled" ? itemRes.value?.data : null
  const batch = kind === "BATCH" && Array.isArray(item?.batches) ? item.batches.find((row: any) => String(row.batch_id) === id) : null
  const queued = queueRes.status === "fulfilled" && Array.isArray(queueRes.value?.data) ? queueRes.value.data.find((row: any) => String(row.entity_id) === id) : null
  const qc = qcRes.status === "fulfilled" && Array.isArray(qcRes.value?.data) ? qcRes.value.data[0] : queued?.last_inspection || null
  const meta = (reel?.inward_metadata || label?.metadata || {}) as Record<string, any>
  const left = kind === "REEL" ? Number(reel?.current_weight_kg ?? label?.qty ?? 0) : batch ? Number(batch.current_balance ?? batch.available_qty ?? 0) : null
  const form = kind === "REEL" ? (upper(reel?.physical_form || label?.physical_form) === "COIL" ? "Coil" : "Reel") : "Lot"
  return {
    kind,
    id,
    qr: String(label?.qr_value || ""),
    code: String(label?.human_label || label?.code || reel?.reel_code || label?.batch_no || ""),
    plantId: canonicalPlantScopeValue(String(label?.plant_id || reel?.plant_id || plantId || "")),
    form,
    item: [label?.item_code, label?.item_name].filter(Boolean).join(" · ") || "Material",
    itemType: upper(item?.type),
    status: kind === "REEL" ? upper(reel?.status) || "IN_STOCK" : (left ?? 0) > 0 ? "IN_STOCK" : "CONSUMED",
    stock: upper(reel?.stock_status || batch?.stock_status || label?.stock_status),
    left,
    received: kind === "REEL" ? Number(reel?.inward_weight_kg ?? label?.inward_qty ?? 0) || null : Number(batch?.received_qty ?? label?.qty ?? 0) || null,
    uom: String(label?.uom || item?.uom || (kind === "REEL" ? "KG" : "")),
    receivedOn: reel?.inward_date || label?.inward_date || batch?.created_at || null,
    grnNo: label?.grn_no || meta.grn_no || batch?.grn_no || null,
    receiptId: meta.receipt_id ? String(meta.receipt_id) : null,
    supplier: label?.supplier_name || reel?.supplier_name_snapshot || batch?.supplier_name || null,
    lastQc: qc ? { status: upper(qc.status), at: String(qc.created_at || "") } : null,
    qcQueue: queued ? upper(queued.queue_state) : null,
    qcSeen: (inspections && qcRes.status === "fulfilled") || Boolean(queued),
  }
}

/** Where the lot sits, in words, and what happens next for someone who is not sent on to a desk. */
function lotState(lot: Lot): { word: string; tone: Tone; icon: any; next: string } {
  const inStore = lot.status === "IN_STOCK" && (lot.left ?? 0) > 0
  if (!inStore) {
    if (lot.status === "SCRAP" || lot.stock === "SCRAP") return { word: "Scrapped", tone: "slate", icon: Ban, next: "It is no longer in stock. Nothing to issue." }
    if (lot.stock === "RETURNED") return { word: "Returned to the supplier", tone: "slate", icon: PackageX, next: "It is no longer in stock. Nothing to issue." }
    if (lot.status === "ISSUED") return { word: "Issued to the floor", tone: "slate", icon: PackageCheck, next: "It is already on the floor. Nothing is left in store to issue." }
    return { word: "Used up", tone: "slate", icon: PackageCheck, next: "It has gone to the floor and nothing is left in store. Nothing to issue." }
  }
  if (lot.itemType === "FINISHED_GOOD") return { word: lot.stock === "QC_HOLD" ? "Finished goods, waiting for QC" : "Finished goods in store", tone: "blue", icon: Truck, next: "Finished goods leave the plant through dispatch, not the issue desks." }
  const rejected = { word: "Rejected by QC", tone: "rose" as Tone, icon: XCircle, next: "QC rejected it, so it cannot go to the floor. The store returns it to the supplier, or the plant head concedes it." }
  if (lot.stock === "BLOCKED") return rejected
  if (lot.stock === "QC_HOLD") {
    // Same rule as the incoming QC queue: a failed, invalid or unfinished inspection keeps the lot in "Failed".
    if (lot.qcQueue === "REJECTED") return rejected
    if (lot.qcQueue === "FAILED" || ["FAIL", "INVALID", "INCOMPLETE"].includes(lot.lastQc?.status || "")) return { word: "Failed incoming QC", tone: "amber", icon: AlertTriangle, next: "It failed incoming QC. QC re-checks it or the plant head concedes it before it can go to the floor." }
    // This login cannot see QC results (Operator): say only that it is not cleared, not that it is waiting.
    if (!lot.qcSeen) return { word: "Not cleared by incoming QC yet", tone: "amber", icon: Clock3, next: "It cannot go to the floor until incoming QC clears it. The store or QC can tell you where it stands." }
    return { word: "Waiting for incoming QC", tone: "amber", icon: Clock3, next: "It cannot go to the floor yet. Ask QC to inspect it; once it passes, the store can issue it." }
  }
  if (lot.stock === "UNRESTRICTED" || lot.stock === "WIP") return { word: "Cleared for the floor", tone: "emerald", icon: CheckCircle2, next: "In stock and free to issue. The store or raw-material issue desk issues it to the floor by scanning this label." }
  return { word: "On hold in store", tone: "slate", icon: Clock3, next: "It is in store but not free to issue. Ask the store which hold is on it." }
}

const QC_WORD: Record<string, string> = { PASS: "Passed", FAIL: "Failed", INVALID: "Readings not valid", INCOMPLETE: "Readings incomplete", SKIPPED: "Skipped" }

/** Send the person on, or keep them here with the lot card. */
function routeLot(lot: Lot, who: Who): Outcome {
  const inStore = lot.status === "IN_STOCK" && (lot.left ?? 0) > 0
  const material = inStore && lot.itemType !== "FINISHED_GOOD"
  const payload = encodeURIComponent(lot.qr || lot.code)
  if (material && (lot.stock === "QC_HOLD" || lot.stock === "BLOCKED") && canInspect(who)) {
    return { type: "redirect", href: `/quality/incoming?lot=${lot.kind}:${lot.id}`, page: "incoming QC", code: lot.code }
  }
  if (material && (lot.stock === "UNRESTRICTED" || lot.stock === "WIP") && canIssue(who)) {
    // Parchment comes on reels too, but is issued by colour and kg on Material issue, which reads the same label.
    return lot.kind === "REEL" && lot.itemType !== "PARCHMENT"
      ? { type: "redirect", href: `/inventory/reels/issue?scan=${payload}`, page: "Reel & coil issue", code: lot.code }
      : { type: "redirect", href: `/inventory/production-issue?scan=${payload}`, page: "Material issue", code: lot.code }
  }
  return { type: "lot", lot }
}

function httpStatus(error: any) {
  return Number(error?.response?.status || 0)
}

/** The single plants to try, one by one, for an API that needs one plant: the open plant, or each plant in "All plants" view. */
function plantsToTry(who: Who): Array<string | undefined> {
  const current = canonicalPlantScopeValue(who.activePlant)
  if (current && current !== "ALL") return [undefined]
  return who.plants.length ? who.plants : [undefined]
}

/** A tool's record carries no plant and its details open for one plant only: find the plant that holds it, the open plant first. */
async function resolveTool(code: string, who: Who): Promise<Outcome> {
  const href = `/masters/tools?asset=${encodeURIComponent(code)}`
  const current = canonicalPlantScopeValue(who.activePlant)
  const order = Array.from(new Set([current && current !== "ALL" ? current : "", ...who.plants].filter(Boolean)))
  if (!order.length) return { type: "redirect", href, page: "the tools register", code }
  let failed = false
  for (const plant of order) {
    try {
      const { data } = await read("/api/inventory/tools/assets", plant, { search: code, limit: 20 })
      if ((Array.isArray(data) ? data : []).some((row: any) => upper(row.asset_no) === upper(code))) {
        return plant === current ? { type: "redirect", href, page: "the tools register", code } : { type: "redirect", href, page: "the tools register", code, switchedTo: plant }
      }
    } catch {
      failed = true
    }
  }
  if (failed) return { type: "missing", code, detail: "The tool could not be checked just now. Check the connection and scan again." }
  return { type: "missing", code, detail: "No tool has this number in the plants your login can open." }
}

/** A rack label (client 2026-10-28): every role opens the location page, which shows the actions its role may use.
 * The label's plant is checked first, as for lots, and the app switches to it when the login may open it. */
async function resolveLocation(id: string, code: string, plantId: string, who: Who): Promise<Outcome> {
  const current = canonicalPlantScopeValue(who.activePlant)
  const labelPlant = canonicalPlantScopeValue(plantId)
  const otherPlant = Boolean(labelPlant && current && labelPlant !== current)
  if (otherPlant && !(who.allowedPlants.has(labelPlant) || who.allPlants)) return { type: "plant", plantId: labelPlant }
  const href = `/inventory/locations/${encodeURIComponent(id)}`
  try {
    await read(href.replace("/inventory/", "/api/inventory/"), labelPlant || undefined)
    return { type: "redirect", href, page: "the rack", code, ...(otherPlant || current === "ALL" ? { switchedTo: labelPlant } : {}) }
  } catch (error) {
    if (httpStatus(error) === 403 && labelPlant) return { type: "plant", plantId: labelPlant }
    if (httpStatus(error) === 404 || httpStatus(error) === 422) return { type: "missing", code, detail: "This rack label is not in the system. It may have been reprinted with a new code; ask the store for a fresh label." }
    return { type: "missing", code, detail: "The rack could not be checked just now. Check the connection and scan again." }
  }
}

async function resolveScan(value: string, outer: URLSearchParams | null, who: Who): Promise<Outcome> {
  const parsed = parseScanCode(value)
  if (!parsed.raw) return { type: "empty" }
  if (parsed.kind === "JOB_CARD") return { type: "redirect", href: entryHref(parsed.id, value, outer), page: "the job card" }
  if (parsed.kind === "LOCATION") return resolveLocation(parsed.id, parsed.code, parsed.plantId, who)
  if (parsed.kind === "TOOL") {
    if (!can(who)) return { type: "tool", code: parsed.code }
    return resolveTool(parsed.code, who)
  }

  let kind: "REEL" | "BATCH" | null = parsed.kind === "REEL" || parsed.kind === "BATCH" ? parsed.kind : null
  let id = kind ? parsed.id : ""
  let labelPlant = canonicalPlantScopeValue(parsed.plantId)

  if (!kind) {
    // A typed or hand-scanned code: an AT number, then a lot number (<inward no>-<n>), then a job card number.
    const code = parsed.code
    try {
      const { data } = await read("/api/inventory/reels", undefined, { search: code, limit: 20 })
      const reel = (Array.isArray(data) ? data : []).find((row: any) => upper(row.reel_code) === upper(code) || upper(row.inward_metadata?.amigo_no) === upper(code))
      if (reel) { kind = "REEL"; id = String(reel.id); labelPlant = canonicalPlantScopeValue(String(reel.plant_id || "")) }
    } catch { /* fall through to the lot and card lookups */ }
    if (!kind) {
      // The GRN register opens one plant at a time, so "All plants" view asks each plant in turn.
      search: for (const grn of Array.from(new Set([code.replace(/-[^-/]+$/, ""), code]))) {
        for (const plant of plantsToTry(who)) {
          try {
            const { data } = await read("/api/purchase/v2/receipts", plant, { q: grn, limit: 10 })
            const lot = (Array.isArray(data?.items) ? data.items : []).flatMap((row: any) => row.lots || []).find((row: any) => upper(row.at_no) === upper(code))
            if (lot) { kind = upper(lot.entity_type) === "BATCH" ? "BATCH" : "REEL"; id = String(lot.id); labelPlant = plant ? canonicalPlantScopeValue(plant) : ""; break search }
          } catch { /* not in this plant's register; try the next plant or form */ }
        }
      }
    }
    if (!kind) {
      try {
        const { data } = await read("/api/production/job-cards", undefined, { search: code, limit: 10 })
        const card = (Array.isArray(data) ? data : data?.items || []).find((row: any) => [row.job_card_no, row.job_card_ref].some((no: any) => upper(no) === upper(code)))
        if (card) return { type: "redirect", href: entryHref(String(card.id), value, outer), page: "the job card", code: String(card.job_card_no || card.job_card_ref || "") }
      } catch { /* not a job card this login can read */ }
      // A rack code typed by hand (RM-A-01) opens the rack.
      for (const plant of plantsToTry(who)) {
        try {
          const { data } = await read("/api/inventory/locations", plant, { code, include_inactive: true })
          const rack = (Array.isArray(data) ? data : []).find((row: any) => upper(row.code) === upper(code))
          if (rack) return resolveLocation(String(rack.id), String(rack.code), String(rack.plant_id || plant || ""), who)
        } catch { /* not readable in this plant; try the next */ }
      }
      return { type: "missing", code, detail: "No reel, coil, lot, rack or job card has this number in your plant." }
    }
  }

  // A label from another plant: check it with that plant first, then switch the app to it.
  // From "All plants" view the switch happens only when a desk opens, since desks write for one plant.
  const current = canonicalPlantScopeValue(who.activePlant)
  const allView = current === "ALL"
  const otherPlant = Boolean(labelPlant && current && labelPlant !== current)
  if (otherPlant && !(who.allowedPlants.has(labelPlant) || who.allPlants)) return { type: "plant", plantId: labelPlant }
  try {
    const lot = await loadLot(kind, id, otherPlant ? labelPlant : undefined, who)
    const outcome = routeLot(lot, who)
    return otherPlant && (!allView || outcome.type === "redirect") ? { ...outcome, switchedTo: labelPlant } as Outcome : outcome
  } catch (error) {
    if (httpStatus(error) === 403 && labelPlant) return { type: "plant", plantId: labelPlant }
    if (httpStatus(error) === 404 || httpStatus(error) === 422) {
      if (labelPlant && !who.allowedPlants.has(labelPlant) && !who.allPlants) return { type: "plant", plantId: labelPlant }
      return { type: "missing", code: parsed.code || value, detail: "This label is not in the system. It may be an old test label, or from another site." }
    }
    return { type: "missing", code: parsed.code || value, detail: "The label could not be checked just now. Check the connection and scan again." }
  }
}

const TONE: Record<Tone, { pill: string; panel: string }> = {
  emerald: { pill: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink", panel: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" },
  amber: { pill: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink", panel: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" },
  rose: { pill: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", panel: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" },
  blue: { pill: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink", panel: "border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink" },
  slate: { pill: "border-border bg-muted text-muted-foreground", panel: "border-border bg-muted text-foreground" },
}

function ScanAgain({ title = "Scan another label", autoFocus = false, current = "", onRetry }: { title?: string; autoFocus?: boolean; current?: string; onRetry?: () => void }) {
  const router = useRouter()
  const [typed, setTyped] = useState("")
  // The same label again (after a dropped connection) checks it again; the URL would not change.
  const go = (value: string) => { const text = value.trim(); if (!text) return; if (text === current.trim() && onRetry) onRetry(); else router.push(`/scan?c=${encodeURIComponent(text)}`) }
  const submit = (event: FormEvent) => { event.preventDefault(); go(typed) }
  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      <QrScanner onScan={go} label="Scan with the camera" title="Scan a label" hint="Point the camera at the QR on the job card, lot label, rack or tool." className="erp-btn-primary mt-3 !h-12 w-full !rounded-xl !text-[15px]" />
      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-input bg-card px-3 focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
          <ScanLine className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="sr-only">AT, lot, rack or job card number</span>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="AT, lot, rack or card number" autoFocus={autoFocus} className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none focus:shadow-none" data-testid="scan-manual-input" />
        </label>
        <button type="submit" className="erp-btn-secondary !h-11 shrink-0"><Search className="h-4 w-4" aria-hidden="true" />Find</button>
      </form>
    </section>
  )
}

function Notice({ tone, icon: Icon, children }: { tone: Tone; icon: any; children: React.ReactNode }) {
  return <p role="status" className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-5", TONE[tone].panel)}><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{children}</span></p>
}

function MessageCard({ tone, icon: Icon, eyebrow, title, children }: { tone: Tone; icon: any; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-premium)]" data-testid="scan-message">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold", TONE[tone].pill)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{eyebrow}</span>
      <h1 className="mt-3 text-[20px] font-semibold leading-snug tracking-tight text-foreground">{title}</h1>
      {children ? <div className="mt-2 space-y-2 text-[13.5px] leading-6 text-muted-foreground">{children}</div> : null}
    </section>
  )
}

function LotCard({ lot, who, plantName, switchedTo }: { lot: Lot; who: Who; plantName: (id: string) => string; switchedTo?: string }) {
  const state = lotState(lot)
  const StateIcon = state.icon
  const isMaterial = lot.itemType !== "FINISHED_GOOD"
  const links: Array<{ href: string; label: string }> = []
  if (!isMaterial && can(who, "Dispatch")) links.push({ href: "/logistics/dispatch", label: "Open dispatch desk" })
  if (lot.kind === "REEL") links.push({ href: `/inventory/genealogy?reel=${encodeURIComponent(lot.id)}`, label: `Trace this ${lot.form.toLowerCase()}` })
  if (lot.receiptId && canOpenReceipts(who)) links.push({ href: `/purchase/receipts/${lot.receiptId}`, label: `Open goods receipt${lot.grnNo ? ` ${lot.grnNo}` : ""}` })
  if (isMaterial && canIssue(who)) links.push(lot.kind === "REEL" && lot.itemType !== "PARCHMENT" ? { href: "/inventory/reels/issue", label: "Back to Reel & coil issue" } : { href: "/inventory/production-issue", label: "Back to Material issue" })
  const facts: Array<[string, string]> = [
    ["Plant", plantName(lot.plantId)],
    ["Left in store", qtyText(lot.left, lot.uom)],
    ["Received", `${indianDate(lot.receivedOn)}${lot.received ? ` · ${qtyText(lot.received, lot.uom)}` : ""}`],
    ["Inward no.", lot.grnNo || "—"],
    ["Vendor", lot.supplier || "—"],
    ["Last QC", !isMaterial ? "Final QC on its job card" : lot.lastQc ? `${QC_WORD[lot.lastQc.status] || "Recorded"} · ${indianDate(lot.lastQc.at)}` : !lot.qcSeen ? "Ask QC" : ["UNRESTRICTED", "WIP"].includes(lot.stock) ? "No check of its own (cleared stock)" : "Not inspected yet"],
  ]
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-premium)]" data-testid="scan-lot-card">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">{lot.kind === "REEL" ? <Factory className="h-5 w-5" aria-hidden="true" /> : <PackageCheck className="h-5 w-5" aria-hidden="true" />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{lot.form} label</p>
          <h1 className="break-all font-mono text-[20px] font-bold leading-tight text-foreground">{lot.code}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{lot.item}</p>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {switchedTo ? <Notice tone="blue" icon={Factory}>Switched to {plantName(switchedTo)} for this label.</Notice> : null}
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold", TONE[state.tone].pill)} data-testid="scan-lot-status"><StateIcon className="h-3.5 w-3.5" aria-hidden="true" />{state.word}</span>
        <p className={cn("rounded-xl border px-3 py-2.5 text-[13.5px] leading-6", TONE[state.tone].panel)} data-testid="scan-lot-next"><strong className="font-semibold">Next step: </strong>{state.next}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 pt-1 text-[13px]">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11.5px] font-medium text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {links.length ? (
        <footer className="grid gap-2 border-t border-border p-4">
          {links.map((link, index) => (
            <Link key={link.href} href={link.href} className={cn(index === 0 ? "erp-btn-primary" : "erp-btn-secondary", "!h-11 w-full !justify-between")}>
              <span className="truncate">{link.label}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
          ))}
        </footer>
      ) : null}
    </article>
  )
}

function ScanLanding() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { user, activePlant, activeRole, setActivePlant } = useAuth()
  const plantsQuery = usePlants()
  const value = searchParams?.get("c") || searchParams?.get("scan") || ""
  const [view, setView] = useState<View>(() => ({ type: "opening", code: parseScanCode(value).code }))
  const run = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const roles = new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[])
  const allowedPlants = new Set([...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])].map((plant) => canonicalPlantScopeValue(String(plant))).filter((plant) => plant && plant !== "ALL"))
  const knownPlants = (Array.isArray(plantsQuery.data) ? plantsQuery.data : []).map((row: any) => canonicalPlantScopeValue(String(row.id || ""))).filter(Boolean)
  const who: Who = {
    roles,
    allowedPlants,
    allPlants: Boolean(user?.is_owner_all_plants),
    activePlant: String(activePlant || ""),
    plants: allowedPlants.size ? Array.from(allowedPlants) : user?.is_owner_all_plants ? knownPlants : [],
  }
  // The resolver reads who is scanning when it starts; switching plant must not start it again.
  const whoRef = useRef(who)
  whoRef.current = who
  const plantName = (id: string) => {
    const plant = (Array.isArray(plantsQuery.data) ? plantsQuery.data : []).find((row: any) => canonicalPlantScopeValue(String(row.id)) === canonicalPlantScopeValue(id))
    return plant?.name || PLANT_SCOPE_LABELS[id] || PLANT_SCOPE_LABELS[id.toLowerCase()] || "another plant"
  }

  useEffect(() => {
    if (!user?.id) return
    const mine = ++run.current
    setView({ type: "opening", code: parseScanCode(value).code })
    void resolveScan(value, searchParams, whoRef.current).catch((): Outcome => ({ type: "missing", code: parseScanCode(value).code, detail: "The label could not be checked just now. Check the connection and scan again." })).then((outcome) => {
      if (mine !== run.current) return
      if ("switchedTo" in outcome && outcome.switchedTo) setActivePlant(outcome.switchedTo)
      setView(outcome)
      if (outcome.type !== "redirect") {
        if ("switchedTo" in outcome && outcome.switchedTo) void queryClient.invalidateQueries()
        return
      }
      // After a plant switch the whole app reloads on the new plant (like the plant switcher), once the note is read.
      if (outcome.switchedTo) window.setTimeout(() => window.location.replace(outcome.href), 1400)
      else router.replace(outcome.href)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, value, attempt])

  if (!user) return <LoadingState label="Opening the label…" />

  if (view.type === "opening" || view.type === "redirect") {
    // Codes never break across lines (AT-261027-026 stays whole on a phone).
    const code = view.code ? <span className="whitespace-nowrap">{view.code}</span> : null
    const title = view.type === "redirect" ? <>Opening {view.page}{code ? <> for {code}</> : null}…</> : code ? <>Opening {code}…</> : "Opening the label…"
    return (
      <div className="mx-auto max-w-lg space-y-3" data-testid="scan-page">
        <section className="rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-[var(--shadow-premium)]" role="status" aria-live="polite" data-testid="scan-opening">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" /></span>
          <p className="mt-4 text-balance text-[16px] font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{view.type === "redirect" ? "Taking you to the page for your role." : "Checking the label and your role."}</p>
        </section>
        {view.type === "redirect" && view.switchedTo ? <Notice tone="blue" icon={Factory}>Switched to {plantName(view.switchedTo)} for this label.</Notice> : null}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-8" data-testid="scan-page">
      {view.type === "lot" ? <LotCard lot={view.lot} who={who} plantName={plantName} switchedTo={view.switchedTo} /> : null}
      {view.type === "plant" ? (
        <MessageCard tone="rose" icon={ShieldAlert} eyebrow="Another plant" title={`This label belongs to ${plantName(view.plantId)}, which your login cannot open.`}>
          <p>Hand the item to that plant&apos;s store, or ask the Owner or Admin to add {plantName(view.plantId)} to your login.</p>
        </MessageCard>
      ) : null}
      {view.type === "tool" ? (
        <MessageCard tone="slate" icon={Wrench} eyebrow="Tool label" title={`Tool ${view.code}`}>
          <p>The tools register opens for the Owner and Admin only. Hand the tool to the tool room, or ask them to scan it.</p>
        </MessageCard>
      ) : null}
      {view.type === "missing" ? (
        <MessageCard tone="amber" icon={AlertTriangle} eyebrow="Not found" title="We could not read this label">
          {view.code ? <p className="break-all">Scanned: <strong className="font-mono text-foreground">{view.code}</strong></p> : null}
          <p>{view.detail} Type the AT, lot or card number printed on it, or scan it again.</p>
        </MessageCard>
      ) : null}
      {view.type === "empty" ? (
        <MessageCard tone="blue" icon={ScanLine} eyebrow="Scan" title="Scan a job card, lot label or tool">
          <p>The phone&apos;s Camera app opens the right page from any new label. Inside the app, use the camera button or type the number.</p>
        </MessageCard>
      ) : null}
      <ScanAgain title={view.type === "lot" ? "Scan another label" : "Find it another way"} autoFocus={view.type === "missing" || view.type === "empty"} current={value} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  )
}

export default function ScanPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening the label…" />}>
      <ScanLanding />
    </Suspense>
  )
}
