"use client"

// Dispatch register (redesign, client 2026-11-23): one row per job card with the order (SO / PO), the tube size
// and colour as the box label prints them, the due date, a pieces bar, QC and the challan state. Counts at the
// top filter the list. Making, sealing, retaining and gate linking are unchanged; this page only shows them.

import { Fragment, Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ClipboardCheck, Factory, Truck } from "lucide-react"
import { useReadyJobs, useCustomers } from "@/hooks/use-dispatch"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { jobCardRef } from "@/lib/job-card-display"
import { labelPlantTag } from "@/lib/reel-label"
import { usePlants } from "@/hooks/use-system"
import { errorText } from "@/lib/season-api"
import { cn } from "@/lib/utils"
import { RetainSurplusButton } from "@/components/production/RetainSurplusButton"
import { DispatchGateChips, useDispatchGateStatus } from "@/components/gate/dispatch-gate-chips"
import { GoneOutLinkPanel, GoneOutStrip, PickGoneOutDialog, useGoneOut, useGoodsOutRoles } from "@/components/gate/gone-out-strip"
import type { GateEntry } from "@/lib/api-gate"

const handoffLabels: Record<string, string> = { AWAITING_PACKING: "Waiting for Process to close", AWAITING_QC: "Waiting for final QC", AWAITING_FG: "Waiting for the stock posting", QC_HOLD: "On QC hold", REJECTED_QC: "Nothing accepted at final QC", RETAINED_FG: "Extra pieces kept in stock", UNSEALED: "Ready · no challan", SEALED: "Challan sealed", BOXES_READY: "Ready · no challan", PACKING: "Packing boxes" }
const STAGE_WORDS: Record<string, string> = { SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch", DONE: "Done" }
const PAGE_SIZE = 25
const pcs = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
// Only a card whose stock is posted can get a new challan; the server refuses the seal otherwise.
// A box card can get one as soon as a packed box is in stock, even while Process is still running.
const canStartChallan = (job: any) => job.dispatch_status === "DRAFT" || job.handoff_state === "UNSEALED" || job.handoff_state === "BOXES_READY"
const PROCESS_OPEN = new Set(["SLITTING", "WINDER", "OVEN", "PROCESS"])
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-IN")} ${count === 1 ? one : many}`
const stageOf = (job: any) => String(job.current_stage || "").toUpperCase()

/**
 * Retain surplus on a box card: Process closed, boxes still packed, and no box fits in the released qty left
 * (the server checks the exact boxes). For a box card remaining_qty is the pcs in packed boxes — the amount the
 * settlement expects.
 */
const canRetainBoxes = (job: any) => {
    if (!job.box_mode || !(Number(job.remaining_qty) > 0) || job.handoff_state === "QC_HOLD" || job.dispatch_status === "SEALED") return false
    if (PROCESS_OPEN.has(stageOf(job))) return false
    const room = Number(job.shipping_allowance || 0) - Number(job.dispatched_qty || 0)
    const perBox = Number(job.boxes?.qty_per_box || 0)
    return Number(job.max_ship_qty || 0) <= 0 || room <= 0 || (perBox > 0 && room < perBox && Number(job.boxes?.ready_pcs || 0) > room)
}

// Colour swatch beside the colour name (the name is always written; the swatch only helps the eye).
const SWATCHES: Array<[RegExp, string]> = [[/MAROON/, "#7b1f2a"], [/PINK|MAGENTA/, "#e46aa0"], [/ORANGE/, "#ef7d1a"], [/RED/, "#c62828"], [/GOLD/, "#c9a227"], [/YELLOW|LEMON/, "#f2c200"], [/SKY|AQUA|CYAN/, "#6fb6e8"], [/NAVY/, "#1d2f6f"], [/BLUE/, "#1e5bb8"], [/GREEN/, "#2e7d32"], [/VIOLET|PURPLE|LAVENDER/, "#7e57c2"], [/BROWN|COFFEE/, "#6d4c41"], [/BLACK/, "#111111"], [/GR[AE]Y|SILVER/, "#9e9e9e"], [/CREAM|IVORY|BEIGE/, "#f3e9cf"], [/WHITE|NATURAL|PLAIN/, "#ffffff"]]
const swatchOf = (colour: string) => SWATCHES.find(([pattern]) => pattern.test(colour.toUpperCase()))?.[1]

const todayIso = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const dayDiff = (iso: string) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 864e5)

/** Everything a row shows, worked out once. */
function rowFacts(job: any, customerMap: Record<string, string>) {
    const spec = job.spec_snapshot || {}
    const released = Number(job.released_qty ?? job.planned_qty ?? 0)
    const shipped = Number(job.dispatched_qty || 0)
    const b = job.boxes || {}
    const sealed = job.dispatch_status === "SEALED"
    const ready = sealed ? 0 : job.box_mode ? Number(b.ready_pcs || 0) : (job.handoff_state === "UNSEALED" || job.dispatch_status === "DRAFT" ? Number(job.remaining_qty || 0) : 0)
    const inHand = job.box_mode ? Number(b.boxed_pcs || 0) - Number(job.retained_qty || 0) : Number(job.packed_qty || 0)
    const waiting = sealed ? 0 : Math.max(0, inHand - shipped - ready)
    const size = job.size_label || [spec.id_avg_mm ?? spec.id_mm ?? spec.id_min_mm, spec.od_avg_mm ?? spec.od_mm ?? spec.od_min_mm, spec.length_mm ?? spec.design_length_mm ?? spec.length_min_mm].map((value) => (value == null ? "?" : String(value))).join(" x ")
    const due = job.due_date ? String(job.due_date).slice(0, 10) : ""
    const days = due ? dayDiff(due) : null
    const open = !sealed && Number(job.remaining_qty ?? 1) > 0
    return {
        customer: customerMap[job.customer_id] || job.customer_name || "Unknown customer",
        so: job.sales_order_no || "",
        po: job.customer_po || "",
        size: String(size).replace(/\s*mm$/i, "").replace(/\s*[x×]\s*/gi, " × "),
        colour: String(job.colour || "").trim(),
        due, days, open,
        dueSoon: open && days !== null && days <= 2,
        released, shipped, ready, waiting,
        flagged: Number(b.flagged || 0),
        hold: job.handoff_state === "QC_HOLD",
    }
}

function DueCell({ facts }: { facts: ReturnType<typeof rowFacts> }) {
    if (!facts.due) return <span className="text-[12.5px] text-muted-foreground">No due date</span>
    const date = new Date(`${facts.due}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    const d = facts.days ?? 0
    const note = !facts.open ? "Shipped" : d < 0 ? `Overdue ${plural(-d, "day", "days")}` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `In ${d} days`
    const tone = !facts.open ? "text-muted-foreground" : d <= 0 ? "text-signal-rose-ink" : d <= 2 ? "text-signal-amber-ink" : "text-foreground"
    return <div className="whitespace-nowrap"><p className={cn("font-semibold", tone)}>{date}</p><p className={cn("text-[12.5px] font-medium", tone === "text-foreground" ? "text-muted-foreground" : tone)}>{note}</p></div>
}

function TubeCell({ facts }: { facts: ReturnType<typeof rowFacts> }) {
    const swatch = facts.colour ? swatchOf(facts.colour) : undefined
    return (
        <div>
            <p className="whitespace-nowrap font-semibold tabular-nums text-foreground">{facts.size}</p>
            {facts.colour ? (
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    {swatch ? <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-foreground/40" style={{ background: swatch }} aria-hidden="true" /> : null}
                    {facts.colour}
                </p>
            ) : <p className="text-[12.5px] text-muted-foreground">Colour not set</p>}
        </div>
    )
}

/** Shipped · ready · packed but not posted · still to make, against the released qty. */
function PiecesCell({ job, facts }: { job: any; facts: ReturnType<typeof rowFacts> }) {
    const total = Math.max(facts.released, facts.shipped + facts.ready + facts.waiting, 1)
    const part = (value: number) => `${Math.max(0, (value / total) * 100)}%`
    const left = Math.max(0, facts.released - facts.shipped - facts.ready - facts.waiting)
    const b = job.boxes || {}
    const maxShip = Number(job.max_ship_qty || 0)
    const notes: string[] = []
    if (job.box_mode) notes.push(`${pcs(b.total)}${Number(b.planned) ? ` of ${pcs(b.planned)}` : ""} boxes × ${pcs(b.qty_per_box)}`)
    else notes.push(`${pcs(job.dispatchable_qty)} accepted`)
    if (facts.shipped && job.dispatch_status !== "SEALED") notes.push(`${pcs(facts.shipped)} shipped`)
    if (canStartChallan(job) && maxShip > 0 && Math.round(maxShip) !== Math.round(facts.ready)) notes.push(`${pcs(maxShip)} can ship now`)
    if (facts.waiting) notes.push(`${pcs(facts.waiting)} waiting for stock posting`)
    if (Number(job.qc_rejected_qty || 0) > 0) notes.push(`${pcs(job.qc_rejected_qty)} rejected at QC`)
    if (Number(job.qc_uninspected_qty || 0) > 0) notes.push(`${pcs(job.qc_uninspected_qty)} not inspected`)
    if (Number(job.retained_qty || 0) > 0) notes.push(`${pcs(job.retained_qty)} kept in stock`)
    const label = `${pcs(facts.shipped)} shipped, ${pcs(facts.ready)} ready, ${pcs(facts.waiting)} waiting for stock posting, ${pcs(left)} still to make, of ${pcs(facts.released)} released`
    return (
        <div className="min-w-[150px]" data-testid="dispatch-pieces">
            <p className="tabular-nums text-foreground">
                {job.dispatch_status === "SEALED" ? <><b className="text-[15px]">{pcs(facts.shipped)}</b> shipped of {pcs(facts.released)}</> : <><b className="text-[15px]">{pcs(facts.ready)}</b> ready of {pcs(facts.released)}</>}
            </p>
            <div className="my-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border" role="img" aria-label={label}>
                <span className="block h-full bg-signal-teal-ink" style={{ width: part(facts.shipped) }} />
                <span className="block h-full bg-signal-emerald-line" style={{ width: part(facts.ready) }} />
                <span className="block h-full bg-signal-amber-line" style={{ width: part(facts.waiting) }} />
            </div>
            <p className="text-[12.5px] tabular-nums text-muted-foreground" data-testid="dispatch-box-state">{notes.join(" · ")}</p>
        </div>
    )
}

function QcCell({ job, facts }: { job: any; facts: ReturnType<typeof rowFacts> }) {
    if (facts.hold) return <div><p className="whitespace-nowrap text-[13px] font-semibold text-signal-rose-ink">On QC hold</p><p className="text-[12px] text-muted-foreground">cannot ship</p></div>
    if (facts.flagged) return <div><p className="whitespace-nowrap text-[13px] font-semibold text-signal-amber-ink" data-testid="dispatch-qc-flagged">⚠ {plural(facts.flagged, "box", "boxes")} flagged</p><p className="text-[12px] text-muted-foreground">out of band at packing · shipping not blocked</p></div>
    if (job.handoff_state === "AWAITING_QC") return <p className="whitespace-nowrap text-[13px] font-semibold text-muted-foreground">Final QC pending</p>
    if (job.handoff_state === "REJECTED_QC") return <p className="whitespace-nowrap text-[13px] font-semibold text-signal-rose-ink">Rejected at QC</p>
    return <p className="whitespace-nowrap text-[13px] font-semibold text-signal-emerald-ink">✓ QC ok</p>
}

function StatusPill({ job }: { job: any }) {
    const [text, tone] = job.dispatch_status === "SEALED" ? [job.box_mode ? "All boxes done" : "Sealed", "emerald"]
        : job.dispatch_status === "DRAFT" ? ["Draft challan", "amber"]
        : ["UNSEALED", "BOXES_READY"].includes(job.handoff_state) ? [(job.shipments || []).length ? "Part shipped · ready" : "Ready · no challan", "teal"]
        : job.handoff_state === "QC_HOLD" ? ["On QC hold", "rose"]
        : [handoffLabels[job.handoff_state] || "Not ready to ship", "slate"]
    const tones: Record<string, string> = {
        emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
        amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
        teal: "border-signal-teal-line bg-signal-teal-soft text-signal-teal-ink",
        rose: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink",
        slate: "border-border bg-muted text-muted-foreground",
    }
    return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold leading-5", tones[tone])} data-testid="dispatch-status">{text}</span>
}

type Quick = "" | "ready" | "draft" | "notout" | "due" | "qc"

// ?card=<job card id> shows one card's dispatch (notification links; old /logistics/dispatch/<id> links redirect here).
export default function DispatchSelectionPage() {
    return <Suspense fallback={<div className="p-6 text-muted-foreground">Loading ready dispatches...</div>}><DispatchRegister /></Suspense>
}

function DispatchRegister() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const cardFilter = searchParams?.get("card") || ""
    // ?gate_out=<gate entry id> (the GATE_GOODS_OUT_TO_LINK notification) opens that truck's link panel.
    const gateOutParam = searchParams?.get("gate_out") || ""
    const { activePlant, user } = useAuth()
    const canRetain = (user?.roles || []).some(role => ["Owner", "Admin", "Dispatch"].includes(role))
    // Sales sees the register and prints sealed challans; making a challan is for the dispatch desk.
    const canPrepare = [user?.role, ...(user?.roles || [])].some(role => ["Owner", "Admin", "Dispatch", "Store", "PlantManager", "Supervisor", "Logistics"].includes(role || ""))
    const jobsQuery = useReadyJobs(activePlant)
    const customersQuery = useCustomers()
    const { data: plants = [] } = usePlants()
    const { data: readyJobs, isLoading } = jobsQuery
    const { data: customers } = customersQuery

    const [search, setSearch] = useState("")
    const [filterStatus, setFilterStatus] = useState("")
    const [filterPlant, setFilterPlant] = useState("")
    const [sortBy, setSortBy] = useState<"due" | "new" | "customer">("due")
    const [grouped, setGrouped] = useState(false)
    const [quick, setQuick] = useState<Quick>("")
    const [openDetails, setOpenDetails] = useState<Set<string>>(new Set())
    const [shown, setShown] = useState(PAGE_SIZE)
    // Gate (2026-11-06): Tally bill no. and out-of-gate state of each sealed challan.
    const gateStatus = useDispatchGateStatus((readyJobs || []).flatMap((job: any) => (job.shipments || []).map((shipment: any) => String(shipment.dispatch_ref || ""))))
    // Goods out (8 Nov 2026): the watchman photographs; Store links the photos to the challan(s) here.
    const { canLink: canLinkGateOut } = useGoodsOutRoles()
    const goneOut = useGoneOut(canLinkGateOut)
    const [gateOutPick, setGateOutPick] = useState<{ entry: GateEntry; presetRef?: string | null } | null>(null)
    const [pickFor, setPickFor] = useState<string | null>(null)
    const [gateNotice, setGateNotice] = useState("")
    useEffect(() => {
        if (!gateOutParam || gateOutPick) return
        const entry = goneOut.data?.find((row) => row.id === gateOutParam)
        if (entry) setGateOutPick({ entry })
    }, [gateOutParam, goneOut.data, gateOutPick])
    const pickGateOut = (entry: GateEntry | null, presetRef?: string | null) => {
        setGateNotice("")
        setGateOutPick(entry ? { entry, presetRef } : null)
        if (entry && typeof window !== "undefined") window.requestAnimationFrame(() => document.getElementById("gone-out-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }))
    }

    const customerMap = useMemo(() => (customers || []).reduce((acc: Record<string, string>, c: any) => { acc[c.id] = c.name; return acc }, {}), [customers])
    const plantById = useMemo(() => new Map((Array.isArray(plants) ? plants : []).map((p: any) => [String(p.id), p])), [plants])
    const allPlants = activePlant === "ALL"
    const plantTag = (job: any) => { const plant = plantById.get(String(job.plant_id)); return plant ? labelPlantTag(plant) || plant.code || plant.name : "" }

    const jobs: any[] = useMemo(() => readyJobs || [], [readyJobs])
    const facts = useMemo(() => new Map(jobs.map((job) => [job.id, rowFacts(job, customerMap)])), [jobs, customerMap])
    const notOut = (job: any) => (job.shipments || []).some((shipment: any) => { const status = gateStatus.data?.[shipment.dispatch_ref]; return status && !(status.linked || (status.out && status.gate_entry_id)) })
    const isReady = (job: any) => canStartChallan(job) && Number(job.max_ship_qty || 0) > 0 && job.dispatch_status !== "DRAFT"
    const quickTest: Record<Exclude<Quick, "">, (job: any) => boolean> = {
        ready: isReady,
        draft: (job) => job.dispatch_status === "DRAFT",
        notout: notOut,
        due: (job) => Boolean(facts.get(job.id)?.dueSoon),
        qc: (job) => Boolean(facts.get(job.id)?.hold || facts.get(job.id)?.flagged),
    }
    const counts = {
        readyPcs: jobs.filter(isReady).reduce((sum, job) => sum + Number(job.max_ship_qty || 0), 0),
        readyCards: jobs.filter(isReady).length,
        readyBoxes: jobs.filter(isReady).reduce((sum, job) => sum + Number(job.boxes?.ready || 0), 0),
        draft: jobs.filter(quickTest.draft).length,
        notout: jobs.filter(notOut).length,
        due: jobs.filter(quickTest.due).length,
        qc: jobs.filter(quickTest.qc).length,
    }

    const filteredJobs = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const rows = jobs.filter((job) => {
            const f = facts.get(job.id)!
            if (cardFilter && String(job.id) !== cardFilter) return false
            if (needle && ![jobCardRef(job), f.customer, f.so, f.po, f.size, f.colour, plantTag(job)].some((value) => String(value || "").toLowerCase().includes(needle))) return false
            if (filterPlant && String(job.plant_id) !== filterPlant) return false
            if (filterStatus === "SEALED" && job.dispatch_status !== "SEALED") return false
            if (filterStatus === "DRAFT" && job.dispatch_status !== "DRAFT") return false
            if (filterStatus === "READY" && job.dispatch_status) return false
            if (quick && !quickTest[quick](job)) return false
            return true
        })
        const created = (job: any) => String(job.created_at || "")
        return rows.sort((a, b) => {
            const fa = facts.get(a.id)!, fb = facts.get(b.id)!
            if (sortBy === "customer") return fa.customer.localeCompare(fb.customer) || created(b).localeCompare(created(a))
            if (sortBy === "new") return created(b).localeCompare(created(a))
            // Due first: open cards by due date (no date last), then shipped cards.
            if (fa.open !== fb.open) return fa.open ? -1 : 1
            return (fa.due || "9999").localeCompare(fb.due || "9999") || created(b).localeCompare(created(a))
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobs, facts, search, filterPlant, filterStatus, quick, sortBy, cardFilter, gateStatus.data])

    if (!activePlant || isLoading || customersQuery.isLoading) {
        return <div className="p-6 text-muted-foreground">Loading ready dispatches...</div>
    }
    if (jobsQuery.isError || customersQuery.isError) {
        const denied = ((jobsQuery.error || customersQuery.error) as any)?.response?.status === 403
        return (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-6">
                <p role="alert" className={denied ? "text-foreground" : "text-destructive"}>{denied ? "The dispatch register is not open to your role for this plant. Ask the Owner for access if your work needs it." : `Could not load dispatch handoffs: ${errorText(jobsQuery.error || customersQuery.error)}`}</p>
                {!denied && <Button variant="outline" className="min-h-11" onClick={() => { jobsQuery.refetch(); customersQuery.refetch() }}>Retry</Button>}
            </div>
        )
    }

    const clearAll = () => { setSearch(""); setFilterStatus(""); setFilterPlant(""); setQuick(""); if (cardFilter) router.replace("/logistics/dispatch") }
    const visible = filteredJobs.slice(0, shown)
    const groups: Array<[string | null, any[]]> = grouped
        ? Array.from(new Set(visible.map((job) => facts.get(job.id)!.customer))).map((customer) => [customer, visible.filter((job) => facts.get(job.id)!.customer === customer)])
        : [[null, visible]]
    const toggleDetails = (id: string) => setOpenDetails((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
    const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"

    const challanLinks = (job: any) => (job.shipments || []).map((shipment: any, index: number) => (
        <div key={shipment.id} className="mt-1.5">
            <Link href={`/logistics/dispatch/${job.id}/print?dispatch_id=${shipment.id}`} className="inline-flex min-h-8 items-center text-[13px] font-medium text-signal-teal-ink underline">
                Challan {job.shipments.length - index}{shipment.challan_no ? ` · ${shipment.challan_no}` : ""}: {pcs(shipment.qty)} pcs
            </Link>
            <DispatchGateChips dispatchRef={shipment.dispatch_ref} status={gateStatus.data?.[shipment.dispatch_ref]} onLinkPhoto={setPickFor} />
        </div>
    ))
    const actionButton = (job: any, full = false) => {
        const latestShipment = job.shipments?.[0]
        if (canPrepare && Number(job.max_ship_qty || 0) > 0 && canStartChallan(job)) {
            return <Button asChild size={full ? "default" : "sm"} className={cn(full ? "min-h-11 w-full" : "w-full")}><Link href={`/logistics/dispatch/new?job_card_id=${job.id}`}>{job.dispatch_status === "DRAFT" ? "Edit draft challan" : job.box_mode ? "Make challan from boxes" : "Make challan"}</Link></Button>
        }
        if (latestShipment) return <Button asChild size={full ? "default" : "sm"} variant="outline" className={cn(full ? "min-h-11 w-full" : "w-full")}><Link href={`/logistics/dispatch/${job.id}/print?dispatch_id=${latestShipment.id}`}>View challan</Link></Button>
        return null
    }
    const retainButtons = (job: any) => <>
        {canRetain && !job.box_mode && job.entry_model === "V2" && job.remaining_qty > 0 && job.dispatched_qty >= job.shipping_allowance && job.handoff_state === "UNSEALED" && <RetainSurplusButton job={job} />}
        {canRetain && canRetainBoxes(job) && <RetainSurplusButton job={job} />}
    </>
    const details = (job: any) => {
        const b = job.boxes || {}
        const f = facts.get(job.id)!
        return (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="dispatch-details">
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Boxes</p>{job.box_mode ? <>{plural(Number(b.total || 0), "box", "boxes")}{Number(b.planned) ? ` of ${pcs(b.planned)} planned` : ""} · {pcs(b.qty_per_box)} pcs each<br />{pcs(b.ready)} in stock · {pcs(b.dispatched)} shipped{Number(b.retained) ? ` · ${pcs(b.retained)} kept as surplus` : ""}</> : "Packed the old way (no boxes)"}</div>
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Stock posting</p>{pcs(f.ready)} pcs ready to ship{f.waiting ? ` · ${pcs(f.waiting)} waiting for the stock posting` : ""}</div>
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Release</p>{pcs(f.released)} pcs released · up to {pcs(job.shipping_allowance)} pcs may ship (with the allowed extra)</div>
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Stage</p>{STAGE_WORDS[stageOf(job)] || stageOf(job).toLowerCase() || "—"}{PROCESS_OPEN.has(stageOf(job)) ? " (still running)" : ""} · {handoffLabels[job.handoff_state] || "—"}</div>
            </div>
        )
    }
    const kpi = (key: Exclude<Quick, "">, title: string, value: string, note: string, warn = false) => (
        <button type="button" aria-pressed={quick === key} onClick={() => { setQuick(quick === key ? "" : key); setShown(PAGE_SIZE) }} data-testid={`dispatch-kpi-${key}`}
            className={cn("rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted", quick === key ? "border-primary ring-1 ring-primary" : "border-border")}>
            <span className="block text-[12.5px] font-semibold text-muted-foreground">{title}</span>
            <span className={cn("block text-xl font-bold tabular-nums", warn && value !== "0" ? "text-signal-rose-ink" : "text-foreground")}>{value}</span>
            <span className="block text-[12px] text-muted-foreground">{note}</span>
        </button>
    )

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Dispatch register</h1>
                    <p className="text-[13.5px] text-muted-foreground">Packed job cards, their challans and gate state. Sealing a challan takes the pieces out of stock and counts them as dispatched on the order.</p>
                </div>
            </header>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5" role="group" aria-label="Quick filters">
                {kpi("ready", "Ready to ship", `${pcs(counts.readyPcs)} pcs`, `${plural(counts.readyCards, "card", "cards")}${counts.readyBoxes ? ` · ${plural(counts.readyBoxes, "box", "boxes")}` : ""}`)}
                {kpi("draft", "Draft challans", pcs(counts.draft), "finish and seal")}
                {kpi("notout", "Sealed, not out of gate", allPlants ? "—" : pcs(counts.notout), allPlants ? "pick one plant to see" : "truck not out yet")}
                {kpi("due", "Overdue or due in 2 days", pcs(counts.due), "not fully shipped", true)}
                {kpi("qc", "QC flagged or on hold", pcs(counts.qc), "flagged ships, hold does not")}
            </div>

            <div className="erp-panel flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-[220px] flex-[2] space-y-1">
                    <label htmlFor="dispatch-search" className="text-[12.5px] font-semibold text-muted-foreground">Search</label>
                    <input id="dispatch-search" type="search" className={field} placeholder="Card, SO, PO, customer, size or colour" value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE_SIZE) }} autoComplete="off" />
                </div>
                <div className="min-w-[150px] flex-1 space-y-1">
                    <label htmlFor="dispatch-status" className="text-[12.5px] font-semibold text-muted-foreground">Challan</label>
                    <select id="dispatch-status" className={field} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setShown(PAGE_SIZE) }}>
                        <option value="">Any challan state</option>
                        <option value="READY">No challan yet</option>
                        <option value="DRAFT">Draft challan</option>
                        <option value="SEALED">Sealed</option>
                    </select>
                </div>
                {allPlants ? (
                    <div className="min-w-[150px] flex-1 space-y-1">
                        <label htmlFor="dispatch-plant" className="text-[12.5px] font-semibold text-muted-foreground">Plant</label>
                        <select id="dispatch-plant" className={field} value={filterPlant} onChange={(e) => { setFilterPlant(e.target.value); setShown(PAGE_SIZE) }}>
                            <option value="">All visible plants</option>
                            {Array.from(new Set(jobs.map((job) => String(job.plant_id)))).map((id) => { const plant = plantById.get(id); return <option key={id} value={id}>{plant ? labelPlantTag(plant) || plant.name : id}</option> })}
                        </select>
                    </div>
                ) : null}
                <div className="min-w-[170px] flex-1 space-y-1">
                    <label htmlFor="dispatch-sort" className="text-[12.5px] font-semibold text-muted-foreground">Sort by</label>
                    <select id="dispatch-sort" className={field} value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                        <option value="due">Due date, earliest first</option>
                        <option value="new">Newest job card</option>
                        <option value="customer">Customer A–Z</option>
                    </select>
                </div>
                <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-foreground">
                    <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} data-testid="dispatch-group" />
                    Group by customer
                </label>
                <Button variant="outline" className="min-h-10" onClick={clearAll}>Clear</Button>
                <p role="status" aria-live="polite" className="w-full text-[13px] text-muted-foreground" data-testid="dispatch-count">Showing {pcs(Math.min(shown, filteredJobs.length))} of {pcs(filteredJobs.length)} job card{filteredJobs.length === 1 ? "" : "s"}{filteredJobs.length !== jobs.length ? ` (${pcs(jobs.length)} in all)` : ""}</p>
            </div>

            <GoneOutStrip picked={gateOutPick?.entry || null} onPick={(entry) => pickGateOut(entry)} />
            {gateNotice ? <p role="status" className="rounded-xl border border-signal-emerald-line bg-signal-emerald-soft px-4 py-2.5 text-sm text-signal-emerald-ink" data-testid="gone-out-notice">{gateNotice}</p> : null}
            {gateOutPick ? (
                <div id="gone-out-panel" className="scroll-mt-4">
                    <GoneOutLinkPanel key={`${gateOutPick.entry.id}:${gateOutPick.presetRef || ""}`} entry={gateOutPick.entry} presetRef={gateOutPick.presetRef}
                        onClose={() => { setGateOutPick(null); if (gateOutParam) router.replace("/logistics/dispatch") }}
                        onLinked={(entry) => { setGateOutPick(null); setGateNotice(`${entry.entry_no} (${entry.vehicle_no || "truck"}) linked: ${(entry.links || []).map((row) => `challan ${row.dispatch_ref} · Tally ${row.tally_bill_no}`).join("; ")}.`); if (gateOutParam) router.replace("/logistics/dispatch") }} />
                </div>
            ) : null}
            <PickGoneOutDialog dispatchRef={pickFor} onClose={() => setPickFor(null)} onPick={(entry) => { const ref = pickFor; setPickFor(null); pickGateOut(entry, ref) }} />
            {cardFilter ? (
                <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm" data-testid="dispatch-card-filter">
                    <span>{filteredJobs.length ? "Showing one job card." : "This job card is not on the dispatch register of this plant. Check the plant at the top, or it has nothing packed yet."}</span>
                    <Link href="/logistics/dispatch" className="font-medium text-signal-teal-ink underline">Show all job cards</Link>
                </p>
            ) : null}

            {filteredJobs.length ? (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-signal-teal-ink" />Shipped</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-signal-emerald-line" />Ready (in stock)</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-signal-amber-line" />Packed, stock posting pending</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-muted ring-1 ring-inset ring-border" />Still to make</span>
                </p>
            ) : null}

            {/* Phone: one card per job card with the action as a full-size button. */}
            <ul className="space-y-2 md:hidden" data-testid="dispatch-cards">
                {groups.map(([customer, rows]) => (
                    <Fragment key={customer || "all"}>
                        {customer ? <li className="px-1 pt-2 text-[13px] font-bold text-foreground">{customer} <span className="font-medium text-muted-foreground">· {plural(rows.length, "card", "cards")}</span></li> : null}
                        {rows.map((job: any) => {
                            const f = facts.get(job.id)!
                            return (
                                <li key={job.id} className="rounded-xl border border-border bg-card p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-bold text-foreground">{jobCardRef(job)}</p>
                                            <p className="text-[12.5px] text-muted-foreground">{[f.so, allPlants ? plantTag(job) : ""].filter(Boolean).join(" · ")}</p>
                                        </div>
                                        <StatusPill job={job} />
                                    </div>
                                    <p className="mt-2 break-words font-semibold text-foreground">{f.customer}</p>
                                    {f.po ? <p className="text-[12.5px] text-muted-foreground">{f.po}</p> : null}
                                    <div className="mt-2"><TubeCell facts={f} /></div>
                                    <div className="mt-2"><PiecesCell job={job} facts={f} /></div>
                                    <div className="mt-2 flex items-start justify-between gap-3"><DueCell facts={f} /><QcCell job={job} facts={f} /></div>
                                    {challanLinks(job)}
                                    <div className="mt-2">{actionButton(job, true)}</div>
                                    {retainButtons(job)}
                                </li>
                            )
                        })}
                    </Fragment>
                ))}
                {!filteredJobs.length ? <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{jobs.length === 0 ? "No packed job cards are waiting." : "No job cards match these filters."}</li> : null}
            </ul>

            <div className="erp-panel hidden overflow-hidden rounded-xl border border-border bg-card md:block">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <caption className="sr-only">Dispatch register: one row per job card</caption>
                        <thead className="border-b border-border bg-muted text-[11.5px] uppercase tracking-[0.05em] text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Job card · SO</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Customer · PO</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Tube <span className="normal-case tracking-normal">(ID × OD × L mm)</span> · colour</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Due</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Pieces</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">QC</th>
                                <th scope="col" className="px-3 py-2.5 font-semibold">Status · action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredJobs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-0">
                                        <div className="flex min-h-[240px] flex-col items-center justify-center px-6 py-10 text-center">
                                            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink">
                                                {jobs.length === 0 ? <ClipboardCheck className="h-7 w-7" aria-hidden="true" /> : <Truck className="h-7 w-7" aria-hidden="true" />}
                                            </span>
                                            <h2 className="mt-4 text-lg font-semibold text-foreground">{jobs.length === 0 ? "No packed job cards are waiting" : "No job cards match these filters"}</h2>
                                            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{jobs.length === 0 ? "A job card shows here once its packed pieces are in stock. Sealed challans stay here to view and print." : "Clear or change the search, the counts at the top and the filters."}</p>
                                            <div className="mt-5">
                                                {jobs.length === 0 ? <Button asChild><Link href="/production/job-cards"><Factory className="mr-2 h-4 w-4" aria-hidden="true" />Open job cards</Link></Button> : <Button variant="outline" onClick={clearAll}>Clear all filters</Button>}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : groups.map(([customer, rows]) => (
                                <Fragment key={customer || "all"}>
                                    {customer ? (
                                        <tr className="bg-muted/70">
                                            <th scope="rowgroup" colSpan={7} className="px-3 py-2 text-left text-[13px] font-bold text-foreground">
                                                {customer}<span className="ml-2 font-medium text-muted-foreground">{plural(rows.length, "card", "cards")} · {pcs(rows.reduce((sum, job) => sum + facts.get(job.id)!.ready, 0))} pcs ready</span>
                                            </th>
                                        </tr>
                                    ) : null}
                                    {rows.map((job: any) => {
                                        const f = facts.get(job.id)!
                                        const open = openDetails.has(job.id)
                                        return (
                                            <Fragment key={job.id}>
                                                <tr className={cn("border-b border-border align-top", open && "border-b-0")} data-testid="dispatch-row">
                                                    <td className="px-3 py-3">
                                                        <p className="whitespace-nowrap text-[15px] font-bold tabular-nums text-foreground">{jobCardRef(job)}</p>
                                                        {f.so ? <p className="whitespace-nowrap text-[12.5px] text-muted-foreground">{f.so}</p> : null}
                                                        {allPlants ? <span className="mt-1 inline-block rounded-md border border-border px-1.5 text-[11.5px] font-bold text-foreground">{plantTag(job) || "Plant ?"}</span> : null}
                                                    </td>
                                                    <td className="min-w-[150px] px-3 py-3">
                                                        <p className="break-words font-semibold text-foreground">{f.customer}</p>
                                                        {f.po ? <p className="text-[12.5px] text-muted-foreground">{f.po}</p> : null}
                                                    </td>
                                                    <td className="px-3 py-3"><TubeCell facts={f} /></td>
                                                    <td className="px-3 py-3"><DueCell facts={f} /></td>
                                                    <td className="px-3 py-3"><PiecesCell job={job} facts={f} /></td>
                                                    <td className="px-3 py-3"><QcCell job={job} facts={f} /></td>
                                                    <td className="w-[190px] px-3 py-3">
                                                        <StatusPill job={job} />
                                                        {PROCESS_OPEN.has(stageOf(job)) ? <p className="mt-1 text-[12.5px] text-muted-foreground">Process still running at {STAGE_WORDS[stageOf(job)]}</p> : null}
                                                        <div className="mt-2">{actionButton(job)}</div>
                                                        {retainButtons(job)}
                                                        {challanLinks(job)}
                                                        <button type="button" onClick={() => toggleDetails(job.id)} aria-expanded={open} aria-controls={`dispatch-details-${job.id}`} className="mt-1 inline-flex min-h-8 items-center text-[13px] font-semibold text-signal-teal-ink underline" data-testid="dispatch-details-toggle">
                                                            {open ? "Hide details" : "Details"}
                                                        </button>
                                                    </td>
                                                </tr>
                                                {open ? <tr id={`dispatch-details-${job.id}`} className="border-b border-border bg-muted/40"><td colSpan={7} className="px-3 pb-3 pt-1">{details(job)}</td></tr> : null}
                                            </Fragment>
                                        )
                                    })}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {filteredJobs.length > shown ? (
                <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
                    <span>Showing {shown} of {filteredJobs.length}</span>
                    <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setShown((value) => value + PAGE_SIZE)} data-testid="dispatch-show-more">Show {Math.min(PAGE_SIZE, filteredJobs.length - shown)} more</Button>
                </div>
            ) : null}
        </div>
    )
}
