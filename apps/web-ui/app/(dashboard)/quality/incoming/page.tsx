"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  ClipboardList,
  FileWarning,
  FlaskConical,
  PackageOpen,
  RotateCcw,
  Scale,
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
  useIncomingBill,
  useIncomingBills,
  useInventoryQualityConcessions,
  useInventoryQualityInspections,
  useReturnRejectedLotToSupplier,
} from "@/hooks/use-inventory"
import { BAND_WORD, BILL_TABS, VARIANCE_STATUS_WORD, materialLabel, type BillTab } from "@/lib/incoming-qc"
import { personLabel } from "@/lib/people"
import { dayText, qtyText, signedQty, unitWord } from "@/lib/stock-format"
import { RackLabelHint } from "@/components/inventory/rack-label-hint"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { cn } from "@/lib/utils"

const asArray = (value: any) => (Array.isArray(value) ? value : [])

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}

const RECENT_WORD: Record<string, string> = { PASS: "Passed", FAIL: "Failed", INVALID: "Readings not valid", INCOMPLETE: "Readings incomplete", SKIPPED: "Skipped" }
const humanize = (value: any) => String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const failureText = (failure: any) => typeof failure === "string" ? failure : String(failure?.message || failure?.label || failure?.detail || failure?.code || "Check failed")

/** ?lot=REEL:<id>, BATCH:<id> or a bare <id>. */
function parseLinkedLot(value?: string | null): { type: "REEL" | "BATCH" | ""; id: string } {
  const text = String(value || "").trim()
  const match = /^(REEL|BATCH):(.+)$/i.exec(text)
  if (match) return { type: match[1].toUpperCase() as "REEL" | "BATCH", id: match[2].trim().toLowerCase() }
  return { type: "", id: text.toLowerCase() }
}

/** ?from=/purchase/receipts/<id>: only a path inside this app, never another site. */
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

function when(value?: string | null) {
  if (!value) return "—"
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function varianceChip(card: any) {
  const variance = card.variance
  if (variance && variance.status !== "PROVISIONAL") {
    const short = Number(variance.short_qty || 0)
    const unit = card.uom === "MIXED" ? "" : card.uom
    if (variance.status === "WITHIN") return { tone: "emerald" as const, text: short > 0 ? `−${qtyText(short, unit)} · within limit` : Number(variance.excess_qty) > 0 ? `+${qtyText(variance.excess_qty, unit)} · over` : "Matches the bill" }
    return { tone: (["AWAITING_OWNER", "CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED"].includes(variance.status) ? "rose" : "amber") as "rose" | "amber",
      text: `${short > 0 ? `−${qtyText(short, unit)} · ` : ""}${VARIANCE_STATUS_WORD[variance.status] || BAND_WORD[variance.band] || variance.status}` }
  }
  if (card.lots_weighed) {
    const diff = Number(card.diff_so_far || 0)
    return { tone: diff < 0 ? ("amber" as const) : ("slate" as const), text: `${signedQty(diff, card.uom === "MIXED" ? "" : card.uom)} so far` }
  }
  return null
}

const GATE_ROLES = ["QC", "InwardQC", "Store", "PlantManager"]
const VIEW_ROLES = ["Owner", "Admin", ...GATE_ROLES]

function IncomingQualityPage() {
  const { showToast } = useApp()
  const { user, activeRole } = useAuth()
  const roles = useMemo(() => new Set([user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, activeRole, user?.roles])
  const canView = VIEW_ROLES.some((role) => roles.has(role))
  const canInspect = ["QC", "InwardQC", "Owner", "Admin"].some((role) => roles.has(role))
  const canConcede = ["Owner", "Admin", "PlantManager"].some((role) => roles.has(role)) || (user?.permissions || []).includes("qc:disposition:approve")
  const canReturn = ["Owner", "Admin", "PlantManager", "Store"].some((role) => roles.has(role))
  const searchParams = useSearchParams()
  const router = useRouter()
  const linked = parseLinkedLot(searchParams?.get("lot"))
  const linkedBill = String(searchParams?.get("bill") || "").trim()
  const backTo = safeBack(searchParams?.get("from"))

  const [tab, setTab] = useState<BillTab>("TO_WEIGH")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])
  const [selected, setSelected] = useState<{ key: string; plantId?: string } | null>(linkedBill ? { key: linkedBill } : null)
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const listQuery = useIncomingBills({ q: query || undefined }, canView)
  const linkedQuery = useIncomingBills({ lot: linked.id && linked.type ? `${linked.type}:${linked.id}` : undefined }, canView && Boolean(linked.id && linked.type))
  const billQuery = useIncomingBill(selected?.key, selected?.plantId, canView)
  const concessionsQuery = useInventoryQualityConcessions(undefined, canView)
  const recentQuery = useInventoryQualityInspections({ source: "INWARD", limit: 12 }, canView)
  const createConcession = useCreateInventoryQualityConcession()
  const returnLot = useReturnRejectedLotToSupplier()

  const cards = useMemo(() => asArray(listQuery.data?.items), [listQuery.data?.items])
  const counts = (listQuery.data?.counts || {}) as Record<string, number>
  const visible = query ? cards : cards.filter((card: any) => (card.tabs || []).includes(tab))

  // A link such as /quality/incoming?lot=REEL:<id> opens that lot's bill with its Actual cell focused.
  const linkedCard = useMemo(() => asArray(linkedQuery.data?.items).find((card: any) => card.matched_lot) || null, [linkedQuery.data?.items])
  const [linkedOpened, setLinkedOpened] = useState("")
  useEffect(() => {
    if (!linkedCard || linkedOpened === linkedCard.key) return
    setLinkedOpened(linkedCard.key)
    setSelected({ key: linkedCard.key, plantId: linkedCard.plant_id || undefined })
    setFocusKey(`${linked.type}:${linked.id}`)
    const first = BILL_TABS.find((item) => (linkedCard.tabs || []).includes(item.key))
    if (first) setTab(first.key)
  }, [linkedCard]) // eslint-disable-line react-hooks/exhaustive-deps
  const linkedMissing = Boolean(linked.id) && (!linked.type || (linkedQuery.isSuccess && !linkedCard))
  const linkedHistory = useInventoryQualityInspections({ entity_id: linked.id, ...(linked.type ? { entity_type: linked.type } : {}), limit: 5 }, linkedMissing)

  // A scanned label or a search with one hit opens it.
  useEffect(() => {
    if (!query || !cards.length) return
    if (cards.length === 1 && cards[0].key !== selected?.key) setSelected({ key: cards[0].key, plantId: cards[0].plant_id || undefined })
  }, [query, cards.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const bill = billQuery.data
  const lots = asArray(bill?.lots)
  const check = bill?.weight_check

  function openBill(key: string, plantId?: string) {
    setSelected({ key, plantId })
    setFocusKey(null)
    window.setTimeout(() => document.querySelector('[data-testid="incoming-lot-context"]')?.scrollIntoView({ block: "start", behavior: "smooth" }), 60)
  }

  // Resolve a failed or rejected lot of the open bill: concession or return to the supplier (unchanged flow).
  const [resolveKey, setResolveKey] = useState("")
  const [concessionQty, setConcessionQty] = useState("")
  const [concessionExpiry, setConcessionExpiry] = useState("")
  const [returnRef, setReturnRef] = useState("")
  const [showAllConcessions, setShowAllConcessions] = useState(false)
  const resolvable = lots.filter((lot: any) => {
    const last = lot?.last_inspection
    return ["QC_HOLD", "BLOCKED"].includes(String(lot.stock_status)) && last && (String(last.status).toUpperCase() === "FAIL" || ["REJECT", "BLOCK", "SCRAP"].includes(String(last.disposition || "").toUpperCase()))
  })
  const resolving = resolvable.find((lot: any) => lot.key === resolveKey) || resolvable[0] || null
  const concessionReason = useReasonChoice("CONCESSION", resolving?.plant_id)
  const returnReason = useReasonChoice("RM_ISSUE", resolving?.plant_id)
  const failedInspection = resolving?.last_inspection && String(resolving.last_inspection.status).toUpperCase() === "FAIL" ? resolving.last_inspection : null
  const concessions = asArray(concessionsQuery.data)
  const recent = asArray(recentQuery.data)

  const resetResolution = () => { concessionReason.reset(); setConcessionQty(""); setConcessionExpiry(""); returnReason.reset(); setReturnRef("") }

  async function handleConcession() {
    if (!failedInspection) return
    if (!concessionReason.validate()) return showToast("Choose why this material is still fit for use.", "error")
    try {
      await createConcession.mutateAsync({
        plantId: resolving?.plant_id || undefined, inspection_id: failedInspection.id, ...concessionReason.payload("reason"),
        quantity: concessionQty.trim() ? Number(concessionQty) : undefined, release_stock: true,
        operation_id: `concession-${failedInspection.id}-${concessionQty || "all"}`,
        expires_at: concessionExpiry ? new Date(concessionExpiry).toISOString() : undefined,
      })
      showToast("Concession recorded. The FAIL stays on record; the released quantity can now be issued.", "success")
      resetResolution()
      void billQuery.refetch()
    } catch (error: any) {
      showToast(errorText(error, "Concession could not be recorded."), "error")
    }
  }

  async function handleReturn() {
    if (!resolving) return
    if (!returnReason.validate()) return showToast("Choose the reason for returning this material.", "error")
    if (!window.confirm(`Return ${Number(resolving.qty || 0).toLocaleString("en-IN")} ${unitWord(resolving.uom || "KG")} of ${resolving.label} to the supplier? It is written out of stock.`)) return
    try {
      const response = await returnLot.mutateAsync({
        plantId: resolving.plant_id || undefined, entity_type: resolving.entity_type, entity_id: String(resolving.entity_id),
        ...returnReason.payload("reason"), return_reference: returnRef.trim() || undefined,
      })
      showToast(response?.data?.message || "Returned to supplier.", "success")
      resetResolution()
      void billQuery.refetch()
    } catch (error: any) {
      showToast(errorText(error, "Return could not be recorded."), "error")
    }
  }

  return (
    <RoleGate allow={GATE_ROLES}>
      <div className="space-y-5" data-testid="quality-incoming-page">
        {backTo ? (
          <Link href={backTo.href} className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-back"><ArrowLeft className="h-4 w-4" /> {backTo.label}</Link>
        ) : linked.id ? (
          <button type="button" className="erp-btn-secondary !h-11 w-fit" data-testid="incoming-back" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /> Back</button>
        ) : null}
        <PageHeader
          badge="Quality · Incoming"
          title="Incoming inspection"
          description="One card per bill or challan. Weigh every reel, type the actual weight and decide. Stock stays on the bill weight; a shortage beyond the plant's limit goes to the Owner or straight to a debit note."
          actions={
            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => { void listQuery.refetch(); void billQuery.refetch(); void recentQuery.refetch() }}>
              <RotateCcw className="h-4 w-4" /> Refresh
            </button>
          }
        />
        <QualityDeskNav />

        <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          {/* Bills */}
          <section className="erp-panel rounded-xl xl:sticky xl:top-4" data-testid="incoming-queue">
            <div className="space-y-3 border-b border-border p-3.5">
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" data-testid="incoming-queue-tabs">
                {BILL_TABS.map((item) => (
                  <button key={item.key} type="button" role="tab" aria-selected={!query && tab === item.key} title={item.hint} onClick={() => { setTab(item.key); setSearch("") }}
                    data-testid={`incoming-tab-${item.key}`}
                    className={cn("min-h-11 shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors sm:min-h-0", !query && tab === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {item.label} <span className={cn("tabular-nums opacity-70", item.key === "OWNER_DECISION" && counts[item.key] ? "font-bold text-signal-rose-ink opacity-100" : "")}>{counts[item.key] || 0}</span>
                  </button>
                ))}
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Bill, challan, GRN, AIT, vendor reel or vendor" aria-label="Search bills" data-testid="incoming-search"
                  className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-base sm:h-9 sm:text-[13px]" />
              </label>
              <RackLabelHint value={search} expected="lot label to find its bill" />
            </div>
            <div className="max-h-[calc(100vh-16rem)] space-y-2 overflow-y-auto p-3">
              {listQuery.isLoading ? (
                <LoadingState label="Loading bills…" />
              ) : listQuery.isError ? (
                <ErrorState message="The bills could not be loaded. This is not an empty list." onRetry={() => void listQuery.refetch()} />
              ) : visible.length === 0 ? (
                <EmptyState label={query ? "No bill matches this search." : tab === "TO_WEIGH" ? "Nothing waiting to be weighed." : "Nothing in this list."} />
              ) : (
                visible.map((card: any) => {
                  const active = selected?.key === card.key
                  const counted = Math.max(0, Number(card.lots_total || 0) - Number(card.lots_excluded || 0))
                  const progress = counted ? Math.round((Number(card.lots_weighed || 0) / counted) * 100) : 0
                  const chip = varianceChip(card)
                  return (
                    <button key={card.key} type="button" onClick={() => openBill(card.key, card.plant_id || undefined)} data-testid={`incoming-bill-${card.key}`}
                      className={cn("w-full rounded-xl border px-3.5 py-3 text-left transition-all", active ? "border-primary bg-primary/[.06] ring-1 ring-primary/40" : "border-border bg-card hover:border-foreground/25 hover:shadow-sm")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold leading-5 text-foreground">{card.title}</p>
                          <p className="truncate text-[12px] text-muted-foreground">{card.supplier_name || "—"}{card.received_date ? ` · ${dayText(card.received_date)}` : ""}</p>
                        </div>
                        {card.overdue ? <Chip tone="rose" size="xs" icon={AlarmClock}>Overdue</Chip> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {card.grn_nos?.length ? <Chip tone="blue" size="xs">GRN {card.grn_nos.join(", ")}</Chip> : <Chip tone="slate" size="xs">Opening stock</Chip>}
                        {card.po_nos?.length ? <Chip tone="slate" size="xs">PO {card.po_nos.join(", ")}</Chip> : null}
                        {(card.material_types || []).slice(0, 2).map((type: string) => <Chip key={type} tone="slate" size="xs">{materialLabel(type)}</Chip>)}
                      </div>
                      {counted ? (
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between text-[11.5px] font-semibold text-foreground/80">
                            <span>{card.lots_weighed} of {counted} weighed{card.lots_excluded ? ` · ${card.lots_excluded} rejected` : ""}</span>
                            <span className="tabular-nums text-muted-foreground">{qtyText(card.bill_total, card.uom === "MIXED" ? "" : card.uom)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", progress === 100 ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${progress}%` }} /></div>
                        </div>
                      ) : null}
                      {chip ? <div className="mt-2"><Chip tone={chip.tone} size="xs" icon={Scale}>{chip.text}</Chip></div> : null}
                    </button>
                  )
                })
              )}
            </div>
          </section>

          {/* Bill */}
          <div className={cn("min-w-0 space-y-5", (linked.id || linkedBill) && "max-xl:order-first")}>
            {!selected && linkedMissing ? (
              <IncomingDecidedLot inspections={asArray(linkedHistory.data)} loading={linkedHistory.isLoading} back={backTo} />
            ) : !selected ? (
              <section className="erp-panel rounded-xl p-6" data-testid="incoming-empty-workspace">
                <div className="mx-auto max-w-xl text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-signal-blue-line bg-signal-blue-soft text-signal-blue-ink"><FlaskConical className="h-6 w-6" /></span>
                  <h2 className="mt-3 text-[17px] font-semibold">Pick a bill from the list</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">Every reel, coil or lot of the bill opens in one sheet.</p>
                </div>
                <ol className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
                  {[
                    { icon: Scale, title: "Weigh each reel", text: "Type the scale weight beside the bill weight. Enter goes to the next reel." },
                    { icon: ShieldCheck, title: "Decide", text: "Accept needs the weight. Hold or Reject do not. Checks are optional." },
                    { icon: PackageOpen, title: "Issue to floor", text: "Accepted reels can be issued at once. A short bill goes to the Owner." },
                  ].map((step, index) => (
                    <li key={step.title} className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3.5">
                      <p className="flex items-center gap-2 text-[13px] font-semibold"><step.icon className="h-4 w-4 text-primary" />{index + 1}. {step.title}</p>
                      <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{step.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : billQuery.isLoading ? (
              <section className="erp-panel rounded-xl p-6"><LoadingState label="Opening the bill…" /></section>
            ) : billQuery.isError || !bill ? (
              <section className="erp-panel rounded-xl p-6"><ErrorState message={errorText(billQuery.error, "The bill could not be opened.")} onRetry={() => void billQuery.refetch()} /></section>
            ) : (
              <>
                <section className="erp-panel scroll-mt-20 rounded-xl p-4 sm:p-5" data-testid="incoming-lot-context">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{(bill.material_types || []).map(materialLabel).join(" · ")}{bill.receipt_kind === "MANUAL" ? " · GRN without PO" : ""}</p>
                      <h2 tabIndex={-1} data-testid="incoming-lot-heading" className="mt-0.5 text-[19px] font-semibold tracking-tight text-foreground outline-none">{bill.title}</h2>
                      <p className="text-[13px] text-muted-foreground">{bill.supplier_name || "—"} · {lots.length} lot{lots.length === 1 ? "" : "s"}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {bill.invoice_pending ? <Chip tone="amber" icon={FileWarning}>Invoice to follow</Chip> : null}
                      {check ? <Chip tone={["AWAITING_OWNER", "DN_DRAFTED", "CLAIM_RAISED", "WAITING_INVOICE"].includes(check.status) ? "rose" : check.status === "WITHIN" ? "emerald" : "slate"} icon={Scale}>{VARIANCE_STATUS_WORD[check.status] || check.status}</Chip> : null}
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-[hsl(var(--surface-2))] px-4 py-3 text-[12.5px] sm:grid-cols-3 2xl:grid-cols-6">
                    {[
                      ["Vendor", bill.supplier_name || "—"],
                      ["PO", (bill.po_nos || []).join(", ") || "No PO"],
                      ["GRN", (bill.grn_nos || []).join(", ") || "—"],
                      ["Challan", (bill.challan_nos || []).join(", ") || "—"],
                      ["Invoice", bill.invoice_no || "To follow (Accounts)"],
                      ["Received", bill.received_date ? dayText(bill.received_date) : "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                        <dd className="break-words font-semibold leading-5 text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {check && check.status !== "PROVISIONAL" ? <WeightCheckBanner check={check} /> : null}
                  {bill.weights_frozen ? <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">{bill.weights_frozen}</p> : null}
                </section>

                <section className="erp-panel rounded-xl p-4 sm:p-5" data-testid="incoming-entry-panel">
                  <div className="mb-3">
                    <h3 className="text-[15px] font-semibold">Weigh &amp; decide</h3>
                    <p className="text-[12.5px] text-muted-foreground">Bill weight is read-only. <span className="text-signal-rose-ink">*</span> Actual weight is needed to Accept; every other check is optional, and a reading out of band still holds the reel.</p>
                  </div>
                  {!canInspect ? (
                    <p className="mb-3 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px] text-muted-foreground" data-testid="incoming-read-only">
                      Only QC, Inward QC, Owner or Admin weighs and decides. You can see the bill and, where allowed, resolve a held lot below.
                    </p>
                  ) : null}
                  <IncomingInspectionEntry key={bill.key} bill={bill} canInspect={canInspect && !bill.weights_frozen} focusKey={focusKey}
                    onSaved={(summary, tone) => showToast(summary, tone)} onOpenBill={(key) => openBill(key)} />
                </section>

                {resolving ? (
                  <section className="erp-panel rounded-xl p-4 sm:p-5" data-testid="incoming-resolution">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[15px] font-semibold">Resolve a held or rejected lot</h3>
                        <p className="text-[12.5px] text-muted-foreground">Re-check it in the sheet above, allow use by concession, or send it back.</p>
                      </div>
                      {resolvable.length > 1 ? (
                        <select aria-label="Lot to resolve" value={resolving.key} onChange={(event) => { setResolveKey(event.target.value); resetResolution() }} className="h-11 rounded-lg border border-input bg-card px-2 text-[13px] sm:h-9">
                          {resolvable.map((lot: any) => <option key={lot.key} value={lot.key}>{lot.code} · {lot.last_inspection?.failures?.join(", ") || lot.last_inspection?.disposition || lot.last_inspection?.status}</option>)}
                        </select>
                      ) : (
                        <Chip tone="amber">{resolving.code} · {resolving.last_inspection?.failures?.join(", ") || resolving.last_inspection?.disposition || resolving.last_inspection?.status}</Chip>
                      )}
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3 rounded-xl border border-border p-4">
                        <p className="flex items-center gap-2 text-[13.5px] font-semibold"><ShieldCheck className="h-4 w-4 text-signal-amber-ink" /> Concession · use despite FAIL</p>
                        {!failedInspection ? (
                          <p className="text-[12.5px] text-muted-foreground">Only a lot whose last check failed can be conceded. A rejected lot is returned.</p>
                        ) : canConcede ? (
                          <>
                            <p className="text-[12px] text-muted-foreground">The FAIL stays on record. Plant head, Owner or Admin, never the inspector.</p>
                            <ReasonPicker category="CONCESSION" plantId={resolving?.plant_id} label="Why it is still fit for use" value={concessionReason.value} onChange={concessionReason.setValue} showErrors={concessionReason.touched} compact testIdPrefix="incoming-concession" />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-[12px] font-medium">Quantity (blank = whole lot)
                                <input type="number" min={0} step="0.001" className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 sm:h-9" value={concessionQty} onChange={(event) => setConcessionQty(event.target.value)} />
                              </label>
                              <label className="block text-[12px] font-medium">Valid until (optional)
                                <input type="date" className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 sm:h-9" value={concessionExpiry} onChange={(event) => setConcessionExpiry(event.target.value)} />
                              </label>
                            </div>
                            <button type="button" data-testid="incoming-concession-submit" disabled={createConcession.isPending} onClick={() => void handleConcession()} className="erp-btn-secondary w-full">Record concession</button>
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
                            <ReasonPicker category="RM_ISSUE" plantId={resolving?.plant_id} label="Reason for the return" value={returnReason.value} onChange={returnReason.setValue} showErrors={returnReason.touched} compact testIdPrefix="incoming-return" />
                            <input className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[13px] sm:h-9" value={returnRef} onChange={(event) => setReturnRef(event.target.value)} placeholder="Return challan / vehicle no. (optional)" />
                            <button type="button" data-testid="incoming-return-submit" disabled={returnLot.isPending} onClick={() => void handleReturn()} className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-signal-rose-line bg-signal-rose-soft text-[13px] font-semibold text-signal-rose-ink disabled:opacity-60 sm:h-9">Return to supplier</button>
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

/** The bill's weight check once every lot is weighed: band, who acts next, and the case / debit note. */
function WeightCheckBanner({ check }: { check: any }) {
  const unit = check.uom === "MIXED" ? "" : check.uom
  const short = Number(check.short_qty || 0)
  const next: Record<string, string> = {
    WITHIN: short > 0 ? `Short ${qtyText(short, unit)}, within the ${qtyText(check.notify_kg, "KG")} limit: recorded only.` : Number(check.excess_qty) > 0 ? `Over the bill by ${qtyText(check.excess_qty, unit)}: recorded only.` : "The scale matches the bill.",
    INFO_SENT: "Short on items not billed in kg: the Owner was told. No debit note is made automatically.",
    AWAITING_OWNER: `Short ${qtyText(short, unit)} (limit ${qtyText(check.notify_kg, "KG")}–${qtyText(check.auto_kg, "KG")}): the Owner decides to make a debit note or skip it.${check.reminder_due ? " Reminder due." : ""}`,
    SKIPPED: `Owner skipped the debit note: ${check.reason_label || "reason on the case"}${check.note ? ` (${check.note})` : ""}.`,
    CLAIM_RAISED: `Case raised for ${qtyText(short, unit)}. ${check.last_error || "The debit note is being drafted."}`,
    WAITING_INVOICE: `Case raised for ${qtyText(short, unit)}; the debit note drafts as soon as the invoice is attached to the GRN.`,
    DN_DRAFTED: `Debit note ${check.debit_note_no || ""} (${String(check.debit_note_status || "draft").toLowerCase()}) for ₹${Number(check.claim_amount || 0).toLocaleString("en-IN")}. ${check.po_raiser ? `${personLabel(check.po_raiser)} follows up with the vendor.` : ""}`,
    CLOSED: `Closed: debit note ${check.debit_note_no || ""} is ${String(check.debit_note_status || "").toLowerCase()}.`,
  }
  const tone = ["AWAITING_OWNER", "CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED"].includes(check.status) ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
    : check.status === "WITHIN" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : "border-border bg-muted text-foreground"
  return (
    <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold", tone)} data-testid="incoming-weight-check">
      <span className="flex items-start gap-2"><Scale className="mt-0.5 h-4 w-4 shrink-0" />{next[check.status] || check.status}</span>
      {["AWAITING_OWNER", "DN_DRAFTED", "WAITING_INVOICE", "CLAIM_RAISED", "SKIPPED", "CLOSED"].includes(check.status) ? (
        <Link href={`/purchase/discrepancies?view=weight&variance=${check.id}`} className="inline-flex min-h-11 items-center gap-1 text-[12.5px] underline-offset-2 hover:underline sm:min-h-0">
          Weight differences <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  )
}

// useSearchParams needs a Suspense boundary in Next 15, or the build bails out.
export default function IncomingQualityPageWithSearch() {
  return (
    <Suspense fallback={<LoadingState label="Opening incoming QC…" />}>
      <IncomingQualityPage />
    </Suspense>
  )
}
