"use client"

/**
 * Watchman desk (6 Nov 2026, plan §4–§5). Phone first. The gate is picked at shift start and remembered on
 * this device. Tabs: Inside now · + Visitor · + Bill in · + Goods out · Today. Refreshes every 15 s.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRightLeft, Camera, CheckCircle2, Clock3, DoorOpen, FileText, LogIn, LogOut, PackageCheck, Plus, RefreshCw, ScanLine, Truck, UserPlus, UserRound, X } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { QrScanner } from "@/components/common/qr-scanner"
import { DocumentDrawer } from "@/components/documents/DocumentDrawer"
import { DocumentThumb, OutboxStrip } from "@/components/documents/DocumentsPanel"
import { bigPrimary, bigSecondary, CountTile, input, Label, newGroup, nextOnEnter, orderCodes, PhotoPages, Pill, shrinkPhoto, smallButton, VisitorFormFields, type PhotoGroup } from "@/components/gate/gate-ui"
import { Chip } from "@/components/inventory/stock-ui"
import { ReasonPicker, reasonNeedsNote, useReasonChoice, useReasonList } from "@/components/reasons"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { useDocumentOutbox } from "@/hooks/use-documents"
import { dispatchRefFromScan, gateApi, GATE_STORAGE_KEY, MATERIAL_CATEGORY, passTokenFromScan, type Gate, type GateEntry, type GateVisit, type LeavingRow } from "@/lib/api-gate"
import { queueDocumentFiles, startOutbox, UploadRefused } from "@/lib/doc-upload"
import { errorText, plural, timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

type Tab = "inside" | "visitor" | "bill" | "out" | "today"
const TABS: Array<{ key: Tab; label: string; icon: any }> = [
  { key: "inside", label: "Inside now", icon: DoorOpen },
  { key: "visitor", label: "Visitor", icon: UserPlus },
  { key: "bill", label: "Bill in", icon: FileText },
  { key: "out", label: "Goods out", icon: Truck },
  { key: "today", label: "Today", icon: Clock3 },
]
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
const clock = (value: string | null) => value ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : ""
function since(value: string | null): string {
  if (!value) return ""
  const minutes = Math.max(0, Math.round((Date.now() - new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).getTime()) / 60000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim()
}

function useGateChoice(gates: Gate[] | undefined) {
  const [gateId, setGateId] = useState<string | null>(null)
  useEffect(() => { try { setGateId(window.localStorage.getItem(GATE_STORAGE_KEY)) } catch { /* no storage */ } }, [])
  const choose = useCallback((id: string | null) => {
    setGateId(id)
    try { if (id) window.localStorage.setItem(GATE_STORAGE_KEY, id); else window.localStorage.removeItem(GATE_STORAGE_KEY) } catch { /* no storage */ }
  }, [])
  const gate = gates?.find((row) => row.id === gateId) || null
  return { gate, choose }
}

export default function GateDeskPage() {
  return <RoleGate allow={["Watchman", "PlantManager"]}><Suspense fallback={null}><GateDesk /></Suspense></RoleGate>
}

function GateDesk() {
  const { activePlant } = useAuth()
  const params = useSearchParams()
  const router = useRouter()
  const concrete = Boolean(activePlant && activePlant !== "ALL")
  const gates = useQuery({ queryKey: ["gate", "gates", activePlant], enabled: concrete, queryFn: () => gateApi.gates() })
  const { gate, choose } = useGateChoice(gates.data)
  const scannedOut = params.get("out")
  const [tab, setTab] = useState<Tab>(scannedOut ? "out" : ((params.get("tab") as Tab) || "inside"))
  const outbox = useDocumentOutbox()
  const desk = useQuery({ queryKey: ["gate", "desk", activePlant, gate?.id], enabled: Boolean(concrete && gate), refetchInterval: 15_000, refetchIntervalInBackground: false, queryFn: () => gateApi.desk(gate!.id) })
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  // A photo that finished uploading shows on its card at once (not at the next 15 s refresh).
  const doneCount = outbox.items.filter((item) => item.status === "done").length
  const refetchDesk = desk.refetch
  useEffect(() => { if (doneCount) void refetchDesk() }, [doneCount, refetchDesk])

  if (!concrete) return <Shell><Message tone="info">Pick your plant at the top first.</Message></Shell>
  if (gates.isLoading) return <Shell><p className="text-muted-foreground">Loading gates…</p></Shell>
  if (gates.isError) return <Shell><Message tone="error">Gates could not load: {errorText(gates.error)} <button className="underline" onClick={() => gates.refetch()}>Try again</button></Message></Shell>
  if (!gates.data?.length) return <Shell><Message tone="info">No gate is set up for this plant yet. The Owner or Admin adds gates in System › Gates.</Message></Shell>
  if (!gate) return <Shell><GatePicker gates={gates.data} onPick={choose} /></Shell>

  const counts = desk.data?.counts
  const entryId = params.get("entry")
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-24" data-testid="gate-desk">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Gate desk</p>
          <h1 className="truncate text-[22px] font-semibold tracking-tight text-foreground" data-testid="gate-name">{gate.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className={cn(smallButton, "border border-border bg-card")} onClick={() => desk.refetch()} aria-label="Refresh"><RefreshCw className={cn("h-4 w-4", desk.isFetching && "animate-spin")} /></button>
          <button className={cn(smallButton, "border border-border bg-card")} onClick={() => choose(null)}><ArrowRightLeft className="h-4 w-4" /> Change gate</button>
        </div>
      </header>
      {counts ? (
        <div className="grid grid-cols-4 gap-2" data-testid="gate-counts">
          <CountTile label="Waiting" value={counts.waiting} tone={counts.waiting ? "amber" : "slate"} onClick={() => setTab("inside")} />
          <CountTile label="Inside" value={counts.people_inside} tone={counts.overstay ? "rose" : counts.inside ? "cyan" : "slate"} onClick={() => setTab("inside")} />
          <CountTile label="Bills today" value={counts.bills_today} onClick={() => setTab("today")} />
          <CountTile label="To go out" value={counts.leaving} tone={counts.leaving ? "amber" : "slate"} onClick={() => setTab("out")} />
        </div>
      ) : null}
      <nav className="sticky top-0 z-20 flex gap-1 rounded-2xl border border-border bg-card/95 p-1 shadow-sm backdrop-blur" role="tablist" aria-label="Gate desk">
        {TABS.map((item) => (
          <button key={item.key} role="tab" aria-selected={tab === item.key} data-testid={`gate-tab-${item.key}`} onClick={() => { setTab(item.key); setNotice(null) }}
            className={cn("flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-xl px-1 text-[11.5px] font-semibold transition sm:min-h-11 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-[13.5px]",
              tab === item.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}>
            <item.icon className="h-4 w-4" aria-hidden="true" /><span className="sm:hidden">{item.key === "inside" ? "Inside" : item.label}</span><span className="hidden sm:inline">{item.key === "inside" || item.key === "today" ? item.label : `+ ${item.label}`}</span>
          </button>
        ))}
      </nav>
      {notice ? <Message tone={notice.tone === "ok" ? "success" : "error"} onClose={() => setNotice(null)}>{notice.text}</Message> : null}
      <OutboxStrip items={outbox.items.filter((item) => item.status !== "done" || Date.now() - (item.doneAt || 0) < 15_000)} />
      {desk.data?.photos_pending?.length ? (
        <Message tone="warning">
          {desk.data.photos_pending.length === 1 ? "1 truck went out" : `${desk.data.photos_pending.length} trucks went out`} without both photos in the vault:{" "}
          {desk.data.photos_pending.map((row) => `challan ${row.dispatch_ref} (${row.missing.join(", ").toLowerCase()})`).join("; ")}. Keep this phone on the network so they upload. If a photo was lost, the dispatch desk adds it in the Doc Vault and links it to the challan.
        </Message>
      ) : null}
      {entryId ? <EntryFocus id={entryId} onClose={() => router.replace("/gate")} /> : null}
      {desk.isError ? <Message tone="error">The desk could not refresh: {errorText(desk.error)}. It tries again in 15 seconds.</Message> : null}
      {tab === "inside" ? <InsideNow desk={desk.data} loading={desk.isLoading} focusVisit={params.get("visit")} onNotice={setNotice} /> : null}
      {tab === "visitor" ? <WalkIn gate={gate} onDone={(text) => { setNotice({ tone: "ok", text }); setTab("inside") }} /> : null}
      {tab === "bill" ? <BillIn gate={gate} onNotice={setNotice} /> : null}
      {tab === "out" ? <GoodsOut gate={gate} scanned={scannedOut} onNotice={setNotice} /> : null}
      {tab === "today" ? <Today desk={desk.data} /> : null}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl space-y-4 pt-2" data-testid="gate-desk"><h1 className="text-[22px] font-semibold tracking-tight">Gate desk</h1>{children}</div>
}

function Message({ tone, children, onClose }: { tone: "success" | "error" | "info" | "warning"; children: React.ReactNode; onClose?: () => void }) {
  const cls = tone === "success" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : tone === "error" ? "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" : tone === "warning" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink"
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-[14px] leading-6", cls)}>
      <div className="min-w-0">{children}</div>
      {onClose ? <button aria-label="Close" onClick={onClose} className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center"><X className="h-4 w-4" /></button> : null}
    </div>
  )
}

function GatePicker({ gates, onPick }: { gates: Gate[]; onPick: (id: string) => void }) {
  return (
    <section className="space-y-3" data-testid="gate-picker">
      <p className="text-[15px] text-muted-foreground">Which gate are you at? This phone remembers it for your shift.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {gates.map((row) => (
          <button key={row.id} onClick={() => onPick(row.id)} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-sm transition hover:border-primary active:scale-[.99]">
            <span><span className="block text-[17px] font-semibold text-foreground">{row.name}</span><span className="text-[12.5px] text-muted-foreground">{row.code} · {row.direction === "BOTH" ? "In and out" : row.direction === "IN" ? "In only" : "Out only"}</span></span>
            <DoorOpen className="h-6 w-6 text-primary" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Inside now ─────────────────────────────────────────────────────────────────────────────────
function InsideNow({ desk, loading, focusVisit, onNotice }: { desk?: Awaited<ReturnType<typeof gateApi.desk>>; loading: boolean; focusVisit: string | null; onNotice: (n: { tone: "ok" | "error"; text: string }) => void }) {
  const client = useQueryClient()
  const [denying, setDenying] = useState<GateVisit | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["gate", "desk"] })
  const act = useMutation({
    mutationFn: ({ visit, action }: { visit: GateVisit; action: "in" | "out" }) => action === "in" ? gateApi.letIn(visit.id, visit.version) : gateApi.out(visit.id),
    onSuccess: (visit, { action }) => { onNotice({ tone: "ok", text: action === "in" ? `${visit.visitor_name} let in. ${visit.host_words} has been told.` : `${visit.visitor_name} marked out at ${clock(visit.out_at)}.` }); refresh() },
    onError: (error) => onNotice({ tone: "error", text: errorText(error) }),
  })
  const scan = useMutation({
    mutationFn: (value: string) => {
      const token = passTokenFromScan(value)
      if (!token) throw new Error("That is not a visitor pass. Scan the QR on the visitor's pass.")
      return gateApi.scanOut(value)
    },
    onSuccess: (result) => { onNotice({ tone: "ok", text: result.action === "OUT" ? `${result.visit.visitor_name} marked out.` : `${result.visit.visitor_name} is still waiting at the gate (${result.visit.visit_no}). Let in or deny below.` }); refresh() },
    onError: (error) => onNotice({ tone: "error", text: errorText(error) }),
  })
  if (loading || !desk) return <p className="text-muted-foreground">Loading the gate…</p>
  return (
    <div className="space-y-5" data-testid="gate-inside">
      <QrScanner onScan={(value) => scan.mutate(value)} label="Scan a visitor pass" title="Scan the visitor's pass" hint="Point the camera at the QR on the visitor's phone. Inside → marked out." className={cn(bigSecondary, "w-full")} />
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">Waiting at gate <Chip tone={desk.waiting.length ? "amber" : "slate"}>{desk.waiting.length}</Chip></h2>
        {!desk.waiting.length ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">No one is waiting. Visitors who scan the gate QR show up here.</p> : null}
        {desk.waiting.map((visit) => (
          <VisitRow key={visit.id} visit={visit} focus={focusVisit === visit.id} actions={<>
            <button className={cn(smallButton, "bg-primary text-primary-foreground")} disabled={act.isPending} onClick={() => act.mutate({ visit, action: "in" })} data-testid="gate-let-in"><LogIn className="h-4 w-4" /> Let in</button>
            <button className={cn(smallButton, "border border-border bg-card text-signal-rose-ink")} onClick={() => setDenying(visit)} data-testid="gate-deny">Deny</button>
          </>} />
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">Inside <Chip tone={desk.inside.some((v) => v.overstay) ? "rose" : desk.inside.length ? "blue" : "slate"}>{desk.inside.length}</Chip>{desk.counts.overstay ? <span className="text-[12.5px] font-semibold text-signal-rose-ink">{desk.counts.overstay} after closing time ({desk.settings.gate_close_time})</span> : null}</h2>
        {!desk.inside.length ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">No visitor is inside.</p> : null}
        {desk.inside.map((visit) => (
          <VisitRow key={visit.id} visit={visit} focus={focusVisit === visit.id} actions={
            <button className={cn(smallButton, "border border-border bg-card")} disabled={act.isPending} onClick={() => act.mutate({ visit, action: "out" })} data-testid="gate-out"><LogOut className="h-4 w-4" /> Out</button>
          } />
        ))}
      </section>
      {desk.vehicles.length ? (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">Vehicles with a bill today</h2>
          {desk.vehicles.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
        </section>
      ) : null}
      <DenyDialog visit={denying} onClose={() => setDenying(null)} onDone={(visit) => { setDenying(null); onNotice({ tone: "ok", text: `${visit.visitor_name} not let in: ${visit.deny_label}.` }); refresh() }} />
    </div>
  )
}

function VisitRow({ visit, actions, focus }: { visit: GateVisit; actions?: React.ReactNode; focus?: boolean }) {
  const [photo, setPhoto] = useState(false)
  const reply = visit.host_reply
  return (
    <article data-testid="gate-visit-row" className={cn("rounded-2xl border bg-card p-3 shadow-sm", visit.overstay ? "border-signal-rose-line bg-signal-rose-soft/40" : focus ? "border-primary" : "border-border")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => visit.photo_url && setPhoto(true)} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted" aria-label={visit.photo_url ? "Open photo" : "No photo"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {visit.photo_url ? <img src={visit.photo_url} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-6 w-6 text-muted-foreground" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15.5px] font-semibold text-foreground">{visit.visitor_name}{visit.people > 1 ? <Chip tone="slate">{visit.people} people</Chip> : null}{visit.overstay ? <Chip tone="rose" icon={AlertTriangle}>After closing</Chip> : null}</p>
          <p className="text-[13px] text-muted-foreground">{[visit.company, visit.purpose_label + (visit.purpose_note ? ` · ${visit.purpose_note}` : "")].filter(Boolean).join(" · ")}</p>
          <p className="text-[13px] text-foreground/85">For <strong>{visit.host_words}</strong>{visit.status === "IN" ? ` · in ${clock(visit.in_at)} · ${since(visit.in_at)}` : ` · waiting ${since(visit.arrived_at)}`}{visit.vehicle_no ? ` · ${visit.vehicle_no}` : ""}</p>
          <p className="text-[12px] text-muted-foreground">{visit.visit_no}{visit.mobile ? ` · ${visit.mobile}` : ""}{visit.source === "DESK" ? " · entered at the desk" : ""}</p>
          {reply ? <p data-testid="gate-host-reply" className={cn("mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold", reply === "SEND_IN" ? "bg-signal-emerald-soft text-signal-emerald-ink" : reply === "WAIT" ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-signal-rose-soft text-signal-rose-ink")}>Host: {visit.host_reply_label} · {clock(visit.host_reply_at)}</p>
            : visit.status === "IN" ? <p className="mt-1 text-[12px] text-muted-foreground">Host told; no reply yet.</p> : null}
        </div>
      </div>
      {actions ? <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div> : null}
      <Dialog open={photo} onOpenChange={setPhoto}>
        <DialogContent className="max-w-md"><DialogTitle>{visit.visitor_name}</DialogTitle><DialogDescription>{visit.visit_no}</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {visit.photo_url ? <img src={visit.photo_url} alt={visit.visitor_name} className="max-h-[70vh] w-full rounded-xl object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </article>
  )
}

function DenyDialog({ visit, onClose, onDone }: { visit: GateVisit | null; onClose: () => void; onDone: (visit: GateVisit) => void }) {
  const reason = useReasonChoice("GATE_DENY")
  const [error, setError] = useState("")
  const deny = useMutation({
    mutationFn: () => gateApi.deny(visit!.id, { reason_code: reason.value.code, reason_note: reason.value.note || undefined, expected_version: visit!.version }),
    onSuccess: (row) => { reason.reset(); setError(""); onDone(row) },
    onError: (err) => setError(errorText(err)),
  })
  return (
    <Dialog open={Boolean(visit)} onOpenChange={(open) => { if (!open) { reason.reset(); setError(""); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Not letting {visit?.visitor_name} in</DialogTitle>
        <DialogDescription>Pick why. The visitor&apos;s pass shows that entry was not allowed.</DialogDescription>
        <ReasonPicker category="GATE_DENY" value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact testIdPrefix="gate:deny" />
        {error ? <p role="alert" className="text-[13px] text-signal-rose-ink">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button className={bigSecondary} onClick={onClose}>Back</button>
          <button className={cn(bigSecondary, "border-signal-rose-line text-signal-rose-ink")} disabled={deny.isPending} onClick={() => { if (reason.validate()) deny.mutate() }} data-testid="gate-deny-confirm">Deny entry</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Walk-in visitor ────────────────────────────────────────────────────────────────────────────
function WalkIn({ gate, onDone }: { gate: Gate; onDone: (text: string) => void }) {
  const { activePlant } = useAuth()
  const purposes = useReasonList("VISIT_PURPOSE")
  const client = useQueryClient()
  const requestId = useRef(newKey())
  const [letIn, setLetIn] = useState(true)
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState("")
  const save = useMutation({
    mutationFn: (form: any) => gateApi.walkIn({ ...form, request_id: requestId.current, gate_id: gate.id, let_in: letIn }),
    onSuccess: async (result) => {
      if (photo) {
        try {
          const blob = await shrinkPhoto(photo)
          await queueDocumentFiles([new File([blob], "visitor.jpg", { type: "image/jpeg" })], { kind: "VISITOR_PHOTO", source: "GATE", party_type: "VISITOR", party_name: result.visit.visitor_name, ref_no: result.visit.visit_no, link_entity_type: "VISIT", link_entity_id: result.visit.id }, { plantId: activePlant })
          startOutbox()
        } catch (err) { setError(err instanceof UploadRefused ? err.message : "The photo could not be kept. The visit is saved.") }
      }
      requestId.current = newKey()
      setPhoto(null)
      client.invalidateQueries({ queryKey: ["gate", "desk"] })
      onDone(`${result.visit.visit_no} · ${result.visit.visitor_name} ${result.visit.status === "IN" ? `let in; ${result.visit.host_words} has been told` : "is waiting at the gate"}.`)
    },
    onError: (err) => setError(errorText(err)),
  })
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="gate-walk-in">
      <h2 className="text-[16px] font-semibold">Visitor without a phone</h2>
      <p className="mb-4 text-[13px] text-muted-foreground">Visitors with a smartphone scan the QR poster at the gate and fill this themselves.</p>
      <VisitorFormFields purposes={orderCodes(purposes.data).map((row) => ({ code: row.code, label: row.label || row.code }))} searchHosts={(q) => gateApi.hosts(q)}
        submitLabel={letIn ? "Check in and let in" : "Check in · waiting at gate"} busy={save.isPending} error={error} onSubmit={(form) => { setError(""); save.mutate(form) }}
        photo={photo} onPhoto={setPhoto} testId="walkin"
        extra={<label className="flex min-h-11 items-center gap-3 text-[14px]"><input type="checkbox" className="h-5 w-5" checked={letIn} onChange={(event) => setLetIn(event.target.checked)} /> Let in now (ID checked)</label>} />
    </section>
  )
}

// ── Bill in ────────────────────────────────────────────────────────────────────────────────────
function BillIn({ gate, onNotice }: { gate: Gate; onNotice: (n: { tone: "ok" | "error"; text: string } | null) => void }) {
  const { activePlant } = useAuth()
  const client = useQueryClient()
  const categories = useReasonList("BILL_CATEGORY")
  const [groups, setGroups] = useState<PhotoGroup[]>([newGroup()])
  const [category, setCategory] = useState("")
  const [vendor, setVendor] = useState<{ id?: string; name: string } | null>(null)
  const [vendorSearch, setVendorSearch] = useState("")
  const [vehicle, setVehicle] = useState("")
  const [categoryNote, setCategoryNote] = useState("")
  const [touched, setTouched] = useState(false)
  const requestId = useRef(newKey())
  const needsNote = reasonNeedsNote(category)
  const vendors = useQuery({ queryKey: ["gate", "vendors", activePlant, vendorSearch], queryFn: () => gateApi.vendors(vendorSearch || undefined), staleTime: 60_000 })
  const photos = groups.reduce((sum, group) => sum + group.files.length, 0)
  const isMaterial = category === MATERIAL_CATEGORY
  const problems = [!groups[0].files.length ? "Take a photo of the bill or challan." : "", !category ? "Tap what kind of bill it is." : "", needsNote && categoryNote.trim().length < 5 ? "Write in a few words what the bill is for." : ""].filter(Boolean)
  const save = useMutation({
    mutationFn: async () => {
      const result = await gateApi.billIn({ request_id: requestId.current, gate_id: gate.id, category_code: category, vendor_id: vendor?.id, vendor_name: vendor?.name, vehicle_no: vehicle.trim() || undefined, note: needsNote ? categoryNote.trim() : undefined })
      const kind = (result.document_kind || (isMaterial ? "VENDOR_BILL" : "EXPENSE_BILL")) as any
      for (const group of groups.filter((row) => row.files.length)) {
        await queueDocumentFiles(group.files, { kind, source: "GATE", category, party_type: vendor ? "SUPPLIER" : undefined, party_id: vendor?.id, party_name: vendor?.name, link_entity_type: "GATE_ENTRY", link_entity_id: result.entry.id }, { plantId: activePlant })
      }
      startOutbox()
      return result
    },
    onSuccess: (result) => {
      const where = result.entry.route === "STORES" ? "sent to Stores" : "sent to Accounts"
      onNotice({ tone: "ok", text: `${result.entry.entry_no} saved · ${where}. ${plural(photos, "photo")} uploading; you can carry on.` })
      requestId.current = newKey()
      setGroups([newGroup()]); setCategory(""); setVendor(null); setVendorSearch(""); setVehicle(""); setCategoryNote(""); setTouched(false)
      client.invalidateQueries({ queryKey: ["gate", "desk"] })
    },
    onError: (error) => onNotice({ tone: "error", text: error instanceof UploadRefused ? error.message : `${errorText(error)} Nothing is lost: tap Save again.` }),
  })
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="gate-bill-in" data-enter-scope onKeyDown={nextOnEnter}>
      <div>
        <h2 className="text-[16px] font-semibold">Bill or challan coming in</h2>
        <p className="text-[13px] text-muted-foreground">Photos only. A bill with two pages: tap Add page. A truck with two bills: Add another bill.</p>
      </div>
      {groups.map((group, index) => (
        <div key={group.key} className="space-y-1">
          <PhotoPages title={groups.length > 1 ? `Bill ${index + 1}` : "Bill / challan"} files={group.files} required={index === 0} testId={`gate-bill-photos-${index}`}
            onChange={(files) => setGroups(groups.map((row) => row.key === group.key ? { ...row, files } : row))} />
          {index > 0 ? <button className="text-[12.5px] font-semibold text-signal-rose-ink underline" onClick={() => setGroups(groups.filter((row) => row.key !== group.key))}>Remove bill {index + 1}</button> : null}
        </div>
      ))}
      <button className={cn(bigSecondary, "w-full")} onClick={() => setGroups([...groups, newGroup()])} disabled={!groups.at(-1)?.files.length}><Plus className="h-4 w-4" /> Add another bill</button>
      <div>
        <Label>What kind of bill?</Label>
        <div className="flex flex-wrap gap-2" data-testid="gate-bill-categories">
          {orderCodes(categories.data, MATERIAL_CATEGORY).map((row) => <Pill key={row.code} active={category === row.code} onClick={() => setCategory(row.code)} testId={`gate-cat-${row.code}`}>{String(row.label || row.code).replace(/\s*\(write a note\)/i, "")}</Pill>)}
          {categories.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
          {categories.isError ? <p className="text-[13px] text-signal-rose-ink">Bill types could not load. Refresh the page.</p> : null}
        </div>
        {needsNote ? <input className={cn(input, "mt-2")} value={categoryNote} onChange={(event) => setCategoryNote(event.target.value)} placeholder="What is the bill for? e.g. water tanker" aria-label="Bill type note" data-testid="gate-bill-note" /> : null}
        {category ? <p className="mt-2 text-[12.5px] text-muted-foreground">{isMaterial ? "Goes to Stores for the GRN (Goods inward › At the gate)." : "Goes to Accounts to file (Gate › Bills inbox)."}</p> : null}
      </div>
      <div>
        <Label hint="optional">Vendor</Label>
        {vendor ? (
          <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-2.5"><span className="text-[15px] font-semibold">{vendor.name}</span><button className={cn(smallButton, "text-primary")} onClick={() => setVendor(null)}>Change</button></div>
        ) : (
          <>
            <input className={input} value={vendorSearch} onChange={(event) => setVendorSearch(event.target.value)} placeholder="Search vendor (recent first)" aria-label="Vendor" data-testid="gate-vendor-search" />
            <div className="mt-2 flex flex-wrap gap-2">
              {(vendors.data || []).slice(0, 8).map((row) => <Pill key={row.id} active={false} onClick={() => setVendor(row)}>{row.name}</Pill>)}
              {vendorSearch.trim().length > 2 && !(vendors.data || []).some((row) => row.name.toLowerCase() === vendorSearch.trim().toLowerCase()) ? <Pill active={false} onClick={() => setVendor({ name: vendorSearch.trim() })}>Use “{vendorSearch.trim()}”</Pill> : null}
            </div>
          </>
        )}
      </div>
      <div><Label hint="optional">Vehicle no.</Label><input className={cn(input, "uppercase")} value={vehicle} onChange={(event) => setVehicle(event.target.value.toUpperCase())} placeholder="GJ 01 AB 1234" data-testid="gate-bill-vehicle" /></div>
      {touched && problems.length ? <p role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3.5 py-2.5 text-[13.5px] text-signal-rose-ink">{problems.join(" ")}</p> : null}
      <button className={bigPrimary} disabled={save.isPending} data-testid="gate-bill-save" onClick={() => { setTouched(true); if (!problems.length) save.mutate() }}>
        <PackageCheck className="h-5 w-5" />{save.isPending ? "Saving…" : category ? `Save · send to ${isMaterial ? "Stores" : "Accounts"}` : "Save"}
      </button>
    </section>
  )
}

// ── Goods out ──────────────────────────────────────────────────────────────────────────────────
function GoodsOut({ gate, scanned, onNotice }: { gate: Gate; scanned: string | null; onNotice: (n: { tone: "ok" | "error"; text: string } | null) => void }) {
  const { activePlant } = useAuth()
  const client = useQueryClient()
  const leaving = useQuery({ queryKey: ["gate", "leaving", activePlant], queryFn: () => gateApi.leavingToday(), refetchInterval: 30_000 })
  const [picked, setPicked] = useState<string | null>(scanned)
  const row = leaving.data?.find((item) => item.dispatch_ref === picked) || null
  const waiting = (leaving.data || []).filter((item) => !item.out)
  const done = (leaving.data || []).filter((item) => item.out)
  if (picked) return <GoodsOutForm gate={gate} dispatchRef={picked} row={row} loading={leaving.isLoading} onBack={() => setPicked(null)}
    onDone={(text) => { onNotice({ tone: "ok", text }); setPicked(null); client.invalidateQueries({ queryKey: ["gate"] }) }} onError={(text) => onNotice({ tone: "error", text })} plantId={activePlant} />
  return (
    <section className="space-y-3" data-testid="gate-goods-out">
      <QrScanner onScan={(value) => { const ref = dispatchRefFromScan(value); if (ref) setPicked(ref) }} label="Scan the challan QR" title="Scan the challan" hint="Point the camera at the QR printed on our delivery challan." className={cn(bigSecondary, "w-full")} />
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">Leaving today <Chip tone={waiting.length ? "amber" : "slate"}>{waiting.length}</Chip></h2>
      {leaving.isLoading ? <p className="text-muted-foreground">Loading challans…</p> : null}
      {leaving.isError ? <Message tone="error">Challans could not load: {errorText(leaving.error)}</Message> : null}
      {!leaving.isLoading && !waiting.length ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">No challan is waiting to go out. A challan shows here once Dispatch seals it.</p> : null}
      {waiting.map((item) => <LeavingCard key={item.dispatch_ref} row={item} onPick={() => setPicked(item.dispatch_ref)} />)}
      {done.length ? <><h3 className="pt-2 text-[13.5px] font-semibold text-muted-foreground">Out today</h3>{done.map((item) => <LeavingCard key={item.dispatch_ref} row={item} />)}</> : null}
    </section>
  )
}

function LeavingCard({ row, onPick }: { row: LeavingRow; onPick?: () => void }) {
  const Tag = onPick ? "button" : "div"
  return (
    <Tag type={onPick ? "button" : undefined} onClick={onPick} data-testid="gate-leaving-row" className={cn("block w-full rounded-2xl border bg-card p-3 text-left shadow-sm", onPick ? "border-border transition hover:border-primary active:scale-[.99]" : "border-signal-emerald-line bg-signal-emerald-soft/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15.5px] font-semibold text-foreground">Challan {row.dispatch_ref}</p>
          <p className="text-[13px] text-muted-foreground">{row.items.map((item) => `${item.item_name} · ${Number(item.qty).toLocaleString("en-IN")} ${item.uom === "PCS" ? "pcs" : item.uom.toLowerCase()}`).join(" · ")}</p>
          <p className="text-[12px] text-muted-foreground">Sealed {timeText(row.posted_at)}{row.carried_over ? " · from an earlier day" : ""}</p>
        </div>
        {row.out ? <Chip tone="emerald" icon={CheckCircle2}>Out {clock(row.out_at)}</Chip> : row.tally_bill_no ? <Chip tone="blue">Tally {row.tally_bill_no}</Chip> : <Chip tone="amber">Tally no. needed</Chip>}
      </div>
    </Tag>
  )
}

function GoodsOutForm({ gate, dispatchRef, row, loading, onBack, onDone, onError, plantId }: {
  gate: Gate; dispatchRef: string; row: LeavingRow | null; loading: boolean; onBack: () => void; onDone: (text: string) => void; onError: (text: string) => void; plantId: string | null
}) {
  const [tally, setTally] = useState<File[]>([])
  const [challan, setChallan] = useState<File[]>([])
  const [tallyNo, setTallyNo] = useState(row?.tally_bill_no || "")
  const [vehicle, setVehicle] = useState(row?.vehicle_no || "")
  const [touched, setTouched] = useState(false)
  const requestId = useRef(newKey())
  useEffect(() => { if (row?.tally_bill_no) setTallyNo((current) => current || row.tally_bill_no || "") }, [row?.tally_bill_no])
  const problems = [!tally.length ? "Take a photo of the Tally bill." : "", !challan.length ? "Take a photo of our challan." : "", !tallyNo.trim() ? "Type the Tally bill number." : ""].filter(Boolean)
  const out = useMutation({
    mutationFn: async () => {
      const result = await gateApi.goodsOut({ request_id: requestId.current, gate_id: gate.id, dispatch_ref: dispatchRef, tally_bill_no: tallyNo.trim(), vehicle_no: vehicle.trim() || undefined })
      await queueDocumentFiles(tally, { kind: "TALLY_BILL", source: "GATE", ref_no: tallyNo.trim(), link_entity_type: "GATE_ENTRY", link_entity_id: result.entry.id }, { plantId })
      await queueDocumentFiles(challan, { kind: "OUR_CHALLAN", source: "GATE", ref_no: dispatchRef, link_entity_type: "GATE_ENTRY", link_entity_id: result.entry.id }, { plantId })
      startOutbox()
      return result
    },
    onSuccess: (result) => onDone(`Challan ${dispatchRef} out of the gate (${result.entry.entry_no}) with Tally ${tallyNo.trim().toUpperCase()}. Photos uploading.`),
    onError: (error) => onError(errorText(error)),
  })
  if (row?.out) return <Message tone="info">Challan {dispatchRef} already went out at {clock(row.out_at)}. <button className="underline" onClick={onBack}>Back</button></Message>
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="gate-goods-out-form" data-enter-scope onKeyDown={nextOnEnter}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold">Challan {dispatchRef}</h2>
          <p className="text-[13px] text-muted-foreground">{row ? row.items.map((item) => `${item.item_name} · ${Number(item.qty).toLocaleString("en-IN")} ${item.uom === "PCS" ? "pcs" : item.uom.toLowerCase()}`).join(" · ") : loading ? "Loading…" : "Not in today's list; the server checks the challan when you tap Out."}</p>
        </div>
        <button className={cn(smallButton, "border border-border")} onClick={onBack}>Back</button>
      </div>
      <PhotoPages title="Tally bill" files={tally} onChange={setTally} required testId="gate-out-tally-photo" />
      <PhotoPages title="Our challan" files={challan} onChange={setChallan} required testId="gate-out-challan-photo" />
      <div><Label hint={row?.tally_bill_no ? "from the dispatch desk" : "required"}>Tally bill no.</Label><input className={cn(input, "uppercase")} value={tallyNo} onChange={(event) => setTallyNo(event.target.value.toUpperCase())} placeholder="T-1189" data-testid="gate-out-tally-no" /></div>
      <div><Label hint="optional">Vehicle no.</Label><input className={cn(input, "uppercase")} value={vehicle} onChange={(event) => setVehicle(event.target.value.toUpperCase())} placeholder="GJ 01 AB 1234" data-testid="gate-out-vehicle" /></div>
      {touched && problems.length ? <p role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3.5 py-2.5 text-[13.5px] text-signal-rose-ink">{problems.join(" ")}</p> : null}
      <button className={bigPrimary} disabled={out.isPending} data-testid="gate-out-submit" onClick={() => { setTouched(true); if (!problems.length) out.mutate() }}><Truck className="h-5 w-5" />{out.isPending ? "Saving…" : "Out of gate"}</button>
    </section>
  )
}

// ── Today ──────────────────────────────────────────────────────────────────────────────────────
function Today({ desk }: { desk?: Awaited<ReturnType<typeof gateApi.desk>> }) {
  if (!desk) return <p className="text-muted-foreground">Loading…</p>
  const { entries, visits } = desk.today
  return (
    <div className="space-y-4" data-testid="gate-today">
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Bills and goods ({entries.length})</h2>
        {!entries.length ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">Nothing recorded at the gate today yet.</p> : null}
        {entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
      </section>
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Visitors ({visits.length})</h2>
        {!visits.length ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[13.5px] text-muted-foreground">No visitors today yet.</p> : null}
        {visits.map((visit) => <VisitRow key={visit.id} visit={visit} />)}
      </section>
    </div>
  )
}

function EntryRow({ entry }: { entry: GateEntry }) {
  const [open, setOpen] = useState<string | null>(null)
  const tone = entry.status === "WITH_STORES" || entry.status === "WITH_ACCOUNTS" ? "amber" : entry.status === "VOID" ? "rose" : "emerald"
  return (
    <article className="rounded-2xl border border-border bg-card p-3 shadow-sm" data-testid="gate-entry-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">{entry.kind === "GOODS_OUT" ? `Goods out · challan ${entry.dispatch_ref}` : entry.category_label || "Bill in"}{entry.party_text ? <span className="font-normal text-muted-foreground"> · {entry.party_text}</span> : null}</p>
          <p className="text-[12.5px] text-muted-foreground">{entry.entry_no} · {clock(entry.created_at)}{entry.vehicle_no ? ` · ${entry.vehicle_no}` : ""}{entry.grn_no ? ` · GRN ${entry.grn_no}` : ""}</p>
        </div>
        <Chip tone={tone as any}>{entry.status_label}</Chip>
      </div>
      {entry.documents.length ? (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {/* Top of the page (bill heading, vendor, bill no.) rather than the blank middle of a sheet. */}
          {entry.documents.map((document) => <button key={document.id} className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-[hsl(var(--surface-2))]" onClick={() => setOpen(document.id)} aria-label={`Open ${document.doc_no}`} title={document.kind_label || document.doc_no}><DocumentThumb document={document} className="object-top" /></button>)}
        </div>
      ) : <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground" data-testid="gate-entry-no-photo"><Camera className="h-3.5 w-3.5" /> {entry.photo_count ? `${entry.photo_count === 1 ? "Photo" : `${entry.photo_count} photos`} saved · Stores and Accounts open it` : entry.created_at && Date.now() - new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(entry.created_at) ? entry.created_at : `${entry.created_at}Z`).getTime() < 15 * 60_000 ? "Photo uploading…" : "No photo"}</p>}
      {entry.kind === "GOODS_OUT" && entry.photos_missing?.length && entry.documents.length ? <p className="mt-1 text-[12px] font-semibold text-signal-amber-ink" data-testid="gate-entry-photos-missing">Still to upload: {entry.photos_missing.join(", ").toLowerCase()} photo</p> : null}
      <DocumentDrawer documentId={open} onClose={() => setOpen(null)} />
    </article>
  )
}

function EntryFocus({ id, onClose }: { id: string; onClose: () => void }) {
  const entry = useQuery({ queryKey: ["gate", "entry", id], queryFn: () => gateApi.entry(id) })
  if (entry.isLoading) return <p className="text-muted-foreground">Opening the gate entry…</p>
  if (entry.isError) return <Message tone="error" onClose={onClose}>{errorText(entry.error)}</Message>
  if (!entry.data) return null
  return <div className="space-y-1"><div className="flex justify-end"><button className="text-[12.5px] font-semibold underline" onClick={onClose}>Close</button></div><EntryRow entry={entry.data} /></div>
}

