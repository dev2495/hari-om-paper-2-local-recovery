"use client"

import { formatAllowedRange, type QcParameterRule } from "@/lib/qc-measurement"

type StageQcFieldsProps = {
  rules: QcParameterRule[]
  readings: Record<string, string>
  reasons: Record<string, string>
  sampleId?: string
  editable?: boolean
  showReasons?: boolean
  onReadingChange?: (code: string, value: string) => void
  onReasonChange?: (code: string, value: string) => void
  onSampleIdChange?: (value: string) => void
  paired?: boolean
}

export function StageQcFields({
  rules,
  readings,
  reasons,
  sampleId,
  editable = true,
  showReasons = true,
  onReadingChange,
  onReasonChange,
  onSampleIdChange,
  paired,
}: StageQcFieldsProps) {
  return (
    <div className="space-y-3" data-testid="stage-qc-fields">
      {paired ? (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Sample / pair ID</span>
          {editable ? (
            <input
              value={sampleId || ""}
              onChange={(event) => onSampleIdChange?.(event.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm"
              placeholder="Same identified sample for pre and post"
            />
          ) : (
            <div className="text-sm font-semibold text-slate-900">{sampleId || "-"}</div>
          )}
        </label>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rules.filter((rule) => rule.applicable !== false).map((rule) => (
          <div key={rule.code} className="rounded-2xl border border-slate-200 bg-white p-3">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{rule.label}</span>
              {editable ? (
                <input
                  type="number"
                  step="0.001"
                  value={readings[rule.code] || ""}
                  onChange={(event) => onReadingChange?.(rule.code, event.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              ) : (
                <div className="text-sm font-semibold text-slate-900">{readings[rule.code] || ""}</div>
              )}
            </label>
            <p className="mt-2 text-xs font-semibold text-slate-600" data-testid={`allowed-${rule.code}`}>
              {formatAllowedRange(rule)}
            </p>
            {rule.method || rule.specimen || rule.sampling ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {[rule.method, rule.specimen, rule.sampling].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {showReasons ? (
              <label className="mt-2 block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Reason if FAIL</span>
                {editable ? (
                  <input
                    value={reasons[rule.code] || ""}
                    onChange={(event) => onReasonChange?.(rule.code, event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    placeholder="Required only for out-of-range readings"
                  />
                ) : (
                  <div className="text-xs text-slate-600">{reasons[rule.code] || ""}</div>
                )}
              </label>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
