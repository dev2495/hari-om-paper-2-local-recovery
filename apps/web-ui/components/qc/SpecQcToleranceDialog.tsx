"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { QC_STAGE_PARAMETERS, emptyQcProfile, formatAllowedRange, type QcStageKey } from "@/lib/qc-measurement"

type SpecQcToleranceDialogProps = {
  open: boolean
  context: {
    customer?: string
    product?: string
    plant?: string
    dimensions?: string
    targetWeight?: string
    cs?: string
    recipe?: string
    ply?: string
    parchment?: string
    notching?: boolean | null
  }
  initialProfile?: any
  saving?: boolean
  onBack: (profile: any) => void
  onDiscard: () => void
  onSaveDraft: (profile: any) => void
  onSaveComplete: (profile: any) => void
}

const STAGES: { key: QcStageKey; label: string }[] = [
  { key: "WINDER", label: "Winding" },
  { key: "OVEN", label: "Oven" },
  { key: "PROCESS", label: "Process" },
]

function cloneProfile(profile: any, notching: boolean | null) {
  const resolvedNotching =
    profile && "notching_applicable" in (profile || {})
      ? (profile.notching_applicable as boolean | null)
      : notching
  const base = emptyQcProfile(resolvedNotching ?? null)
  const incoming = profile?.stages || {}
  for (const stage of Object.keys(base.stages) as QcStageKey[]) {
    base.stages[stage] = { ...incoming[stage], ...base.stages[stage] }
    const defs = QC_STAGE_PARAMETERS[stage] || []
    const incomingRows = Array.isArray(incoming[stage]?.parameters) ? incoming[stage].parameters : []
    const byCode = Object.fromEntries(incomingRows.map((row: any) => [row.code, row]))
    base.stages[stage].parameters = base.stages[stage].parameters.map((row) => {
      const incomingRow = byCode[row.code] || {}
      const def = defs.find((item) => item.code === row.code)
      return {
        ...row,
        ...incomingRow,
        code: row.code,
        label: def?.label || row.label,
        unit: incomingRow.unit || row.unit,
        basis_hint: def?.basisHint || row.basis_hint,
        pair_group: row.pair_group,
        conditional: row.conditional,
        applicable:
          row.conditional === "notching"
            ? resolvedNotching === false
              ? false
              : resolvedNotching === true
                ? incomingRow.applicable !== false
                : incomingRow.applicable ?? null
            : incomingRow.applicable !== false,
        min: row.conditional === "notching" && resolvedNotching === false ? null : incomingRow.min ?? row.min,
        max: row.conditional === "notching" && resolvedNotching === false ? null : incomingRow.max ?? row.max,
      }
    })
  }
  if (profile?.revision) base.revision = profile.revision
  base.notching_applicable = resolvedNotching ?? null
  base.notching_review_required = Boolean(profile?.notching_review_required) || resolvedNotching == null
  return base
}

export function SpecQcToleranceDialog({
  open,
  context,
  initialProfile,
  saving,
  onBack,
  onDiscard,
  onSaveDraft,
  onSaveComplete,
}: SpecQcToleranceDialogProps) {
  const [stage, setStage] = useState<QcStageKey>("WINDER")
  const [profile, setProfile] = useState(() => cloneProfile(initialProfile, context.notching ?? null))
  const profileRef = useRef(profile)
  profileRef.current = profile

  useEffect(() => {
    if (open) {
      setStage("WINDER")
      setProfile(cloneProfile(initialProfile, context.notching ?? null))
    }
  }, [open, initialProfile, context.notching])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onBack(profileRef.current)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onBack])

  const stageRows = profile.stages[stage]?.parameters || []

  const summary = useMemo(
    () =>
      STAGES.map((item) => {
        const rows = profile.stages[item.key]?.parameters || []
        const configured = rows.filter((row: any) => row.applicable !== false && (row.min != null || row.max != null)).length
        return `${item.label} ${configured}/${rows.length}`
      }).join(" · "),
    [profile],
  )

  if (!open) return null

  function updateRow(code: string, patch: Record<string, any>) {
    setProfile((current: any) => ({
      ...current,
      stages: {
        ...current.stages,
        [stage]: {
          ...current.stages[stage],
          parameters: (current.stages[stage]?.parameters || []).map((row: any) =>
            row.code === code ? { ...row, ...patch } : row,
          ),
        },
      },
    }))
  }

  function setNotchingState(next: "unknown" | "true" | "false") {
    const flag = next === "unknown" ? null : next === "true"
    setProfile((current: any) => ({
      ...current,
      notching_applicable: flag,
      notching_review_required: flag == null,
      stages: {
        ...current.stages,
        PROCESS: {
          ...current.stages.PROCESS,
          parameters: (current.stages.PROCESS?.parameters || []).map((row: any) =>
            row.conditional === "notching"
              ? {
                  ...row,
                  applicable: flag,
                  min: flag === false ? null : row.min,
                  max: flag === false ? null : row.max,
                }
              : row,
          ),
        },
      },
    }))
  }

  const notchingState =
    profile.notching_applicable === true ? "true" : profile.notching_applicable === false ? "false" : "unknown"
  const needsNotchingReview = profile.notching_applicable == null || Boolean(profile.notching_review_required)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      data-testid="spec-qc-tolerance-dialog"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Review quality tolerances</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Stage QC setup before save</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {context.customer || "Customer pending"} · {context.product || "Product pending"} · {context.plant || "Plant"} · {context.dimensions || "Dimensions pending"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Target weight {context.targetWeight || "pending"} · C.S. {context.cs || "pending"} · Recipe {context.recipe || "pending"} · Ply {context.ply || "pending"} · Parchment {context.parchment || "pending"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Final product limits stay on the spec sheet. Winding / oven / process ranges are entered here and frozen onto job cards. No invented ± bands.
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">{summary}</p>
          {needsNotchingReview ? (
            <p className="mt-2 text-xs font-semibold text-signal-amber-ink" data-testid="spec-qc-notching-review">
              Notching applicability needs review. Do not store zero or skip automatically.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border px-6 py-3">
          {STAGES.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={`spec-qc-stage-${item.key}`}
              onClick={() => setStage(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ${
                stage === item.key ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {stage === "PROCESS" ? (
            <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notching</span>
              <select
                data-testid="spec-qc-notching-state"
                className="h-10 rounded-xl border border-border px-2"
                value={notchingState}
                onChange={(event) => setNotchingState(event.target.value as "unknown" | "true" | "false")}
              >
                <option value="unknown">Unknown — needs review</option>
                <option value="false">Verified not notched</option>
                <option value="true">Verified notched</option>
              </select>
            </label>
          ) : null}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="border border-border px-2 py-2">Parameter</th>
                <th className="border border-border px-2 py-2">Unit</th>
                <th className="border border-border px-2 py-2">Method</th>
                <th className="border border-border px-2 py-2">Specimen</th>
                <th className="border border-border px-2 py-2">Sampling</th>
                <th className="border border-border px-2 py-2">Min</th>
                <th className="border border-border px-2 py-2">Max</th>
                <th className="border border-border px-2 py-2">Frozen rule</th>
              </tr>
            </thead>
            <tbody>
              {stageRows.map((row: any) => {
                const notApplicable = row.applicable === false
                return (
                <tr key={row.code} data-testid={`spec-qc-row-${stage}-${row.code}`}>
                  <td className="border border-border px-2 py-2 font-semibold text-foreground" data-testid={`spec-qc-param-label-${stage}-${row.code}`}>
                    {row.label}
                    {row.conditional === "notching" ? (
                      <label className="mt-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={row.applicable === true}
                          onChange={(event) => updateRow(row.code, { applicable: event.target.checked, min: event.target.checked ? row.min : null, max: event.target.checked ? row.max : null })}
                        />
                        Applicable
                      </label>
                    ) : null}
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input className="h-10 w-20 rounded-xl border border-border px-2" value={row.unit || ""} onChange={(event) => updateRow(row.code, { unit: event.target.value })} />
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input className="h-10 w-full rounded-xl border border-border px-2" value={row.method || ""} onChange={(event) => updateRow(row.code, { method: event.target.value })} />
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input
                      className="h-10 w-full rounded-xl border border-border px-2"
                      value={row.specimen || ""}
                      placeholder={row.basis_hint || ""}
                      onChange={(event) => updateRow(row.code, { specimen: event.target.value })}
                    />
                    {row.basis_hint ? (
                      <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`spec-qc-basis-${stage}-${row.code}`}>
                        Stage basis: {row.basis_hint}
                      </p>
                    ) : null}
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input className="h-10 w-full rounded-xl border border-border px-2" value={row.sampling || ""} onChange={(event) => updateRow(row.code, { sampling: event.target.value })} />
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input
                      className="h-10 w-24 rounded-xl border border-border px-2"
                      type="number"
                      step="0.001"
                      disabled={notApplicable}
                      value={notApplicable ? "" : row.min ?? ""}
                      onChange={(event) => updateRow(row.code, { min: event.target.value === "" ? null : Number(event.target.value) })}
                    />
                  </td>
                  <td className="border border-border px-2 py-2">
                    <input
                      className="h-10 w-24 rounded-xl border border-border px-2"
                      type="number"
                      step="0.001"
                      disabled={notApplicable}
                      value={notApplicable ? "" : row.max ?? ""}
                      onChange={(event) => updateRow(row.code, { max: event.target.value === "" ? null : Number(event.target.value) })}
                    />
                  </td>
                  <td className="border border-border px-2 py-2 text-xs font-semibold text-muted-foreground" data-testid={`spec-qc-frozen-${stage}-${row.code}`}>
                    {formatAllowedRange(row)}
                    <label className="mt-2 flex min-h-10 items-center gap-2 font-medium">
                      <input type="checkbox" checked={row.non_waivable === true}
                        aria-label={`Critical non-waivable check: ${row.label || row.code || "parameter"}`}
                        onChange={(event) => updateRow(row.code, { non_waivable: event.target.checked })} />
                      Critical: cannot be waived
                    </label>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          {stage === "OVEN" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Oven pre/post weight and moisture are paired readings on the same identified sample. Post values are not due until that checkpoint.
            </p>
          ) : null}
          {stage === "WINDER" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Winding uses Height, not Length, and does not copy finished-product ID/OD/CS bands automatically.
            </p>
          ) : null}
          {stage === "PROCESS" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Process Height/Weight use the finished specimen basis. Those finals are not copied into winding.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => onBack(profile)}
            className="rounded-2xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground"
          >
            Back to specification
          </button>
          <button
            type="button"
            data-testid="spec-qc-discard"
            onClick={() => {
              if (window.confirm("Discard quality tolerance edits? This does not save the specification.")) {
                onDiscard()
              }
            }}
            className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft px-4 py-2 text-sm font-semibold text-signal-rose-ink"
          >
            Discard QC edits
          </button>
          <button
            type="button"
            data-testid="spec-qc-save-incomplete"
            disabled={saving}
            onClick={() => onSaveDraft({ ...profile, status: "draft" })}
            className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft px-4 py-2 text-sm font-semibold text-signal-amber-ink disabled:opacity-50"
          >
            Save draft — QC incomplete
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSaveComplete({ ...profile, status: "complete" })}
            className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save specification + QC
          </button>
        </div>
      </div>
    </div>
  )
}

export { QC_STAGE_PARAMETERS }
