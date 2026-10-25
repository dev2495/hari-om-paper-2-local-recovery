"use client"

import { ArrowRightLeft, History } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAuth } from "@/context/AuthContext"
import { describeApiError } from "@/lib/api-error"
import { productionApi } from "@/lib/api"

/**
 * Cards released before batch entry used the old stage form, which needs a planner slot and
 * QC-approved tolerances before a stage can close (client 2026-10-25: "allow entry … on all stages",
 * "error while closing winder"). Such a card with no stage closed yet moves to batch entry — the
 * same flow as every new card. A card that cannot close anything on the old form (no approved stage
 * QC) moves by itself when its floor page opens; otherwise the supervisor presses the button.
 */
const SWITCH_ROLES = ["Owner", "Admin", "PlantManager", "Planner", "Operator"]

export function BatchEntrySwitch({ card, onSwitched }: { card: any; onSwitched: () => void }) {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const allowed = SWITCH_ROLES.some((role) => roles.has(role))
  const stages: any[] = Array.isArray(card?.stages) ? card.stages : []
  const closedOnOldForm = stages.filter((row) => row.status === "COMPLETED" && row.stage_type !== "SLITTING").map((row) => row.stage_type)
  const stuck = Boolean(card?.spec_snapshot?.missing_qc_setup || card?.spec_snapshot?.missing_profile_marker)
  const open = card && !["COMPLETED", "CANCELLED"].includes(String(card.status || "").toUpperCase())
  const [state, setState] = useState<"idle" | "working" | "error">("idle")
  const [error, setError] = useState("")
  const tried = useRef(false)

  const run = async () => {
    setState("working")
    setError("")
    try {
      await productionApi.switchToBatchEntry(String(card.id), String(card.plant_id || "") || undefined)
      onSwitched()
    } catch (err) {
      setState("error")
      setError(describeApiError(err, "The card could not be moved to batch entry."))
    }
  }

  useEffect(() => {
    if (!open || !allowed || closedOnOldForm.length || !stuck || tried.current) return
    tried.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, open, allowed, stuck, closedOnOldForm.length])

  if (!open) return null
  if (closedOnOldForm.length) {
    return (
      <div className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-[13px]" data-testid="old-form-card">
        <span className="font-semibold">Old entry form.</span> {closedOnOldForm.join(", ")} was closed on this form, so the card finishes here. Runs before planning are allowed and flagged.
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-signal-cyan-line bg-signal-cyan-soft px-4 py-3 text-[13px] text-signal-cyan-ink" data-testid="batch-entry-switch">
      <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {state === "working"
          ? "Moving this card to batch entry…"
          : stuck
            ? "This card was released on the old form without approved stage QC tolerances, so its stages could not close. It moves to batch entry: the same flow as every new card — QC from the stage rules, Process last, finished goods and packing posted automatically, runs before planning allowed and flagged."
            : "This card uses the old entry form. Move it to batch entry — the same flow as every new card: Process last, finished goods and packing posted automatically, runs before planning allowed and flagged."}
        {state === "error" ? <span role="alert" className="mt-1 block font-semibold text-signal-rose-ink">{error}</span> : null}
      </p>
      {allowed ? (
        <button type="button" className="erp-btn-primary !h-9" disabled={state === "working"} onClick={() => void run()} data-testid="batch-entry-switch-button">
          {state === "working" ? "Moving…" : state === "error" ? "Try again" : "Move to batch entry"}
        </button>
      ) : (
        <span className="text-[12px]">A supervisor or planner can move it.</span>
      )}
    </div>
  )
}

/** What was typed on the old form before the card moved to batch entry, to enter again as a batch. */
export function OldFormDrafts({ card }: { card: any }) {
  const drafts = card?.spec_snapshot?.switched_to_batch_entry?.old_drafts || {}
  const stages = Object.entries(drafts) as Array<[string, Record<string, any>]>
  if (!stages.length) return null
  const show = (value: any): string => {
    if (Array.isArray(value)) return value.map((row) => (row && typeof row === "object" ? Object.entries(row).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k} ${v}`).join(", ") : String(row))).filter(Boolean).join(" | ")
    if (value && typeof value === "object") return Object.entries(value).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k} ${v}`).join(", ")
    return String(value)
  }
  return (
    <details className="rounded-xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-[13px] text-signal-amber-ink" data-testid="old-form-drafts">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><History className="h-4 w-4" aria-hidden="true" />Typed on the old form before the move — enter it again as a batch</summary>
      <div className="mt-2 space-y-2">
        {stages.map(([stage, values]) => (
          <div key={stage}>
            <p className="font-semibold">{stage}</p>
            <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {Object.entries(values).filter(([key]) => !["qc_reasons"].includes(key)).map(([key, value]) => (
                <li key={key} className="min-w-0 truncate" title={show(value)}><span className="opacity-75">{key.replace(/_/g, " ")}:</span> {show(value)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
