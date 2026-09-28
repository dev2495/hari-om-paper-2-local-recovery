"use client"

import { useRef, useState } from "react"
import { Activity, Flame, Plus, Wind } from "lucide-react"

import { ColorChip, JobCardNo, LifecycleBadge } from "@/components/production/lifecycle-chips"
import { useApp } from "@/context/AppContext"
import { apiErrorText, newRequestId, useJobCardLifecycle, useRunningEntry, type JobCardLifecycle } from "@/hooks/use-lifecycle"
import { cn } from "@/lib/utils"

const fmt = (value: number | null | undefined) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })

function currentShift() {
  const hour = new Date().getHours()
  return hour >= 8 && hour < 20 ? "SHIFT_A" : "SHIFT_B"
}

/**
 * Winder → oven is one continuous flow on one card/lot: tubes go into the oven as they come
 * off the winder. Supervisors log bamboos as they happen on both stages; the oven can never
 * run ahead of the winder, the winder may beat plan by the +10% tolerance. The final stage
 * completion (weights, moisture, QC) is still done in the card below.
 */
export function LiveFloorLog({ jobCardId }: { jobCardId: string }) {
  const query = useJobCardLifecycle(jobCardId)
  const data = query.data
  if (query.isLoading) return <div className="skeleton h-40 rounded-xl" />
  if (!data) return null
  const flow = data.stages.filter((stage) => stage.stage === "WINDER" || stage.stage === "OVEN")
  if (!flow.length) return null
  return (
    <section className="erp-panel rounded-xl p-4" data-testid="live-floor-log">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-[15px] font-semibold">Live floor log</h2>
        <JobCardNo job={data} />
        <LifecycleBadge state={data.state} />
        <ColorChip color={data.parchment_color} empty="Plain" />
        <span className="ml-auto text-[12px] text-muted-foreground">One batch/lot · winder and oven run together</span>
      </div>
      {data.missed_slot_open ? (
        <p className="mt-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink">
          This card missed its {data.last_missed_slot?.plan_date} slot and went back to the queue. Logging output now puts it back on that slot.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {flow.map((stage) => (
          <StageColumn key={stage.stage} data={data} stage={stage} winderTotal={Math.max(...data.stages.filter((row) => row.stage === "WINDER").map((row) => Math.max(row.running_total, row.output_qty)), 0)} />
        ))}
      </div>
    </section>
  )
}

function StageColumn({ data, stage, winderTotal }: { data: JobCardLifecycle; stage: JobCardLifecycle["stages"][number]; winderTotal: number }) {
  const { showToast } = useApp()
  const add = useRunningEntry()
  const [qty, setQty] = useState("")
  const [scrap, setScrap] = useState("")
  const [shift, setShift] = useState(currentShift())
  const total = Math.max(stage.running_total, stage.output_qty)
  const plan = stage.planned_in_unit || 0
  const limit = stage.stage === "WINDER" ? plan * (1 + data.output_tolerance_pct / 100) : winderTotal
  const pct = plan ? Math.min(100, (total / plan) * 100) : 0
  const finished = stage.status === "COMPLETED"
  const canLog = data.actions.running_entry || data.missed_slot_open
  const Icon = stage.stage === "WINDER" ? Wind : Flame
  const requestId = useRef<string | null>(null)
  const submit = async () => {
    const value = Number(qty)
    if (!value || value <= 0) return
    requestId.current ||= newRequestId()
    try {
      await add.mutateAsync({ jobCardId: data.id, data: { stage: stage.stage, qty: value, scrap_qty: Number(scrap || 0), shift_code: shift, request_id: requestId.current } })
      requestId.current = null
      showToast(`${stage.stage.toLowerCase()} +${fmt(value)} ${stage.unit} logged.`, "success")
      setQty("")
      setScrap("")
    } catch (error: any) {
      if (error?.response) requestId.current = null
      showToast(apiErrorText(error), "error")
    }
  }
  return (
    <div className={cn("rounded-lg border p-3", finished ? "border-signal-emerald-line bg-signal-emerald-soft/40" : "border-border bg-card")}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-[13.5px] font-semibold">{stage.stage === "WINDER" ? "Winder" : "Oven"}</p>
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          <strong className="text-[15px] text-foreground">{fmt(total)}</strong> / {fmt(plan)} {stage.unit}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", finished ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {stage.stage === "WINDER" ? `Up to ${fmt(limit)} allowed (+${data.output_tolerance_pct}%)` : `Can't pass what's wound so far: ${fmt(winderTotal)}`}
        {data.pcs_per_bamboo && stage.unit === "bamboo" ? ` · ≈ ${fmt(total * data.pcs_per_bamboo)} pcs` : ""}
      </p>
      {finished ? (
        <p className="mt-2 text-[12.5px] font-medium text-signal-emerald-ink">Stage finalised.</p>
      ) : canLog ? (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-2">
          <input type="number" min="0" inputMode="decimal" aria-label={`${stage.stage} ${stage.unit} made`} placeholder={`${stage.unit} made`} value={qty} onChange={(event) => setQty(event.target.value)} className="h-10 rounded-lg border border-input bg-card px-2.5 text-[14px] tabular-nums" />
          <input type="number" min="0" inputMode="decimal" aria-label={`${stage.stage} scrap`} placeholder="scrap" value={scrap} onChange={(event) => setScrap(event.target.value)} className="h-10 rounded-lg border border-input bg-card px-2.5 text-[14px] tabular-nums" />
          <button type="button" onClick={() => void submit()} disabled={add.isPending || !Number(qty)} className="erp-btn-primary !h-10"><Plus className="h-4 w-4" />Log</button>
          <div className="tube-segment col-span-3 w-full" role="group" aria-label="Shift">
            {["SHIFT_A", "SHIFT_B"].map((code) => (
              <button key={code} type="button" className="flex-1 justify-center" aria-pressed={shift === code} onClick={() => setShift(code)}>{code.replace("SHIFT_", "Shift ")}</button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Put the card on the schedule to start logging.</p>
      )}
      {stage.running_entries.length ? (
        <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-border pt-2">
          {[...stage.running_entries].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="font-semibold">+{fmt(entry.qty)}</span>
              {entry.scrap ? <span className="text-signal-rose-ink">−{fmt(entry.scrap)} scrap</span> : null}
              <span className="ml-auto text-muted-foreground">{entry.shift ? entry.shift.replace("SHIFT_", "") : ""} · {new Date(entry.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {entry.by?.split("@")[0]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
