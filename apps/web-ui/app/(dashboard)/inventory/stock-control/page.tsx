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

import { ChartCard, CompactTable, FilterChip, KpiCard, PageIntro, formatCompactCurrency, formatCompactNumber } from "@/components/erp/premium-dashboard"
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
  if (normalized === "CARRIED_FORWARD") return "bg-emerald-50 text-emerald-800 border-emerald-200"
  if (normalized === "CERTIFIED") return "bg-cyan-50 text-cyan-800 border-cyan-200"
  return "bg-amber-50 text-amber-800 border-amber-200"
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

  return (
    <div className="space-y-5" data-testid="inventory-stock-control-page">
      <PageIntro
        eyebrow="Stock close control"
        title="Opening stock, closing certification, and formal year carry-forward."
        description="One audit cockpit for book stock, physical counts, bootstrap opening loads, certification proof, and next-year opening carry-forward without double-posting the running ledger."
        actions={
          <>
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              From
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-transparent outline-none" />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              To
              <input
                type="date"
                value={endDate}
                onChange={(event) => {
                  const nextDate = event.target.value
                  setEndDate(nextDate)
                  setStockAsOfAt((current) => current.startsWith(endDate) ? endOfDayLocal(nextDate) : current)
                }}
                className="bg-transparent outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-950">
              <Clock className="h-3.5 w-3.5" />
              Stock as of
              <input
                type="datetime-local"
                value={stockAsOfAt}
                onChange={(event) => setStockAsOfAt(event.target.value)}
                className="w-[154px] bg-transparent outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              Count taken
              <input
                type="datetime-local"
                value={countTakenAt}
                onChange={(event) => setCountTakenAt(event.target.value)}
                className="w-[154px] bg-transparent outline-none"
              />
            </label>
            <FilterChip>{displayPlantScope(activePlant, "No plant selected")}</FilterChip>
            <Link href="/inventory/ledger" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-cyan-300 hover:text-cyan-900">
              Ledger <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">Closing value</p>
              <p className="mt-2 text-3xl font-semibold">{formatCompactCurrency(Number(totals.closing_value || 0))}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">Certified period</p>
              <p className="mt-2 text-lg font-semibold">{latestCertification?.period_end || "Not yet"}</p>
              <p className="text-xs text-slate-300">{latestCertification?.status || "Draft a period below"}</p>
            </div>
          </div>
        }
      />

      {writeBlocked ? (
        <section className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Select one concrete plant before posting opening stock, certifying closing stock, or generating carry-forward. Global scope remains read-only for audit review.
        </section>
      ) : null}

      {/* Flow context — links back to the Lifecycle hub */}
      <section className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-cyan-200 bg-cyan-50/60 px-4 py-2.5 text-[12.5px] font-semibold text-cyan-950 shadow-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-800">Step 3–4 of 6</span>
        <span>You are in <strong>Stock certification</strong> · <strong>Carry-forward</strong></span>
        <Link
          href="/inventory/lifecycle"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-cyan-700 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-900 hover:bg-white"
        >
          ← Lifecycle hub
        </Link>
        <Link
          href="/production/reconciliation"
          className="inline-flex items-center gap-1 rounded-full border border-cyan-700 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan-900 hover:bg-white"
        >
          Next: Monthly reco →
        </Link>
      </section>

      {booksStateQuery.data?.locked_through ? (
        <section className="flex flex-wrap items-center gap-3 rounded-[1.4rem] border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-sm">
          <BadgeCheck className="h-4 w-4" />
          Books locked through {String(booksStateQuery.data.locked_through)}
          {booksStateQuery.data.locked_by ? ` · ${booksStateQuery.data.locked_by}` : null}
          <Link href="/production/reconciliation" className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-700 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-emerald-900 hover:bg-emerald-100">
            Reconciliation <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
      ) : null}

      {periodStateQuery.data && !writeBlocked ? (
        <section className={`flex flex-wrap items-center gap-3 rounded-[1.4rem] border px-4 py-3 text-sm font-semibold shadow-sm ${
          periodStateQuery.data.can_approve_reco
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : periodStateQuery.data.stock_cert_status === "CERTIFIED" || periodStateQuery.data.stock_cert_status === "CARRIED_FORWARD"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-rose-200 bg-rose-50 text-rose-900"
        }`}>
          <Scale className="h-4 w-4" />
          Period <strong>{currentMonthIso}</strong> · Stock cert: <strong>{periodStateQuery.data.stock_cert_status || "missing"}</strong> · Reco: <strong>{periodStateQuery.data.reco_status}</strong>
          {periodStateQuery.data.blockers?.length ? (
            <span className="ml-2">· {periodStateQuery.data.blockers.length} blocker(s)</span>
          ) : null}
          <Link href="/production/reconciliation" className="ml-auto inline-flex items-center gap-1 rounded-full border border-current px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] hover:bg-white/70">
            Open reco <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Book Closing" value={formatCompactCurrency(Number(totals.closing_value || 0))} detail={`${formatKg(totals.kg_closing_qty)} plus ${formatNumber(totals.pcs_closing_qty)} pcs`} icon={Scale} tone="cyan" />
        <KpiCard label="Opening Value" value={formatCompactCurrency(Number(totals.opening_value || 0))} detail="Derived from transactions before the period" icon={BookMarked} tone="slate" />
        <KpiCard label="Risk Lines" value={formatCompactNumber(riskRows.length)} detail="Reorder, safety, or missing policy attention" icon={ShieldAlert} tone={riskRows.length ? "amber" : "emerald"} />
        <KpiCard label="Certificates" value={formatCompactNumber(certifications.length)} detail={draftCert ? "Draft awaiting count review" : "No open draft"} icon={FileCheck2} tone={draftCert ? "amber" : "emerald"} />
        <KpiCard label="Count Coverage" value={`${formatCompactNumber(statementRows.length)}/${formatCompactNumber(items.length)}`} detail="Active item masters included in count sheet" icon={ClipboardCheck} tone={statementRows.length === items.length ? "emerald" : "amber"} />
        <KpiCard label="Carry Forward" value={formatCompactNumber(carryForwards.length)} detail="Formal next-period opening proof documents" icon={Landmark} tone="violet" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_430px]">
        <ChartCard eyebrow="Book statement" title="Opening + receipts - issues + adjustments = closing" description={`Bulk items use stock transactions. Reel-tracked paper uses reel inward weight minus closed consumed weight. Snapshot: ${formatDateTime(statementQuery.data?.stock_as_of_at || stockAsOfAt)}.`}>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topMovementRows}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any) => formatKg(value)} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="opening" fill="#64748b" radius={[7, 7, 0, 0]} />
                <Bar dataKey="in" fill="#0e7490" radius={[7, 7, 0, 0]} />
                <Bar dataKey="out" fill="#f59e0b" radius={[7, 7, 0, 0]} />
                <Bar dataKey="close" fill="#15803d" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4">
            <CompactTable
              rows={statementRows.slice(0, 10)}
              columns={[
                { key: "item_code", label: "Item", render: (row) => <div><p className="font-semibold text-slate-950">{row.item_code}</p><p className="text-xs text-slate-500">{row.item_name}</p></div> },
                { key: "opening_qty", label: "Opening", render: (row) => `${formatNumber(row.opening_qty, 2)} ${row.uom}` },
                { key: "inward_qty", label: "In", render: (row) => `${formatNumber(Number(row.inward_qty || 0) + Number(row.adjustment_qty || 0), 2)} ${row.uom}` },
                { key: "outward_qty", label: "Out", render: (row) => `${formatNumber(row.outward_qty, 2)} ${row.uom}` },
                { key: "closing_qty", label: "Closing", render: (row) => <span className="font-semibold text-slate-950">{formatNumber(row.closing_qty, 2)} {row.uom}</span> },
                { key: "risk_level", label: "Risk", render: (row) => <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.risk_level === "OK" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{row.risk_level}</span> },
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45"
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
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{cert.period_start} to {cert.period_end}</p>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${certStatusTone(cert.status)}`}>{cert.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(cert.stock_as_of_at)} · {formatCompactCurrency(Number(cert.totals?.closing_value || 0))} · {cert.line_count || 0} lines</p>
                </button>
              ))}
              {!certifications.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No stock certificates yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Opening load" title="Bootstrap opening stock" description="Use once at go-live for the first plant opening. Later openings come from certified carry-forward or adjustment vouchers.">
            {manualOpeningLocked ? (
              <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                Opening stock already initialized for this plant. Use carry-forward posting for the next period or a dated adjustment voucher for corrections.
              </p>
            ) : null}
            <form onSubmit={postOpeningLoad} className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input disabled={manualOpeningLocked} value={openingForm.document_no} onChange={(event) => setOpeningForm((current) => ({ ...current, document_no: event.target.value }))} placeholder="Document no optional" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
                <input disabled={manualOpeningLocked} type="date" value={openingForm.effective_date} onChange={(event) => setOpeningForm((current) => ({ ...current, effective_date: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
              </div>
              <select disabled={manualOpeningLocked} required value={openingForm.item_id} onChange={(event) => setOpeningForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100">
                <option value="">Select item</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-3">
                <input disabled={manualOpeningLocked} required type="number" step="0.001" value={openingForm.qty} onChange={(event) => setOpeningForm((current) => ({ ...current, qty: event.target.value }))} placeholder="Qty" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
                <input disabled={manualOpeningLocked} value={openingForm.batch_or_reel} onChange={(event) => setOpeningForm((current) => ({ ...current, batch_or_reel: event.target.value }))} placeholder={selectedItem?.tracking_mode === "REEL" ? "Reel code" : "Batch no"} className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
                <input disabled={manualOpeningLocked} type="number" step="0.01" value={openingForm.unit_cost} onChange={(event) => setOpeningForm((current) => ({ ...current, unit_cost: event.target.value }))} placeholder="Unit cost" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
              </div>
              <input disabled={manualOpeningLocked} value={openingForm.notes} onChange={(event) => setOpeningForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Audit note" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
              <button disabled={writeBlocked || manualOpeningLocked || createOpeningLoad.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-950 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-950 hover:text-white disabled:opacity-45">
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
                <button type="button" disabled={selectedCertification.status !== "DRAFT" || updateCertification.isPending} onClick={savePhysicalCounts} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-45">
                  Save counts
                </button>
                <button type="button" disabled={selectedCertification.status !== "DRAFT" || certifyCertification.isPending} onClick={certifySelected} className="rounded-full border border-cyan-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-900 disabled:opacity-45">
                  Certify
                </button>
                <button type="button" disabled={!["CERTIFIED", "CARRIED_FORWARD"].includes(String(selectedCertification.status)) || createCarryForward.isPending} onClick={carryForwardSelected} className="rounded-full border border-emerald-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900 disabled:opacity-45">
                  Carry forward
                </button>
                <button type="button" disabled={!["CERTIFIED", "CARRIED_FORWARD"].includes(String(selectedCertification.status)) || certificationVarianceQty <= 0 || postCertificationVariance.isPending} onClick={postVarianceSelected} className="rounded-full border border-amber-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900 disabled:opacity-45">
                  Post variance
                </button>
                {certificationVarianceQty > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                    {formatNumber(certificationVarianceQty, 2)} qty variance
                  </span>
                ) : null}
              </div>
              <div className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-5">
                <input
                  value={sessionDraft.count_location_scope}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, count_location_scope: event.target.value }))}
                  placeholder="Count scope / location"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100"
                />
                <input
                  value={sessionDraft.counted_by}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, counted_by: event.target.value }))}
                  placeholder="Counted by"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100"
                />
                <input
                  value={sessionDraft.checked_by}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, checked_by: event.target.value }))}
                  placeholder="Checked by"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100"
                />
                <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">
                  Count
                  <input
                    type="datetime-local"
                    value={sessionDraft.count_taken_at}
                    onChange={(event) => setSessionDraft((current) => ({ ...current, count_taken_at: event.target.value }))}
                    disabled={selectedCertification.status !== "DRAFT"}
                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none disabled:text-slate-500"
                  />
                </label>
                <input
                  value={sessionDraft.attachment_refs}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, attachment_refs: event.target.value }))}
                  placeholder="Proof refs comma-separated"
                  disabled={selectedCertification.status !== "DRAFT"}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100"
                />
              </div>
              <CompactTable
                rows={certificationLines}
                columns={[
                  { key: "item_code", label: "Item", render: (row) => <div><p className="font-semibold text-slate-950">{row.item_code}</p><p className="text-xs text-slate-500">{row.tracking_mode} · {row.uom}</p></div> },
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
                        className="h-9 w-28 rounded-xl border border-slate-200 px-2 text-right text-sm font-semibold disabled:bg-slate-50"
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
                          className="h-8 w-36 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold disabled:bg-slate-50"
                        >
                          {["COUNTED", "REVIEWED", "RECOUNT_REQUIRED"].map((state) => <option key={state} value={state}>{state}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
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
                          className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-xs disabled:bg-slate-50"
                        />
                        <input
                          disabled={selectedCertification.status !== "DRAFT"}
                          value={lineAuditDraft[row.id]?.checked_by ?? row.checked_by ?? ""}
                          onChange={(event) => setLineAuditDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] || {}), checked_by: event.target.value } }))}
                          placeholder="Checker"
                          className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-xs disabled:bg-slate-50"
                        />
                      </div>
                    ),
                  },
                  { key: "variance_qty", label: "Variance", render: (row) => <span className={Number(row.variance_qty || 0) ? "font-semibold text-amber-700" : "text-emerald-700"}>{formatNumber(Number(physicalDraft[row.id] ?? row.physical_qty ?? row.closing_qty ?? 0) - Number(row.closing_qty || 0), 2)} {row.uom}</span> },
                  { key: "closing_value", label: "Value", render: (row) => formatCompactCurrency(Number(row.closing_value || 0)) },
                ]}
                emptyLabel="No certificate lines selected."
              />
            </>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
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
                  className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700"
                />
                <select value={adjustmentForm.reason_code} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason_code: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700">
                  <option value="MANUAL_CORRECTION">Manual correction</option>
                  <option value="PHYSICAL_COUNT_VARIANCE">Physical count variance</option>
                  <option value="SCRAP_DISCOVERY">Scrap discovery</option>
                  <option value="REWORK_RECOVERY">Rework recovery</option>
                  <option value="CUSTOMER_REJECTION">Customer rejection</option>
                </select>
              </div>
              <label className="flex h-11 items-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 text-xs font-semibold text-cyan-950">
                Effective time
                <input
                  type="datetime-local"
                  value={adjustmentForm.effective_at}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, effective_at: event.target.value }))}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                />
              </label>
              <select required value={adjustmentForm.item_id} onChange={(event) => setAdjustmentForm((current) => ({ ...current, item_id: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700">
                <option value="">Select item</option>
                {items.map((item: any) => <option key={item.id} value={item.id}>{item.item_code} · {item.name}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                <input required type="number" step="0.001" value={adjustmentForm.qty_delta} onChange={(event) => setAdjustmentForm((current) => ({ ...current, qty_delta: event.target.value }))} placeholder="+ gain / - loss" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700" />
                <input type="number" step="0.01" value={adjustmentForm.unit_cost} onChange={(event) => setAdjustmentForm((current) => ({ ...current, unit_cost: event.target.value }))} placeholder="Unit cost optional" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700" />
              </div>
              <input value={adjustmentForm.notes} onChange={(event) => setAdjustmentForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Approval note / reason" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700" />
              {selectedAdjustmentItem ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {selectedAdjustmentItem.tracking_mode === "REEL" ? "Reel correction will preserve reel traceability through scan events and generated adjustment reels." : "Bulk correction will post a ledger ADJUSTMENT transaction."}
                </p>
              ) : null}
              <button disabled={writeBlocked || createAdjustmentVoucher.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 disabled:opacity-45">
                <FilePlus2 className="h-4 w-4" />
                {createAdjustmentVoucher.isPending ? "Posting adjustment..." : "Post adjustment voucher"}
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {adjustmentVouchers.slice(0, 4).map((row: any) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{row.voucher_no}</p>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${String(row.status).toUpperCase() === "POSTED" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{row.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{row.effective_at ? formatDateTime(row.effective_at) : row.effective_date} · {row.reason_code} · {formatNumber(row.total_abs_qty, 2)} qty</p>
                </div>
              ))}
              {!adjustmentVouchers.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No adjustment vouchers yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Formal proof trail" title="Opening loads and year carry-forward" description="Prior closing becomes next-period opening through the continuous ledger. Activation records the audit proof without adding stock again.">
            <div className="space-y-3">
              {carryForwards.slice(0, 4).map((row: any) => {
                const cfStatus = String(row.status || "").toUpperCase()
                const isPosted = cfStatus === "POSTED"
                return (
                  <div key={row.id} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-950">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{row.document_no}</p>
                      <BadgeCheck className="h-4 w-4" />
                    </div>
                    <p className="mt-1 text-xs opacity-75">Opening {row.opening_date} · {formatCompactCurrency(Number(row.opening_value || 0))} · {row.line_count} lines</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        isPosted
                          ? "border-emerald-700 bg-white text-emerald-900"
                          : "border-amber-300 bg-white text-amber-900"
                      }`}>
                        {cfStatus}
                      </span>
                      <button
                        type="button"
                        onClick={() => postOpeningFromCf.mutate({ cfId: row.id, plantId: activePlant || "" })}
                        disabled={isPosted || writeBlocked || postOpeningFromCf.isPending}
                        className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] shadow-sm transition ${
                          isPosted || writeBlocked
                            ? "cursor-not-allowed bg-slate-200 text-slate-500"
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
              {!carryForwards.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No carry-forward documents generated yet.</p> : null}
            </div>
            <div className="mt-4 space-y-2">
              {openingLoads.slice(0, 4).map((row: any) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{row.document_no}</p>
                    <CalendarDays className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{row.effective_date} · {row.line_count} lines · {formatKg(row.total_qty)}</p>
                </div>
              ))}
              {!openingLoads.length ? <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No opening load documents posted yet.</p> : null}
            </div>
          </ChartCard>

          <ChartCard eyebrow="Policy clean-up" title="Missing reorder/safety policy" description="MRP alerts are now driven by item master policy, not hidden defaults.">
            <div className="space-y-2">
              {policyMissingRows.slice(0, 5).map((row: any) => (
                <Link key={row.item_id} href="/inventory/items" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 transition hover:bg-amber-100">
                  <span className="font-semibold">{row.item_code}</span>
                  <span className="text-xs">Set policy</span>
                </Link>
              ))}
              {!policyMissingRows.length ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">All statement rows have reorder or safety controls.</p> : null}
            </div>
          </ChartCard>
        </div>
      </section>
    </div>
  )
}
