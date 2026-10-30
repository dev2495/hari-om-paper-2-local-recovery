"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  Hourglass,
  PackageOpen,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Undo2,
} from "lucide-react"

import { EmptyState, StatusBadge } from "@/components/erp/shell"
import { IncomingDecidedLot } from "@/components/qc/IncomingDecidedLot"
import { IncomingInspectionEntry } from "@/components/qc/IncomingInspectionEntry"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { Chip } from "@/components/sales/order-chips"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateInventoryQualityConcession,
  useInventoryQualityConcessions,
  useInventoryQualityInspections,
  usePendingInventoryQuality,
  useReturnRejectedLotToSupplier,
} from "@/hooks/use-inventory"
import { applicableRules, groupIncomingQueue, lotItemName, lotKey, lotName, materialLabel, type IncomingQueueGroup } from "@/lib/incoming-qc"
import { parseScanCode } from "@/lib/scan-code"
import { personLabel } from "@/lib/people"
import { dayText, unitWord } from "@/lib/stock-format"
import { RackLabelHint } from "@/components/inventory/rack-label-hint"
import { cn } from "@/lib/utils"

const asArray = (value: any) => (Array.isArray(value) ? value : [])

const QUEUES = [
  { key: "AWAITING_INSPECTION", label: "To inspect", icon: Hourglass, tone: "blue" },
  { key: "FAILED", label: "Failed · on hold", icon: TriangleAlert, tone: "amber" },
  { key: "REJECTED", label: "Rejected", icon: Ban, tone: "rose" },
  // Retired 2026-10-27 (QC is the only gate); shown only while older lots still sit in it.
  { key: "COMMERCIAL_HOLD", label: "Older holds", icon: AlarmClock, tone: "slate" },
] as const
type QueueKey = (typeof QUEUES)[number]["key"]

const queueOf = (row: any): QueueKey => (row?.queue_state || "AWAITING_INSPECTION") as QueueKey

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}

const RECENT_WORD: Record<string, string> = { PASS: "Passed", FAIL: "Failed", INVALID: "Readings not valid", INCOMPLETE: "Readings incomplete", SKIPPED: "Skipped" }
const humanize = (value: any) => String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
/** A failed check is saved as an object; show what it says, never "[object Object]". */
const failureText = (failure: any) => typeof failure === "string" ? failure : String(failure?.message || failure?.label || failure?.detail || failure?.code || "Check failed")

/** ?lot=REEL:<id>, BATCH:<id> or a bare <id>. */
function parseLinkedLot(value?: string | null): { type: "REEL" | "BATCH" | ""; id: string } {
  const text = String(value || "").trim()
  const match = /^(REEL|BATCH):(.+)$/i.exec(text)
  if (match) return { type: match[1].toUpperCase() as "REEL" | "BATCH", id: match[2].trim().toLowerCase() }
  return { type: "", id: text.toLowerCase() }
}

/** ?from=/purchase/receipts/<id>: only a path inside this app, never another site.
 * Browsers read a backslash as "/" and drop tabs and new lines, so "/" + backslash + "evil.example" would leave the app:
 * refuse those,
 * then check that the path resolves on this origin. */
function safeBack(value?: string | null): { href: string; label: string } | null {
  const raw = String(value || "")
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return null
  let href = ""
  try {
    const base = "https://app.invalid"
    const url = new URL(raw, base)
    if (url.origin !== base) return null
    href = `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
  if (!href.startsWith("/") || href.startsWith("//")) return null
  const label = href.startsWith("/purchase/receipts/") ? "Back to the GRN" : href.startsWith("/purchase/receipts") ? "Back to the GRN register" : href.startsWith("/purchase/inward") ? "Back to goods inward" : href.startsWith("/purchase/") ? "Back to the purchase order" : "Back"
  return { href, label }
}

/** What was ordered, in the words on the PO: "300 GSM · BF 18 · 900 mm". */
function nominalText(nominal?: Record<string, unknown> | null) {
  const parts = Object.entries(nominal || {}).filter(([, value]) => value != null && value !== "").map(([key, value]) => {
    const name = key.toLowerCase()
    if (name === "gsm") return `${value} GSM`
    if (name === "bf") return `BF ${value}`
    if (name === "width_mm") return `${value} mm wide`
    return `${humanize(name)} ${value}`
  })
  return parts.length ? parts.join(" · ") : "—"
}

function when(value?: string | null) {
  if (!value) return "—"
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function dueText(group: IncomingQueueGroup) {
  if (!group.dueAt) return null
  const hours = Math.round((new Date(group.dueAt).getTime() - Date.now()) / 36e5)
  const late = Math.max(1, -hours)
  if (group.overdue || hours < 0) return { text: late >= 48 ? `Overdue ${Math.floor(late / 24)} d` : `Overdue ${late} h`, tone: "rose" as const }
  return { text: hours < 1 ? "Due within the hour" : `Due in ${hours} h`, tone: hours <= 6 ? ("amber" as const) : ("slate" as const) }
}

function Kpi({ label, value, hint, icon: Icon, tone, active, onClick, testId }: { label: string; value: number; hint: string; icon: any; tone: string; active?: boolean; onClick?: () => void; testId?: string }) {
  const ring: Record<string, string> = {
    blue: "text-signal-blue-ink bg-signal-blue-soft border-signal-blue-line",
    amber: "text-signal-amber-ink bg-signal-amber-soft border-signal-amber-line",
    rose: "text-signal-rose-ink bg-signal-rose-soft border-signal-rose-line",
    emerald: "text-signal-emerald-ink bg-signal-emerald-soft border-signal-emerald-line",
    slate: "text-muted-foreground bg-muted border-border",
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "erp-panel group flex items-center gap-3 rounded-xl p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-md",
        active && "ring-2 ring-primary/70",
      )}
    >
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", ring[tone] || ring.slate)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[22px] font-semibold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-1 block text-[12.5px] font-semibold text-foreground/85">{label}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

const GATE_ROLES = ["QC", "InwardQC", "Store", "PlantManager"]
const VIEW_ROLES = ["Owner", "Admin", ...GATE_ROLES]

function IncomingQualityPage() {
  const { showToast } = useApp()
  const { user, activeRole } = useAuth()
  const roles = useMemo(() => new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, activeRole, user?.roles])
  // The same roles as the page gate below: a refused role makes no QC calls at all.
  const canView = VIEW_ROLES.some((role) => roles.has(role))
  const canInspect = ["QC", "InwardQC", "Owner", "Admin"].some((role) => roles.has(role))
  const canConcede = ["Owner", "Admin", "PlantManager"].some((role) => roles.has(role)) || (user?.permissions || []).includes("qc:disposition:approve")
  const canReturn = ["Owner", "Admin", "PlantManager", "Store"].some((role) => roles.has(role))
  const searchParams = useSearchParams()
  const router = useRouter()
  const linked = parseLinkedLot(searchParams?.get("lot"))
  const backTo = safeBack(searchParams?.get("from"))

  const pendingQuery = usePendingInventoryQuality(canView)
  const concessionsQuery = useInventoryQualityConcessions(undefined, canView)
  const recentQuery = useInventoryQualityInspections({ source: "INWARD", limit: 12 }, canView)
  const createConcession = useCreateInventoryQualityConcession()
  const returnLot = useReturnRejectedLotToSupplier()

  const [tab, setTab] = useState<QueueKey>("AWAITING_INSPECTION")
  const [material, setMaterial] = useState("ALL")
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<{ key: string; lots: any[] } | null>(null)
  const [resolveKey, setResolveKey] = useState("")
  const [concessionReason, setConcessionReason] = useState("")
  const [concessionQty, setConcessionQty] = useState("")
  const [concessionExpiry, setConcessionExpiry] = useState("")
  const [returnReason, setReturnReason] = useState("")
  const [returnRef, setReturnRef] = useState("")
  const [showAllConcessions, setShowAllConcessions] = useState(false)

  const all = useMemo(() => asArray(pendingQuery.data), [pendingQuery.data])
  // Customer returns are judged on the Customer complaints desk, not against an inward standard.
  const inward = useMemo(() => all.filter((row: any) => row.entity_type !== "CUSTOMER_REJECTION"), [all])
  const customerReturns = all.length - inward.length
  const liveLots = useMemo(() => new Map(inward.map((row: any) => [lotKey(row), row])), [inward])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const row of inward) out[queueOf(row)] = (out[queueOf(row)] || 0) + 1
    return out
  }, [inward])
  const overdue = inward.filter((row: any) => queueOf(row) === "AWAITING_INSPECTION" && row.overdue).length
  const materials = useMemo(() => Array.from(new Set(inward.map((row: any) => String(row.material_type || "OTHER")))).sort(), [inward])
  // A scanned label (QR text or its /scan link) is matched by the lot's id; typed text by number, supplier, PO…
  const scanned = parseScanCode(search)
  const scannedLot = (scanned.kind === "REEL" || scanned.kind === "BATCH") && scanned.id ? `${scanned.kind}:${scanned.id.toLowerCase()}` : ""
  const query = (scanned.kind === "REEL" || scanned.kind === "BATCH" ? scanned.code : search).trim().toLowerCase()
  const matchesSearch = (row: any) => {
    if (scannedLot) return `${String(row.entity_type || "").toUpperCase()}:${String(row.entity_id || "").toLowerCase()}` === scannedLot
    if (!query) return true
    return [row.label, row.grn_no, row.supplier_or_customer, row.unit_ref, row.po_no, row.invoice_no, row.challan_no].some((value) => String(value || "").toLowerCase().includes(query))
  }
  const inMaterial = (row: any) => material === "ALL" || String(row.material_type || "OTHER") === material
  const visible = inward.filter((row: any) => queueOf(row) === tab && inMaterial(row) && matchesSearch(row))
  const groups = useMemo(() => groupIncomingQueue(visible), [visible])

  function openGroup(group: IncomingQueueGroup) {
    setSelection({ key: group.key, lots: group.lots })
    setResolveKey("")
  }

  // Search looks in every list: when the lot sits in another one (say Failed), show that list, and open a scanned lot.
  useEffect(() => {
    if (!scannedLot && !query) return
    const hits = inward.filter(matchesSearch)
    if (!hits.length) return
    if (!scannedLot && hits.some((row: any) => queueOf(row) === tab && inMaterial(row))) return
    const row = hits[0]
    setTab(queueOf(row))
    if (!inMaterial(row)) setMaterial("ALL")
    if (!scannedLot) return
    const group = groupIncomingQueue(inward.filter((item: any) => queueOf(item) === queueOf(row))).find((item) => item.lots.some((lot) => lotKey(lot) === lotKey(row)))
    if (group) openGroup(group)
  }, [search, inward.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // A link such as /quality/incoming?lot=REEL:<id> (GRN page, inward, issue desk, scan) opens that lot's
  // entry form with its first reading focused; ?lot=<id> alone works too. A decided lot opens read-only.
  const linkedRow = useMemo(() => (linked.id ? inward.find((item: any) => String(item.entity_id).toLowerCase() === linked.id && (!linked.type || String(item.entity_type).toUpperCase() === linked.type)) || null : null), [linked.id, linked.type, inward])
  const linkedDecided = Boolean(linked.id) && pendingQuery.isSuccess && !linkedRow
  const linkedHistory = useInventoryQualityInspections({ entity_id: linked.id, ...(linked.type ? { entity_type: linked.type } : {}), limit: 5 }, linkedDecided)
  const [linkedOpened, setLinkedOpened] = useState("")
  useEffect(() => {
    if (!linkedRow || linkedOpened === lotKey(linkedRow)) return
    setLinkedOpened(lotKey(linkedRow))
    setTab(queueOf(linkedRow))
    if (!inMaterial(linkedRow)) setMaterial("ALL")
    const group = groupIncomingQueue(inward.filter((item: any) => queueOf(item) === queueOf(linkedRow))).find((item) => item.lots.some((lot) => lotKey(lot) === lotKey(linkedRow)))
    if (group) openGroup(group)
  }, [linkedRow, inward.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Once the sheet is open, land on it (not on the list): first reading of the linked lot focused.
  const focusedFor = useRef("")
  useEffect(() => {
    if (!linkedRow || !selection || focusedFor.current === lotKey(linkedRow)) return
    const index = Math.max(0, selection.lots.findIndex((lot) => lotKey(lot) === lotKey(linkedRow)))
    const timer = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="incoming-entry-panel"]')
      if (!panel) return
      focusedFor.current = lotKey(linkedRow)
      const first = panel.querySelector<HTMLElement>(`[data-cell="${selection.lots.length > 1 ? index : 0}:0"]`)
      // Lot name and readings together; on a phone the first reading is brought into view if it is below.
      ;(document.querySelector<HTMLElement>('[data-testid="incoming-lot-context"]') || panel).scrollIntoView({ block: "start", behavior: "auto" })
      // A read-only viewer (Store, plant head) has no reading cells: land on the lot's name instead.
      ;(first || document.querySelector<HTMLElement>('[data-testid="incoming-lot-heading"]'))?.focus({ preventScroll: true })
      const box = first?.getBoundingClientRect()
      if (first && box && (box.bottom > window.innerHeight - 80 || box.top < 64)) first.scrollIntoView({ block: "center", behavior: "auto" })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [linkedRow, selection])
  useEffect(() => {
    if (!linkedDecided) return
    document.querySelector<HTMLElement>('[data-testid="incoming-decided-lot"], [data-testid="incoming-linked-missing"]')?.scrollIntoView({ block: "start" })
  }, [linkedDecided, linkedHistory.isSuccess])

  const lots = selection?.lots || []
  const head = lots[0] ? liveLots.get(lotKey(lots[0])) || lots[0] : null
  const profile = head?.quality_profile || {}
  const rules = applicableRules(profile.parameters)
  const groupQty = lots.reduce((sum: number, lot: any) => sum + Number(lot.qty || 0), 0)
  const resolvable = lots
    .map((lot: any) => liveLots.get(lotKey(lot)))
    .filter((lot: any) => {
      const last = lot?.last_inspection
      return last && (String(last.status).toUpperCase() === "FAIL" || ["REJECT", "BLOCK", "SCRAP"].includes(String(last.disposition || "").toUpperCase()))
    })
  const resolving = resolvable.find((lot: any) => lotKey(lot) === resolveKey) || resolvable[0] || null
  const failedInspection = resolving?.last_inspection && String(resolving.last_inspection.status).toUpperCase() === "FAIL" ? resolving.last_inspection : null
  const concessions = asArray(concessionsQuery.data)
  const recent = asArray(recentQuery.data)

  const resetResolution = () => {
    setConcessionReason("")
    setConcessionQty("")
    setConcessionExpiry("")
    setReturnReason("")
    setReturnRef("")
  }

  async function handleConcession() {
    if (!failedInspection) return
    if (concessionReason.trim().length < 3) return showToast("Write why this material is still fit for use.", "error")
    try {
      await createConcession.mutateAsync({
        plantId: resolving?.plant_id || undefined,
        inspection_id: failedInspection.id,
        reason: concessionReason.trim(),
        quantity: concessionQty.trim() ? Number(concessionQty) : undefined,
        release_stock: true,
        operation_id: `concession-${failedInspection.id}-${concessionQty || "all"}`,
        expires_at: concessionExpiry ? new Date(concessionExpiry).toISOString() : undefined,
      })
      showToast("Concession recorded. The FAIL stays on record; the released quantity can now be issued.", "success")
      resetResolution()
    } catch (error: any) {
      showToast(errorText(error, "Concession could not be recorded."), "error")
    }
  }

  async function handleReturn() {
    if (!resolving) return
    if (returnReason.trim().length < 3) return showToast("Write the reason for returning this material.", "error")
    if (!window.confirm(`Return ${Number(resolving.qty || 0).toLocaleString("en-IN")} ${unitWord(resolving.uom || "KG")} of ${resolving.label} to the supplier? It is written out of stock.`)) return
    try {
      const response = await returnLot.mutateAsync({
        plantId: resolving.plant_id || undefined,
        entity_type: resolving.entity_type,
        entity_id: String(resolving.entity_id),
        reason: returnReason.trim(),
        return_reference: returnRef.trim() || undefined,
      })
      showToast(response?.data?.message || "Returned to supplier.", "success")
      resetResolution()
    } catch (error: any) {
      showToast(errorText(error, "Return could not be recorded."), "error")
    }
  }

  const tabs = QUEUES.filter((item) => item.key !== "COMMERCIAL_HOLD" || (counts[item.key] || 0) > 0)

  return (
    <RoleGate allow={GATE_ROLES}>
      <div className="space-y-5" data-testid="quality-incoming-page">
        {backTo ? (
          <Link href={backTo.href} className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-back">
            <ArrowLeft className="h-4 w-4" /> {backTo.label}
          </Link>
        ) : linked.id ? (
          <button type="button" className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-back" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        ) : null}
        <PageHeader
          badge="Quality · Incoming"
          title="Incoming inspection"
          description="Check what came in against its approved standard. A lot that passes can be issued to the floor straight away — invoice or rate questions stay with Accounts and never hold material."
          actions={
            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => { void pendingQuery.refetch(); void recentQuery.refetch() }}>
              <RotateCcw className="h-4 w-4" /> Refresh
            </button>
          }
        />
        <QualityDeskNav />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="incoming-kpis">
          <Kpi label="To inspect" value={counts.AWAITING_INSPECTION || 0} hint="Inspect within 24 h of inward" icon={Hourglass} tone="blue" active={tab === "AWAITING_INSPECTION"} onClick={() => setTab("AWAITING_INSPECTION")} testId="incoming-tab-AWAITING_INSPECTION" />
          <Kpi label="Overdue" value={overdue} hint={overdue ? "Past the 24 h window" : "Nothing late"} icon={AlarmClock} tone={overdue ? "rose" : "emerald"} onClick={() => setTab("AWAITING_INSPECTION")} />
          <Kpi label="Failed · on hold" value={counts.FAILED || 0} hint="Re-check, concede or return" icon={TriangleAlert} tone="amber" active={tab === "FAILED"} onClick={() => setTab("FAILED")} testId="incoming-tab-FAILED" />
          <Kpi label="Rejected" value={counts.REJECTED || 0} hint="Return to supplier" icon={Ban} tone="rose" active={tab === "REJECTED"} onClick={() => setTab("REJECTED")} testId="incoming-tab-REJECTED" />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          {/* Queue */}
          <section className="erp-panel rounded-xl xl:sticky xl:top-4" data-testid="incoming-queue">
            <div className="space-y-3 border-b border-border p-3.5">
              <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" data-testid="incoming-queue-tabs">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.key}
                    onClick={() => setTab(item.key)}
                    className={cn("min-h-11 flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-semibold transition-colors sm:min-h-0", tab === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {item.label} <span className="tabular-nums opacity-70">{counts[item.key] || 0}</span>
                  </button>
                ))}
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Scan the label, or search reel, inward no., supplier, PO…" aria-label="Search queue" className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-base sm:h-9 sm:text-[13px]" />
              </label>
              <RackLabelHint value={search} expected="lot label to inspect it" />
              {materials.length > 1 ? (
                <div className="flex flex-wrap gap-2 sm:gap-1.5">
                  {["ALL", ...materials].map((value) => (
                    <button key={value} type="button" aria-pressed={material === value} onClick={() => setMaterial(value)} className={cn("min-h-11 rounded-full border px-3.5 text-[13px] font-semibold sm:min-h-0 sm:px-2.5 sm:py-0.5 sm:text-[11.5px]", material === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                      {value === "ALL" ? "All material" : materialLabel(value)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto p-3">
              {pendingQuery.isLoading ? (
                <LoadingState label="Loading inward material…" />
              ) : pendingQuery.isError ? (
                <ErrorState message="The QC queue could not be loaded. This is not an empty queue." onRetry={() => void pendingQuery.refetch()} />
              ) : groups.length === 0 ? (
                <EmptyState label={query || material !== "ALL" ? "Nothing matches this search." : tab === "AWAITING_INSPECTION" ? "All inward material is inspected." : "Nothing in this list."} />
              ) : (
                groups.map((group) => {
                  const active = selection?.key === group.key
                  const due = tab === "AWAITING_INSPECTION" ? dueText(group) : null
                  const last = group.lots.find((lot) => lot.last_inspection)?.last_inspection
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => openGroup(group)}
                      data-testid={`incoming-group-${group.key}`}
                      className={cn(
                        "w-full rounded-xl border px-3.5 py-3 text-left transition-all",
                        active ? "border-primary bg-primary/[.06] ring-1 ring-primary/40" : "border-border bg-card hover:border-foreground/25 hover:shadow-sm",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-foreground">{group.title}</p>
                          <p className="truncate text-[12px] text-muted-foreground">{group.supplier || "—"}</p>
                        </div>
                        {due ? <Chip tone={due.tone} size="xs" icon={due.tone === "rose" ? AlarmClock : undefined}>{due.text}</Chip> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Chip tone="slate" size="xs">{materialLabel(group.materialType)}</Chip>
                        {group.grn ? <Chip tone="blue" size="xs">{group.grn}</Chip> : null}
                        <span className="text-[11.5px] font-semibold tabular-nums text-foreground/80">
                          {group.lots.length > 1 ? `${group.lots.length} lots · ` : ""}{group.qty.toLocaleString("en-IN")} {unitWord(group.uom || "KG")}
                        </span>
                      </div>
                      {group.lots.length > 1 ? (
                        <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{group.lots.map((lot) => lotName(lot)).join(" · ")}</p>
                      ) : (
                        <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{lotName(group.lots[0])}{group.lots[0].unit_ref ? ` · vendor ${group.lots[0].unit_ref}` : ""}</p>
                      )}
                      {last ? (
                        <p className="mt-1 text-[11.5px] font-semibold text-signal-amber-ink">
                          Last check {last.status}{last.disposition ? ` · ${last.disposition}` : ""}{last.failures?.length ? ` · ${last.failures.join(", ")}` : ""}
                        </p>
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
            {customerReturns ? (
              <Link href="/quality/returns" className="flex min-h-11 items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
                <span>{customerReturns} customer return{customerReturns === 1 ? "" : "s"} wait on Customer complaints</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </section>

          {/* Workspace (opened from a link: shown before the list on a phone, so the form is what you land on) */}
          <div className={cn("min-w-0 space-y-5", linked.id && "max-xl:order-first")}>
            {!head && linkedDecided ? (
              <IncomingDecidedLot inspections={asArray(linkedHistory.data)} loading={linkedHistory.isLoading} back={backTo} />
            ) : !head ? (
              <section className="erp-panel rounded-xl p-6" data-testid="incoming-empty-workspace">
                <div className="mx-auto max-w-xl text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"><FlaskConical className="h-6 w-6" /></span>
                  <h2 className="mt-3 text-[17px] font-semibold">Pick an inward entry from the list</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">All reels, coils or batches that came in together open in one sheet.</p>
                </div>
                <ol className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
                  {[
                    { icon: ClipboardList, title: "Enter readings", text: "Each check shows its allowed band. Cells turn green or red as you type." },
                    { icon: ShieldCheck, title: "Decide per lot", text: "By readings releases a lot only if every check is in band. Hold or Reject when needed." },
                    { icon: PackageOpen, title: "Issue to floor", text: "Passed lots appear on the issue desk at once. Failed ones can be conceded or returned." },
                  ].map((step, index) => (
                    <li key={step.title} className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3.5">
                      <p className="flex items-center gap-2 text-[13px] font-semibold"><step.icon className="h-4 w-4 text-primary" />{index + 1}. {step.title}</p>
                      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{step.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <>
                <section className="erp-panel scroll-mt-20 rounded-xl p-4 sm:p-5" data-testid="incoming-lot-context">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{materialLabel(head.material_type)}{head.grn_no ? ` · Inward ${head.grn_no}` : ""}</p>
                      <h2 tabIndex={-1} data-testid="incoming-lot-heading" className="mt-0.5 text-[19px] font-semibold tracking-tight text-foreground outline-none">{lotItemName(head)}</h2>
                      <p className="text-[13px] text-muted-foreground">
                        {lots.length > 1 ? `${lots.length} lots` : lotName(head)} · {groupQty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} {unitWord(head.uom || "KG")} · {head.supplier_or_customer || "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.revision ? <Chip tone="emerald" icon={BadgeCheck}>Standard rev {profile.revision}</Chip> : <Chip tone="amber" icon={TriangleAlert}>No approved standard</Chip>}
                      <StatusBadge value={liveLots.has(lotKey(head)) ? head.stock_status : "UNRESTRICTED"} />
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-[hsl(var(--surface-2))] px-4 py-3 text-[12.5px] sm:grid-cols-3 2xl:grid-cols-6">
                    {[
                      ["Received", head.received_date ? dayText(head.received_date) : when(head.created_at)],
                      ["Challan", head.challan_no || "—"],
                      ["PO", head.po_no || "—"],
                      ["Invoice", head.invoice_no || "Not yet (Accounts)"],
                      ["QC due", head.due_at ? when(head.due_at) : "—"],
                      ["Ordered", nominalText(head.nominal)],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                        <dd className="break-words font-semibold leading-5 text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="erp-panel rounded-xl p-4 sm:p-5" data-testid="incoming-entry-panel">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="text-[15px] font-semibold">Readings &amp; decision</h3>
                      <p className="text-[12.5px] text-muted-foreground">
                        {rules.length} check{rules.length === 1 ? "" : "s"} from the approved standard · <span className="text-signal-rose-ink">*</span> required
                      </p>
                    </div>
                  </div>
                  {!rules.length ? (
                    <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-[13px] text-signal-amber-ink">
                      This material has no approved standard yet, so it cannot pass QC. Approve one in{" "}
                      <Link className="font-semibold underline" href="/quality/material-standards">Material standards</Link>, then come back.
                    </div>
                  ) : (
                    <>
                      {!canInspect ? (
                        <p className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px] text-muted-foreground" data-testid="incoming-read-only">
                          Only QC, Owner or Admin enters readings. You can see the standard and, where allowed, resolve a failed lot below.
                        </p>
                      ) : null}
                      <IncomingInspectionEntry
                        key={selection?.key}
                        lots={lots}
                        liveLots={liveLots}
                        rules={rules}
                        canInspect={canInspect}
                        onSaved={(summary, tone) => showToast(summary, tone)}
                      />
                    </>
                  )}
                </section>

                {resolving ? (
                  <section className="erp-panel rounded-xl p-4 sm:p-5" data-testid="incoming-resolution">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[15px] font-semibold">Resolve a failed lot</h3>
                        <p className="text-[12.5px] text-muted-foreground">Re-check it in the sheet above, allow use by concession, or send it back.</p>
                      </div>
                      {resolvable.length > 1 ? (
                        <select aria-label="Lot to resolve" value={lotKey(resolving)} onChange={(event) => { setResolveKey(event.target.value); resetResolution() }} className="h-11 rounded-lg border border-input bg-card px-2 text-[13px] sm:h-9">
                          {resolvable.map((lot: any) => <option key={lotKey(lot)} value={lotKey(lot)}>{lotName(lot)} · {lot.last_inspection?.failures?.join(", ") || lot.last_inspection?.status}</option>)}
                        </select>
                      ) : (
                        <Chip tone="amber">{lotName(resolving)} · {resolving.last_inspection?.failures?.join(", ") || resolving.last_inspection?.status}</Chip>
                      )}
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3 rounded-xl border border-border p-4">
                        <p className="flex items-center gap-2 text-[13.5px] font-semibold"><ShieldCheck className="h-4 w-4 text-signal-amber-ink" /> Concession — use despite FAIL</p>
                        {!failedInspection ? (
                          <p className="text-[12.5px] text-muted-foreground">Only a lot whose last check failed can be conceded. A rejected lot is returned.</p>
                        ) : canConcede ? (
                          <>
                            <p className="text-[12px] text-muted-foreground">The FAIL stays on record. Plant head, Owner or Admin — never the inspector. Critical checks cannot be conceded.</p>
                            <textarea className="min-h-16 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px]" value={concessionReason} onChange={(event) => setConcessionReason(event.target.value)} placeholder="Why this material is still fit for use" data-testid="incoming-concession-reason" />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-[12px] font-medium">Quantity (blank = whole lot)
                                <input type="number" min={0} step="0.001" className="mt-1 h-11 w-full sm:h-9 rounded-lg border border-input bg-card px-3" value={concessionQty} onChange={(event) => setConcessionQty(event.target.value)} />
                              </label>
                              <label className="block text-[12px] font-medium">Valid until (optional)
                                <input type="date" className="mt-1 h-11 w-full sm:h-9 rounded-lg border border-input bg-card px-3" value={concessionExpiry} onChange={(event) => setConcessionExpiry(event.target.value)} />
                              </label>
                            </div>
                            <button type="button" data-testid="incoming-concession-submit" disabled={createConcession.isPending} onClick={() => void handleConcession()} className="erp-btn-secondary w-full">
                              Record concession
                            </button>
                          </>
                        ) : (
                          <p className="text-[12.5px] text-muted-foreground">The plant head, an Owner or an Admin (not the inspector) can authorise a concession.</p>
                        )}
                      </div>
                      <div className="space-y-3 rounded-xl border border-signal-rose-line/70 p-4">
                        <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Undo2 className="h-4 w-4 text-signal-rose-ink" /> Return to supplier</p>
                        {canReturn ? (
                          <>
                            <p className="text-[12px] text-muted-foreground">Writes the whole lot out of stock and marks the inward line rejected. With an invoice attached, a quality claim opens for the debit note.</p>
                            <textarea className="min-h-16 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px]" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Reason, e.g. GSM 150 against 291–309" data-testid="incoming-return-reason" />
                            <input className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[13px] sm:h-9" value={returnRef} onChange={(event) => setReturnRef(event.target.value)} placeholder="Return challan / vehicle no. (optional)" />
                            <button type="button" data-testid="incoming-return-submit" disabled={returnLot.isPending} onClick={() => void handleReturn()} className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-signal-rose-line sm:h-9 bg-signal-rose-soft text-[13px] font-semibold text-signal-rose-ink disabled:opacity-60">
                              Return to supplier
                            </button>
                          </>
                        ) : (
                          <p className="text-[12.5px] text-muted-foreground">Store, Plant Manager, Owner or Admin records the physical return.</p>
                        )}
                      </div>
                    </div>
                  </section>
                ) : null}
              </>
            )}

            <div className="grid gap-5 2xl:grid-cols-2">
              <section className="erp-panel rounded-xl p-4 sm:p-5" data-testid="incoming-recent">
                <h3 className="text-[15px] font-semibold">Checked recently</h3>
                <p className="text-[12.5px] text-muted-foreground">Latest incoming inspections, newest first.</p>
                <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {recentQuery.isLoading ? (
                    <div className="p-3"><LoadingState label="Loading…" /></div>
                  ) : recent.length === 0 ? (
                    <p className="px-3 py-4 text-[12.5px] text-muted-foreground">No incoming inspections yet.</p>
                  ) : (
                    recent.slice(0, 8).map((row: any) => {
                      const pass = String(row.status).toUpperCase() === "PASS"
                      return (
                        <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg border", pass ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink")}>
                            {pass ? <BadgeCheck className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold">{row.entity_label || `${row.entity_type} ${String(row.entity_id).slice(0, 8)}`}</p>
                            <p className="truncate text-[11.5px] text-muted-foreground">
                              {RECENT_WORD[String(row.status).toUpperCase()] || row.status}{row.disposition ? ` · ${humanize(row.disposition)}` : ""}{row.failures?.length ? ` · ${row.failures.map(failureText).join(", ")}` : ""} · {personLabel(row.created_by)}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{when(row.created_at)}</span>
                        </div>
                      )
                    })
                  )}
                </div>
              </section>

              <section className="erp-panel rounded-xl p-4 sm:p-5">
                <h3 className="text-[15px] font-semibold">Concessions</h3>
                <p className="text-[12.5px] text-muted-foreground">A measured FAIL stays FAIL; a concession only allows a limited use.</p>
                <div data-testid="quality-incoming-concessions" className="mt-3 space-y-2">
                  {concessionsQuery.isLoading ? (
                    <LoadingState label="Loading concessions…" />
                  ) : concessions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-4 text-[12.5px] text-muted-foreground">No concessions recorded.</p>
                  ) : (
                    (showAllConcessions ? concessions : concessions.slice(0, 4)).map((row: any) => (
                      <div key={row.concession_id || `${row.inspection_id}:${row.approved_at}`} data-testid="quality-incoming-concession" className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold">Measured {row.measured_status || "FAIL"} · released {row.released_stock_status || row.stock_status || "held"}</p>
                          <StatusBadge value={row.released_stock_status || "CONCESSION"} />
                        </div>
                        <p className="mt-0.5 text-[12px] text-muted-foreground" data-testid="quality-incoming-concession-separate">
                          Separate record · quantity {row.quantity ?? "whole lot"} · rest stays held · inspection {row.inspection_id}
                        </p>
                        <p className="text-[12px] text-muted-foreground">{row.reason} · by {personLabel(row.approved_by)}{row.expires_at ? ` · until ${row.expires_at}` : ""}</p>
                      </div>
                    ))
                  )}
                  {concessions.length > 4 ? (
                    <button type="button" onClick={() => setShowAllConcessions((value) => !value)} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground sm:min-h-0">
                      {showAllConcessions ? "Show fewer" : `Show all ${concessions.length}`}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAllConcessions && "rotate-180")} />
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </RoleGate>
  )
}

// useSearchParams needs a Suspense boundary in Next 15 (SPEC section 6), or the build bails out.
export default function IncomingQualityPageWithSearch() {
  return (
    <Suspense fallback={<LoadingState label="Opening incoming QC…" />}>
      <IncomingQualityPage />
    </Suspense>
  )
}
