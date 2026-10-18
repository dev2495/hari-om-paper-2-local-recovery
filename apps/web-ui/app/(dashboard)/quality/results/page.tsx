"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useMemo, useState } from "react"
import { ArrowUpRight, ChevronDown, Factory, LockKeyhole, PackageX, Search, ShieldCheck } from "lucide-react"

import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { Field, fieldClass } from "@/components/procurement/procurement-shell"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useInventoryQualityInspections, usePendingInventoryQuality } from "@/hooks/use-inventory"
import { useCreateQualityHold, usePlanningJobCards, useQualityHolds, useQualityInspections, useReleaseQualityHold } from "@/hooks/use-production"
import { cn } from "@/lib/utils"

const asArray = (value: any) => (Array.isArray(value) ? value : [])
const stamp = (value?: string) => value ? new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"
const fmt = (value: any) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
const stageLabel = (value?: string) => ({ WINDER: "Winding", OVEN: "Oven", PROCESS: "Process", QC: "Final QC", PACKING: "Packing" } as Record<string, string>)[String(value || "")] || value || "Stage"
const errorText = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}
const resultTone = (status: string) => status === "PASS" || status === "OBSERVATION_ONLY" ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : status === "FAIL" ? "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" : "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line"
const LOT_STATE: Record<string, { label: string; next: string; tone: string }> = {
  FAILED: { label: "Out of tolerance — held", next: "Decide: re-inspect, accept under concession, or reject", tone: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" },
  REJECTED: { label: "Rejected", next: "Return to supplier or accept under concession", tone: "bg-signal-rose-soft text-signal-rose-ink ring-signal-rose-line" },
  COMMERCIAL_HOLD: { label: "QC passed · commercial hold", next: "Purchase clears the invoice / rate difference", tone: "bg-signal-amber-soft text-signal-amber-ink ring-signal-amber-line" },
}
const EMPTY_RELEASE = { reason: "", disposition: "RELEASE_AS_IS", affected_qty: "" }

export default function HoldsAndInspectionsPage() {
  return <Suspense fallback={<LoadingState label="Loading holds…" />}><HoldsAndInspections /></Suspense>
}

function HoldsAndInspections() {
  const params = useSearchParams()
  const focusCard = params.get("card") || ""
  const { showToast } = useApp()
  const { activePlant, user } = useAuth()
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  // A failed batch is held for the plant head / Admin / Owner to decide (client rule 2026-10-18).
  const canDecideHolds = ["Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  const canRaiseHolds = canDecideHolds || ["QC", "InProcessQC"].some((role) => roles.has(role))
  const canResolveLots = ["Owner", "Admin", "PlantManager", "QC", "InwardQC"].some((role) => roles.has(role))
  const incomingOnly = roles.has("InwardQC") && !["QC", "Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  const [tab, setTab] = useState<"inward" | "jobs" | "register">(params.get("tab") === "jobs" ? "jobs" : params.get("tab") === "register" ? "register" : "inward")
  const [search, setSearch] = useState("")
  const [source, setSource] = useState<"all" | "inward" | "process">("all")
  const [result, setResult] = useState<"all" | "PASS" | "FAIL">("all")
  const [registerPage, setRegisterPage] = useState(0)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [release, setRelease] = useState(EMPTY_RELEASE)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState({ job: "", stage: "WINDER", reason: "" })

  const pending = usePendingInventoryQuality()
  const incoming = useInventoryQualityInspections({ limit: 100 })
  const production = useQualityInspections({ limit: 150 })
  const holdsQuery = useQualityHolds({ limit: 150 })
  const jobCards = usePlanningJobCards({ limit: 300 })
  const createHold = useCreateQualityHold()
  const releaseHold = useReleaseQualityHold()

  const jobs = asArray(jobCards.data)
  const jobMap = useMemo(() => new Map(jobs.map((job: any) => [String(job.id), job])), [jobs])
  const jobLabel = (id: string) => { const job: any = jobMap.get(String(id)); return job ? `${job.job_card_no || String(id).slice(0, 8)}${job.customer_name ? ` · ${job.customer_name}` : ""}` : `Job ${String(id).slice(0, 8)}` }
  // QC holds only: a lot that passed QC but waits on purchase (commercial) is not a QC hold.
  const heldLots = asArray(pending.data).filter((row: any) => ["FAILED", "REJECTED"].includes(String(row.queue_state || "")))
  const commercialLots = asArray(pending.data).filter((row: any) => row.queue_state === "COMMERCIAL_HOLD")
  const jobHolds = asArray(holdsQuery.data).filter((hold: any) => String(hold.status || "").toUpperCase() === "HOLD")
    .sort((a: any, b: any) => Number(String(b.job_card_id) === focusCard) - Number(String(a.job_card_id) === focusCard))
  const register = useMemo(() => [
    ...asArray(incoming.data).map((row: any) => ({ ...row, kind: "inward", title: row.entity_label || `${String(row.material_type || "").replace(/_/g, " ").toLowerCase()} lot`, where: "Incoming" })),
    ...asArray(production.data).map((row: any) => ({ ...row, kind: "process", title: jobLabel(String(row.job_card_id || "")), where: stageLabel(row.stage_type) })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [incoming.data, production.data, jobMap]) // eslint-disable-line react-hooks/exhaustive-deps
  const filteredRegister = register.filter((row: any) => (source === "all" || row.kind === source) && (result === "all" || (result === "PASS" ? ["PASS", "OBSERVATION_ONLY"].includes(row.status) : row.status === result))
    && `${row.title} ${row.where} ${row.created_by || ""}`.toLowerCase().includes(search.toLowerCase()))
  const measured = register.filter((row: any) => ["PASS", "FAIL"].includes(row.status))
  const passRate = measured.length ? Math.round((100 * measured.filter((row: any) => row.status === "PASS").length) / measured.length) : null

  const plantFor = (jobId: string) => {
    const job: any = jobMap.get(String(jobId))
    const value = String(job?.plant_id || "").trim()
    if (value && value.toUpperCase() !== "ALL") return value
    return activePlant && activePlant.toUpperCase() !== "ALL" ? activePlant : undefined
  }
  const doRelease = async (hold: any) => {
    const plantId = plantFor(String(hold.job_card_id || ""))
    if (!plantId) return showToast("Switch to the job card's plant before releasing its hold.", "error")
    if (release.reason.trim().length < 3) return showToast("Say why the hold can be released and what was done with the material.", "error")
    try {
      await releaseHold.mutateAsync({ holdId: String(hold.id), plantId, data: { reason: release.reason.trim(), disposition: release.disposition, affected_qty: release.affected_qty ? Number(release.affected_qty) : undefined } })
      setReleasing(null); setRelease(EMPTY_RELEASE)
      showToast("Hold released.", "success")
    } catch (error: any) { showToast(errorText(error, "Hold release failed."), "error") }
  }
  const doManualHold = async (event: FormEvent) => {
    event.preventDefault()
    const plantId = plantFor(manual.job)
    if (!manual.job || !manual.reason.trim()) return showToast("Choose the job card and give the reason for the hold.", "error")
    if (!plantId) return showToast("Switch to the job card's plant first.", "error")
    try {
      await createHold.mutateAsync({ plantId, data: { job_card_id: manual.job, stage_type: manual.stage, reason: manual.reason.trim() } })
      setManual({ job: "", stage: "WINDER", reason: "" }); setManualOpen(false)
      showToast("Job card put on QC hold.", "success")
    } catch (error: any) { showToast(errorText(error, "Hold could not be created."), "error") }
  }

  const tabs = [
    { key: "inward" as const, label: "Inward lots on hold", count: heldLots.length, icon: PackageX },
    ...(incomingOnly ? [] : [{ key: "jobs" as const, label: "Job cards on hold", count: jobHolds.length, icon: Factory }]),
    { key: "register" as const, label: "All inspections", count: register.length, icon: ShieldCheck },
  ]

  return (
    <RoleGate allow={["QC", "InwardQC", "InProcessQC", "PlantManager", "Store", "Dispatch", "Sales"]}>
      <div className="space-y-5" data-testid="quality-results-page">
        <PageHeader title="Holds & inspections" description="Everything QC has stopped, in one place: inward lots outside their band and job-card batches that failed a stage check — with the decision each one needs — plus every inspection recorded." />
        <QualityDeskNav />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Inward lots on hold", value: pending.isLoading ? "…" : heldLots.length, tone: heldLots.length ? "text-signal-rose-ink" : "" },
            { label: "Job-card holds", value: holdsQuery.isLoading ? "…" : jobHolds.length, tone: jobHolds.length ? "text-signal-rose-ink" : "" },
            { label: "Inspections loaded", value: register.length, tone: "" },
            { label: "Pass rate (loaded)", value: passRate == null ? "—" : `${passRate}%`, tone: "" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-card p-3.5"><p className="text-[12px] font-semibold text-muted-foreground">{kpi.label}</p><p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", kpi.tone)}>{kpi.value}</p></div>
          ))}
        </div>

        <div role="tablist" aria-label="Holds and inspections" className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/60 p-1">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors", tab === item.key ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
              <item.icon className="h-4 w-4" aria-hidden="true" />{item.label}<span className={cn("rounded-full px-1.5 text-[11.5px]", item.count && item.key !== "register" ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-muted text-muted-foreground")}>{item.count}</span>
            </button>
          ))}
        </div>

        {tab === "inward" ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="inward-holds">
            <header className="border-b border-border px-4 py-3"><h2 className="font-semibold">Inward lots on hold</h2><p className="text-[12.5px] text-muted-foreground">A lot is held only when a reading is outside its band (set in Masters). It cannot be issued until QC decides.{commercialLots.length ? ` ${commercialLots.length} other lot${commercialLots.length === 1 ? "" : "s"} passed QC and wait${commercialLots.length === 1 ? "s" : ""} only on purchase (invoice / rate).` : ""}</p></header>
            {pending.isLoading ? <LoadingState label="Loading held lots…" /> : pending.isError ? <ErrorState message="Held lots could not be loaded. This is not an empty list." onRetry={() => pending.refetch()} /> : heldLots.length ? (
              <div className="overflow-x-auto">
                <table className="tube-grid w-full min-w-[820px]">
                  <thead><tr><th>Lot / material</th><th>Supplier · GRN</th><th>Quantity</th><th>Outside band</th><th>State</th><th className="text-right">Next step</th></tr></thead>
                  <tbody>
                    {heldLots.map((row: any) => {
                      const state = LOT_STATE[row.queue_state] || LOT_STATE.FAILED
                      return (
                        <tr key={`${row.entity_type}:${row.entity_id}`}>
                          <td><p className="font-medium">{row.label}</p><p className="text-[12px] text-muted-foreground">{String(row.material_type || "").replace(/_/g, " ").toLowerCase()}</p></td>
                          <td><p>{row.supplier_or_customer || "—"}</p><p className="text-[12px] text-muted-foreground">{[row.grn_no, row.po_no].filter(Boolean).join(" · ") || "—"}</p></td>
                          <td className="whitespace-nowrap tabular-nums">{fmt(row.qty)} {row.uom || "KG"}</td>
                          <td className="text-[12.5px]">{row.last_inspection?.failures?.length ? row.last_inspection.failures.join(", ") : "—"}<p className="text-[11.5px] text-muted-foreground">{row.last_inspection ? `${stamp(row.last_inspection.created_at)} · ${row.last_inspection.created_by || ""}` : ""}</p></td>
                          <td><span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", state.tone)}>{state.label}</span></td>
                          <td className="text-right">
                            <p className="mb-1.5 text-[12px] text-muted-foreground">{state.next}</p>
                            {canResolveLots && row.queue_state !== "COMMERCIAL_HOLD" ? <Link className="erp-btn-primary !h-9" href={`/quality/incoming?lot=${row.entity_type}:${row.entity_id}`}>Decide<ArrowUpRight className="h-3.5 w-3.5" /></Link> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="px-6 py-10 text-center"><ShieldCheck className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" /><p className="font-semibold">No inward lot is on hold</p><p className="mt-1 text-sm text-muted-foreground">Lots inside their bands were released on inspection.</p></div>}
          </section>
        ) : null}

        {tab === "jobs" ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="job-holds">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">Job cards on hold</h2><p className="text-[12.5px] text-muted-foreground">A batch that fails its stage QC is held and the plant head, Admin and Owner are notified to decide. The next stage cannot take it; other batches on the card keep moving.</p></div>
              {canRaiseHolds ? <button type="button" className="erp-btn-secondary !h-9" onClick={() => setManualOpen(!manualOpen)}><LockKeyhole className="h-4 w-4" />Put a job card on hold</button> : null}
            </header>
            {manualOpen ? (
              <form className="grid gap-3 border-b border-border bg-muted/30 p-4 md:grid-cols-[minmax(0,1.3fr)_10rem_minmax(0,1.5fr)_auto] md:items-end" onSubmit={doManualHold}>
                <Field label="Job card"><select className={fieldClass} value={manual.job} onChange={(e) => setManual({ ...manual, job: e.target.value })}><option value="">Choose</option>{jobs.filter((job: any) => !["COMPLETED", "CLOSED", "CANCELLED"].includes(String(job.status))).slice(0, 150).map((job: any) => <option key={job.id} value={job.id}>{jobLabel(String(job.id))}</option>)}</select></Field>
                <Field label="Stage"><select className={fieldClass} value={manual.stage} onChange={(e) => setManual({ ...manual, stage: e.target.value })}>{["WINDER", "OVEN", "PROCESS", "QC"].map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></Field>
                <Field label="Reason"><input className={fieldClass} value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} /></Field>
                <button type="submit" className="erp-btn-primary" disabled={createHold.isPending}>Hold</button>
              </form>
            ) : null}
            {holdsQuery.isLoading ? <LoadingState label="Loading holds…" /> : holdsQuery.isError ? <ErrorState message="Holds could not be loaded. This is not an empty list." onRetry={() => holdsQuery.refetch()} /> : jobHolds.length ? (
              <ul className="divide-y divide-border">
                {jobHolds.map((hold: any) => (
                  <li key={hold.id} className={cn("px-4 py-3", String(hold.job_card_id) === focusCard && "bg-signal-amber-soft/40")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{stageLabel(hold.stage_type)} · <Link className="text-primary hover:underline" href={`/production/job-cards/${hold.job_card_id}`}>{jobLabel(String(hold.job_card_id))}</Link></p>
                        <p className="text-[12.5px] text-muted-foreground">{hold.reason} · since {stamp(hold.created_at)}{hold.created_by ? ` · ${hold.created_by}` : ""}</p>
                        <p className="mt-1 text-[12.5px] font-medium text-signal-amber-ink">{canDecideHolds ? "Your decision: release as is, after rework or sorting, or with part scrapped." : "Waiting for the plant head / Admin / Owner to decide."}</p>
                      </div>
                      <div className="flex gap-2">
                        <Link className="erp-btn-secondary !h-9" href={`/production/job-cards/${hold.job_card_id}`}>Open card<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                        {canDecideHolds ? <button type="button" className={releasing === String(hold.id) ? "erp-btn-secondary !h-9" : "erp-btn-primary !h-9"} onClick={() => { setRelease(EMPTY_RELEASE); setReleasing(releasing === String(hold.id) ? null : String(hold.id)) }}>{releasing === String(hold.id) ? "Cancel" : "Decide…"}</button> : null}
                      </div>
                    </div>
                    {releasing === String(hold.id) ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 md:grid-cols-[minmax(0,1fr)_12rem_8rem_auto] md:items-end" data-testid="hold-release-form">
                        <Field label="Why it can be released"><input className={fieldClass} value={release.reason} onChange={(e) => setRelease({ ...release, reason: e.target.value })} /></Field>
                        <Field label="Decision"><select className={fieldClass} value={release.disposition} onChange={(e) => setRelease({ ...release, disposition: e.target.value })}><option value="RELEASE_AS_IS">Release as is (use it)</option><option value="REWORKED">Reworked, now OK</option><option value="SORTED">Sorted / segregated, good part released</option><option value="PARTLY_SCRAPPED">Part scrapped, rest released</option></select></Field>
                        <Field label="Qty affected" hint="optional"><input className={fieldClass} type="number" min={0} value={release.affected_qty} onChange={(e) => setRelease({ ...release, affected_qty: e.target.value })} /></Field>
                        <button type="button" className="erp-btn-primary" disabled={releaseHold.isPending} onClick={() => void doRelease(hold)}>Record decision &amp; release</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <div className="px-6 py-10 text-center"><ShieldCheck className="mx-auto mb-2 h-7 w-7 text-signal-emerald-ink" aria-hidden="true" /><p className="font-semibold">No job card is on QC hold</p></div>}
          </section>
        ) : null}

        {tab === "register" ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="inspection-register">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><input className="w-full bg-transparent text-sm outline-none" placeholder="Lot, job card, stage, inspector…" aria-label="Search inspections" value={search} onChange={(e) => { setSearch(e.target.value); setRegisterPage(0) }} /></label>
              <select className={cn(fieldClass, "w-auto")} aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value as any); setRegisterPage(0) }}><option value="all">Inward + in-process</option><option value="inward">Inward only</option><option value="process">In-process only</option></select>
              <select className={cn(fieldClass, "w-auto")} aria-label="Result" value={result} onChange={(e) => { setResult(e.target.value as any); setRegisterPage(0) }}><option value="all">Any result</option><option value="PASS">Pass</option><option value="FAIL">Fail</option></select>
            </div>
            {incoming.isLoading || production.isLoading ? <LoadingState label="Loading inspections…" /> : incoming.isError || production.isError ? <ErrorState message="Inspections could not be loaded." onRetry={() => { void incoming.refetch(); void production.refetch() }} /> : filteredRegister.length ? (
              <>
                <ul className="divide-y divide-border">
                  {filteredRegister.slice(registerPage * 30, registerPage * 30 + 30).map((row: any) => {
                    const key = `${row.kind}:${row.id}`
                    const readings = row.kind === "inward" ? Object.entries(row.readings || {}) : asArray(row.readings?.samples).flatMap((sample: any, index: number) => Object.entries(sample.readings || {}).map(([code, value]) => [`S${index + 1} ${code}`, value]))
                    return (
                      <li key={key}>
                        <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40" onClick={() => setOpenRow(openRow === key ? null : key)} aria-expanded={openRow === key}>
                          <span className="w-28 shrink-0 text-[12px] text-muted-foreground">{stamp(row.created_at)}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                          <span className="w-24 text-[12.5px] text-muted-foreground">{row.where}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset", resultTone(row.status))}>{row.status === "OBSERVATION_ONLY" ? "PASS" : row.status}</span>
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", openRow === key && "rotate-180")} aria-hidden="true" />
                        </button>
                        {openRow === key ? (
                          <div className="grid gap-3 border-t border-border bg-muted/20 px-4 py-3 text-[12.5px] sm:grid-cols-2">
                            <dl className="space-y-1">{readings.length ? readings.map(([code, value]: any) => <div key={code} className="flex justify-between gap-3"><dt className="text-muted-foreground">{String(code).replace(/_/g, " ")}</dt><dd className="font-medium tabular-nums">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>) : <p className="text-muted-foreground">No readings stored.</p>}</dl>
                            <div className="space-y-1"><p><span className="text-muted-foreground">Inspector:</span> {row.created_by || "—"}</p><p><span className="text-muted-foreground">Decision:</span> {row.disposition || "Measured result"}</p>{row.notes ? <p><span className="text-muted-foreground">Notes:</span> {row.notes}</p> : null}{asArray(row.failures).length ? <p className="text-signal-rose-ink">Outside band: {asArray(row.failures).map((f: any) => f.label || f.code || f.parameter).filter(Boolean).join(", ")}</p> : null}</div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
                {filteredRegister.length > 30 ? <div className="flex justify-end gap-3 border-t border-border p-3 text-sm"><button className="erp-btn-secondary !h-9" disabled={!registerPage} onClick={() => setRegisterPage(registerPage - 1)}>Previous</button><span className="self-center">{registerPage * 30 + 1}–{Math.min(registerPage * 30 + 30, filteredRegister.length)} of {filteredRegister.length}</span><button className="erp-btn-secondary !h-9" disabled={registerPage * 30 + 30 >= filteredRegister.length} onClick={() => setRegisterPage(registerPage + 1)}>Next</button></div> : null}
              </>
            ) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">No inspections match.</p>}
          </section>
        ) : null}

        <p className="text-[12.5px] text-muted-foreground">Customer complaints and returns are followed on <Link className="font-semibold text-primary hover:underline" href="/quality/returns">Customer complaints</Link>.</p>
      </div>
    </RoleGate>
  )
}
