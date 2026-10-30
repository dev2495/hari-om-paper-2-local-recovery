"use client"

// Floor picker: scan the card's QR, type its number, or pick it from the open cards, then land on the
// card with Log output or Log QC already open (?mode=output|qc). Same page on a PC and on a phone.
// Any printed form is read here: new full links, old /production/entry paths, old supervisor-entry links,
// a pasted card id, or a typed card number (looked up on the server when it is not in the list).
// The open list is read newest first, 100 cards a page; when older pages remain it says so.

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Camera, ChevronDown, ClipboardCheck, Flag, Loader2, ScanLine, Search, SearchX } from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import { QrScanner } from "@/components/common/qr-scanner"
import { ColorChip, LifecycleBadge, lifecycleFromSummary } from "@/components/production/lifecycle-chips"
import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { productionApi } from "@/lib/api"
import { parseScanCode } from "@/lib/scan-code"
import { cn } from "@/lib/utils"

const ENTRY_ROLES = ["Operator", "Admin", "PlantManager", "Owner", "QC", "InProcessQC", "Planner"]
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Closed = completed or cancelled; a card cancelled by its close mode can still carry an older status.
const isOpenCard = (job: any) => !["COMPLETED", "CANCELLED"].includes(String(job?.status || "").toUpperCase()) && String(job?.close_mode || "").toUpperCase() !== "CANCELLED"
const listOf = (data: any): any[] => (Array.isArray(data) ? data : data?.items || [])
const PAGE = 100
// Card numbers typed with dashes, dots or spaces ("26-10-65", "26.10.59-C") read as 26/10/65.
const cardNoOf = (text: string) => text.trim().replace(/^(\d{2})[-.\s](\d{2})[-.\s](\d+)/, "$1/$2/$3")
const stageWord = (stage: string) => ({ SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch" })[String(stage || "").toUpperCase()] || String(stage || "").toLowerCase()

function EntryPicker() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading, activePlant } = useAuth()
  const mode = searchParams?.get("mode") === "qc" ? "qc" : searchParams?.get("mode") === "output" ? "output" : ""
  const [typed, setTyped] = useState("")
  const [search, setSearch] = useState("")
  const [miss, setMiss] = useState<{ text: string; href?: string } | null>(null)
  const [looking, setLooking] = useState(false)
  const roles = useMemo(() => (Array.isArray(user?.roles) ? user.roles : []), [user?.roles])
  const allowed = roles.some((role: string) => ENTRY_ROLES.includes(role))
  // A typed number not in this plant is also looked for in the user's other plants (one "All plants" read for
  // Owner/Admin); the card page then switches to the card's plant, as it does for a scanned card.
  const otherPlants = useMemo(() => {
    if (!user || String(activePlant || "").toUpperCase() === "ALL") return []
    if (user.is_owner_all_plants || [user.role, ...roles].some((role) => role === "Owner" || role === "Admin")) return ["ALL"]
    return (user.allowed_plant_ids || []).filter((plant) => plant.toLowerCase() !== String(activePlant || "").toLowerCase())
  }, [user, roles, activePlant])
  const cards = useInfiniteQuery({
    queryKey: ["planning-job-cards", "floor-picker", search],
    enabled: Boolean(user),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => listOf((await productionApi.getPlanningJobCards({ search: search || undefined, limit: PAGE, offset: pageParam })).data),
    getNextPageParam: (last: any[], pages: any[][]) => (last.length === PAGE ? pages.length * PAGE : undefined),
  })
  const rows: any[] = useMemo(() => (cards.data?.pages || []).flat().filter(isOpenCard), [cards.data])
  // Older pages not read yet: the list is the newest open cards only, and says so.
  const cut = Boolean(cards.hasNextPage)
  // ?mode=output|qc&stage=OVEN&entry=<run> are carried to the card, so Log QC opens on that stage and run.
  const target = (id: string) => {
    const query = new URLSearchParams()
    if (mode) query.set("mode", mode)
    for (const key of ["stage", "entry"]) if (searchParams?.get(key)) query.set(key, String(searchParams.get(key)))
    return `/production/entry/${encodeURIComponent(id)}${query.toString() ? `?${query}` : ""}`
  }

  // Older links carried the card in the query (?job_card_id=…): land on it straight away.
  useEffect(() => {
    const seeded = searchParams?.get("job_card_id")
    if (seeded) router.replace(target(seeded))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(`/production/entry${mode ? `?mode=${mode}` : ""}`)}`)
  }, [isLoading, user, router, mode])

  const open = async (value: string) => {
    const candidate = value.trim()
    if (!candidate || looking) return
    setMiss(null)
    const scanned = parseScanCode(candidate)
    if (scanned.kind === "JOB_CARD") return router.push(target(scanned.id))
    if (scanned.kind === "LOCATION") return setMiss({ text: `That is a rack label (${scanned.code || "location"}), not a job card. Scan the QR on the printed job card.` })
    if (scanned.kind !== "CODE") return setMiss({ text: "That QR is on a material or tool label, not a job card. Scan the QR on the printed job card." })
    if (UUID.test(candidate)) return router.push(target(candidate.toLowerCase()))
    // A typed card number: the open list first, then the server (the list may still be loading or cut short).
    const cardNo = cardNoOf(candidate)
    const wanted = cardNo.toLowerCase()
    const sameNo = (job: any) => [job.job_card_no, job.job_card_ref].some((no) => String(no || "").toLowerCase() === wanted)
    let match = rows.find(sameNo)
    let found: any[] = []
    if (!match) {
      setLooking(true)
      try {
        const { data } = await productionApi.getPlanningJobCards({ search: cardNo, limit: 20 })
        found = listOf(data)
        for (const plant of found.some(sameNo) ? [] : otherPlants) {
          try {
            const elsewhere = listOf((await productionApi.getPlanningJobCards({ search: cardNo, limit: 20 }, plant)).data).filter(sameNo)
            if (elsewhere.length) {
              found = elsewhere
              break
            }
          } catch {
            /* That plant cannot be read: try the next. */
          }
        }
        match = found.filter(isOpenCard).find(sameNo)
        const closed = match ? null : found.find(sameNo)
        if (closed) {
          const word = [closed.status, closed.close_mode].some((v) => String(v || "").toUpperCase() === "CANCELLED") ? "cancelled" : "completed"
          return setMiss({ text: `Job card ${closed.job_card_no || closed.job_card_ref} is closed (${word}). ${word === "cancelled" ? "Nothing more can be logged on it." : "No more runs can be logged on it."}`, href: target(String(closed.id)) })
        }
      } catch {
        /* Fall back to the list on screen. */
      } finally {
        setLooking(false)
      }
    }
    // Typing a customer or order opens the first open card that matches it (as before).
    const mentions = (job: any) => [job.job_card_no, job.job_card_ref, job.customer_name, job.sales_order_no].join(" ").toLowerCase().includes(wanted)
    match = match || rows.find(mentions) || found.filter(isOpenCard).find(mentions)
    if (match) return router.push(target(String(match.id)))
    setMiss({ text: `No open job card ${cardNo}` })
  }

  if (isLoading && !user) return <LoadingState label="Opening the floor entry…" />
  if (user && !allowed)
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-signal-rose-line bg-card p-6">
        <p className="text-[12px] font-semibold text-signal-rose-ink">Access denied</p>
        <h1 className="mt-2 text-xl font-semibold">This account cannot open floor entry.</h1>
        <Link href="/dashboard" className="erp-btn-secondary mt-4 !h-11">
          Back to dashboard
        </Link>
      </div>
    )

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="entry-picker">
      <header className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", mode === "qc" ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-primary/10 text-primary")}>{mode === "qc" ? <ClipboardCheck className="h-5 w-5" aria-hidden="true" /> : <Camera className="h-5 w-5" aria-hidden="true" />}</span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Floor</p>
          <h1 className="text-[22px] font-bold tracking-tight">{mode === "qc" ? "Log QC" : mode === "output" ? "Log output" : "Floor entry"}</h1>
          <p className="text-[13px] text-muted-foreground">{mode === "qc" ? "Scan the card, pick the run, type the readings. Out of band is flagged, never held." : mode === "output" ? "Scan the card, pick the stage, enter made and rejected. No QC fields here." : "Scan the card's QR or pick it below."}</p>
        </div>
        {mode ? (
          <Link href={`/production/entry?mode=${mode === "qc" ? "output" : "qc"}`} className="erp-btn-secondary ml-auto !h-11 shrink-0">
            {mode === "qc" ? "Log output instead" : "Log QC instead"}
          </Link>
        ) : null}
      </header>

      <section className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-premium)]">
        <QrScanner onScan={(value) => void open(value)} label="Scan the card's QR" title="Scan job card" hint="Point the camera at the QR on the printed job card." className="erp-btn-primary !h-14 w-full !rounded-xl !text-[15px]" />
        <p className="my-2 text-center text-[12px] text-muted-foreground">or type the card number</p>
        <label className="flex h-14 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
          <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="sr-only">Job card number or scan</span>
          <input
            data-testid="entry-picker-input"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setSearch(cardNoOf(event.target.value))
              setMiss(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void open(typed)
              }
            }}
            placeholder="26/10/…  or customer"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
            autoFocus
          />
          <button type="button" className="erp-btn-secondary -mr-2 !h-11" onClick={() => void open(typed)} disabled={looking} data-testid="entry-picker-open">
            {looking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" />} Open
          </button>
        </label>
        {miss ? (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink" data-testid="entry-picker-miss">
            <SearchX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span role="alert">{miss.text}</span>
              {miss.href ? (
                <>
                  {" "}
                  <Link href={miss.href} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                    View the card
                  </Link>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </section>

      <section id="open-cards" className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card" data-testid="entry-picker-list">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Open cards</h2>
          <span className="text-[12px] text-muted-foreground" data-testid="entry-picker-count">{cards.isLoading ? "Loading…" : cut ? `Newest ${rows.length} open card${rows.length === 1 ? "" : "s"}` : `${rows.length} card${rows.length === 1 ? "" : "s"}`}</span>
        </div>
        {cut ? <p className="border-b border-border bg-muted/60 px-4 py-2 text-[12.5px] text-muted-foreground">Older cards are not listed yet. Type a card number above to find one, or show older cards below.</p> : null}
        <ul className="divide-y divide-border">
          {rows.map((job: any) => (
            <li key={job.id}>
              <Link href={target(String(job.id))} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted" data-testid={`entry-picker-card-${job.id}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-semibold">
                    {job.job_card_no || job.job_card_ref}
                    {job.qc_flagged_runs ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-signal-amber-line bg-signal-amber-soft px-1.5 text-[10.5px] font-bold text-signal-amber-ink">
                        <Flag className="h-2.5 w-2.5" aria-hidden="true" /> {job.qc_flagged_runs}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                    <span className="truncate">{job.customer_name || "—"}</span>
                    <span>·</span>
                    <ColorChip color={job.parchment_color} empty="plain" />
                    <span>· {fmt(job.released_qty || job.planned_qty)} pcs</span>
                    <span>· {stageWord(job.current_stage)}</span>
                  </span>
                </span>
                <LifecycleBadge state={lifecycleFromSummary(job)} />
              </Link>
            </li>
          ))}
          {!cards.isLoading && !rows.length && !cut ? <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">No open job cards{search ? ` for “${search}”` : ""}.</li> : null}
        </ul>
        {cut ? (
          <div className="border-t border-border p-2">
            <button type="button" className="erp-btn-secondary !h-11 w-full" disabled={cards.isFetchingNextPage} onClick={() => void cards.fetchNextPage()} data-testid="entry-picker-more">
              {cards.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />} Show older cards
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default function ProductionEntryPickerPage() {
  return (
    <Suspense fallback={<LoadingState label="Opening the floor entry…" />}>
      <EntryPicker />
    </Suspense>
  )
}
