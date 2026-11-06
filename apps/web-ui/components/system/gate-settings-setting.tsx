"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { CheckCircle2, DoorOpen } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import type { GateSettings } from "@/lib/api-gate"
import { personLabel } from "@/lib/people"
import { errorText } from "@/lib/stock-format"

/**
 * Gate settings of a plant (6 Nov 2026), Owner only: the gate close time (visitors still inside after it turn
 * red and the Owner gets a daily list; challans not out by then are told to Dispatch) and how long visitor
 * photos are kept (then they are wiped; the visit log stays).
 */
export function GateSettingsSetting({ plantId }: { plantId: string }) {
  const { user } = useAuth()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canEdit = roles.has("Owner")
  const client = useQueryClient()
  const headers = { "X-Plant-ID": plantId }
  const query = useQuery({ queryKey: ["gate-settings", plantId], queryFn: async () => (await api.get<GateSettings & { updated_by?: string }>("/api/gate/settings", { headers })).data })
  const [close, setClose] = useState("")
  const [days, setDays] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (query.data) { setClose(query.data.gate_close_time); setDays(String(query.data.visitor_retention_days)) } }, [query.data])
  const save = useMutation({
    mutationFn: async () => (await api.put("/api/gate/settings", { gate_close_time: close, visitor_retention_days: Number(days), expected_version: Number(query.data?.version || 0) }, { headers })).data,
    onSuccess: () => { setSaved(true); client.invalidateQueries({ queryKey: ["gate-settings", plantId] }) },
  })
  const daysValue = Number(days)
  const problem = !/^\d{2}:\d{2}$/.test(close) ? "Pick the gate close time." : !Number.isInteger(daysValue) || daysValue < 30 || daysValue > 3650 ? "Keep photos 30 to 3,650 days." : null
  const changed = query.data && (close !== query.data.gate_close_time || daysValue !== query.data.visitor_retention_days)
  return (
    <section className="mt-3 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-3" data-testid={`plant-gate-settings-${plantId}`}>
      <p className="flex items-center gap-2 text-sm font-semibold"><DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Gate</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Gates and their QR posters: <Link className="underline" href="/system/gates">System › Gates</Link>.</p>
      {query.isLoading ? <div className="mt-2 h-16 animate-pulse rounded-md bg-muted" /> : query.isError ? (
        <p className="mt-2 text-xs font-semibold text-signal-rose-ink">{errorText(query.error, "The gate settings could not be loaded.")}</p>
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium">Gate closes at
              <input type="time" disabled={!canEdit} value={close} onChange={(event) => { setClose(event.target.value); setSaved(false) }}
                className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums disabled:bg-muted sm:h-9" data-testid="gate-close-time" />
            </label>
            <label className="block text-xs font-medium">Keep visitor photos (days)
              <input type="number" min={30} max={3650} step={1} inputMode="numeric" disabled={!canEdit} value={days} onChange={(event) => { setDays(event.target.value); setSaved(false) }}
                className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums disabled:bg-muted sm:h-9" data-testid="gate-retention-days" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Visitors still inside after {close || "—"} turn red on the gate desk and the Owner gets one list a day; challans not out by then are told to Dispatch.
            {query.data?.version ? (query.data.updated_by ? ` Last set by ${personLabel(query.data.updated_by)}.` : "") : ` Defaults (${query.data?.defaults.gate_close_time}, ${query.data?.defaults.visitor_retention_days} days).`}
          </p>
          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {problem && changed ? <span className="text-xs font-semibold text-signal-rose-ink">{problem}</span> : null}
              {save.isError ? <span className="text-xs font-semibold text-signal-rose-ink">{errorText(save.error, "Not saved.")}</span> : null}
              {saved && !changed ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span> : null}
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-8" disabled={!changed || Boolean(problem) || save.isPending} onClick={() => save.mutate()} data-testid="gate-settings-save">
                {save.isPending ? "Saving…" : "Save gate settings"}
              </button>
            </div>
          ) : <p className="mt-2 text-xs text-muted-foreground">Only the Owner changes these.</p>}
        </>
      )}
    </section>
  )
}
