"use client"

// Runs of a card: one row per run with who / when / machine, made · good · rejected and the reason, its QC
// state (flagged runs stay accepted, with the reading and its band in words) and whether it matched the plan.
// Drafts can be edited and submitted, submitted runs can be voided by a supervisor with a reason, and each
// run keeps its revision history; a closed card shows its runs read-only. A table on a wide screen, one
// card per run on a phone or narrow screen.

import { CheckCircle2, Clock3, Flag, History, Pencil, Send, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { errorText } from "@/lib/season-api"
import { useCardMasters, useCardMutation, useEntryApi, useStableCommand } from "./data"
import { clockOf, flagText, fmt, rejectCodeText, runDay, runNo, runQcState, savedRunPlanMatch, shiftLabel, stageLabel, stageParameters, stampLabel, toneClass, useCardRoles, type RunQcState } from "./model"

export function QcChip({ qc, compact }: { qc: RunQcState; compact?: boolean }) {
  const Icon = qc.flags.length || qc.key === "flagged" ? Flag : qc.key === "done" || qc.key === "qc_only" || qc.key === "no_qc" ? CheckCircle2 : qc.key === "due" || qc.key === "short" || qc.key === "draft" ? Clock3 : null
  const words =
    compact && (qc.key === "flagged" || (qc.key === "draft" && qc.flags.length))
      ? `${qc.key === "draft" ? "Draft · " : ""}Flagged · ${qc.flags.length} reading${qc.flags.length === 1 ? "" : "s"}`
      : compact && qc.key === "short"
        ? "Needs more readings"
        : qc.label
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", toneClass(qc.tone))} title={[qc.label, qc.detail].filter(Boolean).join(" — ")} data-testid={`run-qc-${qc.key}`}>
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{words}</span>
    </span>
  )
}

/** The flagged readings of a run in words, under its QC chip. */
function FlagLines({ qc, className }: { qc: RunQcState; className?: string }) {
  if (!qc.flags.length) return null
  return (
    <span className={cn("mt-0.5 block text-[11.5px] leading-snug text-signal-amber-ink", className)} data-testid="run-flag-lines">
      {qc.flags.map((f: any) => flagText(f)).join(" · ")}
    </span>
  )
}

export function RunRows({
  card,
  flow,
  entries,
  planRuns,
  showStage = true,
  layout = "auto",
  onEdit,
  onQc,
  readOnly = false,
  emptyText = "No runs logged yet.",
}: {
  card: any
  flow: any
  entries: any[]
  planRuns?: any[]
  showStage?: boolean
  /** "list" keeps the one-card-per-run layout at every width (the phone landing). */
  layout?: "auto" | "list"
  onEdit?: (entry: any) => void
  onQc?: (entry: any) => void
  /** A closed (completed or cancelled) card: no Submit or Void on its runs (Edit and QC follow onEdit / onQc). */
  readOnly?: boolean
  emptyText?: string
}) {
  const entryApi = useEntryApi(card)
  const { canSubmit, canDraft, canQc } = useCardRoles()
  const { machineName, employees } = useCardMasters(card)
  const { mutation, error, setError } = useCardMutation(String(card.id))
  const { stableCommand, reset } = useStableCommand()
  const [history, setHistory] = useState<{ entry: any; rows: any[] } | null>(null)
  const stateOf = (stage: string) => (flow?.stages || []).find((s: any) => s.stage === stage)
  // Drafts carry the operator's id only (the name is stamped when the supervisor submits): show the name from Masters.
  const employeeName = useMemo(() => {
    const by: Record<string, string> = {}
    for (const e of employees.data || []) by[String(e.id)] = e.name
    return by
  }, [employees.data])

  const submit = (e: any) =>
    mutation.mutate(async () => {
      const result = await entryApi.submit(card.id, e.id, stableCommand({ expected_version: e.row_version, reason: "Reviewed draft" }, `submit:${e.id}`))
      reset()
      return result
    })
  const voidRun = (e: any) => {
    const reason = window.prompt(`Reason to void ${stageLabel(e.stage)} run ${runNo(e)} (output already used by the next stage cannot be voided)`)
    if (!reason?.trim()) return
    mutation.mutate(async () => {
      const result = await entryApi.void(card.id, e.id, stableCommand({ expected_version: e.row_version, reason: reason.trim() }, `void:${e.id}`))
      reset()
      return result
    })
  }
  const openHistory = async (e: any) => {
    try {
      setHistory({ entry: e, rows: (await entryApi.history(card.id, e.id)).data || [] })
    } catch (err) {
      setError(errorText(err))
    }
  }

  const who = (e: any) => [e.operator_name || employeeName[String(e.operator_id || "")], e.details?.helper_name].filter(Boolean).join(" + ")
  const logged = (e: any) => `${stampLabel(e.created_at)}${e.created_by ? ` · ${String(e.created_by).split("@")[0]}` : ""}`
  const reason = (e: any) => {
    const parts: string[] = []
    if (e.rejected && e.details?.reject_code) parts.push(`${e.details.reject_code} ${rejectCodeText(e.details.reject_code).toLowerCase()}`)
    else if (e.rejected && e.details?.reject_reason) parts.push(e.details.reject_reason)
    if (e.cutting_loss_pcs) parts.push(`cutting loss ${fmt(e.cutting_loss_pcs)}${e.details?.cutting_loss_reason ? `: ${e.details.cutting_loss_reason}` : ""}`)
    if (e.carry_in_pcs) parts.push(`held in ${fmt(e.carry_in_pcs)}`)
    if (e.carry_out_pcs) parts.push(`held out ${fmt(e.carry_out_pcs)}`)
    if (e.details?.overproduction_reason) parts.push(`over plan: ${e.details.overproduction_reason}`)
    if (e.qc_gate_override) parts.push("taken before upstream QC (override)")
    if (e.details?.material_prep_pending) parts.push("before the slitting record")
    return parts.join(" · ")
  }
  const totals = useMemo(() => {
    const by: Record<string, { made: number; good: number; rejected: number }> = {}
    for (const e of entries) {
      if (e.status !== "SUBMITTED" || e.kind === "QC_ONLY") continue
      const unit = stateOf(e.stage)?.unit || "pcs"
      by[unit] = by[unit] || { made: 0, good: 0, rejected: 0 }
      by[unit].made += Number(e.produced || 0)
      by[unit].good += Number(e.accepted || 0)
      by[unit].rejected += Number(e.rejected || 0)
    }
    // Route order: Winding / Oven in bamboo first, then Process onwards in pcs.
    return Object.entries(by).sort(([a], [b]) => (a === b ? 0 : a === "bamboo" ? -1 : b === "bamboo" ? 1 : 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, flow])

  // `suffix` keeps the phone list's test ids apart from the table's (both are rendered, one is hidden by CSS).
  const actions = (e: any, suffix = "") => {
    const state = stateOf(e.stage)
    const hasQc = stageParameters(card, e.stage).length > 0
    const accepted = runQcState(card, e).accepted
    return (
      <div className="flex flex-wrap items-center justify-end gap-0.5">
        {["SUBMITTED", "DRAFT"].includes(e.status) && hasQc && canQc && onQc && e.kind !== "QC_ONLY" ? (
          <Button size="sm" variant={accepted ? "ghost" : "outline"} className="h-8 px-2.5" onClick={() => onQc(e)} title={e.samples?.length ? "See or add QC readings" : "Log QC for this run"} data-testid={`run-qc-button-${e.entry_no}${suffix}`}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {e.samples?.length ? "QC" : "Add QC"}
          </Button>
        ) : null}
        {e.status === "DRAFT" && canSubmit && !readOnly ? (
          <Button size="sm" className="h-8 px-2.5" disabled={mutation.isPending} onClick={() => submit(e)} title="Checked — post this run" data-testid={`run-submit-${e.entry_no}${suffix}`}>
            <Send className="h-3.5 w-3.5" />
            Submit
          </Button>
        ) : e.status === "DRAFT" && !readOnly ? (
          <span className="px-1 text-[11.5px] text-muted-foreground" data-testid={`run-waiting-supervisor-${e.entry_no}${suffix}`}>
            supervisor submits
          </span>
        ) : null}
        {e.status === "DRAFT" && canDraft && onEdit ? (
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(e)} title="Edit this draft" aria-label={`Edit draft ${runNo(e)}`} data-testid={`run-edit-${e.entry_no}${suffix}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {e.status !== "VOID" && canSubmit && !readOnly && state?.status !== "COMPLETED" ? (
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={mutation.isPending} onClick={() => voidRun(e)} title="Void this run (reason required)" aria-label={`Void ${runNo(e)}`} data-testid={`run-void-${e.entry_no}${suffix}`}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void openHistory(e)} title="Revision history" aria-label={`Revision history of ${runNo(e)}`} data-testid={`run-history-${e.entry_no}${suffix}`}>
          <History className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }
  const statusChips = (e: any) => (
    <>
      {e.kind === "QC_ONLY" ? <span className={cn("rounded-full border px-1.5 text-[10.5px] font-semibold", toneClass("violet"))}>QC without a run</span> : null}
      {e.kind === "DISPOSITION" ? <span className="rounded-full border border-border bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground">held pieces</span> : null}
      {e.status === "DRAFT" ? <span className={cn("rounded-full border px-1.5 text-[10.5px] font-semibold", toneClass("amber"))}>Draft</span> : null}
      {e.status === "VOID" ? (
        <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10.5px] font-semibold", toneClass("rose"))}>
          <X className="h-2.5 w-2.5" aria-hidden="true" /> Voided
        </span>
      ) : null}
    </>
  )

  const table = layout === "auto"
  return (
    <div data-testid="run-rows">
      {error ? (
        <p role="alert" className="m-3 rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink">
          {error}
        </p>
      ) : null}
      {entries.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{emptyText}</p> : null}

      {entries.length && table ? (
        <div className="hidden xl:block">
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col className="w-[5.25rem]" />
              <col className="w-[9rem]" />
              <col />
              <col className="w-[3.75rem]" />
              <col className="w-[5.75rem]" />
              <col className="w-[7rem]" />
              <col className="w-[11rem]" />
              <col className="w-[9.75rem]" />
            </colgroup>
            <thead className="bg-[hsl(var(--surface-2))] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Run</th>
                <th className="px-2 py-2 text-left">Date · shift · plan</th>
                <th className="px-2 py-2 text-left">Operator · logged</th>
                <th className="px-2 py-2 text-right">Made</th>
                <th className="px-2 py-2 text-right">Good</th>
                <th className="px-2 py-2 text-right">Rejected</th>
                <th className="px-2 py-2 text-left">QC</th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e: any) => {
                const qc = runQcState(card, e)
                const plan = savedRunPlanMatch(e, stateOf(e.stage), planRuns)
                const state = stateOf(e.stage)
                const voided = e.status === "VOID"
                const note = reason(e)
                return (
                  <tr key={e.id} className={cn("align-top", voided ? "text-muted-foreground" : "", qc.flags.length && !voided ? "bg-signal-amber-soft/25" : "")} data-testid={`run-row-${e.stage.toLowerCase()}-${e.entry_no}`}>
                    <td className="px-3 py-2">
                      <span className={cn("font-semibold", voided ? "line-through" : "")}>{runNo(e)}</span>
                      {showStage ? <span className="block text-[11.5px] text-muted-foreground">{stageLabel(e.stage)}</span> : null}
                      <span className="mt-0.5 flex flex-wrap gap-1">{statusChips(e)}</span>
                    </td>
                    <td className="px-2 py-2">
                      {runDay(e)}
                      {e.shift_code ? (
                        <>
                          {" "}
                          · <b>{shiftLabel(e.shift_code).replace("Shift ", "")}</b>
                        </>
                      ) : null}
                      {e.machine_id ? <span className="block truncate text-[11.5px] text-muted-foreground">{machineName(e.machine_id) || "machine"}</span> : null}
                      {e.details?.start_time && e.details?.end_time ? (
                        <span className="block text-[11.5px] text-muted-foreground">
                          {clockOf(e.details.start_time)}–{clockOf(e.details.end_time)}
                        </span>
                      ) : null}
                      {e.kind === "QC_ONLY" || voided ? null : (
                        <span className={cn("mt-1 block w-fit max-w-full truncate rounded-full border px-2 py-px text-[11px] font-medium", toneClass(plan.tone))} title={`Plan match: ${plan.label}`} data-testid={`run-plan-${e.entry_no}`}>
                          {plan.label}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className="block truncate">{who(e) || "—"}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{logged(e)}</span>
                    </td>
                    {e.kind === "QC_ONLY" ? (
                      <td className="px-2 py-2 text-right text-muted-foreground" colSpan={3}>
                        {(e.samples || []).length} sample{(e.samples || []).length === 1 ? "" : "s"}
                        {e.details?.qc_remark ? <span className="block truncate text-[11.5px]">{e.details.qc_remark}</span> : null}
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(e.produced)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                          <b className={voided ? "" : "text-foreground"}>{fmt(e.accepted)}</b> <span className="text-[11px] text-muted-foreground">{state?.unit || ""}</span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          <span className={e.rejected && !voided ? "font-semibold text-signal-rose-ink" : ""}>{fmt(e.rejected)}</span>
                          {note ? (
                            <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={note}>
                              {note}
                            </span>
                          ) : null}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2">
                      {voided ? <span className="text-[11.5px] text-muted-foreground">not counted</span> : <QcChip qc={qc} compact />}
                      <FlagLines qc={qc} />
                    </td>
                    <td className="px-2 py-1.5">{actions(e)}</td>
                  </tr>
                )
              })}
            </tbody>
            {totals.length ? (
              <tfoot className="border-t border-border bg-[hsl(var(--surface-2))] text-[12.5px]">
                {totals.map(([unit, t], index) => (
                  <tr key={unit} data-testid={`run-totals-${unit}`}>
                    <td className="px-3 py-2 font-semibold" colSpan={3}>
                      Totals · posted runs{totals.length > 1 ? ` in ${unit}` : ""}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(t.made)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">
                      {fmt(t.good)} <span className="text-[11px] font-normal text-muted-foreground">{unit}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(t.rejected)}</td>
                    <td className="px-2 py-2 text-[11.5px] text-muted-foreground" colSpan={2}>
                      {index === totals.length - 1 ? (totals.length > 1 ? "each stage in its own unit · drafts count once submitted" : "drafts count once submitted") : ""}
                    </td>
                  </tr>
                ))}
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {entries.length ? (
        <ul className={cn("divide-y divide-border", table ? "xl:hidden" : "")}>
          {entries.map((e: any) => {
            const qc = runQcState(card, e)
            const plan = savedRunPlanMatch(e, stateOf(e.stage), planRuns)
            const state = stateOf(e.stage)
            const voided = e.status === "VOID"
            const note = reason(e)
            return (
              <li
                key={e.id}
                className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4", voided ? "text-muted-foreground" : "", qc.flags.length && !voided ? "bg-signal-amber-soft/25" : "")}
                data-testid={`run-card-${e.stage.toLowerCase()}-${e.entry_no}`}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("text-[15px] font-semibold", voided ? "line-through" : "")}>
                      {runNo(e)}
                      {showStage ? <span className="font-normal text-muted-foreground"> · {stageLabel(e.stage)}</span> : null}
                    </span>
                    {statusChips(e)}
                    <span className="ml-auto text-[12px] text-muted-foreground">
                      {runDay(e)}
                      {e.shift_code ? ` · ${shiftLabel(e.shift_code)}` : ""}
                    </span>
                  </div>
                  {e.kind === "QC_ONLY" ? (
                    <p className="text-[13px] text-muted-foreground">
                      {(e.samples || []).length} sample{(e.samples || []).length === 1 ? "" : "s"}
                      {e.details?.qc_remark ? ` · ${e.details.qc_remark}` : ""}
                    </p>
                  ) : (
                    <p className="text-[14px] tabular-nums">
                      {fmt(e.produced)} made · <b>{fmt(e.accepted)} good</b>
                      {e.rejected ? <span className="text-signal-rose-ink"> · {fmt(e.rejected)} rejected</span> : null} <span className="text-muted-foreground">{state?.unit || ""}</span>
                      {note ? <span className="block text-[12px] text-muted-foreground">{note}</span> : null}
                    </p>
                  )}
                  <p className="text-[12px] text-muted-foreground">{[e.machine_id ? machineName(e.machine_id) : "", who(e), logged(e)].filter(Boolean).join(" · ")}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {voided ? <span className="text-[11.5px] text-muted-foreground">not counted</span> : <QcChip qc={qc} compact />}
                    {e.kind !== "QC_ONLY" && !voided ? <span className={cn("inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium", toneClass(plan.tone))}>{plan.label}</span> : null}
                  </div>
                  <FlagLines qc={qc} />
                </div>
                <div className="shrink-0 sm:w-auto">{actions(e, "-m")}</div>
              </li>
            )
          })}
        </ul>
      ) : null}

      <Dialog open={Boolean(history)} onOpenChange={(open) => (open ? undefined : setHistory(null))}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {stageLabel(history?.entry?.stage || "")} run {history?.entry ? runNo(history.entry) : ""} · revisions
            </DialogTitle>
            <DialogDescription>Every save of this run, newest first, with who and why.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(history?.rows || [])
              .slice()
              .sort((a: any, b: any) => Number(b.version ?? b.row_version) - Number(a.version ?? a.row_version))
              .map((r: any, index: number) => {
                const p = r.payload || {}
                return (
                  <li key={`${r.version ?? r.row_version}-${index}`} className="rounded-lg border border-border p-3 text-[13px]">
                    <p className="font-semibold">
                      Revision {r.version ?? r.row_version} · {String(r.actor || "").split("@")[0] || "—"}
                      {r.created_at || r.at ? <span className="font-normal text-muted-foreground"> · {stampLabel(r.created_at || r.at)}</span> : null}
                    </p>
                    <p className="text-muted-foreground">{r.reason || "—"}</p>
                    {p.kind !== "QC_ONLY" ? (
                      <p className="mt-1 tabular-nums">
                        {fmt(p.produced)} made · {fmt(p.accepted)} good · {fmt(p.rejected)} rejected · {String(p.status || "").toLowerCase()} · {(p.samples || []).length} QC sample{(p.samples || []).length === 1 ? "" : "s"}
                      </p>
                    ) : (
                      <p className="mt-1">{(p.samples || []).length} QC samples</p>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-muted-foreground">Full record</summary>
                      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(p, null, 2)}</pre>
                    </details>
                  </li>
                )
              })}
            {history && !history.rows.length ? <li className="text-[13px] text-muted-foreground">No revisions recorded.</li> : null}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
