"use client"

import { FormEvent, useMemo, useState } from "react"

import { EmptyState, ExecutiveHero, Panel, StatusBadge } from "@/components/erp/shell"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { StageQcFields } from "@/components/qc/StageQcFields"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useApp } from "@/context/AppContext"
import { useCreateInventoryQualityInspection, usePendingInventoryQuality } from "@/hooks/use-inventory"
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
  const createInventoryInspection = useCreateInventoryQualityInspection()
  const pendingQuality = useMemo(() => asArray(pendingQualityQuery.data), [pendingQualityQuery.data])
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
          title="Inspect receipt lots against the item quality profile."
          description="The measured result is computed from owned item rules. A client-authored PASS, FAIL, or disposition cannot decide the verdict."
        />
        <QualityDeskNav />
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
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
                    className={`mb-2 w-full rounded-2xl border px-4 py-3 text-left ${active ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-950">{row.label}</p>
                      <StatusBadge value={row.stock_status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{row.material_type} · {row.source}</p>
                  </button>
                )
              })
            )}
          </Panel>
          <Panel title="Item profile readings" subtitle="No result or disposition shortcut. The server returns PASS, FAIL, INCOMPLETE, or INVALID.">
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm font-semibold text-slate-950">{selectedPending ? selectedPending.label : "Select held material"}</p>
              {selectedPending && !parameters.length ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
                <p className="text-xs text-slate-500">Open Inventory → Items to add owned incoming parameters. {formatAllowedRange(null)}</p>
              ) : null}
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Inspector notes (optional)"
                className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
              />
              <button
                type="submit"
                disabled={!selectedPending || createInventoryInspection.isPending}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Submit readings — server verdict
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </RoleGate>
  )
}
