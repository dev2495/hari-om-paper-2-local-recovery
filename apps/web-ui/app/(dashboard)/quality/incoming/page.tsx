"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useCreateInventoryQualityInspection, useInventoryQualityConcessions, usePendingInventoryQuality } from "@/hooks/use-inventory"
import { MODULE_APPEARANCES } from "@/lib/erp-appearance"
import { formatAllowedRange } from "@/lib/qc-measurement"

function asArray(value: any) {
  return Array.isArray(value) ? value : []
}

export default function IncomingQualityPage() {
  const { showToast } = useApp()
  const [selectedPendingId, setSelectedPendingId] = useState("")
  const [readings, setReadings] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState("")
  const pendingQualityQuery = usePendingInventoryQuality()
  const concessionsQuery = useInventoryQualityConcessions()
  const createInventoryInspection = useCreateInventoryQualityInspection()
  const pendingQuality = useMemo(() => asArray(pendingQualityQuery.data), [pendingQualityQuery.data])
  const concessions = useMemo(() => asArray(concessionsQuery.data), [concessionsQuery.data])
  const selectedPending = pendingQuality.find((row: any) => `${row.entity_type}:${row.entity_id}` === selectedPendingId) || null
  const profile = selectedPending?.quality_profile || {}
  const parameters = asArray(profile.parameters).filter((row: any) => row?.applicable !== false)

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
      const response = await createInventoryInspection.mutateAsync({
        entity_type: selectedPending.entity_type,
        entity_id: selectedPending.entity_id,
        material_type: selectedPending.material_type,
        source: selectedPending.source || "INWARD",
        readings: numericReadings,
        reasons,
        notes: notes || undefined,
        status: "PASS",
        disposition: "ACCEPT",
      })
      const payload = response?.data || {}
      const verdict = payload.status
      const ignored = payload.ignored_client_status
      showToast(
        `Incoming QC verdict ${verdict}. Client status ${ignored || "PASS"} was not trusted.`,
        verdict === "FAIL" ? "error" : "success",
      )
      setReadings({})
      setReasons({})
      setNotes("")
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Inventory QC save failed."
      showToast(typeof detail === "string" ? detail : JSON.stringify(detail), "error")
    }
  }

  return (
    <RoleGate allow={["QC", "PlantManager", "Store"]}>
      <div className="space-y-6" data-testid="quality-incoming-page">
        <ExecutiveHero
          appearance={MODULE_APPEARANCES.analytics}
          badge="Incoming QC"
          title="Incoming inspection"
          description="The measured result is computed from owned item rules. A client-authored PASS, FAIL, or disposition cannot decide the verdict."
        />
        <QualityDeskNav />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Panel title="Held inward material" subtitle="Select a lot. Parameters come from that item's quality profile.">
            {pendingQualityQuery.isLoading ? (
              <LoadingState label="Loading held material..." />
            ) : pendingQualityQuery.isError ? (
              <ErrorState
                message="Held inward material could not be loaded. This is not an empty QC queue."
                onRetry={() => {
                  void pendingQualityQuery.refetch()
                }}
              />
            ) : pendingQuality.length === 0 ? (
              <EmptyState label="No inward material is waiting for QC." />
            ) : (
              pendingQuality.map((row: any) => {
                const key = `${row.entity_type}:${row.entity_id}`
                const active = key === selectedPendingId
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedPendingId(key)
                      setReadings({})
                      setReasons({})
                      setNotes("")
                    }}
                    className={`mb-2 w-full rounded-2xl border px-4 py-3 text-left ${active ? "border-signal-cyan-line bg-signal-cyan-soft" : "border-border bg-card"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{row.label}</p>
                      <StatusBadge value={row.stock_status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{row.material_type} · {row.source}</p>
                  </button>
                )
              })
            )}
          </Panel>
          <Panel title="Item profile readings" subtitle="No result or disposition shortcut. The server returns PASS, FAIL, INCOMPLETE, or INVALID.">
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm font-semibold text-foreground">{selectedPending ? selectedPending.label : "Select held material"}</p>
              {selectedPending && !parameters.length ? (
                <p className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink">
                  This item has no approved quality profile. Incoming QC will stay INCOMPLETE until item rules are saved.
                </p>
              ) : null}
              {parameters.length ? (
                <StageQcFields
                  rules={parameters}
                  readings={readings}
                  reasons={reasons}
                  onReadingChange={(code, value) => setReadings((current) => ({ ...current, [code]: value }))}
                  onReasonChange={(code, value) => setReasons((current) => ({ ...current, [code]: value }))}
                />
              ) : selectedPending ? (
                <p className="text-xs text-muted-foreground">Open Inventory → Items to add owned incoming parameters. {formatAllowedRange(null)}</p>
              ) : null}
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Inspector notes (optional)"
                className="min-h-20 w-full rounded-xl border border-border px-3 py-3 text-sm"
              />
              <button
                type="submit"
                disabled={!selectedPending || createInventoryInspection.isPending}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Submit readings — server verdict
              </button>
            </form>
          </Panel>
        </div>
        <Panel
          title="Concession authorizations"
          subtitle="Measured FAIL stays FAIL. A concession is a separate limited authorization, not unrestricted interchangeable stock."
        >
          <div data-testid="quality-incoming-concessions" className="space-y-3">
            {concessionsQuery.isLoading ? (
              <LoadingState label="Loading concession authorizations..." />
            ) : concessions.length === 0 ? (
              <EmptyState label="No concession authorizations recorded." />
            ) : (
              concessions.map((row: any) => (
                <div
                  key={row.concession_id || `${row.inspection_id}:${row.approved_at}`}
                  data-testid="quality-incoming-concession"
                  className="rounded-2xl border border-border bg-card px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      Measured {row.measured_status || "FAIL"} · released {row.released_stock_status || row.stock_status || "held"}
                    </p>
                    <StatusBadge value={row.released_stock_status || "CONCESSION"} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="quality-incoming-concession-separate">
                    Concession is a separate record. Quantity {row.quantity}. Residual stays held.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inspection {row.inspection_id} · Customer {row.permitted_customer_id || "unscoped"} · Order {row.permitted_sales_order_id || "unscoped"}
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
