"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Hash } from "lucide-react"

import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { api } from "@/lib/api"
import { errorText } from "@/lib/season-api"

type SerialState = {
  financial_year: number
  year_label: string
  restarts_on: string
  next_number: number
  next_serial: string
  highest_issued: number
  last_serial: string | null
  issued: boolean
  set: boolean
  can_set: boolean
  history: Array<{ from_number: number; to_number: number; reason: string; set_by: string; set_at: string | null }>
}

const onPlant = (plantId: string) => ({ headers: { "X-Plant-ID": plantId } })
const pad = (value: number) => String(value).padStart(5, "0")
const when = (value: string | null) => (value ? new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "")

/** The two AIT series of a plant: reels (owner decision 6, 1 Nov 2026) and glue tanks (owner, 3 Nov 2026). */
type SeriesKind = "reel" | "tank"
const SERIES: Record<SeriesKind, { path: string; title: string; thing: string; things: string; extra: string }> = {
  reel: { path: "reel-serial", title: "Reel numbers", thing: "reel", things: "Reels", extra: " Coils slit from a reel get its number plus -1, -2…" },
  tank: { path: "tank-serial", title: "Glue tank numbers", thing: "glue tank", things: "Glue tanks", extra: " Its own series, apart from the reels." },
}

/**
 * The plant's AIT reel serial (owner decision 6, 1 Nov 2026): what the next new reel gets this financial year.
 * The Owner / Admin sets it once to carry on from the plant's own series (e.g. AIT 06280); after reels have
 * numbers it can only be raised. Every change keeps who, when and why.
 */
export function ReelSerialSetting({ plantId }: { plantId: string }) {
  return <SerialSetting plantId={plantId} kind="reel" />
}

/** The plant's glue tank number (owner, 3 Nov 2026): the same setting on its own series (e.g. AIT 01001). */
export function TankSerialSetting({ plantId }: { plantId: string }) {
  return <SerialSetting plantId={plantId} kind="tank" />
}

function SerialSetting({ plantId, kind }: { plantId: string; kind: SeriesKind }) {
  const series = SERIES[kind]
  const id = series.path // test ids: reel-serial-… / tank-serial-…
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [`inventory-${series.path}`, plantId],
    queryFn: async () => (await api.get<SerialState>(`/api/inventory/${series.path}`, onPlant(plantId))).data,
    enabled: Boolean(plantId),
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState("")
  // Why: a REEL_SERIAL code from Masters › Reason codes of this plant (owner decision 4, 1 Nov 2026).
  const reason = useReasonChoice("REEL_SERIAL", plantId)
  const save = useMutation({
    mutationFn: async () => (await api.put<SerialState>(`/api/inventory/${series.path}`, { next_number: Number(number), ...reason.payload("reason") }, onPlant(plantId))).data,
    onSuccess: (data) => {
      client.setQueryData([`inventory-${series.path}`, plantId], data)
      setOpen(false)
      setNumber("")
      reason.reset()
    },
  })
  const state = query.data
  if (query.isError) return null // roles that cannot see the setting see nothing
  if (!state) return <p className="text-xs text-muted-foreground">Loading {series.thing} numbers…</p>
  const wanted = Number(number)
  const tooLow = Boolean(number) && state.issued && wanted <= state.highest_issued
  const invalid = !number || !Number.isInteger(wanted) || wanted < 1 || wanted > 99999 || tooLow

  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/50 p-3" data-testid={`${id}-${plantId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Hash className="h-3.5 w-3.5" aria-hidden="true" />{series.title} {state.year_label}</p>
          <p className="mt-0.5 text-sm text-foreground">Next new {series.thing} gets <strong className="font-mono" data-testid={`${id}-next`}>{state.next_serial}</strong></p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state.last_serial ? `Last given ${state.last_serial}. ` : `No ${series.thing} has a number this year yet. `}
            Starts again at AIT 00001 on 1 April.{series.extra}
          </p>
        </div>
        {state.can_set && !open ? (
          <button type="button" className="erp-btn-secondary !h-11 shrink-0 sm:!h-9" onClick={() => { setOpen(true); setNumber(String(state.next_number)) }} data-testid={`${id}-edit`}>
            {state.set ? "Change next number" : "Set next number"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]" onSubmit={(event) => { event.preventDefault(); if (!invalid && reason.validate()) save.mutate() }} data-testid={`${id}-form`}>
          <label className="text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Next number</span>
            <span className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-sm font-bold">AIT</span>
              <input className="h-11 w-full rounded-md border border-input bg-card px-2 font-mono text-base sm:h-9 sm:text-sm" inputMode="numeric" value={number}
                onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, 5))} aria-invalid={tooLow || undefined} data-testid={`${id}-number`} />
            </span>
          </label>
          <ReasonPicker category="REEL_SERIAL" plantId={plantId} label="Why" value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact testIdPrefix={`${id}-reason`} />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {number && !tooLow ? <>The next new {series.thing} gets <strong className="font-mono text-foreground">AIT {pad(wanted || 0)}</strong>. </> : null}
            {state.issued ? `${series.things} already have numbers up to ${state.last_serial}: the next number can only go up.` : `Set this once, before the first ${series.thing} of this year is received in the system.`}
          </p>
          {tooLow ? <p className="flex items-start gap-1 text-xs font-semibold text-signal-rose-ink sm:col-span-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{state.last_serial} is already on a {series.thing}. Choose {pad(state.highest_issued + 1)} or higher.</p> : null}
          {save.isError ? <p role="alert" className="text-xs font-semibold text-signal-rose-ink sm:col-span-2">{errorText(save.error)}</p> : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className="erp-btn-primary !h-11 sm:!h-9" disabled={invalid || save.isPending} data-testid={`${id}-save`}>{save.isPending ? "Saving…" : "Save next number"}</button>
            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {state.history.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer py-1 font-semibold text-muted-foreground">Changes ({state.history.length})</summary>
          <ol className="mt-1 space-y-1">
            {state.history.map((row, index) => (
              <li key={index} className="flex items-start gap-1.5 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-signal-emerald-ink" aria-hidden="true" />
                <span>AIT {pad(row.from_number)} → <strong className="text-foreground">AIT {pad(row.to_number)}</strong> · {row.set_by} · {when(row.set_at)} · {row.reason}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}
