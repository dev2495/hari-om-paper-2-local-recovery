"use client"

import dayjs from "dayjs"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  LockKeyhole,
  Search,
  ShieldCheck,
  UnlockKeyhole,
} from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

import {
  EmptyState,
  ExecutiveHero,
  MetricCard,
  MetricRail,
  Panel,
  StatusBadge,
} from "@/components/erp/shell"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateCustomerRejection,
  useCreateInventoryQualityInspection,
  useCustomerRejections,
  useDisposeCustomerRejection,
  useInventoryItems,
  useInventoryLocations,
  useInventoryQualityTemplates,
  usePendingInventoryQuality,
} from "@/hooks/use-inventory"
import {
  useCreateQualityHold,
  useCreateQualityInspection,
  usePlanningJobCards,
  useQualityHolds,
  useQualityInspections,
  useReleaseQualityHold,
} from "@/hooks/use-production"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

const STAGES = [
  { value: "WINDER", label: "Winder QC" },
  { value: "OVEN", label: "Oven QC" },
  { value: "PROCESS", label: "Process QC" },
  { value: "PACKING", label: "Packing / final QC" },
]
const READING_FIELDS = [
  { key: "id", label: "ID mm" },
  { key: "od", label: "OD mm" },
  { key: "length", label: "Length mm" },
  { key: "weight", label: "Weight g" },
  { key: "cs", label: "CS n" },
  { key: "moisture_after", label: "Moisture %" },
]

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

function jobLabel(job: any) {
  if (!job) return ""
  return [
    job.job_card_no || job.job_no || String(job.id || "").slice(0, 8),
    job.product_code || job.spec_no || job.spec_code,
    job.current_stage || job.stage,
  ]
    .filter(Boolean)
    .join(" | ")
}

function plantForJob(job: any) {
  const value = String(job?.plant_id || job?.plant || "").trim()
  return value && value.toUpperCase() !== "ALL" ? value : undefined
}

function readableDate(value?: string | null) {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format("DD MMM, HH:mm") : String(value)
}

function compactId(value?: string | null) {
  const text = String(value || "")
  return text.length > 10 ? text.slice(0, 8) : text || "-"
}

function normalizeMaterialType(value?: string | null) {
  const text = String(value || "OTHER").toUpperCase()
  if (text === "PAPER" || text === "REEL") return "RAW_PAPER"
  if (text === "FG") return "FINISHED_GOOD"
  return text
}

function coerceReadings(values: Record<string, string>, templates: any[]) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => String(value).trim() !== "")
      .map(([key, value]) => {
        const template = templates.find((row: any) => String(row.parameter_key) === key)
        if (template?.input_type === "number") return [key, Number(value)]
        return [key, value]
      }),
  )
}

function formatJsonSummary(value: any) {
  const entries = Object.entries(value || {}).filter(([, item]) => item !== null && item !== undefined && item !== "")
  if (!entries.length) return "-"
  return entries.slice(0, 4).map(([key, item]) => `${key}: ${item}`).join(" | ")
}

export default function QualityLifecyclePage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedJobId, setSelectedJobId] = useState("")
  const [stageType, setStageType] = useState("WINDER")
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [manualHoldReason, setManualHoldReason] = useState("")
  const [selectedPendingId, setSelectedPendingId] = useState("")
  const [inventoryReadings, setInventoryReadings] = useState<Record<string, string>>({})
  const [inventoryInspectionStatus, setInventoryInspectionStatus] = useState("PASS")
  const [inventoryDisposition, setInventoryDisposition] = useState("ACCEPT")
  const [inventoryNotes, setInventoryNotes] = useState("")
  const [customerReturn, setCustomerReturn] = useState({
    item_id: "",
    rejected_qty: "",
    customer_name: "",
    invoice_ref: "",
    dispatch_ref: "",
    reason_code: "CUSTOMER_REJECT",
    reason_notes: "",
    location_id: "",
    source_job_card_id: "",
    source_spec_id: "",
  })
  const [customerDispositionDraft, setCustomerDispositionDraft] = useState<Record<string, Record<string, string>>>({})

  const jobCardsQuery = usePlanningJobCards({ limit: 200 })
  const inspectionsQuery = useQualityInspections({ limit: 120 })
  const holdsQuery = useQualityHolds({ limit: 120 })
  const itemsQuery = useInventoryItems()
  const locationsQuery = useInventoryLocations()
  const pendingQualityQuery = usePendingInventoryQuality()
  const customerRejectionsQuery = useCustomerRejections({ limit: 80 })
  const createInspection = useCreateQualityInspection()
  const createHold = useCreateQualityHold()
  const releaseHold = useReleaseQualityHold()
  const createInventoryInspection = useCreateInventoryQualityInspection()
  const createCustomerRejection = useCreateCustomerRejection()
  const disposeCustomerRejection = useDisposeCustomerRejection()

  const jobs = useMemo(() => asArray(jobCardsQuery.data), [jobCardsQuery.data])
  const inspections = useMemo(() => asArray(inspectionsQuery.data), [inspectionsQuery.data])
  const holds = useMemo(() => asArray(holdsQuery.data), [holdsQuery.data])
  const inventoryItems = useMemo(() => asArray(itemsQuery.data), [itemsQuery.data])
  const locations = useMemo(() => asArray(locationsQuery.data), [locationsQuery.data])
  const pendingQuality = useMemo(() => asArray(pendingQualityQuery.data), [pendingQualityQuery.data])
  const customerRejections = useMemo(() => asArray(customerRejectionsQuery.data), [customerRejectionsQuery.data])
  const selectedJob = jobs.find((job: any) => String(job.id) === selectedJobId) || null
  const selectedPending = pendingQuality.find((row: any) => `${row.entity_type}:${row.entity_id}` === selectedPendingId) || null
  const selectedPendingMaterial = normalizeMaterialType(selectedPending?.material_type)
  const inventoryTemplatesQuery = useInventoryQualityTemplates(selectedPending ? selectedPendingMaterial : "RAW_PAPER")
  const inventoryTemplates = useMemo(() => asArray(inventoryTemplatesQuery.data), [inventoryTemplatesQuery.data])
  const finishedGoods = useMemo(() => inventoryItems.filter((item: any) => String(item.type || "").toUpperCase() === "FINISHED_GOOD"), [inventoryItems])

  const jobMap = useMemo(() => {
    const rows = new Map<string, any>()
    jobs.forEach((job: any) => rows.set(String(job.id), job))
    return rows
  }, [jobs])

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return jobs.slice(0, 80)
    return jobs
      .filter((job: any) => jobLabel(job).toLowerCase().includes(needle))
      .slice(0, 80)
  }, [jobs, search])

  const activeHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "HOLD")
  const releasedHolds = holds.filter((hold: any) => String(hold.status || "").toUpperCase() === "RELEASED")
  const failedInspections = inspections.filter((row: any) => String(row.status || "").toUpperCase() === "FAIL")
  const passedInspections = inspections.filter((row: any) => String(row.status || "").toUpperCase() === "PASS")
  const passRate = inspections.length ? (passedInspections.length / inspections.length) * 100 : 100
  const openCustomerRejections = customerRejections.filter((row: any) => !row.closed_at && !["UNRESTRICTED", "SCRAP"].includes(String(row.status || "").toUpperCase()))

  const mutationPlantForJob = (jobId: string) => {
    const jobPlant = plantForJob(jobMap.get(String(jobId)))
    if (jobPlant) return jobPlant
    if (activePlant && activePlant.toUpperCase() !== "ALL") return activePlant
    return undefined
  }

  const numericReadings = () =>
    Object.fromEntries(
      Object.entries(readings)
        .filter(([, value]) => String(value).trim() !== "")
        .map(([key, value]) => [key, Number(value)]),
    )

  const handleInspectionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedJobId) {
      showToast("Select a job card before saving inspection.", "error")
      return
    }
    const plantId = mutationPlantForJob(selectedJobId)
    if (!plantId) {
      showToast("Switch to the job plant before creating quality records.", "error")
      return
    }
    try {
      const response = await createInspection.mutateAsync({
        plantId,
        data: {
          job_card_id: selectedJobId,
          stage_type: stageType,
          readings: numericReadings(),
          create_hold_on_fail: true,
        },
      })
      const status = String(response?.data?.status || "PASS")
      showToast(status === "FAIL" ? "Inspection failed and a quality hold was opened." : "Inspection passed.", status === "FAIL" ? "error" : "success")
      setReadings({})
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inspection save failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleManualHoldSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedJobId || !manualHoldReason.trim()) {
      showToast("Select a job card and enter a hold reason.", "error")
      return
    }
    const plantId = mutationPlantForJob(selectedJobId)
    if (!plantId) {
      showToast("Switch to the job plant before creating quality records.", "error")
      return
    }
    try {
      await createHold.mutateAsync({
        plantId,
        data: {
          job_card_id: selectedJobId,
          stage_type: stageType,
          reason: manualHoldReason.trim(),
        },
      })
      setManualHoldReason("")
      showToast("Quality hold created.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Hold creation failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleReleaseHold = async (hold: any) => {
    const plantId = mutationPlantForJob(String(hold.job_card_id || ""))
    if (!plantId) {
      showToast("Switch to the hold's plant before releasing it.", "error")
      return
    }
    try {
      await releaseHold.mutateAsync({ holdId: String(hold.id), plantId })
      showToast("Quality hold released.", "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Hold release failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleInventoryQcSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedPending) {
      showToast("Select held inward material before saving QC.", "error")
      return
    }
    try {
      const response = await createInventoryInspection.mutateAsync({
        entity_type: selectedPending.entity_type,
        entity_id: selectedPending.entity_id,
        material_type: selectedPendingMaterial,
        source: selectedPending.source || "INWARD",
        status: inventoryInspectionStatus,
        disposition: inventoryDisposition,
        readings: coerceReadings(inventoryReadings, inventoryTemplates),
        notes: inventoryNotes || undefined,
      })
      const stockStatus = response?.data?.stock_status || inventoryDisposition
      showToast(`Inventory QC saved. Stock status: ${stockStatus}`, "success")
      setInventoryReadings({})
      setInventoryNotes("")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inventory QC save failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleCustomerReturnSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!customerReturn.item_id || !customerReturn.customer_name || !customerReturn.rejected_qty) {
      showToast("Finished good, customer, and rejected qty are required.", "error")
      return
    }
    try {
      await createCustomerRejection.mutateAsync({
        item_id: customerReturn.item_id,
        rejected_qty: Number(customerReturn.rejected_qty),
        customer_name: customerReturn.customer_name,
        invoice_ref: customerReturn.invoice_ref || undefined,
        dispatch_ref: customerReturn.dispatch_ref || undefined,
        reason_code: customerReturn.reason_code || "CUSTOMER_REJECT",
        reason_notes: customerReturn.reason_notes || undefined,
        location_id: customerReturn.location_id || undefined,
        source_job_card_id: customerReturn.source_job_card_id || undefined,
        source_spec_id: customerReturn.source_spec_id || undefined,
        trace_snapshot: {
          job_card_ref: customerReturn.source_job_card_id || "",
          spec_ref: customerReturn.source_spec_id || "",
        },
      })
      showToast("Customer rejected material inwarded under QC hold.", "success")
      setCustomerReturn({
        item_id: "",
        rejected_qty: "",
        customer_name: "",
        invoice_ref: "",
        dispatch_ref: "",
        reason_code: "CUSTOMER_REJECT",
        reason_notes: "",
        location_id: "",
        source_job_card_id: "",
        source_spec_id: "",
      })
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Customer rejection inward failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  const handleCustomerDisposition = async (rejection: any, disposition: string) => {
    const closure = customerDispositionDraft[String(rejection.id)] || {}
    try {
      await disposeCustomerRejection.mutateAsync({
        id: String(rejection.id),
        data: {
          disposition,
          effective_date: dayjs().format("YYYY-MM-DD"),
          root_cause_department: closure.root_cause_department || undefined,
          owner_department: closure.owner_department || undefined,
          corrective_action: closure.corrective_action || undefined,
          closure_due_date: closure.closure_due_date || undefined,
          rework_cost: closure.rework_cost ? Number(closure.rework_cost) : undefined,
          scrap_cost: closure.scrap_cost ? Number(closure.scrap_cost) : undefined,
          attachment_refs: closure.attachment_refs ? closure.attachment_refs.split(",").map((value) => value.trim()).filter(Boolean) : [],
          notes: `Disposition recorded from quality desk for ${rejection.reason_code || "customer rejection"}.`,
          readings: {
            reject_reason: rejection.reason_code || "CUSTOMER_REJECT",
            rework_possible: ["REWORK", "REHEAT", "SEGREGATE"].includes(disposition) ? "YES" : "NO",
          },
        },
      })
      showToast(`Customer rejection moved to ${disposition}.`, "success")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Disposition failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <div className="space-y-6" data-testid="quality:page">
      <ExecutiveHero
        appearance={MODULE_APPEARANCES.analytics}
        badge="Quality Lifecycle"
        title="Inspection, hold, disposition, and release in one quality rail."
        description="Quality now sits inside the production flow instead of being a report-only afterthought: inspect against spec snapshots, open holds automatically on failures, release with audit evidence, and keep dispatch blocked until stock is clean."
        aside={
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Live QC Gate
            </div>
            <p className="text-2xl font-semibold tracking-tight">{activeHolds.length} active hold(s)</p>
            <p className="text-sm text-slate-200/80">Pass rate {passRate.toFixed(1)}% across the current quality window.</p>
          </div>
        }
      />

      <MetricRail>
        <MetricCard label="Active Holds" value={activeHolds.length} detail="Dispatch-blocking quality decisions" icon={LockKeyhole} tone={activeHolds.length ? "rose" : "emerald"} />
        <MetricCard label="Pass Rate" value={`${passRate.toFixed(1)}%`} detail="Latest inspection window" icon={CheckCircle2} tone="cyan" />
        <MetricCard label="Failures" value={failedInspections.length} detail="Auto-hold candidates from readings" icon={AlertTriangle} tone={failedInspections.length ? "amber" : "slate"} />
        <MetricCard label="Released Holds" value={releasedHolds.length} detail="Closed quality interventions" icon={UnlockKeyhole} tone="violet" />
        <MetricCard label="Inward QC" value={pendingQuality.length} detail="Held material awaiting release" icon={FlaskConical} tone={pendingQuality.length ? "amber" : "emerald"} />
        <MetricCard label="Customer Rejects" value={openCustomerRejections.length} detail="Returned FG under disposition" icon={ClipboardCheck} tone={openCustomerRejections.length ? "rose" : "slate"} />
      </MetricRail>

      <Panel
        title="Quality lifecycle framework"
        subtitle="Each job card moves through measurable checkpoints. Failures create holds; released holds return stock to normal flow."
      >
        <div className="grid gap-3 xl:grid-cols-5">
          {[
            ["1. Spec truth", "Job-card snapshot fixes target ID, OD, length, weight, CS, and moisture bands."],
            ["2. In-process QC", "Winder, oven, and process checks are captured against the running job card."],
            ["3. Final QC", "Packing / final QC captures the outgoing check before dispatch handoff."],
            ["4. Hold and disposition", "Out-of-range readings open an active QC hold with reason and audit trail."],
            ["5. Release gate", "Authorized release clears the hold and allows dispatchable stock to move forward."],
          ].map(([title, detail]) => (
            <article key={title} className="rounded-[1.4rem] border border-slate-200 bg-white/85 p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 2xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          title="Incoming material QC"
          subtitle="Bulk inwards and paper reels stay held here until QC releases them to production issue."
        >
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-2">
              {pendingQualityQuery.isLoading ? (
                <EmptyState label="Loading held material..." />
              ) : pendingQuality.length === 0 ? (
                <EmptyState label="No inward material is waiting for QC." />
              ) : (
                pendingQuality.slice(0, 12).map((row: any) => {
                  const key = `${row.entity_type}:${row.entity_id}`
                  const active = key === selectedPendingId
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedPendingId(key)
                        setInventoryReadings({})
                        setInventoryInspectionStatus("PASS")
                        setInventoryDisposition("ACCEPT")
                        setInventoryNotes("")
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        active ? "border-cyan-300 bg-cyan-50 shadow-sm" : "border-slate-200 bg-white hover:border-cyan-200",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{row.label}</p>
                        <StatusBadge value={row.stock_status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{row.source} | {row.material_type} | Qty {Number(row.qty || 0).toLocaleString()}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.supplier_or_customer || "No supplier/customer"} | {readableDate(row.created_at)}</p>
                    </button>
                  )
                })
              )}
            </div>

            <form onSubmit={handleInventoryQcSubmit} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{selectedPending ? selectedPending.label : "Select held material"}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedPending ? `${selectedPendingMaterial} QC template` : "Adhesive, parchment, raw paper, and FG returns use editable QC parameters."}</p>
                </div>
                {selectedPending ? <StatusBadge value={selectedPending.stock_status} /> : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Result</span>
                  <select
                    value={inventoryInspectionStatus}
                    onChange={(event) => {
                      const next = event.target.value
                      setInventoryInspectionStatus(next)
                      setInventoryDisposition(next === "PASS" ? "ACCEPT" : "BLOCK")
                    }}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  >
                    <option value="PASS">Pass and release</option>
                    <option value="FAIL">Fail / hold decision</option>
                    <option value="SKIPPED">Skipped with note</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Disposition</span>
                  <select
                    value={inventoryDisposition}
                    onChange={(event) => setInventoryDisposition(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  >
                    <option value="ACCEPT">Release to stock</option>
                    <option value="BLOCK">Block stock</option>
                    <option value="SCRAP">Scrap</option>
                    <option value="REWORK">Rework</option>
                    <option value="REHEAT">Reheat</option>
                    <option value="SEGREGATE">Segregate</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {inventoryTemplates.map((field: any) => (
                  <label key={field.parameter_key} className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {field.label}{field.required ? " *" : ""}
                    </span>
                    {field.input_type === "select" ? (
                      <select
                        value={inventoryReadings[field.parameter_key] || ""}
                        onChange={(event) => setInventoryReadings((current) => ({ ...current, [field.parameter_key]: event.target.value }))}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">Select</option>
                        {asArray(field.options).map((option: any) => (
                          <option key={String(option)} value={String(option)}>{String(option)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.input_type === "number" ? "number" : "text"}
                        step="0.001"
                        value={inventoryReadings[field.parameter_key] || ""}
                        onChange={(event) => setInventoryReadings((current) => ({ ...current, [field.parameter_key]: event.target.value }))}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      />
                    )}
                  </label>
                ))}
              </div>

              <textarea
                value={inventoryNotes}
                onChange={(event) => setInventoryNotes(event.target.value)}
                placeholder="QC remarks, reason, or approval note"
                className="mt-4 min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
              />
              <button
                type="submit"
                disabled={!selectedPending || createInventoryInspection.isPending}
                className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save inward QC decision
              </button>
            </form>
          </div>
        </Panel>

        <Panel
          title="Customer rejection inward"
          subtitle="Returned finished goods enter QC hold, then move to rework, reheat, segregate, scrap, or release."
        >
          <form onSubmit={handleCustomerReturnSubmit} className="grid gap-3 md:grid-cols-2">
            <select
              required
              value={customerReturn.item_id}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, item_id: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Finished good</option>
              {finishedGoods.map((item: any) => (
                <option key={item.id} value={item.id}>{item.item_code} - {item.name}</option>
              ))}
            </select>
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              placeholder="Rejected qty"
              value={customerReturn.rejected_qty}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, rejected_qty: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
            <input
              required
              placeholder="Customer name"
              value={customerReturn.customer_name}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, customer_name: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
            <input
              placeholder="Invoice no."
              value={customerReturn.invoice_ref}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, invoice_ref: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
            <input
              placeholder="Dispatch ref"
              value={customerReturn.dispatch_ref}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, dispatch_ref: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
            <select
              value={customerReturn.location_id}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, location_id: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Return location</option>
              {locations.map((location: any) => (
                <option key={location.id} value={location.id}>{location.code} - {location.warehouse}</option>
              ))}
            </select>
            <select
              value={customerReturn.source_job_card_id}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, source_job_card_id: event.target.value }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Trace to job card</option>
              {jobs.slice(0, 120).map((job: any) => (
                <option key={job.id} value={job.id}>{jobLabel(job)}</option>
              ))}
            </select>
            <input
              placeholder="Reason code"
              value={customerReturn.reason_code}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, reason_code: event.target.value.toUpperCase() }))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
            <textarea
              placeholder="Customer complaint / QC note"
              value={customerReturn.reason_notes}
              onChange={(event) => setCustomerReturn((current) => ({ ...current, reason_notes: event.target.value }))}
              className="min-h-20 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm md:col-span-2"
            />
            <button
              type="submit"
              disabled={createCustomerRejection.isPending}
              className="rounded-xl bg-rose-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
            >
              Inward rejected FG under QC hold
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {customerRejections.length === 0 ? (
              <EmptyState label="No customer rejections recorded." />
            ) : (
              customerRejections.slice(0, 8).map((row: any) => (
                <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{row.customer_name} | Qty {Number(row.rejected_qty || 0).toLocaleString()}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.reason_code} | Invoice {row.invoice_ref || "-"} | Dispatch {row.dispatch_ref || "-"}</p>
                      <p className="mt-1 text-xs text-slate-500">Trace {formatJsonSummary(row.trace_snapshot)}</p>
                    </div>
                    <StatusBadge value={row.status} />
                  </div>
                  {!row.closed_at ? (
                    <>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {[
                          ["root_cause_department", "Cause dept"],
                          ["owner_department", "Owner dept"],
                          ["closure_due_date", "Closure date"],
                          ["rework_cost", "Rework cost"],
                          ["scrap_cost", "Scrap cost"],
                          ["attachment_refs", "Proof refs"],
                        ].map(([key, label]) => (
                          <input
                            key={key}
                            type={key === "closure_due_date" ? "date" : key.includes("cost") ? "number" : "text"}
                            step={key.includes("cost") ? "0.01" : undefined}
                            placeholder={label}
                            value={customerDispositionDraft[row.id]?.[key] || ""}
                            onChange={(event) => setCustomerDispositionDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), [key]: event.target.value } }))}
                            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-cyan-700"
                          />
                        ))}
                        <textarea
                          placeholder="Corrective action / closure note"
                          value={customerDispositionDraft[row.id]?.corrective_action || ""}
                          onChange={(event) => setCustomerDispositionDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), corrective_action: event.target.value } }))}
                          className="min-h-16 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-cyan-700 md:col-span-3"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {["REWORK", "REHEAT", "SEGREGATE", "SCRAP", "ACCEPT", "BLOCK"].map((action) => (
                          <button
                            key={action}
                            type="button"
                            onClick={() => handleCustomerDisposition(row, action)}
                            disabled={disposeCustomerRejection.isPending}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-60"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {row.closed_at ? (
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {row.root_cause_department || "-"} | Owner {row.owner_department || "-"} | Cost {Number(row.cost_impact || 0).toLocaleString("en-IN")}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          title="Inspection entry"
          subtitle="Select a live job card, enter readings, and let the system decide pass or hold from the spec snapshot."
          actions={
            <div className="flex min-w-[18rem] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search job card..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          }
        >
          <form className="space-y-4" onSubmit={handleInspectionSubmit}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Job card</span>
                <select
                  value={selectedJobId}
                  onChange={(event) => setSelectedJobId(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Select job card</option>
                  {filteredJobs.map((job: any) => (
                    <option key={job.id} value={job.id}>
                      {jobLabel(job)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stage</span>
                <select
                  value={stageType}
                  onChange={(event) => setStageType(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                >
                  {STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>{stage.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {READING_FIELDS.map((field) => (
                <label key={field.key} className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{field.label}</span>
                  <input
                    type="number"
                    step="0.001"
                    value={readings[field.key] || ""}
                    onChange={(event) => setReadings((current) => ({ ...current, [field.key]: event.target.value }))}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={createInspection.isPending}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save inspection and apply QC gate
            </button>
          </form>

          <form className="mt-5 rounded-[1.4rem] border border-amber-200 bg-amber-50/70 p-4" onSubmit={handleManualHoldSubmit}>
            <p className="text-sm font-semibold text-amber-950">Manual hold</p>
            <p className="mt-1 text-sm text-amber-800">Use this for visual defects, customer-specific checks, or process issues that are not numeric tolerance failures.</p>
            <textarea
              value={manualHoldReason}
              onChange={(event) => setManualHoldReason(event.target.value)}
              placeholder="Reason for hold..."
              className="mt-3 min-h-24 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-3 text-sm outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
            <button
              type="submit"
              disabled={createHold.isPending}
              className="mt-3 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:-translate-y-0.5 hover:shadow-sm disabled:opacity-60"
            >
              Open manual hold
            </button>
          </form>
        </Panel>

        <Panel title="Active quality holds" subtitle="Release only after disposition is complete. These are the blocks that should stay visible before dispatch.">
          {holdsQuery.isLoading ? (
            <EmptyState label="Loading quality holds..." />
          ) : activeHolds.length === 0 ? (
            <EmptyState label="No active quality holds in the current window." />
          ) : (
            <div className="space-y-3">
              {activeHolds.slice(0, 16).map((hold: any) => {
                const job = jobMap.get(String(hold.job_card_id))
                return (
                  <article key={hold.id} className="rounded-[1.45rem] border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge value="HOLD" />
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">{hold.stage_type}</span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-950">{jobLabel(job) || compactId(hold.job_card_id)}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-700">{hold.reason}</p>
                        <p className="mt-2 text-xs text-slate-500">Opened {readableDate(hold.created_at)} by {hold.created_by || "system"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleReleaseHold(hold)}
                        disabled={releaseHold.isPending}
                        className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-60"
                      >
                        Release hold
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent inspection evidence" subtitle="Audit-ready view of the latest readings and failures by stage.">
        {inspectionsQuery.isLoading ? (
          <EmptyState label="Loading inspections..." />
        ) : inspections.length === 0 ? (
          <EmptyState label="No inspections have been recorded yet." />
        ) : (
          <div className="overflow-hidden rounded-[1.35rem] border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-950 text-[11px] uppercase tracking-[0.16em] text-white">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Job card</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Failures</th>
                  <th className="px-4 py-3">Readings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {inspections.slice(0, 30).map((inspection: any) => {
                  const failures = asArray(inspection.failures)
                  return (
                    <tr key={inspection.id} className="align-top">
                      <td className="px-4 py-3 text-slate-600">{readableDate(inspection.created_at)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{jobLabel(jobMap.get(String(inspection.job_card_id))) || compactId(inspection.job_card_id)}</td>
                      <td className="px-4 py-3 text-slate-700">{inspection.stage_type}</td>
                      <td className="px-4 py-3"><StatusBadge value={inspection.status} /></td>
                      <td className="px-4 py-3 text-slate-600">
                        {failures.length ? failures.map((item: any) => item.label || "Failure").join(", ") : "Within tolerance"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{JSON.stringify(inspection.readings || {})}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What this closes" subtitle="Quality is now a lifecycle surface, not just an analytics report.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[1.2rem] border border-cyan-200 bg-cyan-50/70 p-4">
            <FlaskConical className="h-5 w-5 text-cyan-700" />
            <p className="mt-3 font-semibold text-slate-950">Spec-backed readings</p>
            <p className="mt-1 text-sm text-slate-600">The backend compares entries to job-card spec snapshots and stores exact failures.</p>
          </div>
          <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50/70 p-4">
            <LockKeyhole className="h-5 w-5 text-rose-700" />
            <p className="mt-3 font-semibold text-slate-950">Hold control</p>
            <p className="mt-1 text-sm text-slate-600">Failures create visible holds that can be released only through the quality route.</p>
          </div>
          <div className="rounded-[1.2rem] border border-emerald-200 bg-emerald-50/70 p-4">
            <ClipboardCheck className="h-5 w-5 text-emerald-700" />
            <p className="mt-3 font-semibold text-slate-950">Audit trail</p>
            <p className="mt-1 text-sm text-slate-600">Every inspection, hold, and release writes audit evidence for client review.</p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
