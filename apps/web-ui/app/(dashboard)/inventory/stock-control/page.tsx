"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BadgeCheck,
  BookMarked,
  CalendarDays,
  Clock,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  Landmark,
  Scale,
  ShieldAlert,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartCard, CompactTable, FilterChip, formatCompactCurrency, formatCompactNumber } from "@/components/erp/premium-dashboard"
import { MetricCard, MetricRail } from "@/components/erp/shell"
import { PageHeader } from "@/components/workspace/page-header"
import { useAuth } from "@/context/AuthContext"
import {
  useAdjustmentVouchers,
  useCarryForwards,
  useCertifyStockCertification,
  useCreateAdjustmentVoucher,
  useCreateCarryForward,
  useCreateOpeningLoad,
  useCreateStockCertification,
  useInventoryItems,
  useInventoryStockStatement,
  useOpeningLoads,
  usePostOpeningFromCarryForward,
  usePostStockCertificationVariance,
  useStockCertifications,
  useUpdateStockCertification,
} from "@/hooks/use-inventory"
import { useBooksState, usePeriodState } from "@/hooks/use-production"
import { inventoryApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"

const today = () => new Date().toISOString().slice(0, 10)
const dateTimeLocal = (value = new Date()) => {
  const offset = value.getTimezoneOffset()
  const local = new Date(value.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}
const endOfDayLocal = (day: string) => `${day || today()}T23:59`
const monthStart = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
}
const formatNumber = (value: unknown, digits = 0) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const formatKg = (value: unknown) => `${formatNumber(value, 2)} kg`
const formatDateTime = (value?: string | null) => {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value).replace("T", " ").slice(0, 16)
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
}
const toDateTimeInput = (value?: string | null, fallback = dateTimeLocal()) => {
  if (!value) return fallback
  return String(value).replace("Z", "").slice(0, 16)
}

function normalizeRows(raw: any) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.rows) ? raw.rows : []
}

function certStatusTone(status: string) {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "CARRIED_FORWARD") return "bg-signal-emerald-soft text-signal-emerald-ink border-signal-emerald-line"
  if (normalized === "CERTIFIED") return "bg-signal-cyan-soft text-signal-cyan-ink border-signal-cyan-line"
  return "bg-signal-amber-soft text-signal-amber-ink border-signal-amber-line"
}

export default function InventoryStockControlPage() {
  const { activePlant } = useAuth()
  const [startDate, setStartDate] = useState(monthStart())
  const [endDate, setEndDate] = useState(today())
  const [stockAsOfAt, setStockAsOfAt] = useState(() => endOfDayLocal(today()))
  const [countTakenAt, setCountTakenAt] = useState(() => dateTimeLocal())
  const [selectedCertificationId, setSelectedCertificationId] = useState<string | null>(null)
  const [physicalDraft, setPhysicalDraft] = useState<Record<string, string>>({})
  const [sessionDraft, setSessionDraft] = useState({
    count_location_scope: "",
    counted_by: "",
    checked_by: "",
    count_taken_at: "",
    attachment_refs: "",
  })
  const [lineAuditDraft, setLineAuditDraft] = useState<Record<string, Record<string, any>>>({})
  const [openingForm, setOpeningForm] = useState({
    document_no: "",
    effective_date: today(),
    item_id: "",
    qty: "",
    batch_or_reel: "",
    unit_cost: "",
    notes: "",
  })
  const [adjustmentForm, setAdjustmentForm] = useState({
    effective_date: today(),
    effective_at: dateTimeLocal(),
    item_id: "",
    qty_delta: "",
    reason_code: "MANUAL_CORRECTION",
    notes: "",
    unit_cost: "",
    post_now: true,
  })
  const writeBlocked = !activePlant || activePlant === "ALL"

  const statementQuery = useInventoryStockStatement({ start_date: startDate, end_date: endDate, stock_as_of_at: stockAsOfAt })
  const itemsQuery = useInventoryItems()
  const openingLoadsQuery = useOpeningLoads()
  const certificationsQuery = useStockCertifications()
  const carryForwardsQuery = useCarryForwards()
  const createOpeningLoad = useCreateOpeningLoad()
  const createCertification = useCreateStockCertification()
  const updateCertification = useUpdateStockCertification()
  const certifyCertification = useCertifyStockCertification()
  const postCertificationVariance = usePostStockCertificationVariance()
  const createCarryForward = useCreateCarryForward()
  const adjustmentVouchersQuery = useAdjustmentVouchers()
  const createAdjustmentVoucher = useCreateAdjustmentVoucher()
  const postOpeningFromCf = usePostOpeningFromCarryForward()
  const booksStateQuery = useBooksState(activePlant || "", true)
  const currentMonthIso = monthStart().slice(0, 7)
  const periodStateQuery = usePeriodState(currentMonthIso, activePlant || "", true)

  const certificationDetailQuery = useQuery({
    queryKey: ["inventory-stock-certification", selectedCertificationId],
    queryFn: async () => {
      if (!selectedCertificationId) return null
      const { data } = await inventoryApi.getStockCertification(selectedCertificationId)
      return data
    },
    enabled: Boolean(selectedCertificationId),
  })

  const statementRows = normalizeRows(statementQuery.data)
  const items = normalizeRows(itemsQuery.data)
  const openingLoads = normalizeRows(openingLoadsQuery.data)
  const certifications = normalizeRows(certificationsQuery.data)
  const carryForwards = normalizeRows(carryForwardsQuery.data)
  const adjustmentVouchers = normalizeRows(adjustmentVouchersQuery.data)
  const selectedCertification = certificationDetailQuery.data
  const certificationLines = normalizeRows(selectedCertification?.lines)
  const manualOpeningLocked = openingLoads.length > 0
  const certificationVarianceQty = certificationLines.reduce(
    (sum: number, line: any) => sum + Math.abs(Number(line.variance_qty || 0)),
    0,
  )

  const totals = statementQuery.data?.totals || {}
  const topMovementRows = statementRows
    .map((row: any) => ({
      label: row.item_code || row.item_name,
      opening: Number(row.opening_qty || 0),
      in: Number(row.inward_qty || 0) + Number(row.adjustment_qty || 0),
      out: Number(row.outward_qty || 0),
      close: Number(row.closing_qty || 0),
    }))
    .sort((left: any, right: any) => right.close - left.close)
    .slice(0, 8)

  const latestCertification = certifications[0]
  const draftCert = certifications.find((row: any) => String(row.status || "").toUpperCase() === "DRAFT")

  useEffect(() => {
    if (!selectedCertification?.id) return
    const selectedCountTakenAt = toDateTimeInput(selectedCertification.count_taken_at || selectedCertification.counted_at, dateTimeLocal())
    setSessionDraft({
      count_location_scope: selectedCertification.count_location_scope || "",
      counted_by: selectedCertification.counted_by || "",
      checked_by: selectedCertification.checked_by || "",
      count_taken_at: selectedCountTakenAt,
      attachment_refs: Array.isArray(selectedCertification.attachment_refs) ? selectedCertification.attachment_refs.join(", ") : "",
    })
    if (selectedCertification.stock_as_of_at) {
      setStockAsOfAt(toDateTimeInput(selectedCertification.stock_as_of_at, endOfDayLocal(selectedCertification.period_end || endDate)))
    }
    if (selectedCertification.count_taken_at) {
      setCountTakenAt(selectedCountTakenAt)
    }
    setLineAuditDraft({})
  }, [
    endDate,
    selectedCertification?.id,
    selectedCertification?.attachment_refs,
    selectedCertification?.checked_by,
    selectedCertification?.count_location_scope,
    selectedCertification?.count_taken_at,
    selectedCertification?.counted_at,
    selectedCertification?.counted_by,
    selectedCertification?.period_end,
    selectedCertification?.stock_as_of_at,
  ])
  const riskRows = statementRows.filter((row: any) => row.risk_level && row.risk_level !== "OK")
  const policyMissingRows = statementRows.filter((row: any) => row.policy_missing)

  const selectedItem = useMemo(() => {
    const item = items.find((row: any) => String(row.id) === openingForm.item_id)
    return item || null
  }, [items, openingForm.item_id])
  const selectedAdjustmentItem = useMemo(() => {
    return items.find((row: any) => String(row.id) === adjustmentForm.item_id) || null
  }, [items, adjustmentForm.item_id])

  async function postOpeningLoad(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (manualOpeningLocked) return
    if (!openingForm.item_id || !openingForm.qty) return
    const codeField = selectedItem?.tracking_mode === "REEL" ? "reel_code" : "batch_no"
    await createOpeningLoad.mutateAsync({
      document_no: openingForm.document_no || undefined,
      effective_date: openingForm.effective_date,
      notes: openingForm.notes || undefined,
      lines: [
        {
          item_id: openingForm.item_id,
          qty: Number(openingForm.qty),
          [codeField]: openingForm.batch_or_reel || undefined,
          unit_cost: openingForm.unit_cost ? Number(openingForm.unit_cost) : undefined,
          notes: openingForm.notes || undefined,
        },
      ],
    })
    setOpeningForm((current) => ({ ...current, document_no: "", qty: "", batch_or_reel: "", unit_cost: "", notes: "" }))
  }

  async function draftCertification() {
    const result = await createCertification.mutateAsync({
      period_start: startDate,
      period_end: endDate,
      stock_as_of_at: stockAsOfAt,
      count_taken_at: countTakenAt,
      count_location_scope: "ALL_LOCATIONS",
      notes: "Generated from stock-control statement.",
    })
    const id = result?.data?.id
    if (id) {
      setSelectedCertificationId(id)
      setPhysicalDraft({})
    }
  }

  async function savePhysicalCounts() {
    if (!selectedCertification?.id) return
    const lines = certificationLines.map((line: any) => {
      const draft = lineAuditDraft[line.id] || {}
      return {
        line_id: line.id,
        physical_qty: Number(physicalDraft[line.id] ?? line.physical_qty ?? line.closing_qty ?? 0),
        stock_status: draft.stock_status ?? line.stock_status ?? "UNRESTRICTED",
        bin_code: draft.bin_code ?? line.bin_code ?? undefined,
        count_state: draft.count_state ?? line.count_state ?? "COUNTED",
        counted_by: (draft.counted_by ?? line.counted_by ?? sessionDraft.counted_by) || undefined,
        checked_by: (draft.checked_by ?? line.checked_by ?? sessionDraft.checked_by) || undefined,
        recount_required: Boolean(draft.recount_required ?? line.recount_required ?? false),
        recount_notes: draft.recount_notes ?? line.recount_notes ?? undefined,
        notes: line.notes || undefined,
      }
    })
    await updateCertification.mutateAsync({
      id: selectedCertification.id,
      data: {
        count_location_scope: sessionDraft.count_location_scope || undefined,
        count_taken_at: sessionDraft.count_taken_at || countTakenAt,
        counted_by: sessionDraft.counted_by || undefined,
        checked_by: sessionDraft.checked_by || undefined,
        attachment_refs: sessionDraft.attachment_refs.split(",").map((value) => value.trim()).filter(Boolean),
        lines,
      },
    })
  }

  async function certifySelected() {
    if (!selectedCertification?.id) return
    await certifyCertification.mutateAsync({ id: selectedCertification.id, data: { notes: selectedCertification.notes || "Certified from stock-control workspace." } })
  }

  async function carryForwardSelected() {
    if (!selectedCertification?.id) return
    await createCarryForward.mutateAsync({ id: selectedCertification.id, data: {} })
  }

  async function postVarianceSelected() {
    if (!selectedCertification?.id) return
    await postCertificationVariance.mutateAsync(selectedCertification.id)
  }

  async function postManualAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adjustmentForm.item_id || !adjustmentForm.qty_delta) return
    await createAdjustmentVoucher.mutateAsync({
      effective_date: adjustmentForm.effective_date,
      effective_at: adjustmentForm.effective_at,
      reason_code: adjustmentForm.reason_code || "MANUAL_CORRECTION",
      reason_notes: adjustmentForm.notes || undefined,
      source_type: "MANUAL",
      post_now: adjustmentForm.post_now,
      lines: [
        {
          item_id: adjustmentForm.item_id,
          qty_delta: Number(adjustmentForm.qty_delta),
          unit_cost: adjustmentForm.unit_cost ? Number(adjustmentForm.unit_cost) : undefined,
          stock_status: "UNRESTRICTED",
          reason_code: adjustmentForm.reason_code || "MANUAL_CORRECTION",
          notes: adjustmentForm.notes || undefined,
        },
      ],
    })
    setAdjustmentForm((current) => ({ ...current, item_id: "", qty_delta: "", notes: "", unit_cost: "" }))
  }

  const certStatus = String(periodStateQuery.data?.stock_cert_status || latestCertification?.status || "").toUpperCase()
  const recoStatus = String(periodStateQuery.data?.reco_status || "").toUpperCase()
  const closeSteps: Array<{ label: string; detail: string; state: "done" | "active" | "todo" }> = (() => {
    const hasStatement = statementRows.length > 0
    const drafted = Boolean(draftCert) || ["CERTIFIED", "CARRIED_FORWARD"].includes(certStatus)
    const counted = ["CERTIFIED", "CARRIED_FORWARD"].includes(certStatus) || certificationLines.some((line: any) => line.physical_qty !== null && line.physical_qty !== undefined)
    const certified = ["CERTIFIED", "CARRIED_FORWARD"].includes(certStatus)
    const carried = certStatus === "CARRIED_FORWARD" || carryForwards.length > 0
    const reconciled = ["APPROVED", "LOCKED", "CLOSED"].includes(recoStatus) || Boolean(booksStateQuery.data?.locked_through)
    const flags = [hasStatement, drafted, counted, certified, carried, reconciled]
    const firstOpen = flags.findIndex((flag) => !flag)
    const state = (index: number) => (flags[index] ? "done" : index === firstOpen ? "active" : "todo") as "done" | "active" | "todo"
    return [
      { label: "Book statement", detail: hasStatement ? `${statementRows.length} items in the statement` : "No stock lines for this window", state: state(0) },
      { label: "Draft count", detail: drafted ? "Count sheet drafted from book stock" : "Draft a certificate below", state: state(1) },
      { label: "Physical count", detail: counted ? "Counts entered" : "Enter counted qty per line", state: state(2) },
      { label: "Certify", detail: certified ? "Closing stock certified" : "Certify once counts are checked", state: state(3) },
      { label: "Carry forward", detail: carried ? `${carryForwards.length} opening proof(s)` : "Generate next-period opening", state: state(4) },
      { label: "Monthly reco", detail: reconciled ? "Reconciliation approved" : recoStatus ? `Reco ${recoStatus.toLowerCase().replaceAll("_", " ")}` : "Open reconciliation", state: state(5) },
    ]
  })()

  return (
    <div className="space-y-5" data-testid="inventory-stock-control-page">
      <PageHeader
        badge="Stock close control"
        title="Stock control"
        description="Book stock, physical counts, certification and next-period carry-forward in one place. The running ledger is never double-posted."
        actions={
          <>
            <FilterChip>{displayPlantScope(activePlant, "No plant selected")}</FilterChip>
            <Link href="/inventory/lifecycle" className="erp-btn-secondary !h-9">← Lifecycle</Link>
            <Link href="/inventory/ledger" className="erp-btn-secondary !h-9">Ledger <ArrowRight className="h-3.5 w-3.5" /></Link>
            <Link href="/production/reconciliation" className="erp-btn-primary !h-9">Monthly reco <ArrowRight className="h-3.5 w-3.5" /></Link>
          </>
        }
      />

      <MetricRail className="xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="Book closing" value={formatCompactCurrency(Number(totals.closing_value || 0))} detail={`${formatKg(totals.kg_closing_qty)} plus ${formatNumber(totals.pcs_closing_qty)} pcs`} icon={Scale} tone="cyan" />
        <MetricCard label="Opening value" value={formatCompactCurrency(Number(totals.opening_value || 0))} detail="Derived from transactions before the period" icon={BookMarked} tone="slate" />
        <MetricCard label="Risk lines" value={formatCompactNumber(riskRows.length)} detail="Reorder, safety, or missing policy attention" icon={ShieldAlert} tone={riskRows.length ? "amber" : "emerald"} />
        <MetricCard label="Certificates" value={formatCompactNumber(certifications.length)} detail={draftCert ? "Draft awaiting count review" : "No open draft"} icon={FileCheck2} tone={draftCert ? "amber" : "emerald"} />
        <MetricCard label="Count coverage" value={`${formatCompactNumber(statementRows.length)}/${formatCompactNumber(items.length)}`} detail="Active item masters included in count sheet" icon={ClipboardCheck} tone={statementRows.length === items.length ? "emerald" : "amber"} />
        <MetricCard label="Carry-forward proofs" value={formatCompactNumber(carryForwards.length)} detail="Formal next-period opening proof documents" icon={Landmark} tone="violet" />
      </MetricRail>

      <section className="erp-panel rounded-xl p-4 sm:p-5" aria-label="Close progress">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Period close · {currentMonthIso}</h2>
          <span className="text-[12.5px] text-muted-foreground">
            {booksStateQuery.data?.locked_through ? `Books locked through ${String(booksStateQuery.data.locked_through)}${booksStateQuery.data.locked_by ? ` · ${booksStateQuery.data.locked_by}` : ""}` : "Books open"}
            {periodStateQuery.data?.blockers?.length ? ` · ${periodStateQuery.data.blockers.length} blocker(s)` : ""}
          </span>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {closeSteps.map((step, index) => (
            <li key={step.label} className={`relative rounded-lg border px-3 py-2.5 transition-colors ${step.state === "done" ? "border-signal-emerald-line bg-signal-emerald-soft/60" : step.state === "active" ? "border-primary/40 bg-primary/5 shadow-[0_0_0_3px_hsl(var(--primary)/.08)]" : "border-border bg-[hsl(var(--surface-2))]"}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold ${step.state === "done" ? "bg-signal-emerald-ink text-white" : step.state === "active" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{step.state === "done" ? "✓" : index + 1}</span>
                <span className="truncate text-[12.5px] font-semibold">{step.label}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">{step.detail}</p>
            </li>
          ))}
        </ol>
        {writeBlocked ? (
          <p className="mt-3 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] font-medium text-signal-amber-ink">
            Select one plant before posting opening stock, certifying closing stock or generating carry-forward. All-plant scope is read-only for audit review.
          </p>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5" aria-label="Statement window">
        <span className="mr-1 text-[12.5px] font-semibold">Statement window</span>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12.5px] text-muted-foreground">
          From
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-transparent text-[13px] text-foreground outline-none" />
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12.5px] text-muted-foreground">
          To
          <input
            type="date"
            value={endDate}
            onChange={(event) => {
              const nextDate = event.target.value
              setEndDate(nextDate)
              setStockAsOfAt((current) => current.startsWith(endDate) ? endOfDayLocal(nextDate) : current)
            }}
            className="bg-transparent text-[13px] text-foreground outline-none"
          />
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft/50 px-2.5 text-[12.5px] text-signal-cyan-ink">
          <Clock className="h-3.5 w-3.5" />
          Stock as of
          <input type="datetime-local" value={stockAsOfAt} onChange={(event) => setStockAsOfAt(event.target.value)} className="w-[170px] bg-transparent text-[13px] text-foreground outline-none" />
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12.5px] text-muted-foreground">
          Count taken
          <input type="datetime-local" value={countTakenAt} onChange={(event) => setCountTakenAt(event.target.value)} className="w-[170px] bg-transparent text-[13px] text-foreground outline-none" />
        </label>
        <span className="ml-auto text-[12px] text-muted-foreground">Last certified: <strong className="text-foreground">{latestCertification?.period_end || "never"}</strong>{latestCertification?.status ? ` · ${String(latestCertification.status).replaceAll("_", " ").toLowerCase()}` : ""}</span>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ChartCard eyebrow="Book statement" title="Opening + receipts - issues + adjustments = closing" description={`Bulk items use stock transactions. Reel-tracked paper uses reel inward weight minus closed consumed weight. Snapshot: ${formatDateTime(statementQuery.data?.stock_as_of_at || stockAsOfAt)}.`}>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topMovementRows}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatKg(value)} contentStyle={{ borderRadius: 14, border: "1px solid hsl(var(--chart-grid))" }} />
                <Bar dataKey="opening" fill="hsl(var(--chart-axis))" radius={[7, 7, 0, 0]} />
                <Bar dataKey="in" fill="hsl(var(--chart-1))" radius={[7, 7, 0, 0]} />
                <Bar dataKey="out" fill="hsl(var(--chart-6))" radius={[7, 7, 0, 0]} />
                <Bar dataKey="close" fill="#15803d" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4">
            <CompactTable
              rows={statementRows.slice(0, 10)}
              columns={[
                { key: "item_code", label: "Item", render: (row) => <div><p className="font-semibold text-foreground">{row.item_code}</p><p className="text-xs text-muted-foreground">{row.item_name}</p></div> },
                { key: "opening_qty", label: "Opening", render: (row) => `${formatNumber(row.opening_qty, 2)} ${row.uom}` },
                { key: "inward_qty", label: "In", render: (row) => `${formatNumber(Number(row.inward_qty || 0) + Number(row.adjustment_qty || 0), 2)} ${row.uom}` },
                { key: "outward_qty", label: "Out", render: (row) => `${formatNumber(row.outward_qty, 2)} ${row.uom}` },
                { key: "closing_qty", label: "Closing", render: (row) => <span className="font-semibold text-foreground">{formatNumber(row.closing_qty, 2)} {row.uom}</span> },
                { key: "risk_level", label: "Risk", render: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.risk_level === "OK" ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-amber-soft text-signal-amber-ink"}`}>{row.risk_level}</span> },
              ]}
              emptyLabel="No statement rows for this period."
            />
          </div>
        </ChartCard>

        <div className="space-y-4">
          <ChartCard eyebrow="Certification" title="Physical count close" description="Draft from book stock at the selected timestamp, enter the physical count taken time, then certify.">
            <button
              type="button"
              disabled={writeBlocked || createCertification.isPending}
              onClick={draftCertification}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-45"
            >
              <FilePlus2 className="h-4 w-4" />
              Draft certification for period
            </button>
            <div className="mt-4 space-y-2">
              {certifications.slice(0, 4).map((cert: any) => (
                <button
                  key={cert.id}
                  type="button"
                  onClick={() => {
                    setSelectedCertificationId(cert.id)
                    setPhysicalDraft({})
                  }}
                  className="w-full rounded-2xl border border-border bg-card px-3 py-3 text-left transition hover:border-signal-cyan-line hover:bg-signal-cyan-soft/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{cert.period_start} to {cert.period_end}</p>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${certStatusTone(cert.status)}`}>{cert.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(cert.stock_as_of_at)} · {formatCompactCurrency(Number(cert.totals?.closing_value || 0))} · {cert.line_count || 0} lines</p>
                </button>
              ))}
              {!certifications.length ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No stock certificates yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Opening load" title="Bootstrap opening stock" description="Use once at go-live for the first plant opening. Later openings come from certified carry-forward or adjustment vouchers.">
            {manualOpeningLocked ? (
              <p className="mb-3 rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-xs font-semibold text-signal-emerald-ink">
                Opening stock already initialized for this plant. Use carry-forward posting for the next period or a dated adjustment voucher for corrections.
              </p>
            ) : null}
            <form onSubmit={postOpeningLoad} className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input disabled={manualOpeningLocked} value={openingForm.document_no} onChange={(event) => setOpeningForm((current) => ({ ...current, document_no: event.target.value }))} placeholder="Document no optional" className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
                <input disabled={manualOpeningLocked} type="date" value={openingForm.effective_date} onChange={(event) => setOpeningForm((current) => ({ ...current, effective_date: event.target.value }))} className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
              </div>
              <select disabled={manualOpeningLocked} required value={openingForm.item_id} onChange={(event) => setOpeningForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted">
                <option value="">Select item</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-3">
                <input disabled={manualOpeningLocked} required type="number" step="0.001" value={openingForm.qty} onChange={(event) => setOpeningForm((current) => ({ ...current, qty: event.target.value }))} placeholder="Qty" className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
                <input disabled={manualOpeningLocked} value={openingForm.batch_or_reel} onChange={(event) => setOpeningForm((current) => ({ ...current, batch_or_reel: event.target.value }))} placeholder={selectedItem?.tracking_mode === "REEL" ? "Reel code" : "Batch no"} className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
                <input disabled={manualOpeningLocked} type="number" step="0.01" value={openingForm.unit_cost} onChange={(event) => setOpeningForm((current) => ({ ...current, unit_cost: event.target.value }))} placeholder="Unit cost" className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
              </div>
              <input disabled={manualOpeningLocked} value={openingForm.notes} onChange={(event) => setOpeningForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Audit note" className="h-11 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted" />
              <button disabled={writeBlocked || manualOpeningLocked || createOpeningLoad.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-primary px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-primary/90 hover:text-primary-foreground disabled:opacity-45">
                <BookMarked className="h-4 w-4" />
                {manualOpeningLocked ? "Opening already initialized" : "Post opening load"}
              </button>
            </form>
          </ChartCard>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartCard eyebrow="Selected certificate" title={selectedCertification ? `${selectedCertification.period_start} to ${selectedCertification.period_end}` : "Select or draft a certificate"} description="Count rows stay editable only while the certificate is draft.">
          {selectedCertification ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${certStatusTone(selectedCertification.status)}`}>{selectedCertification.status}</span>
                <FilterChip>{selectedCertification.fiscal_year_label || "FY not set"}</FilterChip>
                <FilterChip>{selectedCertification.count_session_no || "Count session"}</FilterChip>
                <FilterChip>{selectedCertification.count_state || "DRAFT"}</FilterChip>
                <FilterChip>As of {formatDateTime(selectedCertification.stock_as_of_at)}</FilterChip>
                <FilterChip>Count {formatDateTime(selectedCertification.count_taken_at || selectedCertification.counted_at)}</FilterChip>
                <button type="button" disabled={selectedCertification.status !== "DRAFT" || updateCertification.isPending} onClick={savePhysicalCounts} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground disabled:opacity-45">
                  Save counts
                </button>
                <button type="button" disabled={selectedCertification.status !== "DRAFT" || certifyCertification.isPending} onClick={certifySelected} className="rounded-full border border-signal-cyan-ink/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-signal-cyan-ink disabled:opacity-45">
                  Certify
                </button>
                <button type="button" disabled={!["CERTIFIED", "CARRIED_FORWARD"].includes(String(selectedCertification.status)) || createCarryForward.isPending} onClick={carryForwardSelected} className="rounded-full border border-signal-emerald-ink/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-signal-emerald-ink disabled:opacity-45">
                  Carry forward
                </button>
                <button type="button" disabled={!["CERTIFIED", "CARRIED_FORWARD"].includes(String(selectedCertification.status)) || certificationVarianceQty <= 0 || postCertificationVariance.isPending} onClick={postVarianceSelected} className="rounded-full border border-signal-amber-ink/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-signal-amber-ink disabled:opacity-45">
                  Post variance
                </button>
                {certificationVarianceQty > 0 ? (
                  <span className="rounded-full bg-signal-amber-soft px-2.5 py-1 text-[11px] font-semibold text-signal-amber-ink">
                    {formatNumber(certificationVarianceQty, 2)} qty variance
                  </span>
                ) : null}
              </div>
              <div className="mb-4 grid gap-2 rounded-2xl border border-border bg-muted p-3 md:grid-cols-2 xl:grid-cols-5">
                <input
                  value={sessionDraft.count_location_scope}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, count_location_scope: event.target.value }))}
                  placeholder="Count scope / location"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted"
                />
                <input
                  value={sessionDraft.counted_by}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, counted_by: event.target.value }))}
                  placeholder="Counted by"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted"
                />
                <input
                  value={sessionDraft.checked_by}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, checked_by: event.target.value }))}
                  placeholder="Checked by"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted"
                />
                <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground">
                  Count
                  <input
                    type="datetime-local"
                    value={sessionDraft.count_taken_at}
                    onChange={(event) => setSessionDraft((current) => ({ ...current, count_taken_at: event.target.value }))}
                    disabled={selectedCertification.status !== "DRAFT"}
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none disabled:text-muted-foreground"
                  />
                </label>
                <input
                  value={sessionDraft.attachment_refs}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, attachment_refs: event.target.value }))}
                  placeholder="Proof refs comma-separated"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-signal-cyan-ink/40 disabled:bg-muted"
                />
              </div>
              <CompactTable
                rows={certificationLines}
                columns={[
                  { key: "item_code", label: "Item", render: (row) => <div><p className="font-semibold text-foreground">{row.item_code}</p><p className="text-xs text-muted-foreground">{row.tracking_mode} · {row.uom}</p></div> },
                  { key: "closing_qty", label: "Book close", render: (row) => `${formatNumber(row.closing_qty, 2)} ${row.uom}` },
                  {
                    key: "physical_qty",
                    label: "Physical",
                    render: (row) => (
                      <input
                        disabled={selectedCertification.status !== "DRAFT"}
                        type="number"
                        step="0.001"
                        value={physicalDraft[row.id] ?? String(row.physical_qty ?? row.closing_qty ?? 0)}
                        onChange={(event) => setPhysicalDraft((current) => ({ ...current, [row.id]: event.target.value }))}
                        className="h-9 w-28 rounded-xl border border-border px-2 text-right text-sm font-semibold disabled:bg-muted"
                      />
                    ),
                  },
                  {
                    key: "count_state",
                    label: "Count state",
                    render: (row) => (
                      <div className="space-y-1">
                        <select
                          disabled={selectedCertification.status !== "DRAFT"}
                          value={lineAuditDraft[row.id]?.count_state ?? row.count_state ?? "COUNTED"}
                          onChange={(event) => setLineAuditDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), count_state: event.target.value } }))}
                          className="h-8 w-36 rounded-lg border border-border bg-card px-2 text-xs font-semibold disabled:bg-muted"
                        >
                          {["COUNTED", "REVIEWED", "RECOUNT_REQUIRED"].map((state) => <option key={state} value={state}>{state}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                          <input
                            type="checkbox"
                            disabled={selectedCertification.status !== "DRAFT"}
                            checked={Boolean(lineAuditDraft[row.id]?.recount_required ?? row.recount_required ?? false)}
                            onChange={(event) => setLineAuditDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), recount_required: event.target.checked, count_state: event.target.checked ? "RECOUNT_REQUIRED" : "REVIEWED" } }))}
                          />
                          Recount
                        </label>
                      </div>
                    ),
                  },
                  {
                    key: "bin_code",
                    label: "Bin / checker",
                    render: (row) => (
                      <div className="space-y-1">
                        <input
                          disabled={selectedCertification.status !== "DRAFT"}
                          value={lineAuditDraft[row.id]?.bin_code ?? row.bin_code ?? ""}
                          onChange={(event) => setLineAuditDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), bin_code: event.target.value } }))}
                          placeholder="Bin"
                          className="h-8 w-28 rounded-lg border border-border px-2 text-xs disabled:bg-muted"
                        />
                        <input
                          disabled={selectedCertification.status !== "DRAFT"}
                          value={lineAuditDraft[row.id]?.checked_by ?? row.checked_by ?? ""}
                          onChange={(event) => setLineAuditDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), checked_by: event.target.value } }))}
                          placeholder="Checker"
                          className="h-8 w-28 rounded-lg border border-border px-2 text-xs disabled:bg-muted"
                        />
                      </div>
                    ),
                  },
                  { key: "variance_qty", label: "Variance", render: (row) => <span className={Number(row.variance_qty || 0) ? "font-semibold text-signal-amber-ink" : "text-signal-emerald-ink"}>{formatNumber(Number(physicalDraft[row.id] ?? row.physical_qty ?? row.closing_qty ?? 0) - Number(row.closing_qty || 0), 2)} {row.uom}</span> },
                  { key: "closing_value", label: "Value", render: (row) => formatCompactCurrency(Number(row.closing_value || 0)) },
                ]}
                emptyLabel="No certificate lines selected."
              />
            </>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-border bg-muted p-8 text-center text-sm text-muted-foreground">
              Draft a certification from the current statement or select an existing certificate. After certification, use Post variance to create the formal adjustment voucher.
            </div>
          )}
        </ChartCard>

        <div className="space-y-4">
          <ChartCard eyebrow="Adjustment voucher" title="Manual stock correction" description="Use for approved count correction, scrap discovery, or store correction. Reel items create adjustment reels for gains and scan reductions for losses.">
            <form onSubmit={postManualAdjustment} className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="date"
                  value={adjustmentForm.effective_date}
                  onChange={(event) => {
                    const nextDate = event.target.value
                    setAdjustmentForm((current) => ({
                      ...current,
                      effective_date: nextDate,
                      effective_at: current.effective_at.startsWith(current.effective_date) ? `${nextDate}T23:59` : current.effective_at,
                    }))
                  }}
                  className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40"
                />
                <select value={adjustmentForm.reason_code} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason_code: event.target.value }))} className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40">
                  <option value="MANUAL_CORRECTION">Manual correction</option>
                  <option value="PHYSICAL_COUNT_VARIANCE">Physical count variance</option>
                  <option value="SCRAP_DISCOVERY">Scrap discovery</option>
                  <option value="REWORK_RECOVERY">Rework recovery</option>
                  <option value="CUSTOMER_REJECTION">Customer rejection</option>
                </select>
              </div>
              <label className="flex h-11 items-center gap-2 rounded-xl border border-signal-cyan-line bg-card px-3 text-xs font-semibold text-signal-cyan-ink">
                Effective time
                <input
                  type="datetime-local"
                  value={adjustmentForm.effective_at}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, effective_at: event.target.value }))}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </label>
              <select required value={adjustmentForm.item_id} onChange={(event) => setAdjustmentForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40">
                <option value="">Select item</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                <input required type="number" step="0.001" value={adjustmentForm.qty_delta} onChange={(event) => setAdjustmentForm((current) => ({ ...current, qty_delta: event.target.value }))} placeholder="+ gain / - loss" className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40" />
                <input type="number" step="0.01" value={adjustmentForm.unit_cost} onChange={(event) => setAdjustmentForm((current) => ({ ...current, unit_cost: event.target.value }))} placeholder="Unit cost optional" className="h-11 rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40" />
              </div>
              <input value={adjustmentForm.notes} onChange={(event) => setAdjustmentForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Approval note / reason" className="h-11 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-signal-cyan-ink/40" />
              {selectedAdjustmentItem ? (
                <p className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {selectedAdjustmentItem.tracking_mode === "REEL" ? "Reel correction will preserve reel traceability through scan events and generated adjustment reels." : "Bulk correction will post a ledger ADJUSTMENT transaction."}
                </p>
              ) : null}
              <button disabled={writeBlocked || createAdjustmentVoucher.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-45">
                <FilePlus2 className="h-4 w-4" />
                {createAdjustmentVoucher.isPending ? "Posting adjustment..." : "Post adjustment voucher"}
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {adjustmentVouchers.slice(0, 4).map((row: any) => (
                <div key={row.id} className="rounded-2xl border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{row.voucher_no}</p>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${String(row.status).toUpperCase() === "POSTED" ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-amber-soft text-signal-amber-ink"}`}>{row.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.effective_at ? formatDateTime(row.effective_at) : row.effective_date} · {row.reason_code} · {formatNumber(row.total_abs_qty, 2)} qty</p>
                </div>
              ))}
              {!adjustmentVouchers.length ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No adjustment vouchers yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Formal proof trail" title="Opening loads and year carry-forward" description="Prior closing becomes next-period opening through the continuous ledger. Activation records the audit proof without adding stock again.">
            <div className="space-y-3">
              {carryForwards.slice(0, 4).map((row: any) => {
                const cfStatus = String(row.status || "").toUpperCase()
                const isPosted = cfStatus === "POSTED"
                return (
                  <div key={row.id} className="rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft px-3 py-3 text-signal-emerald-ink">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{row.document_no}</p>
                      <BadgeCheck className="h-4 w-4" />
                    </div>
                    <p className="mt-1 text-xs opacity-75">Opening {row.opening_date} · {formatCompactCurrency(Number(row.opening_value || 0))} · {row.line_count} lines</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        isPosted
                          ? "border-signal-emerald-ink/40 bg-card text-signal-emerald-ink"
                          : "border-signal-amber-line bg-card text-signal-amber-ink"
                      }`}>
                        {cfStatus}
                      </span>
                      <button
                        type="button"
                        onClick={() => postOpeningFromCf.mutate({ cfId: row.id, plantId: activePlant || "" })}
                        disabled={isPosted || writeBlocked || postOpeningFromCf.isPending}
                        className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] shadow-sm transition ${
                          isPosted || writeBlocked
                            ? "cursor-not-allowed bg-muted text-muted-foreground"
                            : "bg-emerald-700 text-white hover:bg-emerald-800"
                        }`}
                        title={isPosted ? "Next-period opening proof is active" : "Activate next-period opening proof without creating another stock movement"}
                      >
                        <FilePlus2 className="h-3 w-3" />
                        {isPosted ? "Active" : postOpeningFromCf.isPending ? "Activating…" : "Activate opening"}
                      </button>
                    </div>
                  </div>
                )
              })}
              {!carryForwards.length ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No carry-forward documents generated yet.</p> : null}
            </div>
            <div className="mt-4 space-y-2">
              {openingLoads.slice(0, 4).map((row: any) => (
                <div key={row.id} className="rounded-2xl border border-border bg-card px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{row.document_no}</p>
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.effective_date} · {row.line_count} lines · {formatKg(row.total_qty)}</p>
                </div>
              ))}
              {!openingLoads.length ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No opening load documents posted yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Policy clean-up" title="Missing reorder/safety policy" description="MRP alerts are now driven by item master policy, not hidden defaults.">
            <div className="space-y-2">
              {policyMissingRows.slice(0, 5).map((row: any) => (
                <Link key={row.item_id} href="/inventory/items" className="flex items-center justify-between gap-3 rounded-2xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink transition hover:bg-signal-amber-soft">
                  <span className="font-semibold">{row.item_code}</span>
                  <span className="text-xs">Set policy</span>
                </Link>
              ))}
              {!policyMissingRows.length ? <p className="rounded-2xl border border-signal-emerald-line bg-signal-emerald-soft p-4 text-sm text-signal-emerald-ink">All statement rows have reorder or safety controls.</p> : null}
            </div>
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
