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
  reasonCodes?: Record<string, string>
  containments?: Record<string, string>
  assignees?: Record<string, string>
  sampleId?: string
  editable?: boolean
  showReasons?: boolean
  allowUnknownCause?: boolean
  onReadingChange?: (code: string, value: string) => void
  onReasonChange?: (code: string, value: string) => void
  onReasonCodeChange?: (code: string, value: string) => void
  onContainmentChange?: (code: string, value: string) => void
  onAssigneeChange?: (code: string, value: string) => void
  onSampleIdChange?: (value: string) => void
  paired?: boolean
  profileRevision?: number | string | null
  checkpoint?: string
  printLayout?: boolean
  dueTiming?: "PRE" | "POST" | null
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
  reasonCodes,
  containments,
  assignees,
  sampleId,
  editable = true,
  showReasons = true,
  allowUnknownCause = false,
  onReadingChange,
  onReasonChange,
  onReasonCodeChange,
  onContainmentChange,
  onAssigneeChange,
  onSampleIdChange,
  paired,
  profileRevision,
  checkpoint,
  printLayout = false,
  dueTiming = null,
}: StageQcFieldsProps) {
  const issues = qcExceptionIssues(rules, readings)
  return (
    <div className="space-y-3" data-testid="stage-qc-fields">
      {issues.length ? (
        <div className="rounded-xl border border-slate-900 bg-card p-3 text-sm text-foreground" data-testid="stage-qc-issue-summary" aria-label="Stage QC issues">
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sample / pair ID</span>
          {editable ? (
            <input
              value={sampleId || ""}
              onChange={(event) => onSampleIdChange?.(event.target.value)}
              data-testid="stage-qc-sample-id"
              className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm"
              placeholder="Same identified sample for pre and post"
            />
          ) : (
            <div
              className={printLayout ? "qc-print-writable min-h-11 border border-slate-900 bg-card px-2 py-2 text-sm" : "text-sm font-semibold text-foreground"}
              data-testid="stage-qc-sample-id"
              data-blank={sampleId ? "false" : "true"}
            >
              {sampleId || ""}
            </div>
          )}
        </label>
      ) : editable && !printLayout ? (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sample ID</span>
          <input
            value={sampleId || ""}
            onChange={(event) => onSampleIdChange?.(event.target.value)}
            data-testid="stage-qc-sample-id"
            className="h-11 w-full rounded-2xl border border-border bg-card px-3 text-sm"
            placeholder="Identified sample for this observation"
          />
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
          const notYetDue = dueTiming === "PRE" && String(rule.code).startsWith("post_")
          return (
            <div key={rule.code} id={`qc-field-${rule.code}`} className="rounded-2xl border border-border bg-card p-3">
              <label className="space-y-1" htmlFor={editable && !notYetDue ? `stage-qc-reading-${rule.code}` : undefined}>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{rule.label}</span>
                {rule.applicable === false ? (
                  <div className="text-sm font-semibold text-foreground" data-testid={`stage-qc-na-${rule.code}`}>
                    NOT APPLICABLE
                  </div>
                ) : notYetDue ? (
                  <div className="text-sm font-semibold text-foreground" data-testid={`stage-qc-not-due-${rule.code}`}>
                    Not yet due
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
                    className="h-11 w-full rounded-xl border border-border px-3 text-sm text-foreground"
                  />
                ) : (
                  <div
                    className={printLayout ? "qc-print-writable min-h-11 border border-slate-900 bg-card px-2 py-2 text-sm text-foreground" : "text-sm font-semibold text-foreground"}
                    data-testid={`stage-qc-reading-${rule.code}`}
                    data-blank={readings[rule.code] ? "false" : "true"}
                  >
                    {readings[rule.code] || ""}
                  </div>
                )}
              </label>
              <p className="mt-2 text-xs font-semibold text-muted-foreground" data-testid={`allowed-${rule.code}`} id={`allowed-${rule.code}`}>
                {formatAllowedRange(rule)}
                {rule.non_waivable ? " · Critical — cannot be waived" : ""}
              </p>
              {qcFieldMeta(rule, { checkpoint, revision: profileRevision }) ? (
                <p className="mt-1 text-[11px] text-muted-foreground" data-testid={`stage-qc-meta-${rule.code}`} id={`stage-qc-meta-${rule.code}`}>
                  {qcFieldMeta(rule, { checkpoint, revision: profileRevision })}
                </p>
              ) : null}
              {feedback ? (
                <p
                  className={`qc-exception mt-2 text-xs font-semibold text-foreground ${
                    fail || feedback.verdict === "INVALID" ? "qc-exception-fail border border-slate-950 bg-card p-2" : "qc-exception-pass"
                  }`}
                  data-testid={`stage-qc-feedback-${rule.code}`}
                  id={`stage-qc-feedback-${rule.code}`}
                  role="status"
                >
                  <ExceptionMark verdict={feedback.verdict} />
                  {feedback.text}
                </p>
              ) : null}
              {showReasons && rule.applicable !== false && !notYetDue ? (
                <div className="mt-2 space-y-2">
                  <label className="block space-y-1" htmlFor={editable ? `stage-qc-reason-${rule.code}` : undefined}>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {reasonCodes?.[rule.code] === "CAUSE_UNDER_INVESTIGATION" ? "Factual note" : "Reason if FAIL"}
                    </span>
                    {editable ? (
                      <input
                        id={`stage-qc-reason-${rule.code}`}
                        data-testid={`stage-qc-reason-${rule.code}`}
                        value={reasons[rule.code] || ""}
                        onChange={(event) => onReasonChange?.(rule.code, event.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-900 px-3 text-sm text-foreground"
                        placeholder={
                          reasonCodes?.[rule.code] === "CAUSE_UNDER_INVESTIGATION"
                            ? "Facts only — do not invent a root cause"
                            : "Required only for out-of-range readings"
                        }
                        aria-required={fail ? true : undefined}
                      />
                    ) : (
                      <div
                        className={printLayout ? "qc-print-writable min-h-10 border border-slate-900 bg-card px-2 py-2 text-xs" : "text-xs text-muted-foreground"}
                        data-testid={`stage-qc-reason-${rule.code}`}
                        data-blank={reasons[rule.code] ? "false" : "true"}
                      >
                        {reasons[rule.code] || ""}
                      </div>
                    )}
                  </label>
                  {allowUnknownCause && editable ? (
                    <label className="block space-y-1" htmlFor={`stage-qc-reason-code-${rule.code}`}>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reason code</span>
                      <select
                        id={`stage-qc-reason-code-${rule.code}`}
                        data-testid={`stage-qc-reason-code-${rule.code}`}
                        value={reasonCodes?.[rule.code] || ""}
                        onChange={(event) => onReasonCodeChange?.(rule.code, event.target.value)}
                        className="h-10 w-full rounded-xl border border-slate-900 px-3 text-sm text-foreground"
                      >
                        <option value="">Known explanation</option>
                        <option value="CAUSE_UNDER_INVESTIGATION">Cause under investigation</option>
                      </select>
                    </label>
                  ) : null}
                  {allowUnknownCause && reasonCodes?.[rule.code] === "CAUSE_UNDER_INVESTIGATION" ? (
                    <>
                      <label className="block space-y-1" htmlFor={`stage-qc-containment-${rule.code}`}>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Containment</span>
                        {editable ? (
                          <input
                            id={`stage-qc-containment-${rule.code}`}
                            data-testid={`stage-qc-containment-${rule.code}`}
                            value={containments?.[rule.code] || ""}
                            onChange={(event) => onContainmentChange?.(rule.code, event.target.value)}
                            className="h-10 w-full rounded-xl border border-slate-900 px-3 text-sm text-foreground"
                            placeholder="Immediate containment / affected scope"
                            aria-required={fail ? true : undefined}
                          />
                        ) : (
                          <div className="text-xs text-muted-foreground" data-testid={`stage-qc-containment-${rule.code}`}>
                            {containments?.[rule.code] || ""}
                          </div>
                        )}
                      </label>
                      <label className="block space-y-1" htmlFor={`stage-qc-assignee-${rule.code}`}>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Assignee</span>
                        {editable ? (
                          <input
                            id={`stage-qc-assignee-${rule.code}`}
                            data-testid={`stage-qc-assignee-${rule.code}`}
                            value={assignees?.[rule.code] || ""}
                            onChange={(event) => onAssigneeChange?.(rule.code, event.target.value)}
                            className="h-10 w-full rounded-xl border border-slate-900 px-3 text-sm text-foreground"
                            placeholder="Responsible person"
                            aria-required={fail ? true : undefined}
                          />
                        ) : (
                          <div className="text-xs text-muted-foreground" data-testid={`stage-qc-assignee-${rule.code}`}>
                            {assignees?.[rule.code] || ""}
                          </div>
                        )}
                      </label>
                      <p className="text-[11px] text-muted-foreground" data-testid={`stage-qc-investigation-hint-${rule.code}`}>
                        Investigation remains open. A completed root-cause analysis is a later controlled action.
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
