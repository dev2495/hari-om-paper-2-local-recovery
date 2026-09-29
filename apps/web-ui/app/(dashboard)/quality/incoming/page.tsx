"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import {
  useCreateInventoryQualityConcession,
  useCreateInventoryQualityInspection,
  useInventoryQualityConcessions,
  usePendingInventoryQuality,
  useReturnRejectedLotToSupplier,
} from "@/hooks/use-inventory"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

const QUEUE_TABS = [
  { key: "AWAITING_INSPECTION", label: "Awaiting inspection" },
  { key: "FAILED", label: "Failed / on hold" },
  { key: "REJECTED", label: "Rejected" },
  { key: "COMMERCIAL_HOLD", label: "Commercial hold" },
] as const
type QueueKey = (typeof QUEUE_TABS)[number]["key"]

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail?.message) return detail.message
  return error?.message || fallback
}

function when(value?: string | null) {
  if (!value) return "—"
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function IncomingQualityPage() {
  const { showToast } = useApp()
  const { user } = useAuth()
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const canInspect = roles.has("QC") || roles.has("Owner") || roles.has("Admin")
  const canConcede = roles.has("Owner") || roles.has("Admin") || (user?.permissions || []).includes("qc:disposition:approve")
  const canReturn = ["Owner", "Admin", "PlantManager", "Store"].some((role) => roles.has(role))
  const searchParams = useSearchParams()
  const [selectedPendingId, setSelectedPendingId] = useState(searchParams?.get("lot") || "")
  const [tab, setTab] = useState<QueueKey>("AWAITING_INSPECTION")
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState("")
  const [resolvedHoldIds, setResolvedHoldIds] = useState<string[]>([])
  const [disposition, setDisposition] = useState("AUTO")
  const [certNo, setCertNo] = useState("")
  const [certMatches, setCertMatches] = useState<"" | "yes" | "no">("")
  const [sampleCount, setSampleCount] = useState("")
  const [sampleIds, setSampleIds] = useState("")
  const [concessionReason, setConcessionReason] = useState("")
  const [concessionQty, setConcessionQty] = useState("")
  const [concessionExpiry, setConcessionExpiry] = useState("")
  const [returnReason, setReturnReason] = useState("")
  const [returnRef, setReturnRef] = useState("")
  const pendingQualityQuery = usePendingInventoryQuality()
  const concessionsQuery = useInventoryQualityConcessions()
  const createInventoryInspection = useCreateInventoryQualityInspection()
  const createConcession = useCreateInventoryQualityConcession()
  const returnLot = useReturnRejectedLotToSupplier()
  const pendingQuality = useMemo(() => asArray(pendingQualityQuery.data), [pendingQualityQuery.data])
  const concessions = useMemo(() => asArray(concessionsQuery.data), [concessionsQuery.data])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const row of pendingQuality) out[row.queue_state || "AWAITING_INSPECTION"] = (out[row.queue_state || "AWAITING_INSPECTION"] || 0) + 1
    return out
  }, [pendingQuality])
  const visible = pendingQuality.filter((row: any) => (row.queue_state || "AWAITING_INSPECTION") === tab)
  const selectedPending = pendingQuality.find((row: any) => `${row.entity_type}:${row.entity_id}` === selectedPendingId) || null
  const profile = selectedPending?.quality_profile || {}
  const parameters = asArray(profile.parameters).filter((row: any) => row?.applicable !== false)
  const lastInspection = selectedPending?.last_inspection || null
  const failedInspection = lastInspection && String(lastInspection.status).toUpperCase() === "FAIL" ? lastInspection : null
  const returnable = Boolean(
    selectedPending &&
      ["BATCH", "REEL"].includes(selectedPending.entity_type) &&
      lastInspection &&
      (String(lastInspection.status).toUpperCase() === "FAIL" || ["REJECT", "BLOCK", "SCRAP"].includes(String(lastInspection.disposition || "").toUpperCase())),
  )

  const resetForm = () => {
    setResolvedHoldIds([])
    setReadings({})
    setReasons({})
    setNotes("")
    setDisposition("AUTO")
    setCertNo("")
    setCertMatches("")
    setSampleCount("")
    setSampleIds("")
    setConcessionReason("")
    setConcessionQty("")
    setConcessionExpiry("")
    setReturnReason("")
    setReturnRef("")
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedPending) {
      showToast("Select held inward material before saving QC.", "error")
      return
    }
    try {
      const numericReadings = Object.fromEntries(
        Object.entries(readings)
          .filter(([, value]) => String(value).trim() !== "")
          .map(([key, value]) => {
            const number = Number(value)
            return [key, Number.isFinite(number) ? number : value]
          }),
      )
      const ids = sampleIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      const response = await createInventoryInspection.mutateAsync({
        entity_type: selectedPending.entity_type,
        entity_id: selectedPending.entity_id,
        material_type: selectedPending.material_type,
        source: selectedPending.source || "INWARD",
        readings: numericReadings,
        reasons,
        notes: notes || undefined,
        resolve_hold_ids: resolvedHoldIds,
        disposition: disposition === "AUTO" ? undefined : disposition,
        ...(certNo.trim() || certMatches
          ? { supplier_certificate: { certificate_no: certNo.trim() || undefined, matches_readings: certMatches ? certMatches === "yes" : undefined } }
          : {}),
        ...(sampleCount.trim() ? { sample_count: Math.max(0, Math.floor(Number(sampleCount))) } : {}),
        ...(ids.length ? { sample_ids: ids } : {}),
      })
      const payload = response?.data || {}
      const verdict = payload.status
      showToast(
        `Inspection saved: ${verdict}. ${payload.stock_status === "UNRESTRICTED" ? "Material released for issue." : "Material remains held."}`,
        verdict === "FAIL" ? "error" : "success",
      )
      resetForm()
    } catch (error: any) {
      showToast(errorText(error, "Inventory QC save failed."), "error")
    }
  }

  const handleConcession = async () => {
    if (!failedInspection) return
    if (concessionReason.trim().length < 3) {
      showToast("Give the reason this FAIL can still be used.", "error")
      return
    }
    try {
      await createConcession.mutateAsync({
        inspection_id: failedInspection.id,
        reason: concessionReason.trim(),
        quantity: concessionQty.trim() ? Number(concessionQty) : undefined,
        release_stock: true,
        operation_id: `concession-${failedInspection.id}-${concessionQty || "all"}`,
        expires_at: concessionExpiry ? new Date(concessionExpiry).toISOString() : undefined,
      })
      showToast("Concession recorded. The measured FAIL stays on record; only the released quantity can be issued.", "success")
      resetForm()
    } catch (error: any) {
      showToast(errorText(error, "Concession could not be recorded."), "error")
    }
  }

  const handleReturn = async () => {
    if (!selectedPending) return
    if (returnReason.trim().length < 3) {
      showToast("Give the reason for returning this material.", "error")
      return
    }
    if (!window.confirm(`Return ${selectedPending.qty} ${selectedPending.uom || "KG"} of ${selectedPending.label} to the supplier? Stock is written out and cannot be issued.`)) return
    try {
      const response = await returnLot.mutateAsync({
        entity_type: selectedPending.entity_type,
        entity_id: String(selectedPending.entity_id),
        reason: returnReason.trim(),
        return_reference: returnRef.trim() || undefined,
      })
      showToast(response?.data?.message || "Returned to supplier.", "success")
      setSelectedPendingId("")
      resetForm()
    } catch (error: any) {
      showToast(errorText(error, "Return could not be recorded."), "error")
    }
  }

  return (
    <RoleGate allow={["QC", "Store", "PlantManager"]}>
      <div className="space-y-6" data-testid="quality-incoming-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Incoming QC"
          title="Incoming inspection"
          description="Inspect inward material within 24 hours. Approved material standards decide the result; held or rejected material stays unavailable for issue until it passes, is conceded, or goes back to the supplier."
        />
        <QualityDeskNav />
        <div className="flex flex-wrap gap-2" data-testid="incoming-queue-tabs">
          {QUEUE_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={`incoming-tab-${item.key}`}
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                tab === item.key ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {item.label} · {counts[item.key] || 0}
            </button>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Panel title="Held inward material" subtitle="Select a lot. Parameters come from the standard frozen on that receipt.">
            {pendingQualityQuery.isLoading ? (
              <LoadingState label="Loading held material..." />
            ) : pendingQualityQuery.isError ? (
              <ErrorState
                message="Held inward material could not be loaded. This is not an empty QC queue."
                onRetry={() => {
                  void pendingQualityQuery.refetch()
                }}
              />
            ) : visible.length === 0 ? (
              <EmptyState label={tab === "AWAITING_INSPECTION" ? "No inward material is waiting for QC." : "Nothing in this list."} />
            ) : (
              visible.map((row: any) => {
                const key = `${row.entity_type}:${row.entity_id}`
                const active = key === selectedPendingId
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`incoming-lot-${row.entity_id}`}
                    onClick={() => {
                      resetForm()
                      setSelectedPendingId(key)
                    }}
                    className={`mb-2 w-full rounded-2xl border px-4 py-3 text-left ${active ? "border-signal-cyan-line bg-signal-cyan-soft" : "border-border bg-card"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{row.label}</p>
                      <StatusBadge value={row.stock_status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.material_type} · {row.qty} {row.uom || "KG"} · {row.supplier_or_customer || row.source}
                    </p>
                    {row.grn_no || row.po_no || row.invoice_no ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[row.grn_no && `GRN ${row.grn_no}`, row.po_no && `PO ${row.po_no}`, row.invoice_no && `Inv ${row.invoice_no}`].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {row.last_inspection ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last check {row.last_inspection.status}
                        {row.last_inspection.disposition ? ` · ${row.last_inspection.disposition}` : ""} · {when(row.last_inspection.created_at)}
                        {row.last_inspection.failures?.length ? ` · ${row.last_inspection.failures.join(", ")}` : ""}
                      </p>
                    ) : row.due_at ? (
                      <p className={`mt-1 text-xs ${row.overdue ? "font-semibold text-signal-rose-ink" : "text-muted-foreground"}`}>
                        {row.overdue ? "Overdue · " : "Due · "}
                        {new Date(row.due_at).toLocaleString("en-IN")}
                      </p>
                    ) : null}
                  </button>
                )
              })
            )}
          </Panel>

          <div className="space-y-5">
            <Panel title="Inspection" subtitle="Enter measurements against the approved tolerance. Failed or incomplete readings remain on hold.">
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm font-semibold text-foreground">{selectedPending ? selectedPending.label : "Select held material"}</p>
                {selectedPending ? (
                  <dl className="grid gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-xs sm:grid-cols-3" data-testid="incoming-lot-context">
                    <div><dt className="text-muted-foreground">Supplier / customer</dt><dd className="font-semibold">{selectedPending.supplier_or_customer || "—"}</dd></div>
                    <div><dt className="text-muted-foreground">GRN · received</dt><dd className="font-semibold">{selectedPending.grn_no || "—"}{selectedPending.received_date ? ` · ${selectedPending.received_date}` : ""}</dd></div>
                    <div><dt className="text-muted-foreground">PO · invoice</dt><dd className="font-semibold">{selectedPending.po_no || "—"} · {selectedPending.invoice_no || "no invoice yet"}</dd></div>
                    <div><dt className="text-muted-foreground">Quantity</dt><dd className="font-semibold">{selectedPending.qty} {selectedPending.uom || "KG"}</dd></div>
                    <div><dt className="text-muted-foreground">Standard</dt><dd className="font-semibold">{profile.revision ? `Rev ${profile.revision} · ${profile.status || ""}` : "none frozen"}</dd></div>
                    {selectedPending.nominal && Object.keys(selectedPending.nominal).length ? (
                      <div><dt className="text-muted-foreground">Ordered nominal</dt><dd className="font-semibold">{Object.entries(selectedPending.nominal).map(([key, value]) => `${key.toUpperCase().replace("_MM", " mm")} ${value}`).join(" · ")}</dd></div>
                    ) : null}
                  </dl>
                ) : null}
                {selectedPending && !parameters.length ? (
                  <p className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink">
                    This material has no approved standard. Incoming QC stays INCOMPLETE until one is approved in{" "}
                    <Link className="font-semibold underline" href="/quality/material-standards">Quality → Material standards</Link>.
                  </p>
                ) : null}
                {!canInspect && selectedPending ? (
                  <p className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="incoming-read-only">
                    Only QC (or Owner/Admin) records incoming readings. You can see the lot and, where allowed, resolve a rejection below.
                  </p>
                ) : null}
                {canInspect && parameters.length ? (
                  <StageQcFields
                    rules={parameters}
                    readings={readings}
                    reasons={reasons}
                    onReadingChange={(code, value) => setReadings((current) => ({ ...current, [code]: value }))}
                    onReasonChange={(code, value) => setReasons((current) => ({ ...current, [code]: value }))}
                  />
                ) : null}
                {canInspect && selectedPending ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium">Supplier test certificate no.
                        <input className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3" value={certNo} onChange={(event) => setCertNo(event.target.value)} placeholder="Mill TC / COA number" />
                      </label>
                      <label className="block text-sm font-medium">Certificate agrees with our readings?
                        <select className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3" value={certMatches} onChange={(event) => setCertMatches(event.target.value as "" | "yes" | "no")}>
                          <option value="">Not checked</option>
                          <option value="yes">Yes</option>
                          <option value="no">No — note the difference</option>
                        </select>
                      </label>
                      <label className="block text-sm font-medium">Samples tested
                        <input type="number" min={0} className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3" value={sampleCount} onChange={(event) => setSampleCount(event.target.value)} />
                      </label>
                      <label className="block text-sm font-medium">Sample IDs (comma separated)
                        <input className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3" value={sampleIds} onChange={(event) => setSampleIds(event.target.value)} />
                      </label>
                    </div>
                    <label className="block text-sm font-medium">Disposition
                      <select className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3" value={disposition} onChange={(event) => setDisposition(event.target.value)}>
                        <option value="AUTO">Accept only if all checks pass</option>
                        <option value="HOLD">Hold for review</option>
                        <option value="REJECT">Reject inward material</option>
                      </select>
                    </label>
                    {asArray(selectedPending?.inspection_holds).length ? (
                      <fieldset className="space-y-2 rounded-xl border border-border p-3">
                        <legend className="px-1 text-sm font-semibold">Earlier inspection holds</legend>
                        <p className="text-xs text-muted-foreground">Select only the holds resolved by this reinspection. Closing requires passing all checks and an explanation. Other holds remain active.</p>
                        {asArray(selectedPending.inspection_holds).map((hold: any) => (
                          <label key={hold.id} className="flex items-start gap-2 text-sm">
                            <input type="checkbox" className="mt-1" checked={resolvedHoldIds.includes(hold.id)} onChange={(event) => setResolvedHoldIds((ids) => (event.target.checked ? [...ids, hold.id] : ids.filter((id) => id !== hold.id)))} />
                            <span>{hold.reason}</span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      aria-label="Inspector notes"
                      placeholder={resolvedHoldIds.length ? "Explain why the selected inspection holds can close" : "Inspector notes (optional)"}
                      required={resolvedHoldIds.length > 0}
                      className="min-h-20 w-full rounded-xl border border-border px-3 py-3 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={!selectedPending || createInventoryInspection.isPending}
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {lastInspection ? "Save re-inspection" : "Save QC inspection"}
                    </button>
                  </>
                ) : null}
              </form>
            </Panel>

            {selectedPending && (failedInspection || returnable) ? (
              <Panel title="Resolve a failed or rejected lot" subtitle="Re-inspect above, allow limited use by concession, or send it back to the supplier.">
                <div className="space-y-5" data-testid="incoming-resolution">
                  {failedInspection ? (
                    <div className="space-y-3 rounded-xl border border-border p-3">
                      <p className="text-sm font-semibold">Concession (use despite FAIL)</p>
                      {canConcede ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Measured FAIL stays on record. Owner/Admin only, and never the person who inspected it. Critical checks cannot be conceded.
                          </p>
                          <textarea className="min-h-16 w-full rounded-xl border border-border px-3 py-2 text-sm" value={concessionReason} onChange={(event) => setConcessionReason(event.target.value)} placeholder="Why this material is still fit for use" data-testid="incoming-concession-reason" />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-xs font-medium">Quantity to release (blank = whole lot)
                              <input type="number" min={0} step="0.001" className="mt-1 h-10 w-full rounded-xl border border-border px-3" value={concessionQty} onChange={(event) => setConcessionQty(event.target.value)} />
                            </label>
                            <label className="block text-xs font-medium">Valid until (optional)
                              <input type="date" className="mt-1 h-10 w-full rounded-xl border border-border px-3" value={concessionExpiry} onChange={(event) => setConcessionExpiry(event.target.value)} />
                            </label>
                          </div>
                          <button type="button" data-testid="incoming-concession-submit" disabled={createConcession.isPending} onClick={() => void handleConcession()} className="rounded-xl border border-foreground/80 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                            Record concession
                          </button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">An Owner or Admin (not the inspector) can authorise a concession.</p>
                      )}
                    </div>
                  ) : null}
                  {returnable ? (
                    <div className="space-y-3 rounded-xl border border-signal-rose-line p-3">
                      <p className="text-sm font-semibold">Return to supplier</p>
                      {canReturn ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Writes the whole remaining lot out of stock and marks the GRN line REJECTED. If the supplier invoice is attached, a quality claim opens for the debit note.
                          </p>
                          <textarea className="min-h-16 w-full rounded-xl border border-border px-3 py-2 text-sm" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Reason, e.g. GSM 150 against 200–260" data-testid="incoming-return-reason" />
                          <input className="h-10 w-full rounded-xl border border-border px-3 text-sm" value={returnRef} onChange={(event) => setReturnRef(event.target.value)} placeholder="Return challan / vehicle no. (optional)" />
                          <button type="button" data-testid="incoming-return-submit" disabled={returnLot.isPending} onClick={() => void handleReturn()} className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2 text-sm font-semibold text-signal-rose-ink disabled:opacity-60">
                            Return to supplier
                          </button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Store, Plant Manager, Owner or Admin records the physical return.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
        <Panel title="Concession authorizations" subtitle="Measured FAIL stays FAIL. A concession is a separate limited authorization, not unrestricted interchangeable stock.">
          <div data-testid="quality-incoming-concessions" className="space-y-3">
            {concessionsQuery.isLoading ? (
              <LoadingState label="Loading concession authorizations..." />
            ) : concessions.length === 0 ? (
              <EmptyState label="No concession authorizations recorded." />
            ) : (
              concessions.map((row: any) => (
                <div key={row.concession_id || `${row.inspection_id}:${row.approved_at}`} data-testid="quality-incoming-concession" className="rounded-2xl border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      Measured {row.measured_status || "FAIL"} · released {row.released_stock_status || row.stock_status || "held"}
                    </p>
                    <StatusBadge value={row.released_stock_status || "CONCESSION"} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="quality-incoming-concession-separate">
                    Concession is a separate record. Quantity {row.quantity ?? "whole lot"}. Residual stays held.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.reason} · by {row.approved_by || "—"}
                    {row.expires_at ? ` · Expires ${row.expires_at}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </RoleGate>
  )
}
