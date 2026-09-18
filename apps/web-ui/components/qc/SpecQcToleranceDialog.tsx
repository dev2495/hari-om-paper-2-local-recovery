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
    notching?: boolean
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

function cloneProfile(profile: any, notching: boolean) {
  const base = emptyQcProfile(notching)
  const incoming = profile?.stages || {}
  for (const stage of Object.keys(base.stages)) {
    const incomingRows = Array.isArray(incoming[stage]?.parameters) ? incoming[stage].parameters : []
    const byCode = Object.fromEntries(incomingRows.map((row: any) => [row.code, row]))
    base.stages[stage].parameters = base.stages[stage].parameters.map((row) => ({
      ...row,
      ...(byCode[row.code] || {}),
      code: row.code,
      label: byCode[row.code]?.label || row.label,
      unit: byCode[row.code]?.unit || row.unit,
    }))
  }
  if (profile?.revision) base.revision = profile.revision
  base.notching_applicable = notching
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
  const [profile, setProfile] = useState(() => cloneProfile(initialProfile, Boolean(context.notching)))
  const profileRef = useRef(profile)
  profileRef.current = profile

  useEffect(() => {
    if (open) {
      setStage("WINDER")
      setProfile(cloneProfile(initialProfile, Boolean(context.notching)))
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
          parameters: (current.stages[stage]?.parameters || []).map((row: any) =>
            row.code === code ? { ...row, ...patch } : row,
          ),
        },
      },
    }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      data-testid="spec-qc-tolerance-dialog"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Review quality tolerances</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">Stage QC setup before save</h2>
          <p className="mt-2 text-sm text-slate-600">
            {context.customer || "Customer pending"} · {context.product || "Product pending"} · {context.plant || "Plant"} · {context.dimensions || "Dimensions pending"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Target weight {context.targetWeight || "pending"} · C.S. {context.cs || "pending"} · Recipe {context.recipe || "pending"} · Ply {context.ply || "pending"} · Parchment {context.parchment || "pending"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Final product limits stay on the spec sheet. Winding / oven / process ranges are entered here and frozen onto job cards. No invented ± bands.
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-700">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-3">
          {STAGES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStage(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ${
                stage === item.key ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <th className="border border-slate-200 px-2 py-2">Parameter</th>
                <th className="border border-slate-200 px-2 py-2">Unit</th>
                <th className="border border-slate-200 px-2 py-2">Method</th>
                <th className="border border-slate-200 px-2 py-2">Specimen</th>
                <th className="border border-slate-200 px-2 py-2">Sampling</th>
                <th className="border border-slate-200 px-2 py-2">Min</th>
                <th className="border border-slate-200 px-2 py-2">Max</th>
                <th className="border border-slate-200 px-2 py-2">Frozen rule</th>
              </tr>
            </thead>
            <tbody>
              {stageRows.map((row: any) => (
                <tr key={row.code}>
                  <td className="border border-slate-200 px-2 py-2 font-semibold text-slate-900">
                    {row.label}
                    {row.conditional === "notching" ? (
                      <label className="mt-1 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <input
                          type="checkbox"
                          checked={row.applicable !== false}
                          onChange={(event) => updateRow(row.code, { applicable: event.target.checked })}
                        />
                        Applicable
                      </label>
                    ) : null}
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-20 rounded-xl border border-slate-200 px-2" value={row.unit || ""} onChange={(event) => updateRow(row.code, { unit: event.target.value })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-full rounded-xl border border-slate-200 px-2" value={row.method || ""} onChange={(event) => updateRow(row.code, { method: event.target.value })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-full rounded-xl border border-slate-200 px-2" value={row.specimen || ""} onChange={(event) => updateRow(row.code, { specimen: event.target.value })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-full rounded-xl border border-slate-200 px-2" value={row.sampling || ""} onChange={(event) => updateRow(row.code, { sampling: event.target.value })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-24 rounded-xl border border-slate-200 px-2" type="number" step="0.001" value={row.min ?? ""} onChange={(event) => updateRow(row.code, { min: event.target.value === "" ? null : Number(event.target.value) })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2">
                    <input className="h-10 w-24 rounded-xl border border-slate-200 px-2" type="number" step="0.001" value={row.max ?? ""} onChange={(event) => updateRow(row.code, { max: event.target.value === "" ? null : Number(event.target.value) })} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-600">{formatAllowedRange(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stage === "OVEN" ? (
            <p className="mt-3 text-xs text-slate-500">
              Oven pre/post weight and moisture are paired readings on the same identified sample. Post values are not due until that checkpoint.
            </p>
          ) : null}
          {stage === "WINDER" ? (
            <p className="mt-3 text-xs text-slate-500">
              Winding uses Height, not Length, and does not copy finished-product ID/OD/CS bands automatically.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={() => onBack(profile)}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
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
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800"
          >
            Discard QC edits
          </button>
          <button
            type="button"
            data-testid="spec-qc-save-incomplete"
            disabled={saving}
            onClick={() => onSaveDraft({ ...profile, status: "draft" })}
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
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
