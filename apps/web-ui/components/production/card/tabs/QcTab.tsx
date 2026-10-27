"use client"

// QC: every sample per stage and run, readings coloured against the card's frozen limits, flagged
// readings highlighted (flagged, never held), runs still needing readings, QC without a run, the limits.

import Link from "next/link"
import { CheckCircle2, Clock3, ExternalLink, Flag, PauseCircle, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { seasonLabel } from "@/lib/season-api"
import { OPTIONAL_QC_CODES, allowedText } from "../../SeasonQcMatrix"
import { QcChip } from "../RunList"
import { bandText, flagText, fmt, requiredReadings, runDay, runNo, runQcState, shiftLabel, stageLabel, stageParameters, stampLabel, toneClass, useCardRoles } from "../model"

/** A check's limit in a few words for a table header (the full words stay in the tooltip and the limits box). */
const shortLimit = (rule: any) =>
  rule.applicable === false ? "not checked" : OPTIONAL_QC_CODES.has(rule.code) ? "optional" : rule.mode === "RECORD_ONLY" ? "record" : rule.dynamic ? "vs pre-weight" : `${bandText(rule.min, rule.max)}${rule.unit ? ` ${rule.unit}` : ""}`

export function QcTab({ card, flow, stages, entries, machineName, onLogQc }: { card: any; flow: any; stages: any[]; entries: any[]; machineName: (id: any) => string; onLogQc?: (entry: any | null, stage: string) => void }) {
  const { canQc } = useCardRoles()
  const live = entries.filter((e) => e.status !== "VOID")
  const waiting = live.filter((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && stageParameters(card, e.stage).length > 0 && !runQcState(card, e).accepted)
  const holds = (card?.quality_holds || []).filter((h: any) => String(h.status || "").toUpperCase() === "HOLD")
  const qcStages = stages.filter((s: any) => stageParameters(card, s.stage).length > 0)
  const profile = card?.spec_snapshot?.qc_profile
  const flags = live.flatMap((e) => (Array.isArray(e.qc_flags) ? e.qc_flags.map((f: any) => ({ ...f, entry: e })) : []))

  return (
    <div className="space-y-4" data-testid="tab-qc">
      {qcStages.map((s: any) => {
        const parameters = stageParameters(card, s.stage)
        const rows = live
          .filter((e) => e.stage === s.stage && (e.samples || []).length)
          .flatMap((e) => (e.samples || []).map((sample: any, index: number) => ({ entry: e, sample, index })))
        const resultOf = (entry: any, sampleId: string, code: string) => (entry.evaluation?.results || []).find((r: any) => r.sample_id === sampleId && r.parameter === code)
        return (
          <section key={s.stage} className="overflow-hidden rounded-xl border border-border bg-card" data-testid={`qc-stage-${s.stage.toLowerCase()}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[14px] font-semibold">{stageLabel(s.stage)} samples</h3>
              <span className="text-[12px] text-muted-foreground">{rows.length} reading row{rows.length === 1 ? "" : "s"} · green in band · amber flagged</span>
              {canQc && onLogQc && s.status !== "COMPLETED" ? (
                <Button size="sm" className="ml-auto" onClick={() => onLogQc(null, s.stage)} data-testid={`qc-add-${s.stage.toLowerCase()}`}>
                  <Plus className="h-3.5 w-3.5" /> Add QC
                </Button>
              ) : null}
            </div>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Sample</th>
                      <th className="px-2 py-2 text-left">Run</th>
                      <th className="px-2 py-2 text-left">When · by</th>
                      {parameters.map((p: any) => (
                        <th key={p.code} className="px-2 py-2 text-right" title={`${p.label}: ${allowedText(p)}`}>
                          <span className="whitespace-nowrap">{p.label}</span>
                          <span className="block whitespace-nowrap text-[10px] font-medium normal-case tracking-normal text-muted-foreground">{shortLimit(p)}</span>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(({ entry, sample, index }) => {
                      const qc = runQcState(card, entry)
                      return (
                        <tr key={`${entry.id}-${sample.sample_id}`} data-testid={`qc-sample-${entry.entry_no}-${index + 1}`}>
                          <td className="px-3 py-2 font-semibold">S{index + 1}</td>
                          <td className="px-2 py-2">
                            {entry.kind === "QC_ONLY" ? <span className={cn("whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-semibold", toneClass("violet"))}>no run</span> : <b>{runNo(entry)}</b>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                            {runDay(entry)}
                            {entry.shift_code ? ` · ${shiftLabel(entry.shift_code).replace("Shift ", "")}` : entry.kind === "QC_ONLY" ? ` · ${stampLabel(entry.created_at).split(", ").pop()}` : ""}
                            {entry.machine_id ? ` · ${machineName(entry.machine_id)}` : ""}
                            <span className="block text-[11.5px]">{entry.operator_name || String(entry.created_by || "").split("@")[0]}</span>
                          </td>
                          {parameters.map((p: any) => {
                            const value = sample.readings?.[p.code]
                            const result = resultOf(entry, sample.sample_id, p.code)
                            const verdict = result?.verdict
                            const empty = value === "" || value == null
                            return (
                              <td key={p.code} className="px-2 py-2 text-right tabular-nums">
                                {empty ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold",
                                      verdict === "FAIL" ? toneClass("amber") : verdict === "PASS" ? toneClass("emerald") : "border-border bg-muted text-foreground",
                                    )}
                                    title={verdict === "FAIL" ? `Outside the band (${bandText(result?.min, result?.max)}) — flagged, not held` : verdict === "PASS" ? "In band" : "Recorded"}
                                  >
                                    {verdict === "FAIL" ? <Flag className="h-3 w-3" aria-hidden="true" /> : null}
                                    {value}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2">
                            <QcChip qc={qc} compact />
                            {entry.details?.qc_remark ? <span className="block max-w-[14rem] text-[11.5px] text-muted-foreground">{entry.details.qc_remark}</span> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No QC samples on {stageLabel(s.stage)} yet.</p>
            )}
          </section>
        )
      })}
      {!qcStages.length ? <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">This card has no QC checks set up (see the spec sheet&apos;s QC rules).</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-4" data-testid="qc-waiting">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            Waiting for QC
            <span className={cn("rounded-full border px-1.5 text-[11px]", waiting.length ? toneClass("amber") : toneClass("emerald"))}>{waiting.length}</span>
          </h3>
          <ul className="mt-2 space-y-1.5">
            {waiting.map((e) => {
              const qc = runQcState(card, e)
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
                  <Clock3 className="h-4 w-4 shrink-0 text-signal-amber-ink" aria-hidden="true" />
                  <b>
                    {runNo(e)} · {stageLabel(e.stage)}
                  </b>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {runDay(e)} · {shiftLabel(e.shift_code)} · {fmt(e.accepted)} good{qc.key === "short" ? ` · ${qc.label.replace("Needs more readings: ", "needs ")}` : ""}
                  </span>
                  {canQc && onLogQc ? (
                    <Button size="sm" onClick={() => onLogQc(e, e.stage)} data-testid={`qc-waiting-${e.entry_no}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Log QC
                    </Button>
                  ) : null}
                </li>
              )
            })}
            {!waiting.length ? <li className="text-[13px] text-muted-foreground">No runs waiting.</li> : null}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">A run goes on to the next stage once it has at least 2 readings per required check; a stage closes once it has 2 readings per check (a short close too). Out-of-band readings are flagged, never held.</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4" data-testid="qc-limits">
          <h3 className="text-[14px] font-semibold">
            Limits on this card <span className="text-[12px] font-normal text-muted-foreground">{profile?.provenance?.rule_set_version ? `· rules v${profile.provenance.rule_set_version}` : ""}{flow?.season ? ` · ${seasonLabel(flow.season)}` : ""}</span>
          </h3>
          <div className="mt-2 space-y-2">
            {qcStages.map((s: any) => (
              <div key={s.stage}>
                <p className="text-[12px] font-semibold text-muted-foreground">{stageLabel(s.stage)}</p>
                <ul className="mt-0.5 divide-y divide-border rounded-lg border border-border">
                  {stageParameters(card, s.stage).map((r: any) => (
                    <li key={r.code} className="flex items-baseline justify-between gap-2 px-2.5 py-1 text-[12.5px]">
                      <span className="font-medium">{r.label}</span>
                      <span className="text-right text-muted-foreground">
                        {allowedText(r)}
                        {OPTIONAL_QC_CODES.has(r.code) ? "" : ` · ${requiredReadings(r)} readings`}
                        {r.overlay_id ? <span className="block text-[11px]">customer overlay v{r.overlay_version}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Frozen on the card at release. A new band version never changes old samples.</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4" data-testid="qc-holds">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            Flags and holds
            <Link href={`/quality/stage?job=${card.id}`} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline" data-testid="qc-flags-register-link">
              QC flags register <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          </h3>
          {flags.length ? (
            <ul className="mt-2 space-y-1">
              {flags.map((f: any, i: number) => (
                <li key={`${f.entry.id}-${f.parameter}-${i}`} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]", toneClass("amber"))}>
                  <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <b>
                      {stageLabel(f.entry.stage)} {f.entry.kind === "QC_ONLY" ? "check without a run" : runNo(f.entry)}
                    </b>{" "}
                    · Flagged · {flagText(f)}
                    {f.direction ? ` · ${f.direction === "HIGH" ? "high" : "low"}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">No flagged readings on this card.</p>
          )}
          {holds.length ? (
            <ul className="mt-2 space-y-1">
              {holds.map((h: any) => (
                <li key={h.id} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]", toneClass("rose"))}>
                  <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    On hold · {h.reason || h.hold_reason || "QC hold"}
                    {h.created_at ? ` · ${stampLabel(h.created_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted-foreground">No holds. A flag never stops the stage; a hold (raised by QC on the Quality pages) does.</p>
          )}
        </section>
      </div>
    </div>
  )
}
