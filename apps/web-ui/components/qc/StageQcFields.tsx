"use client"

import {
  formatAllowedRange,
  qcExceptionFeedback,
  qcExceptionIssues,
  qcFieldMeta,
  type QcParameterRule,
} from "@/lib/qc-measurement"

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
  profileRevision?: number | string | null
  checkpoint?: string
  printLayout?: boolean
}

function ExceptionMark({ verdict }: { verdict: "FAIL" | "PASS" | "INVALID" }) {
  const mark = verdict === "PASS" ? "✓" : "!"
  return (
    <span className="qc-exception-icon mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-black" aria-hidden="true">
      {mark}
    </span>
  )
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
  profileRevision,
  checkpoint,
  printLayout = false,
}: StageQcFieldsProps) {
  const issues = qcExceptionIssues(rules, readings)
  return (
    <div className="space-y-3" data-testid="stage-qc-fields">
      {issues.length ? (
        <div className="rounded-xl border border-slate-900 bg-white p-3 text-sm text-slate-900" data-testid="stage-qc-issue-summary" aria-label="Stage QC issues">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">Issues</div>
          <ul className="mt-1 space-y-1">
            {issues.map((issue) => (
              <li key={issue.code}>
                <a className="font-semibold underline" href={`#qc-field-${issue.code}`}>
                  {issue.label} FAIL
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
            <div
              className={printLayout ? "qc-print-writable min-h-11 border border-slate-900 bg-white px-2 py-2 text-sm" : "text-sm font-semibold text-slate-900"}
              data-testid="stage-qc-sample-id"
              data-blank={sampleId ? "false" : "true"}
            >
              {sampleId || ""}
            </div>
          )}
        </label>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const feedback = qcExceptionFeedback(rule, readings[rule.code])
          const describedBy = [
            `allowed-${rule.code}`,
            qcFieldMeta(rule, { checkpoint, revision: profileRevision }) ? `stage-qc-meta-${rule.code}` : null,
            feedback ? `stage-qc-feedback-${rule.code}` : null,
          ]
            .filter(Boolean)
            .join(" ")
          const fail = feedback?.verdict === "FAIL"
          return (
            <div key={rule.code} id={`qc-field-${rule.code}`} className="rounded-2xl border border-slate-200 bg-white p-3">
              <label className="space-y-1" htmlFor={editable ? `stage-qc-reading-${rule.code}` : undefined}>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{rule.label}</span>
                {rule.applicable === false ? (
                  <div className="text-sm font-semibold text-slate-900" data-testid={`stage-qc-na-${rule.code}`}>
                    NOT APPLICABLE
                  </div>
                ) : editable ? (
                  <input
                    id={`stage-qc-reading-${rule.code}`}
                    data-testid={`stage-qc-reading-${rule.code}`}
                    type="number"
                    step="0.001"
                    inputMode="decimal"
                    value={readings[rule.code] || ""}
                    onChange={(event) => onReadingChange?.(rule.code, event.target.value)}
                    aria-invalid={fail || feedback?.verdict === "INVALID" ? true : undefined}
                    aria-describedby={describedBy || undefined}
                    className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900"
                  />
                ) : (
                  <div
                    className={printLayout ? "qc-print-writable min-h-11 border border-slate-900 bg-white px-2 py-2 text-sm text-slate-900" : "text-sm font-semibold text-slate-900"}
                    data-testid={`stage-qc-reading-${rule.code}`}
                    data-blank={readings[rule.code] ? "false" : "true"}
                  >
                    {readings[rule.code] || ""}
                  </div>
                )}
              </label>
              <p className="mt-2 text-xs font-semibold text-slate-600" data-testid={`allowed-${rule.code}`} id={`allowed-${rule.code}`}>
                {formatAllowedRange(rule)}
              </p>
              {qcFieldMeta(rule, { checkpoint, revision: profileRevision }) ? (
                <p className="mt-1 text-[11px] text-slate-500" data-testid={`stage-qc-meta-${rule.code}`} id={`stage-qc-meta-${rule.code}`}>
                  {qcFieldMeta(rule, { checkpoint, revision: profileRevision })}
                </p>
              ) : null}
              {feedback ? (
                <p
                  className={`qc-exception mt-2 text-xs font-semibold text-slate-950 ${
                    fail || feedback.verdict === "INVALID" ? "qc-exception-fail border border-slate-950 bg-white p-2" : "qc-exception-pass"
                  }`}
                  data-testid={`stage-qc-feedback-${rule.code}`}
                  id={`stage-qc-feedback-${rule.code}`}
                  role="status"
                >
                  <ExceptionMark verdict={feedback.verdict} />
                  {feedback.text}
                </p>
              ) : null}
              {showReasons && rule.applicable !== false ? (
                <label className="mt-2 block space-y-1" htmlFor={editable ? `stage-qc-reason-${rule.code}` : undefined}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Reason if FAIL</span>
                  {editable ? (
                    <input
                      id={`stage-qc-reason-${rule.code}`}
                      data-testid={`stage-qc-reason-${rule.code}`}
                      value={reasons[rule.code] || ""}
                      onChange={(event) => onReasonChange?.(rule.code, event.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-900 px-3 text-sm text-slate-900"
                      placeholder="Required only for out-of-range readings"
                      aria-required={fail ? true : undefined}
                    />
                  ) : (
                    <div
                      className={printLayout ? "qc-print-writable min-h-10 border border-slate-900 bg-white px-2 py-2 text-xs" : "text-xs text-slate-600"}
                      data-testid={`stage-qc-reason-${rule.code}`}
                      data-blank={reasons[rule.code] ? "false" : "true"}
                    >
                      {reasons[rule.code] || ""}
                    </div>
                  )}
                </label>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
