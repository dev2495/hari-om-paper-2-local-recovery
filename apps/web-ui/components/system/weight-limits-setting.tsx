"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Scale } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { purchaseApi } from "@/lib/api"
import { personLabel } from "@/lib/people"
import { errorText } from "@/lib/stock-format"

/**
 * Weight check of a bill (6 Nov 2026): the plant's two limits, Owner only. A bill weighed short up to the
 * first limit is recorded; above it up to the second the Owner decides; above the second the debit note is
 * drafted automatically. Each weight case keeps the limits it was checked with.
 */
export function WeightLimitsSetting({ plantId }: { plantId: string }) {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canEdit = roles.has("Owner") || roles.has("Admin")
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["plant-settings", plantId], queryFn: async () => (await purchaseApi.getPlantSettings(plantId)).data })
  const [notify, setNotify] = useState("")
  const [auto, setAuto] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!query.data) return
    setNotify(String(query.data.weight_short_notify_kg))
    setAuto(String(query.data.weight_short_auto_kg))
  }, [query.data])
  const save = useMutation({
    mutationFn: () => purchaseApi.savePlantSettings({ weight_short_notify_kg: Number(notify), weight_short_auto_kg: Number(auto), expected_version: Number(query.data?.version || 0) }, plantId),
    onSuccess: () => { setSaved(true); client.invalidateQueries({ queryKey: ["plant-settings", plantId] }) },
  })
  const notifyValue = Number(notify)
  const autoValue = Number(auto)
  const problem = !notify.trim() || !auto.trim() || !Number.isFinite(notifyValue) || !Number.isFinite(autoValue) ? "Enter both limits in kg."
    : notifyValue < 0 ? "Limits cannot be below zero." : autoValue < notifyValue ? "The debit-note limit must be at least the Owner limit." : null
  const changed = query.data && (notifyValue !== Number(query.data.weight_short_notify_kg) || autoValue !== Number(query.data.weight_short_auto_kg))
  return (
    <section className="mt-3 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3" data-testid={`plant-weight-limits-${plantId}`}>
      <p className="flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Weight check of a bill</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Bill weight against the scale weight at incoming QC. Stock always stays on the bill weight.</p>
      {query.isLoading ? <div className="mt-2 h-16 animate-pulse rounded-md bg-muted" /> : query.isError ? (
        <p className="mt-2 text-xs font-semibold text-signal-rose-ink">{errorText(query.error, "The limits could not be loaded.")}</p>
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium">Owner decides above (kg short)
              <input type="number" min={0} step="0.001" inputMode="decimal" disabled={!canEdit} value={notify} onChange={(event) => { setNotify(event.target.value); setSaved(false) }}
                className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums disabled:bg-muted sm:h-9" data-testid="weight-notify-kg" />
            </label>
            <label className="block text-xs font-medium">Debit note made automatically above (kg short)
              <input type="number" min={0} step="0.001" inputMode="decimal" disabled={!canEdit} value={auto} onChange={(event) => { setAuto(event.target.value); setSaved(false) }}
                className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums disabled:bg-muted sm:h-9" data-testid="weight-auto-kg" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Up to {Number.isFinite(notifyValue) ? notifyValue.toLocaleString("en-IN") : "—"} kg short: recorded only. Up to {Number.isFinite(autoValue) ? autoValue.toLocaleString("en-IN") : "—"} kg: the Owner gets Make debit note / Skip. Above: drafted automatically. Items not in kg: the Owner is told.
            {query.data?.updated_by ? ` Last set by ${personLabel(query.data.updated_by)}.` : " Defaults (20 / 50 kg)."}
          </p>
          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {problem && changed ? <span className="text-xs font-semibold text-signal-rose-ink">{problem}</span> : null}
              {save.isError ? <span className="text-xs font-semibold text-signal-rose-ink">{errorText(save.error, "Not saved.")}</span> : null}
              {saved && !changed ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span> : null}
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" disabled={!changed || Boolean(problem) || save.isPending} onClick={() => save.mutate()} data-testid="weight-limits-save">
                {save.isPending ? "Saving…" : "Save limits"}
              </button>
            </div>
          ) : <p className="mt-2 text-xs text-muted-foreground">Only the Owner changes these limits.</p>}
        </>
      )}
    </section>
  )
}
