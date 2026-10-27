"use client"

// Floor picker: scan the card's QR, type its number, or pick it from the open cards, then land on the
// card with Log output or Log QC already open (?mode=output|qc). Same page on a PC and on a phone.

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Camera, ClipboardCheck, Flag, ScanLine, Search } from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import { QrScanner, jobCardIdFromScan } from "@/components/common/qr-scanner"
import { ColorChip, LifecycleBadge, lifecycleFromSummary } from "@/components/production/lifecycle-chips"
import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { usePlanningJobCards } from "@/hooks/use-production"
import { cn } from "@/lib/utils"

const ENTRY_ROLES = ["Operator", "Admin", "PlantManager", "Owner", "QC", "InProcessQC", "Planner"]
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })
const stageWord = (stage: string) => ({ SLITTING: "Slitting", WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", PACKING: "Packing", QC: "Final QC", DISPATCH: "Dispatch" })[String(stage || "").toUpperCase()] || String(stage || "").toLowerCase()

function EntryPicker() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading } = useAuth()
  const mode = searchParams?.get("mode") === "qc" ? "qc" : searchParams?.get("mode") === "output" ? "output" : ""
  const [typed, setTyped] = useState("")
  const [search, setSearch] = useState("")
  const roles = useMemo(() => (Array.isArray(user?.roles) ? user.roles : []), [user?.roles])
  const allowed = roles.some((role: string) => ENTRY_ROLES.includes(role))
  const cards = usePlanningJobCards({ search: search || undefined, limit: 40 }, Boolean(user))
  const rows: any[] = useMemo(() => (Array.isArray(cards.data) ? cards.data : cards.data?.items || []).filter((job: any) => !["COMPLETED", "CANCELLED"].includes(String(job.status || "").toUpperCase())), [cards.data])
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

  const open = (value: string) => {
    const candidate = value.trim()
    if (!candidate) return
    const id = jobCardIdFromScan(candidate)
    const match = rows.find((job: any) => String(job.id) === id || String(job.job_card_no || job.job_card_ref || "").toLowerCase() === candidate.toLowerCase()) || rows.find((job: any) => [job.job_card_no, job.job_card_ref, job.customer_name, job.sales_order_no].join(" ").toLowerCase().includes(candidate.toLowerCase()))
    router.push(target(String(match?.id || id)))
  }

  if (isLoading && !user) return <LoadingState label="Opening the floor entry…" />
  if (user && !allowed)
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-signal-rose-line bg-card p-6">
        <p className="text-[12px] font-semibold text-signal-rose-ink">Access denied</p>
        <h1 className="mt-2 text-xl font-semibold">This account cannot open floor entry.</h1>
        <Link href="/dashboard" className="erp-btn-secondary mt-4 !h-9">
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
          <Link href={`/production/entry?mode=${mode === "qc" ? "output" : "qc"}`} className="erp-btn-secondary ml-auto !h-9">
            {mode === "qc" ? "Log output instead" : "Log QC instead"}
          </Link>
        ) : null}
      </header>

      <section className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-premium)]">
        <QrScanner onScan={open} label="Scan the card's QR" title="Scan job card" hint="Point the camera at the QR on the printed job card." className="erp-btn-primary !h-14 w-full !rounded-xl !text-[15px]" />
        <p className="my-2 text-center text-[12px] text-muted-foreground">or type the card number</p>
        <label className="flex h-12 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
          <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="sr-only">Job card number or scan</span>
          <input
            data-testid="entry-picker-input"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setSearch(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                open(typed)
              }
            }}
            placeholder="26/10/…  or customer"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
            autoFocus
          />
          <button type="button" className="erp-btn-secondary !h-9" onClick={() => open(typed)} data-testid="entry-picker-open">
            <Search className="h-4 w-4" /> Open
          </button>
        </label>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="entry-picker-list">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Open cards</h2>
          <span className="text-[12px] text-muted-foreground">{cards.isLoading ? "Loading…" : `${rows.length} card${rows.length === 1 ? "" : "s"}`}</span>
        </div>
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
          {!cards.isLoading && !rows.length ? <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">No open job cards{search ? ` for “${search}”` : ""}.</li> : null}
        </ul>
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
