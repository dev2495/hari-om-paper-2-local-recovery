"use client"

import dayjs from "dayjs"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ClipboardCheck,
  Boxes,
  Factory,
  GitBranch,
  PackageCheck,
  ScanLine,
  Search,
  ShieldCheck,
  SquareSplitHorizontal,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"

import {
  EmptyState,
  ExecutiveHero,
  MetricCard,
  MetricRail,
  Panel,
  StatusBadge,
} from "@/components/erp/shell"
import {
  useJobCardGenealogy,
  usePlanningJobCards,
} from "@/hooks/use-production"
import {
  useInventoryGenealogyExceptions,
  useReelIssues,
  useReels,
  useReelScans,
} from "@/hooks/use-inventory"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function asArray(value: any) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.rows)) return value.rows
  if (Array.isArray(value?.ledger)) return value.ledger
  return []
}

function kg(value: any) {
  return `${Number(value || 0).toFixed(2)} kg`
}

function readableDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM YYYY, HH:mm") : String(value)
}

function compactId(value?: string | null) {
  const text = String(value || "")
  return text.length > 12 ? text.slice(0, 10) : text || "-"
}

function refText(prefix: string, value?: string | null) {
  const text = String(value || "")
  return text ? `${prefix}-${text.replaceAll("-", "").slice(0, 8).toUpperCase()}` : "-"
}

function metadataText(value: any) {
  if (!value || typeof value !== "object") return "-"
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
    .slice(0, 4)
  if (!entries.length) return "-"
  return entries.map(([key, entryValue]) => `${key}: ${entryValue}`).join(" | ")
}

export default function InventoryGenealogyPage() {
  const searchParams = useSearchParams()
  const urlJobCardId = searchParams.get("job_card_id") || ""
  const [jobSearch, setJobSearch] = useState("")
  const [selectedJobCardId, setSelectedJobCardId] = useState("")
  const [search, setSearch] = useState("")
  const [selectedReelId, setSelectedReelId] = useState("")
  const deferredJobSearch = useDeferredValue(jobSearch.trim().toLowerCase())
  const deferredSearch = useDeferredValue(search.trim())

  const jobCardsQuery = usePlanningJobCards({ limit: 120 }, true)
  const genealogyQuery = useJobCardGenealogy(selectedJobCardId)
  const reelsQuery = useReels({ search: deferredSearch || undefined, limit: 101 })
  const issuesQuery = useReelIssues(
    selectedReelId ? { reel_id: selectedReelId, limit: 120 } : { limit: 20 },
    Boolean(selectedReelId),
  )
  const scansQuery = useReelScans(selectedReelId, { limit: 120 }, Boolean(selectedReelId))
  const exceptionsQuery = useInventoryGenealogyExceptions()

  const jobCards = useMemo(() => {
    const rows = asArray(jobCardsQuery.data)
    if (!deferredJobSearch) return rows
    return rows.filter((row: any) => {
      const haystack = [
        row.id,
        row.job_card_ref,
        row.product_code,
        row.status,
        row.current_stage,
        row.sales_order_ref,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(deferredJobSearch)
    })
  }, [jobCardsQuery.data, deferredJobSearch])
  const selectedJob = jobCards.find((row: any) => String(row.id) === selectedJobCardId) || null
  const genealogy = genealogyQuery.data || {}
  const flowSteps = useMemo(() => asArray(genealogy.flow_steps), [genealogy.flow_steps])
  const flowGaps = useMemo(() => asArray(genealogy.gaps), [genealogy.gaps])
  const genealogyStages = useMemo(() => asArray(genealogy.stages), [genealogy.stages])
  const genealogyReelIssues = useMemo(() => asArray(genealogy.materials?.reel_issues), [genealogy.materials])
  const genealogyShiftLedgers = useMemo(() => asArray(genealogy.materials?.shift_ledgers), [genealogy.materials])
  const materialProofCount = genealogyReelIssues.length + genealogyShiftLedgers.length
  const completedFlowSteps = flowSteps.filter((step: any) => String(step.status).toUpperCase() === "COMPLETE").length
  const activeHoldCount = Number(genealogy.quality?.active_hold_count || 0)
  const fgLedgerCount = asArray(genealogy.fg_inventory?.production_ledger).length + asArray(genealogy.fg_inventory?.dispatch_ledger).length
  const reelWindow = useMemo(() => asArray(reelsQuery.data), [reelsQuery.data])
  const reels = reelWindow.slice(0, 100)
  const hasMoreReels = reelWindow.length > 100
  const selectedReel = reels.find((row: any) => String(row.id) === selectedReelId) || null
  const linkedIssues = useMemo(() => asArray(issuesQuery.data), [issuesQuery.data])
  const scans = useMemo(() => asArray(scansQuery.data), [scansQuery.data])
  const exceptions = useMemo(() => {
    const payload: any = exceptionsQuery.data || {}
    return asArray(payload.rows || payload.items || payload)
  }, [exceptionsQuery.data])

  useEffect(() => {
    if (urlJobCardId && !selectedJobCardId) {
      setSelectedJobCardId(urlJobCardId)
    }
  }, [selectedJobCardId, urlJobCardId])

  useEffect(() => {
    if (!urlJobCardId && !selectedJobCardId && jobCards.length > 0) {
      setSelectedJobCardId(String(jobCards[0].id))
    }
  }, [jobCards, selectedJobCardId, urlJobCardId])

  useEffect(() => {
    if (!selectedReelId && reels.length > 0) {
      setSelectedReelId(String(reels[0].id))
    }
  }, [reels, selectedReelId])

  const childScanCount = scans.filter((event: any) => String(event.event_type || "").toUpperCase() === "SLIT_SCAN").length
  const issuedKg = linkedIssues.reduce((sum: number, issue: any) => sum + Number(issue.issued_weight_kg || 0), 0)
  const consumedKg = linkedIssues.reduce((sum: number, issue: any) => sum + Number(issue.consumed_weight_kg || 0), 0)

  const genealogyNodes = [
    {
      label: "Inward reel",
      value: selectedReel?.reel_code || "No reel selected",
      detail: selectedReel ? `${kg(selectedReel.inward_weight_kg)} received from ${selectedReel.supplier_name || "supplier not captured"}` : "Select a reel to load lineage.",
      icon: Boxes,
    },
    {
      label: "Slitting lineage",
      value: childScanCount ? `${childScanCount} slit event(s)` : selectedReel?.parent_reel_id ? "Child reel" : "No slit event",
      detail: selectedReel?.parent_reel_id ? `Parent ${compactId(selectedReel.parent_reel_id)}` : "Parent and child relationships are read from reel genealogy metadata.",
      icon: SquareSplitHorizontal,
    },
    {
      label: "Production issue",
      value: linkedIssues.length ? `${linkedIssues.length} issue(s)` : "No issue",
      detail: `${kg(issuedKg)} issued, ${kg(consumedKg)} consumed against this reel.`,
      icon: Factory,
    },
    {
      label: "Scan proof",
      value: scans.length ? `${scans.length} event(s)` : "No scans",
      detail: "Inward, issue, close, move, and slit scans form the audit timeline.",
      icon: ScanLine,
    },
    {
      label: "FG and dispatch bridge",
      value: linkedIssues.some((issue: any) => String(issue.status).toUpperCase() === "CLOSED") ? "Consumption closed" : "WIP open",
      detail: "Closed issue consumption feeds production truth and then FG/dispatch tracking.",
      icon: PackageCheck,
    },
  ]

  return (
    <div className="space-y-6" data-testid="genealogy:page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.inventory}
        badge="Full Genealogy"
        title="Sales-to-dispatch genealogy with job output, quality, FG, and reel proof."
        description="Trace one job from sales release to planner schedule, production output logs, quality hold/inspection, packed FG stock, dispatch, sales fulfillment, and material reel consumption."
        aside={
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
              <GitBranch className="h-3.5 w-3.5" />
              Active Trace
            </div>
            <p className="text-2xl font-semibold tracking-tight">{selectedJob ? refText("JC", selectedJob.id) : "Select job card"}</p>
            <p className="text-sm text-slate-200/80">
              {selectedJob ? `${selectedJob.status || "status"} at ${selectedJob.current_stage || "stage"}. Reel drilldown is below.` : "Select a job card to load the full chain."}
            </p>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Flow Complete" value={`${completedFlowSteps}/${flowSteps.length || 7}`} detail="Sales, planner, output, quality, FG, dispatch" icon={ClipboardCheck} tone="emerald" />
        <MetricCard label="Quality Holds" value={activeHoldCount} detail={activeHoldCount ? "Blocks dispatch seal" : "No active hold on selected job"} icon={ShieldCheck} tone={activeHoldCount ? "rose" : "slate"} />
        <MetricCard label="FG Ledger Proof" value={fgLedgerCount} detail="Inward and dispatch inventory rows" icon={PackageCheck} tone="cyan" />
        <MetricCard label="Trace Gaps" value={flowGaps.length + exceptions.length} detail="Job gaps plus material exceptions" icon={AlertTriangle} tone={flowGaps.length || exceptions.length ? "rose" : "slate"} />
      </MetricRail>

      <Panel
        title="Job-card genealogy"
        subtitle="This is the core client audit chain: sales order, release, planner, output logs, quality, packed FG, dispatch, and sales close."
        actions={
          <div className="flex min-w-[19rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Search job, status, product..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
        }
      >
        <div className="grid gap-5 xl:grid-cols-[22rem_1fr]">
          <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
            {jobCardsQuery.isLoading ? (
              <EmptyState label="Loading job-card trace window..." />
            ) : jobCards.length === 0 ? (
              <EmptyState label="No job cards matched this search." />
            ) : (
              jobCards.slice(0, 80).map((job: any) => {
                const selected = String(job.id) === selectedJobCardId
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobCardId(String(job.id))}
                    className={`w-full rounded-[1.25rem] border p-4 text-left transition-all duration-200 ${
                      selected
                        ? "border-slate-950 bg-slate-950 text-white shadow-[0_18px_35px_rgba(15,23,42,0.18)]"
                        : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{refText("JC", job.id)}</p>
                        <p className={`mt-1 text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>
                          {job.product_code || "Product not captured"}
                        </p>
                      </div>
                      <StatusBadge value={job.status} />
                    </div>
                    <div className={`mt-4 grid grid-cols-2 gap-2 text-xs ${selected ? "text-slate-300" : "text-slate-600"}`}>
                      <span>Stage {job.current_stage || "-"}</span>
                      <span>Qty {Number(job.released_qty || job.planned_qty || 0).toLocaleString("en-IN")}</span>
                      <span>SO {compactId(job.sales_order_id)}</span>
                      <span>Release {compactId(job.release_lot_id)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="space-y-5">
            {genealogyQuery.isLoading ? (
              <EmptyState label="Loading sales-to-dispatch genealogy..." />
            ) : !selectedJobCardId ? (
              <EmptyState label="Select a job card to see the complete genealogy." />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                  <div className="rounded-[1.25rem] border border-cyan-200 bg-cyan-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Packed FG</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{Number(genealogy.packing?.total_packed_qty || 0).toLocaleString("en-IN")}</p>
                    <p className="mt-1 text-sm text-slate-600">Batch {compactId(genealogy.fg_inventory?.batch_id)}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Quality</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{activeHoldCount ? "Blocked" : "Clear"}</p>
                    <p className="mt-1 text-sm text-slate-600">{asArray(genealogy.quality?.inspections).length} inspection rows</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Material Issues</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{materialProofCount}</p>
                    <p className="mt-1 text-sm text-slate-600">Reel issues plus shift ledgers</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Dispatch</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{genealogy.dispatch?.status || "Pending"}</p>
                    <p className="mt-1 text-sm text-slate-600">{genealogy.dispatch?.dispatch_snapshot?.dispatch_ref || "No challan sealed"}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {flowSteps.map((step: any, index: number) => {
                    const status = String(step.status || "").toUpperCase()
                    const done = status === "COMPLETE"
                    const blocked = status === "BLOCKED"
                    return (
                      <article
                        key={step.code || index}
                        className={`rounded-[1.25rem] border p-4 ${
                          blocked
                            ? "border-rose-200 bg-rose-50"
                            : done
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-400">0{index + 1}</span>
                          <StatusBadge value={step.status || "PENDING"} />
                        </div>
                        <p className="mt-3 font-semibold text-slate-950">{step.label}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{step.detail}</p>
                      </article>
                    )
                  })}
                </div>

                {flowGaps.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {flowGaps.map((gap: any) => (
                      <article key={gap.code} className="rounded-[1.2rem] border border-rose-200 bg-white p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-rose-700" />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-950">{gap.code}</p>
                              <StatusBadge value={gap.severity} />
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{gap.message}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[1.2rem] border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
                    No job-card genealogy gaps detected for this selection.
                  </div>
                )}

                <div className="overflow-hidden rounded-[1.25rem] border border-slate-200">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-950 text-[11px] uppercase tracking-[0.16em] text-white">
                      <tr>
                        <th className="px-4 py-3">Stage</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Input</th>
                        <th className="px-4 py-3">Output</th>
                        <th className="px-4 py-3">Scrap</th>
                        <th className="px-4 py-3">Reel Issues</th>
                        <th className="px-4 py-3">Quality</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {genealogyStages.slice(0, 12).map((stage: any) => (
                        <tr key={stage.id}>
                          <td className="px-4 py-3 font-semibold text-slate-950">{stage.stage_type}</td>
                          <td className="px-4 py-3"><StatusBadge value={stage.status} /></td>
                          <td className="px-4 py-3 text-slate-700">{Number(stage.input_qty || 0).toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3 text-slate-700">{Number(stage.output_qty || 0).toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3 text-slate-700">{Number(stage.scrap_qty || 0).toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3 text-slate-600">{asArray(stage.reel_issue_ids).length}</td>
                          <td className="px-4 py-3 text-slate-600">{metadataText(stage.quality_checks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {genealogyShiftLedgers.slice(0, 4).map((ledger: any) => (
                    <article key={ledger.id} className="rounded-[1.2rem] border border-amber-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Shift material proof</p>
                          <p className="mt-2 font-semibold text-slate-950">{ledger.stage_type} | {ledger.shift_code}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {kg(ledger.issued_weight_kg)} issued, {kg(ledger.consumed_weight_kg)} consumed, {kg(ledger.wastage_weight_kg)} wastage.
                          </p>
                        </div>
                        <StatusBadge value={ledger.issue_section || "MATERIAL"} />
                      </div>
                    </article>
                  ))}
                  {genealogyReelIssues.slice(0, 4).map((issue: any) => (
                    <article key={issue.id} className="rounded-[1.2rem] border border-cyan-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Reel issue proof</p>
                          <p className="mt-2 font-semibold text-slate-950">{compactId(issue.id)}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {kg(issue.issued_weight_kg)} issued, {kg(issue.consumed_weight_kg)} consumed.
                          </p>
                        </div>
                        <StatusBadge value={issue.status} />
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title="Reel selector"
        subtitle="Search is backend bounded. Large reel histories load as pages/windows instead of flooding the browser."
        actions={
          <div className="flex min-w-[19rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reel code..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
        }
      >
        {reelsQuery.isLoading ? (
          <EmptyState label="Loading reel genealogy window..." />
        ) : reels.length === 0 ? (
          <EmptyState label="No reels matched this search." />
        ) : (
          <div className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3">
            {reels.map((reel: any) => {
              const selected = String(reel.id) === selectedReelId
              return (
                <button
                  key={reel.id}
                  type="button"
                  onClick={() => setSelectedReelId(String(reel.id))}
                  className={`rounded-[1.35rem] border p-4 text-left transition-all duration-200 ${
                    selected
                      ? "border-amber-300 bg-amber-50 shadow-[0_18px_35px_rgba(217,119,6,0.12)]"
                      : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-950">{reel.reel_code}</p>
                      <p className="mt-1 text-xs text-slate-500">{readableDate(reel.created_at)}</p>
                    </div>
                    <StatusBadge value={reel.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <span>Inward {kg(reel.inward_weight_kg)}</span>
                    <span>Current {kg(reel.current_weight_kg)}</span>
                    <span>{reel.supplier_name || "Supplier -"}</span>
                    <span>{reel.stock_status || "UNRESTRICTED"}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Genealogy chain"
        subtitle="A visual chain for what client users need to answer fast: where did this reel come from, where did it go, and what proof exists?"
      >
        {!selectedReel ? (
          <EmptyState label="Select a reel to see its genealogy chain." />
        ) : (
          <div className="relative overflow-hidden rounded-[1.6rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.24),transparent_35%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#fff7ed_100%)] p-5">
            <div className="grid gap-3 xl:grid-cols-5">
              {genealogyNodes.map((node, index) => {
                const Icon = node.icon
                return (
                  <article key={node.label} className="relative rounded-[1.3rem] border border-white/80 bg-white/90 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="rounded-2xl bg-slate-950 p-2.5 text-white">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-semibold text-slate-400">0{index + 1}</span>
                    </div>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{node.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{node.value}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{node.detail}</p>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 2xl:grid-cols-[1fr_1fr]">
        <Panel title="Linked reel issues" subtitle="Issue rows connect stores movement to production consumption.">
          {!selectedReel ? (
            <EmptyState label="Select a reel first." />
          ) : issuesQuery.isLoading ? (
            <EmptyState label="Loading linked issues..." />
          ) : linkedIssues.length === 0 ? (
            <EmptyState label="No issue rows are linked to this reel." />
          ) : (
            <div className="overflow-hidden rounded-[1.25rem] border border-slate-200">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-950 text-[11px] uppercase tracking-[0.16em] text-white">
                  <tr>
                    <th className="px-4 py-3">Issue</th>
                    <th className="px-4 py-3">Section</th>
                    <th className="px-4 py-3">Machine</th>
                    <th className="px-4 py-3">Shift</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Issued</th>
                    <th className="px-4 py-3">Consumed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {linkedIssues.map((issue: any) => (
                    <tr key={issue.id}>
                      <td className="px-4 py-3 font-semibold text-slate-950">{compactId(issue.id)}</td>
                      <td className="px-4 py-3 text-slate-600">{issue.issue_section || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{compactId(issue.machine_id)}</td>
                      <td className="px-4 py-3 text-slate-600">{issue.shift || "-"}</td>
                      <td className="px-4 py-3"><StatusBadge value={issue.status} /></td>
                      <td className="px-4 py-3 text-slate-700">{kg(issue.issued_weight_kg)}</td>
                      <td className="px-4 py-3 text-slate-700">{kg(issue.consumed_weight_kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Scan and slit timeline" subtitle="The event log proves inward, slit, issue, close, and movement history.">
          {!selectedReel ? (
            <EmptyState label="Select a reel first." />
          ) : scansQuery.isLoading ? (
            <EmptyState label="Loading scan timeline..." />
          ) : scans.length === 0 ? (
            <EmptyState label="No scan events are recorded for this reel." />
          ) : (
            <div className="space-y-3">
              {scans.slice(0, 30).map((event: any) => (
                <article key={event.id} className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={event.event_type} />
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{event.source || "SOURCE"}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{metadataText(event.metadata)}</p>
                    </div>
                    <p className="text-xs font-semibold text-slate-500">{readableDate(event.timestamp)}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Genealogy exceptions" subtitle="Rows here are material trace gaps that should be corrected before audit or client review.">
        {exceptionsQuery.isLoading ? (
          <EmptyState label="Loading genealogy exceptions..." />
        ) : exceptions.length === 0 ? (
          <EmptyState label="No genealogy exceptions in the current health window." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {exceptions.slice(0, 12).map((row: any, index: number) => (
              <article key={row.id || index} className="rounded-[1.25rem] border border-rose-200 bg-rose-50/70 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-rose-700" />
                  <div>
                    <p className="font-semibold text-rose-950">{row.title || row.reel_code || row.entity || "Trace exception"}</p>
                    <p className="mt-1 text-sm leading-6 text-rose-800">{row.reason || row.detail || row.message || metadataText(row)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
