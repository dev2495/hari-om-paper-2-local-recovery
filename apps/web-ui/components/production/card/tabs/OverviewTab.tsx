"use client"

// Overview: today on this card, the numbers per stage, open holds and flags, the next step, card details.

import Link from "next/link"
import { CheckCircle2, Clock3, Flag, PauseCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { QcChip } from "../RunList"
import type { StepInfo } from "../StageStepper"
import { cardFacts, dayLabel, flagText, fmt, runNo, runQcState, shiftLabel, stageLabel, stampLabel, today, toneClass, useCardRoles } from "../model"

const STATE_WORD: Record<StepInfo["state"], { label: string; tone: "emerald" | "blue" | "violet" | "muted" }> = {
  done: { label: "Done", tone: "emerald" },
  running: { label: "Running", tone: "blue" },
  planned: { label: "Planned", tone: "violet" },
  todo: { label: "Not started", tone: "muted" },
  system: { label: "With Process", tone: "muted" },
}

export type NextStep = { title: string; detail?: string; done?: boolean; action?: { label: string; onClick: () => void } }

export function Tile({ label, value, sub, tone, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "amber" | "emerald"; testId?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3", tone === "amber" ? "border-signal-amber-line" : tone === "emerald" ? "border-signal-emerald-line" : "border-border")} data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-[22px] font-bold leading-tight tracking-tight tabular-nums", tone === "amber" ? "text-signal-amber-ink" : "")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

export function OverviewTab({
  card,
  steps,
  entries,
  lifecycle,
  machineName,
  nextSteps,
  onLogQc,
}: {
  card: any
  steps: StepInfo[]
  entries: any[]
  lifecycle: any
  machineName: (id: any) => string
  nextSteps: NextStep[]
  onLogQc?: (entry: any) => void
}) {
  const facts = cardFacts(card)
  const { canQc } = useCardRoles()
  const live = entries.filter((e) => e.status !== "VOID")
  const todayRuns = live.filter((e) => e.kind !== "QC_ONLY" && String(e.business_date || "").slice(0, 10) === today())
  const unitTotals = (rows: any[], key: "produced" | "accepted" | "rejected") => {
    const by: Record<string, number> = {}
    for (const e of rows) {
      const unit = steps.find((s) => s.stage === e.stage)?.unit || "pcs"
      by[unit] = (by[unit] || 0) + Number(e[key] || 0)
    }
    return Object.entries(by).map(([unit, value]) => `${fmt(value)} ${unit}`).join(" · ") || "0"
  }
  const flags = live.flatMap((e) => (Array.isArray(e.qc_flags) ? e.qc_flags.map((f: any) => ({ ...f, entry: e })) : []))
  const drafts = live.filter((e) => e.status === "DRAFT")
  const waitingQc = live.filter((e) => e.status === "SUBMITTED" && e.kind !== "QC_ONLY" && !runQcState(card, e).accepted)
  const holds = (card?.quality_holds || []).filter((h: any) => String(h.status || "").toUpperCase() === "HOLD")

  return (
    <div className="space-y-4" data-testid="tab-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Runs today" value={todayRuns.length} sub={todayRuns.length ? Array.from(new Set(todayRuns.map((e) => runNo(e)))).slice(0, 4).join(" · ") : "nothing logged today"} testId="tile-runs-today" />
        <Tile label="Made today" value={unitTotals(todayRuns, "produced")} sub={todayRuns.length ? `${unitTotals(todayRuns, "accepted")} good · ${unitTotals(todayRuns, "rejected")} rejected` : "—"} />
        <Tile label="Flagged readings" value={flags.length} tone={flags.length ? "amber" : undefined} sub={flags.length ? "outside the band · accepted, not held" : "all readings in band"} testId="tile-flags" />
        <Tile label="Waiting" value={drafts.length + waitingQc.length} tone={drafts.length + waitingQc.length ? "amber" : undefined} sub={[drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} to submit` : "", waitingQc.length ? `${waitingQc.length} run${waitingQc.length === 1 ? "" : "s"} need QC` : ""].filter(Boolean).join(" · ") || "nothing waiting"} testId="tile-waiting" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-border px-4 py-3">
              <h3 className="text-[14px] font-semibold">Numbers per stage</h3>
              <span className="text-[12px] text-muted-foreground">target · made · good · rejected</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Stage</th>
                    <th className="px-2 py-2 text-right">Target</th>
                    <th className="px-2 py-2 text-right">Made</th>
                    <th className="px-2 py-2 text-right">Good</th>
                    <th className="px-2 py-2 text-right">Rejected</th>
                    <th className="px-2 py-2 text-right">%</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {steps.map((s) => {
                    const started = s.state === "done" || s.state === "running"
                    const word = STATE_WORD[s.state]
                    return (
                      <tr key={s.stage} data-testid={`numbers-${s.stage.toLowerCase()}`}>
                        <td className="px-4 py-2">
                          <b>{s.label}</b>
                          <span className="block text-[11px] text-muted-foreground">{s.unit}</span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(s.target)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{started ? fmt(s.made ?? s.good) : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          <b>{started ? fmt(s.good) : "—"}</b>
                        </td>
                        <td className={cn("px-2 py-2 text-right tabular-nums", s.rejected ? "text-signal-rose-ink" : "")}>{started ? fmt(s.rejected || 0) : "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{started && s.target ? `${Math.round((s.good / s.target) * 100)}%` : "—"}</td>
                        <td className="px-2 py-2">
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold", toneClass(word.tone))}>{word.label}</span>
                          {s.flagged ? (
                            <span className={cn("ml-1 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[11px] font-semibold", toneClass("amber"))}>
                              <Flag className="h-2.5 w-2.5" aria-hidden="true" /> {s.flagged}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-[12px] text-muted-foreground">{s.state === "done" ? [s.closedAt ? stampLabel(s.closedAt) : "", s.closedBy].filter(Boolean).join(" · ") || "yes" : "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {todayRuns.length ? (
            <section className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-baseline gap-2 border-b border-border px-4 py-3">
                <h3 className="text-[14px] font-semibold">Today on this card</h3>
                <span className="text-[12px] text-muted-foreground">{dayLabel(today())}</span>
              </div>
              <ul className="divide-y divide-border">
                {todayRuns.map((e) => {
                  const qc = runQcState(card, e)
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
                      <b className="w-16 shrink-0">{runNo(e)}</b>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {shiftLabel(e.shift_code)} · {e.machine_id ? `${machineName(e.machine_id)} · ` : ""}
                        {e.operator_name ? `${e.operator_name} · ` : ""}
                        {fmt(e.produced)} made · {fmt(e.accepted)} good{e.rejected ? ` · ${fmt(e.rejected)} ${e.details?.reject_code || "rejected"}` : ""}
                      </span>
                      <QcChip qc={qc} compact />
                      {!qc.accepted && e.status === "SUBMITTED" && canQc && onLogQc ? (
                        <Button size="sm" variant="outline" onClick={() => onLogQc(e)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Log QC
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4" data-testid="overview-holds">
            <h3 className="text-[14px] font-semibold">Open holds and flags</h3>
            {holds.length ? (
              holds.map((h: any) => (
                <p key={h.id} className={cn("mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", toneClass("rose"))}>
                  <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <b>On hold</b> · {h.reason || h.hold_reason || h.note || "QC hold"}
                    {h.stage_type ? ` · ${stageLabel(h.stage_type)}` : ""}
                    {h.created_at ? ` · ${stampLabel(h.created_at)}` : ""}
                  </span>
                </p>
              ))
            ) : (
              <p className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-signal-emerald-ink">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> No open holds on this card
              </p>
            )}
            {flags.length ? (
              <ul className="mt-2 space-y-1">
                {flags.slice(0, 6).map((f: any, i: number) => (
                  <li key={`${f.entry.id}-${f.parameter}-${i}`} className={cn("flex items-start gap-2 rounded-lg border px-3 py-1.5 text-[12.5px]", toneClass("amber"))}>
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      <b>
                        {stageLabel(f.entry.stage)} {f.entry.kind === "QC_ONLY" ? "check without a run" : runNo(f.entry)}
                      </b>{" "}
                      · Flagged · {flagText(f)} · not held
                    </span>
                  </li>
                ))}
                {flags.length > 6 ? <li className="text-[12px] text-muted-foreground">+{flags.length - 6} more on the QC tab</li> : null}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">No readings outside the band.</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4" data-testid="overview-next">
            <h3 className="text-[14px] font-semibold">Next step</h3>
            <ol className="mt-2 space-y-2">
              {nextSteps.map((step, i) => (
                <li key={`${step.title}-${i}`} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2", step.done ? "border-signal-emerald-line bg-signal-emerald-soft/40" : "border-border bg-[hsl(var(--surface-2))]")}>
                  <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold", step.done ? "bg-signal-emerald-ink text-white" : "bg-primary text-primary-foreground")}>{step.done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">{step.title}</span>
                    {step.detail ? <span className="block text-[12px] text-muted-foreground">{step.detail}</span> : null}
                  </span>
                  {step.action ? (
                    <Button size="sm" variant="outline" onClick={step.action.onClick}>
                      {step.action.label}
                    </Button>
                  ) : null}
                </li>
              ))}
              {!nextSteps.length ? <li className="text-[13px] text-muted-foreground">Nothing pending.</li> : null}
            </ol>
          </section>

          <section className="rounded-xl border border-border bg-card p-4" data-testid="overview-details">
            <h3 className="text-[14px] font-semibold">Card details</h3>
            <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Order</dt>
              <dd>
                {facts.orderId ? (
                  <Link href={`/sales-orders/${facts.orderId}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    {facts.orderNo || "Open order"}
                  </Link>
                ) : (
                  facts.orderNo || "—"
                )}
                {facts.lineNo ? ` · line ${facts.lineNo}` : ""}
                {facts.po ? ` · PO ${facts.po}` : ""}
              </dd>
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                {facts.customer}
                {facts.customerCode ? ` · ${facts.customerCode}` : ""}
              </dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{facts.size ? `${facts.size} mm` : "—"}</dd>
              <dt className="text-muted-foreground">Colour</dt>
              <dd>{facts.colour || "Plain (no parchment)"}</dd>
              <dt className="text-muted-foreground">Quantity</dt>
              <dd>
                {fmt(facts.qty, 0)} pcs{facts.bamboo ? ` · ${fmt(facts.bamboo, 0)} bamboo` : ""}
              </dd>
              {facts.pcsPerBamboo ? (
                <>
                  <dt className="text-muted-foreground">Bamboo math</dt>
                  <dd>
                    {fmt(facts.qty, 0)} ÷ {fmt(facts.pcsPerBamboo, 0)} = {(facts.qty / facts.pcsPerBamboo).toFixed(2)} → {fmt(facts.bamboo, 0)} bamboo{facts.bambooLength ? ` · ${fmt(facts.bambooLength, 0)} mm` : ""}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Released</dt>
              <dd>{facts.releasedAt ? stampLabel(facts.releasedAt) : "—"}</dd>
              <dt className="text-muted-foreground">Due</dt>
              <dd>{facts.due ? dayLabel(facts.due) : "—"}</dd>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>{card?.is_emergency ? "Emergency" : facts.priority || "Normal"}</dd>
              <dt className="text-muted-foreground">Lot</dt>
              <dd>{facts.lot || "—"}</dd>
              {lifecycle?.family?.length > 1 ? (
                <>
                  <dt className="text-muted-foreground">Family</dt>
                  <dd>
                    {lifecycle.family.map((f: any, i: number) => (
                      <span key={f.id}>
                        {i ? ", " : ""}
                        {f.is_self ? <b>{f.job_card_no}</b> : <Link href={`/production/job-cards/${f.id}`} className="text-primary underline-offset-2 hover:underline">{f.job_card_no}</Link>}
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          {waitingQc.length ? (
            <p className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]", toneClass("amber"))}>
              <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" /> {waitingQc.length === 1 ? "1 run still needs" : `${waitingQc.length} runs still need`} QC (at least 2 readings per check) — the next stage takes {waitingQc.length === 1 ? "it" : "them"} once QC is recorded.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
