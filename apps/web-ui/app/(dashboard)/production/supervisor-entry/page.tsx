"use client"

import { Search } from "lucide-react"
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

  return (
    <div className="space-y-5">
      <section className="page-hero">
        <h1 className="page-title">Supervisor Paper-to-ERP Entry</h1>
        <p className="page-subtitle">
          Supervisors load a planned card, confirm the auto-filled setup, and enter only actual run data from the floor sheet.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr] no-print">
        <div className="erp-panel p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-slate-900">Load Job Card</h2>
          {activePlant === "ALL" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Global reads are enabled. Choose one plant below before opening supervisor-stage entry for saving.
            </div>
          ) : null}
          {activePlant === "ALL" ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Write Plant</label>
              <select value={writePlant} onChange={(event) => setWritePlant(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                <option value="">Select one plant for supervisor entry</option>
                {allowedPlants.map((plantId: string) => (
                  <option key={plantId} value={plantId}>
                    {plantId}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              data-testid="supervisor-entry:job-card-input"
              value={jobCardInput}
              onChange={(event) => setJobCardInput(event.target.value)}
              placeholder="Scan / paste job card number, barcode alias, customer, or order reference"
              className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
              autoFocus
              disabled={!effectiveWritePlant}
            />
            <button data-testid="supervisor-entry:load" onClick={handleLoadByScannerInput} className="erp-btn-primary h-10" disabled={!effectiveWritePlant}>
              <Search className="h-4 w-4" />
              Load
            </button>
          </div>

          <div className="mt-3">
            <input
              data-testid="supervisor-entry:search"
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Search by customer / job card number / order"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {normalizedJobOptions.map((job: any) => (
                <button
                  key={job.id}
                  data-testid={`supervisor-entry:select:${job.id}`}
                  onClick={() => {
                    setJobCardId(job.id)
                    setJobCardInput(job.ref)
                  }}
                  className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                    jobCardId === job.id ? "bg-cyan-50" : ""
                  }`}
                  disabled={!effectiveWritePlant}
                >
                  <span>
                    <span className="font-semibold text-slate-900">{job.ref}</span>
                    <span className="text-slate-500"> · {job.customer_name || "Unknown customer"}</span>
                  </span>
                  <span className="text-xs text-slate-500">{job.status}</span>
                </button>
              ))}
              {selectedJobOptions.length === 0 && (
                <p className="px-3 py-3 text-sm text-slate-500">No job cards found</p>
              )}
            </div>
          </div>
        </div>

        <div className="erp-panel p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-slate-900">Fast Entry Rules</h2>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              Machine, shift, spec, mandrel, customer, order, parchment, and packaging all come from planning plus the approved setup snapshot.
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              Supervisors should only fill actual times, counts, measurements, reject reasons, and signatures.
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              A released job becomes floor-executable only after planner schedules its active stage into the next three days with a machine and shift.
            </div>
          </div>
        </div>
      </section>

      {!effectiveWritePlant ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading supervisor entry...</div>}>
      <SupervisorEntryPageContent />
    </Suspense>
  )
}
