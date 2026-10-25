"use client"

// Page 3 of the printed job card: every run and every QC reading of a seasonal card,
// laid out for A4 portrait (200 mm wide). Fixed column widths so nothing runs off the page.

import { Fragment } from "react"
import { useQuery } from "@tanstack/react-query"

import { entryApiForPlant, seasonLabel, seasonTimestamp } from "@/lib/season-api"
import { relativeLimitText } from "@/lib/qc-measurement"
import { displayStageRule } from "@/lib/qc-measurement"

const stageName = (stage: string) =>
  stage === "WINDER" ? "Winding" : stage === "QC" ? "Final QC" : stage.charAt(0) + stage.slice(1).toLowerCase()
const qty = (value: any) => (value == null || value === "" ? "" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 }))
const reading = (value: any) =>
  value == null || value === "" ? "" : Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(3))) : String(value)
const person = (value: any) => String(value || "").split("@")[0]
const clock = (value: any) => {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
}
const dateText = (value: any) => {
  const text = String(value || "").slice(0, 10)
  const [y, m, d] = text.split("-")
  return y && m && d ? `${d}-${m}-${y.slice(2)}` : text
}
const verdictText: Record<string, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NOT_MEASURED: "No readings",
  OBSERVATION_ONLY: "Recorded",
  INCOMPLETE: "Incomplete",
  INVALID: "Invalid",
}

/** Allowed limit in a few characters, for the "Allowed" row under each readings header. */
export function compactLimit(rule: any): string {
  if (!rule || rule.applicable === false) return "n/a"
  if (rule.mode === "RECORD_ONLY") return "record"
  if (rule.dynamic) {
    return (relativeLimitText(rule) || "from sample").replace("this sample's ", "").replace("pre-weight", "pre-wt")
  }
  // Two decimals are enough on paper (28.7762 → 28.78).
  const min = rule.min == null || rule.min === "" ? null : Number(Number(rule.min).toFixed(2))
  const max = rule.max == null || rule.max === "" ? null : Number(Number(rule.max).toFixed(2))
  if (min != null && max != null) return `${min}–${max}`
  if (min != null) return `≥ ${min}`
  if (max != null) return `≤ ${max}`
  return "record"
}

export function SeasonPrintLog({ card, machineLabel }: { card: any; machineLabel: (id: any) => string }) {
  const entryApi = entryApiForPlant(String(card.plant_id || ""))
  const flow = useQuery({ queryKey: ["continuous-flow", card.id], queryFn: async () => (await entryApi.flow(card.id)).data })
  const entries = useQuery({
    queryKey: ["continuous-entries-log", card.id],
    queryFn: async () => {
      const all: any[] = []
      let offset = 0
      let total = 1
      while (offset < total && offset < 1000) {
        const { data } = await entryApi.list(card.id, undefined, offset, 100)
        all.push(...(data?.entries || []))
        total = Number(data?.total || 0)
        offset += 100
      }
      return all
    },
  })
  if (flow.isLoading || entries.isLoading) return <p className="jc-log-note">Loading the production and QC log…</p>
  if (flow.isError || entries.isError || !flow.data) return <p className="jc-log-note">The production and QC log could not be loaded.</p>

  const stages: any[] = flow.data.stages || []
  const order = (stage: string) => stages.findIndex((s: any) => s.stage === stage)
  const live = (entries.data || []).filter((e: any) => e.status !== "VOID")
  const drafts = live.filter((e: any) => e.status === "DRAFT").length
  const posted = live
    .filter((e: any) => e.status === "SUBMITTED")
    .sort((a: any, b: any) => order(a.stage) - order(b.stage) || a.entry_no - b.entry_no)
  const runs = posted.filter((e: any) => e.kind !== "QC_ONLY")
  const profile = card.spec_snapshot?.qc_profile
  const rulesFor = (stage: string) => (profile?.stages?.[stage]?.parameters || []).filter((r: any) => r.applicable !== false).map((r: any) => displayStageRule(stage, r))
  const qcStages = stages.filter((s: any) => rulesFor(s.stage).length)
  const isFlagged = (e: any) => e.details?.unscheduled_entry || e.details?.machine_changed || e.details?.material_prep_pending
  const flagged = runs.some(isFlagged)

  return (
    <div className="jc-log" data-testid="season-print-annex">
      <table className="jc-log-table jc-log-title">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "33%" }} />
          <col style={{ width: "33%" }} />
        </colgroup>
        <tbody>
          <tr>
            <td className="jc-log-band" colSpan={3}>
              Production &amp; QC log <span>उत्पादन और क्यूसी रिकॉर्ड</span>
            </td>
          </tr>
          <tr>
            <td>
              <small>JC No.</small>
              <b>{card.job_card_no || card.job_card_ref}</b>
            </td>
            <td>
              <small>Customer</small>
              <b>{card.document_snapshot?.header?.customer_name || card.sales_order?.customer_name || ""}</b>
            </td>
            <td>
              <small>Rules</small>
              <b>
                {seasonLabel(flow.data.season)} · recipe r{flow.data.recipe_revision} · QC v{profile?.provenance?.rule_set_version ?? "—"}
              </b>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 className="jc-log-h">Stage totals</h3>
      <table className="jc-log-table">
        <colgroup>
          <col style={{ width: "14%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "35%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Status</th>
            <th>Good / target</th>
            <th>Rejected</th>
            <th>Runs</th>
            <th>Closed by · notes</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s: any) => (
            <tr key={s.stage}>
              <td>{stageName(s.stage)}</td>
              <td>{s.status === "COMPLETED" ? "Closed" : s.status === "RUNNING" ? "Running" : s.status === "PLANNED" ? "Not started" : s.status}</td>
              <td className="num">
                {qty(s.accepted_total)} / {qty(s.target)} {s.unit}
              </td>
              <td className="num">{qty(s.rejected_total)}</td>
              <td className="num">{runs.filter((e: any) => e.stage === s.stage).length || ""}</td>
              <td>
                {[
                  s.supervisor_name ? `${s.supervisor_name}${s.closed_at ? ` · ${seasonTimestamp(s.closed_at)}` : ""}` : "",
                  s.accepted_total < s.target && s.status === "COMPLETED" ? "short-closed" : "",
                  s.qc_rejected_qty > 0 ? `final QC rejected ${qty(s.qc_rejected_qty)} pcs` : "",
                  s.qc_uninspected_qty > 0 ? `uninspected ${qty(s.qc_uninspected_qty)} pcs` : "",
                  s.retained_fg_qty > 0 ? `retained FG ${qty(s.retained_fg_qty)} pcs` : "",
                  s.residual_quantity ? `${qty(s.residual_quantity)} unused input ${String(s.residual_disposition || "").toLowerCase()}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {drafts ? <p className="jc-log-note">{drafts} draft entr{drafts === 1 ? "y is" : "ies are"} waiting for the supervisor and not counted above.</p> : null}

      <h3 className="jc-log-h">Runs · one line per run as entered</h3>
      <table className="jc-log-table" data-testid="season-print-runs">
        <colgroup>
          <col style={{ width: "9%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Run</th>
            <th>Date · shift</th>
            <th>Machine</th>
            <th>Operator · helper</th>
            <th>Output</th>
            <th>Good</th>
            <th>Reject</th>
            <th>Start – end</th>
            <th>QC</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((e: any) => (
            <tr key={e.id}>
              <td>{stageName(e.stage)}</td>
              <td className="num">
                {e.entry_no}
                {isFlagged(e) ? " †" : ""}
              </td>
              <td>
                {dateText(e.business_date)}
                {e.shift_code ? ` · ${String(e.shift_code).replace("SHIFT_", "")}` : ""}
              </td>
              <td>{e.machine_id ? machineLabel(e.machine_id) : ""}</td>
              <td>
                {e.operator_name || ""}
                {e.details?.helper_name ? <span className="sub">{e.details.helper_name}</span> : null}
              </td>
              <td className="num">{qty(e.produced)}</td>
              <td className="num">{qty(e.accepted)}</td>
              <td className="num">
                {e.rejected ? qty(e.rejected) : ""}
                {e.details?.reject_code ? ` ${e.details.reject_code}` : ""}
                {e.details?.reject_reason && !String(e.details.reject_reason).startsWith(`${e.details?.reject_code} ·`) ? <span className="sub">{e.details.reject_reason}</span> : null}
              </td>
              <td>{[clock(e.details?.start_time), clock(e.details?.end_time)].filter(Boolean).join(" – ")}</td>
              <td>
                {verdictText[e.evaluation?.verdict] || "No readings"}
                {e.evaluation?.unrecorded?.length ? <span className="sub">{e.evaluation.unrecorded.map((u: any) => u.label).join(", ")} not recorded</span> : null}
                <span className="sub">by {person(e.created_by)}</span>
              </td>
            </tr>
          ))}
          {runs.length === 0 ? (
            <tr>
              <td colSpan={10}>No runs entered yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {qcStages.map((s: any) => {
        const rules = rulesFor(s.stage)
        const rows = posted
          .filter((e: any) => e.stage === s.stage && (e.samples || []).length)
          .map((e: any) => ({
            entry: e,
            samples: (e.samples || []).map((sample: any) => ({
              sample,
              fails: new Set(
                (e.evaluation?.results || [])
                  .filter((r: any) => r.sample_id === sample.sample_id && r.verdict === "FAIL")
                  .map((r: any) => r.parameter),
              ),
            })),
          }))
        const first = rules.length > 8 ? 9 : 10
        const each = (100 - first - 6) / Math.max(1, rules.length)
        return (
          <Fragment key={s.stage}>
            <h3 className="jc-log-h">{stageName(s.stage)} QC readings</h3>
            <table className="jc-log-table" data-testid={`season-print-qc-${s.stage.toLowerCase()}`}>
              <colgroup>
                <col style={{ width: `${first}%` }} />
                <col style={{ width: "6%" }} />
                {rules.map((r: any) => (
                  <col key={r.code} style={{ width: `${each}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Smp</th>
                  {rules.map((r: any) => (
                    <th key={r.code}>
                      {r.label}
                      {r.unit ? <span className="sub">{r.unit}</span> : null}
                    </th>
                  ))}
                </tr>
                <tr className="jc-log-allowed">
                  <th colSpan={2}>Allowed</th>
                  {rules.map((r: any) => (
                    <th key={r.code}>{compactLimit(r)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry, samples }: any) =>
                  samples.map(({ sample, fails }: any, index: number) => (
                    <tr key={`${entry.id}-${sample.sample_id}`}>
                      {index === 0 ? (
                        <td rowSpan={samples.length}>
                          {entry.kind === "QC_ONLY" ? `QC desk ${entry.entry_no}` : `#${entry.entry_no}`}
                          <span className="sub">{verdictText[entry.evaluation?.verdict] || ""}</span>
                        </td>
                      ) : null}
                      <td className="num">{index + 1}</td>
                      {rules.map((r: any) => (
                        <td key={r.code} className={fails.has(r.code) ? "num fail" : "num"}>
                          {reading(sample.readings?.[r.code])}
                          {fails.has(r.code) ? " ✗" : ""}
                        </td>
                      ))}
                    </tr>
                  )),
                )}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={2 + rules.length}>No readings entered yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Fragment>
        )
      })}

      {flow.data.final_samples?.length ? (
        <>
          <h3 className="jc-log-h">Final customer acceptance</h3>
          <table className="jc-log-table">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Sample</th>
                <th>Status</th>
                <th>QC</th>
                <th>Recorded</th>
                <th>I.D.</th>
                <th>O.D.</th>
                <th>Length · weight · C.S.</th>
              </tr>
            </thead>
            <tbody>
              {flow.data.final_samples.map((s: any) => (
                <tr key={s.sample_id}>
                  <td>{String(s.sample_id || "").slice(0, 8)}</td>
                  <td>
                    {s.status}
                    {s.workflow_status ? ` · ${s.workflow_status}` : ""}
                  </td>
                  <td>{s.qc_name}</td>
                  <td>{s.recorded_at ? seasonTimestamp(s.recorded_at) : ""}</td>
                  <td className="num">{reading(s.readings?.id)}</td>
                  <td className="num">{reading(s.readings?.od)}</td>
                  <td className="num">{[s.readings?.length, s.readings?.weight, s.readings?.cs].map((v: any) => reading(v) || "—").join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {flow.data.residual_wip?.length ? (
        <>
          <h3 className="jc-log-h">Unused input</h3>
          <table className="jc-log-table">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "52%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Quantity</th>
                <th>Disposition</th>
                <th>Reason · recorded by</th>
              </tr>
            </thead>
            <tbody>
              {flow.data.residual_wip.map((row: any) => (
                <tr key={row.id}>
                  <td>{stageName(row.stage)}</td>
                  <td className="num">
                    {qty(row.quantity)} {row.unit}
                  </td>
                  <td>
                    {row.disposition} · {row.status}
                  </td>
                  <td>
                    {row.reason} · {person(row.created_by)}
                    {row.resolved_by ? ` · resolved by ${person(row.resolved_by)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <p className="jc-log-note">
        ✗ = reading outside the allowed limit (the batch is held for QC).{flagged ? " † = run entered before the planner placed the stage, on another machine, or before the slitting record (listed for the owner under Reports › Exceptions)." : ""}
      </p>
    </div>
  )
}
