"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Activity, Flame, Plus, Wind } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { command, entryApiForPlant, errorText } from "@/lib/season-api"
import { cn } from "@/lib/utils"

const fmt = (value: number | null | undefined) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })
const stageName = (stage: string) => (stage === "WINDER" ? "Winder" : stage === "OVEN" ? "Oven" : stage.charAt(0) + stage.slice(1).toLowerCase())

function currentShift() {
  const hour = new Date().getHours()
  return hour >= 8 && hour < 20 ? "SHIFT_A" : "SHIFT_B"
}

/**
 * Quick floor log for seasonal job cards: each Log is one batch entry on the card
 * (same rules as the stage form below — operator, shift, reject reason, batch QC gate).
 */
export function SeasonFloorLog({ card }: { card: any }) {
  const entryApi = entryApiForPlant(card.plant_id)
  const flow = useQuery({ queryKey: ["continuous-flow", card.id], queryFn: async () => (await entryApi.flow(card.id)).data, refetchInterval: 15000 })
  const employees = useQuery({ queryKey: ["continuous-employees", card.plant_id], queryFn: async () => (await entryApi.employees()).data })
  if (flow.isLoading) return <div className="skeleton h-40 rounded-xl" />
  if (flow.isError || !flow.data) return null
  const stages = (flow.data.stages || []).filter((stage: any) => stage.stage === "WINDER" || stage.stage === "OVEN")
  if (!stages.length) return null
  return (
    <section className="erp-panel rounded-xl p-4" data-testid="live-floor-log">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-[15px] font-semibold">Live floor log</h2>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[12px] font-semibold">{card.job_card_no || card.job_card_ref}</span>
        <span className="ml-auto text-[12px] text-muted-foreground">Each Log is one batch · the oven takes winder batches once their QC is OK</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {stages.map((stage: any) => (
          <SeasonStageColumn key={stage.stage} card={card} stage={stage} employees={employees.data || []} />
        ))}
      </div>
    </section>
  )
}

function SeasonStageColumn({ card, stage, employees }: { card: any; stage: any; employees: any[] }) {
  const { showToast } = useApp()
  const { user } = useAuth()
  const cache = useQueryClient()
  const entryApi = entryApiForPlant(card.plant_id)
  const roles = new Set([user?.role, ...(user?.roles || [])])
  const canSubmit = ["Owner", "Admin", "PlantManager"].some((role) => roles.has(role))
  const memory = `hariom-floor-operator:${card.plant_id}:${stage.stage}`
  const [good, setGood] = useState("")
  const [rejected, setRejected] = useState("")
  const [reason, setReason] = useState("")
  const [shift, setShift] = useState(currentShift())
  const [operator, setOperator] = useState("")
  const pending = useRef<{ key: string; body: any } | null>(null)
  useEffect(() => {
    try {
      setOperator(window.localStorage.getItem(memory) || "")
    } catch {}
  }, [memory])
  const active = employees.filter((e: any) => e.active !== false && e.is_active !== false)
  const rank = (e: any) => (String(e.role || "").toLowerCase() === "operator" ? 0 : 2) + (String(e.department || "").toUpperCase() === stage.stage ? 0 : 1)
  const operators = [...active].sort((a: any, b: any) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)))
  const recent = useQuery({
    queryKey: ["floor-entries", card.id, stage.stage],
    queryFn: async () => (await entryApi.list(card.id, stage.stage, 0, 6)).data,
    refetchInterval: 15000,
  })
  const finished = stage.status === "COMPLETED"
  const target = Number(stage.target || 0)
  const total = Number(stage.accepted_total || 0)
  const pct = target ? Math.min(100, (total / target) * 100) : 0
  const goodQty = Math.max(0, Math.floor(Number(good || 0)))
  const rejectQty = Math.max(0, Math.floor(Number(rejected || 0)))
  const segments = (stage.segments || []).filter((s: any) => !["COMPLETED", "CANCELLED"].includes(s.status))
  const today = new Date().toLocaleDateString("en-CA")
  const segment = segments.length === 1 ? segments[0] : segments.find((s: any) => s.plan_date === today) || null
  const log = useMutation({
    mutationFn: async () => {
      const content = {
        stage: stage.stage,
        kind: "PRODUCTION",
        quantity_mode: "DELTA",
        business_date: today,
        shift_code: shift,
        operator_id: operator,
        segment_id: segment?.id || null,
        produced: goodQty + rejectQty,
        accepted: goodQty,
        input_quantity: stage.stage === "WINDER" ? 0 : goodQty + rejectQty,
        samples: [],
        details: { reject_reason: reason.trim() || undefined },
        reason: reason.trim(),
        submit: canSubmit,
      }
      const key = JSON.stringify(content)
      if (!pending.current || pending.current.key !== key) pending.current = { key, body: command(content) }
      return entryApi.create(card.id, pending.current.body)
    },
    onSuccess: async () => {
      pending.current = null
      try {
        window.localStorage.setItem(memory, operator)
      } catch {}
      showToast(`${stageName(stage.stage)} +${fmt(goodQty)} ${stage.unit} ${canSubmit ? "logged" : "saved as a draft for the supervisor"}.`, "success")
      setGood("")
      setRejected("")
      setReason("")
      await Promise.all(
        [["continuous-flow", card.id], ["continuous-entries", card.id], ["floor-entries", card.id], ["planning-job-card", card.id]].map((queryKey) => cache.invalidateQueries({ queryKey })),
      )
    },
    onError: (error: any) => {
      if (error?.response) pending.current = null
      showToast(errorText(error), "error")
    },
  })
  const missing = !goodQty ? "Enter the good quantity" : !operator ? "Choose the operator" : rejectQty && !reason.trim() ? "Give the reject reason" : ""
  const Icon = stage.stage === "WINDER" ? Wind : Flame
  return (
    <div className={cn("rounded-lg border p-3", finished ? "border-signal-emerald-line bg-signal-emerald-soft/40" : "border-border bg-card")} data-testid={`floor-log-${stage.stage.toLowerCase()}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-[13.5px] font-semibold">{stageName(stage.stage)}</p>
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          <strong className="text-[15px] text-foreground">{fmt(total)}</strong> / {fmt(target)} {stage.unit}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", finished ? "bg-signal-emerald-ink" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {stage.stage === "OVEN"
          ? `Winder batches ready for the oven: ${fmt(stage.available_from_upstream)} ${stage.input_unit || "bamboo"}${stage.awaiting_qc_from_upstream > 0 ? ` · ${fmt(stage.awaiting_qc_from_upstream)} waiting for winder QC` : ""}`
          : `Rejected so far ${fmt(stage.rejected_total)} ${stage.unit}`}
      </p>
      {finished ? (
        <p className="mt-2 text-[12.5px] font-medium text-signal-emerald-ink">Stage closed.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${stage.stage} good ${stage.unit}`} placeholder={`good ${stage.unit}`} value={good} onChange={(event) => setGood(event.target.value)} className="h-10 rounded-lg border border-input bg-card px-2.5 text-[14px] tabular-nums" />
            <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${stage.stage} rejected`} placeholder="rejected" value={rejected} onChange={(event) => setRejected(event.target.value)} className="h-10 rounded-lg border border-input bg-card px-2.5 text-[14px] tabular-nums" />
          </div>
          <select aria-label={`${stage.stage} operator`} value={operator} onChange={(event) => setOperator(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]">
            <option value="">{operators.length ? "Operator who ran it" : "No active employees — add them in Masters › Employees"}</option>
            {operators.map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.employee_code ? ` · ${e.employee_code}` : ""}
              </option>
            ))}
          </select>
          {rejectQty > 0 ? (
            <input aria-label={`${stage.stage} reject reason`} placeholder="Reject reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]" />
          ) : null}
          <div className="flex gap-2">
            <div className="tube-segment flex-1" role="group" aria-label="Shift">
              {["SHIFT_A", "SHIFT_B"].map((code) => (
                <button key={code} type="button" className="flex-1 justify-center" aria-pressed={shift === code} onClick={() => setShift(code)}>
                  {code.replace("SHIFT_", "Shift ")}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => log.mutate()} disabled={log.isPending || Boolean(missing)} title={missing || undefined} className="erp-btn-primary !h-10">
              <Plus className="h-4 w-4" />
              Log
            </button>
          </div>
          {segments.length > 1 && !segment ? <p className="text-[11.5px] text-signal-amber-ink">Several scheduled slots are open; use the stage form below to pick the slot.</p> : null}
        </div>
      )}
      {recent.data?.entries?.length ? (
        <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-border pt-2">
          {recent.data.entries.map((entry: any) => (
            <li key={entry.id} className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="font-semibold">#{entry.entry_no} +{fmt(entry.accepted)}</span>
              {entry.rejected ? <span className="text-signal-rose-ink">−{fmt(entry.rejected)} rejected</span> : null}
              {entry.status === "SUBMITTED" ? (
                <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", entry.qc_cleared ? "bg-signal-emerald-soft text-signal-emerald-ink" : entry.evaluation?.verdict === "FAIL" ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-amber-soft text-signal-amber-ink")}>
                  {entry.qc_cleared ? "QC ok" : entry.evaluation?.verdict === "FAIL" ? "QC fail" : "QC pending"}
                </span>
              ) : null}
              <span className="ml-auto text-muted-foreground">
                {entry.status === "DRAFT" ? "draft · " : ""}
                {entry.shift_code ? entry.shift_code.replace("SHIFT_", "") : ""} · {entry.operator_name || "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
