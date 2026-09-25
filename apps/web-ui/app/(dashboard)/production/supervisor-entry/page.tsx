"use client"

import { ScanLine, Search } from "lucide-react"
import { QrScanner, jobCardIdFromScan } from "@/components/common/qr-scanner"
import { PageHeader } from "@/components/workspace/page-header"
import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

import JobCardDocument from "@/components/production/JobCardDocument"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { usePlanningJobCards } from "@/hooks/use-production"

function SupervisorEntryPageContent() {
  const { showToast } = useApp()
  const { activePlant, user } = useAuth()
  const searchParams = useSearchParams()
  const [jobCardInput, setJobCardInput] = useState("")
  const [jobCardId, setJobCardId] = useState("")
  const [jobSearch, setJobSearch] = useState("")
  const [writePlant, setWritePlant] = useState("")
  const allowedPlants = user?.allowed_plant_ids || []
  const effectiveWritePlant = activePlant === "ALL" ? writePlant : activePlant || ""

  const jobCardsQuery = usePlanningJobCards({ search: jobSearch || undefined, limit: 25 })

  useEffect(() => {
    const seededJobCardId = searchParams?.get("job_card_id") || ""
    if (seededJobCardId) {
      setJobCardId(seededJobCardId)
      setJobCardInput(seededJobCardId)
    }
  }, [searchParams])

  const selectedJobOptions = useMemo(() => {
    const rows = Array.isArray(jobCardsQuery.data) ? jobCardsQuery.data : []
    return rows
  }, [jobCardsQuery.data])

  const normalizedJobOptions = useMemo(
    () =>
      selectedJobOptions.map((job: any) => ({
        ...job,
        ref: String(job.job_card_ref || job.job_card_no || `JC-${String(job.id || "").slice(0, 8).toUpperCase()}`),
      })),
    [selectedJobOptions],
  )

  function handleLoadByScannerInput() {
    const candidate = jobCardInput.trim()
    if (!candidate) {
      showToast("Enter or scan a job card number, barcode alias, customer, or order reference", "error")
      return
    }
    const match = normalizedJobOptions.find((job: any) => {
      const haystack = [
        String(job.id || ""),
        String(job.ref || ""),
        String(job.customer_name || ""),
        String(job.sales_order_id || ""),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(candidate.toLowerCase())
    })
    setJobCardId(String(match?.id || candidate))
    setJobCardInput(String(match?.ref || candidate))
  }

  const loadScanned = (value: string) => {
    const id = jobCardIdFromScan(value)
    const match = normalizedJobOptions.find((job: any) => String(job.id) === id || String(job.ref).toLowerCase() === id.toLowerCase())
    setJobCardId(String(match?.id || id))
    setJobCardInput(String(match?.ref || id))
    showToast(`Loaded ${match?.ref || "job card"} from scan.`, "success")
  }
  const selectedJob = normalizedJobOptions.find((job: any) => String(job.id) === jobCardId)
  const readyJobs = normalizedJobOptions.filter((job: any) => job.planner_gate_ready !== false && !job.blocked_reason)
  const blockedJobs = normalizedJobOptions.filter((job: any) => job.planner_gate_ready === false || job.blocked_reason)

  return (
    <div className="space-y-5">
      <PageHeader
        badge="Shop floor"
        title="Stage entry"
        description="Scan or pick a planned job card, confirm the pre-filled setup, and enter only what happened on the floor: times, counts, measurements and rejects."
      />

      <section className="erp-panel no-print rounded-xl p-4" aria-label="Load job card">
        {activePlant === "ALL" ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[13px] text-signal-amber-ink">
            <span className="flex-1">You&apos;re viewing all plants. Choose the plant you are entering for.</span>
            <select aria-label="Write plant" value={writePlant} onChange={(event) => setWritePlant(event.target.value)} className="h-8 rounded-md border border-signal-amber-line bg-card px-2 text-[13px] text-foreground">
              <option value="">Select plant</option>
              {allowedPlants.map((plantId: string) => <option key={plantId} value={plantId}>{plantId}</option>)}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 shadow-[var(--shadow-xs)] focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15">
            <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="sr-only">Job card number or scan</span>
            <input
              data-testid="supervisor-entry:job-card-input"
              value={jobCardInput}
              onChange={(event) => setJobCardInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (/\/production\//.test(jobCardInput)) loadScanned(jobCardInput); else handleLoadByScannerInput() } }}
              placeholder="Scan the job card QR, or type JC number / customer / order"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] shadow-none outline-none focus:shadow-none"
              autoFocus
              disabled={!effectiveWritePlant}
            />
          </label>
          <div className="flex gap-2">
            <button data-testid="supervisor-entry:load" onClick={handleLoadByScannerInput} className="erp-btn-primary !h-12 flex-1 !px-5 sm:flex-none" disabled={!effectiveWritePlant}>
              <Search className="h-4 w-4" />
              Load
            </button>
            <QrScanner onScan={loadScanned} label="Camera" title="Scan job card" hint="Point the camera at the QR on the printed job card." className="erp-btn-secondary !h-12 flex-1 sm:flex-none" />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-semibold">Planned for the floor <span className="font-normal text-muted-foreground">· {readyJobs.length} ready{blockedJobs.length ? ` · ${blockedJobs.length} blocked` : ""}</span></p>
              <input
                data-testid="supervisor-entry:search"
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="Filter…"
                aria-label="Filter job cards"
                className="h-8 w-40 rounded-md border border-input bg-card px-2.5 text-[12.5px]"
              />
            </div>
            <div className="grid max-h-60 gap-1.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
              {normalizedJobOptions.map((job: any) => {
                const blocked = job.planner_gate_ready === false || Boolean(job.blocked_reason)
                return (
                  <button
                    key={job.id}
                    data-testid={`supervisor-entry:select:${job.id}`}
                    onClick={() => { setJobCardId(job.id); setJobCardInput(job.ref) }}
                    title={blocked ? job.blocked_reason || job.planner_gate_reason : undefined}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${jobCardId === job.id ? "border-primary/50 bg-primary/[.06] shadow-[0_0_0_3px_hsl(var(--primary)/.08)]" : "border-border bg-card hover:border-input hover:bg-muted/60"}`}
                    disabled={!effectiveWritePlant}
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${blocked ? "bg-signal-rose-ink" : "bg-signal-emerald-ink"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{job.ref}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{String(job.current_stage || "").toLowerCase()} · {job.customer_name || "—"}</span>
                      {blocked ? <span className="block truncate text-[11px] text-signal-rose-ink">{job.blocked_reason || job.planner_gate_reason}</span> : null}
                    </span>
                  </button>
                )
              })}
              {selectedJobOptions.length === 0 ? <p className="col-span-full px-3 py-6 text-center text-[13px] text-muted-foreground">No job cards found</p> : null}
            </div>
          </div>
          <aside className="rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3 text-[12.5px] leading-5 text-muted-foreground">
            <p className="mb-1.5 font-semibold text-foreground">What you enter here</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Machine, shift, spec, mandrel, order and packing come pre-filled from planning.</li>
              <li>Enter actual times, counts, measurements, rejects and sign.</li>
              <li>A card opens for entry once its stage is planned within the next 3 days.</li>
            </ul>
            {selectedJob ? <p className="mt-2 rounded-md bg-card px-2 py-1.5 text-foreground">Loaded <strong>{selectedJob.ref}</strong> · {String(selectedJob.current_stage || "").toLowerCase()}</p> : null}
          </aside>
        </div>
      </section>

      {!effectiveWritePlant ? (
        <div className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-sm text-signal-amber-ink">
          Select one plant before opening supervisor-stage data entry.
        </div>
      ) : (
        <JobCardDocument jobCardId={jobCardId} mode="supervisor" />
      )}
    </div>
  )
}

export default function SupervisorEntryPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading supervisor entry...</div>}>
      <SupervisorEntryPageContent />
    </Suspense>
  )
}
