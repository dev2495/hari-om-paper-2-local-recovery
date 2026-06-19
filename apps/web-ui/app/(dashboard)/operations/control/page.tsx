"use client"

/**
 * Operations control room — the place to log a short-close, a downtime event,
 * or browse the most recent of both. Lives at /operations/control so it's
 * separate from the planner board (which is huge) and the operations report
 * (which is read-only).
 *
 * Role-gated to PlantManager / Planner / Owner / Admin.
 */

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  PauseCircle,
  Wrench,
  XCircle,
} from "lucide-react"

import { useApp } from "@/context/AppContext"
import { RoleGate } from "@/components/workspace/role-gate"
import {
  DrillLink,
  FilterField,
  KpiRail,
  NoteCallout,
  Panel,
  Pill,
  ReportFilterBar,
  ReportHero,
  formatNumber,
} from "@/components/reports/primitives"
import {
  LabeledInput,
  LabeledTextarea,
  Modal,
} from "@/components/master/master-cockpit"
import { useAuth } from "@/context/AuthContext"
import { useMachines, usePlanningJobCards } from "@/hooks/use-production"
import { useReasonCodes } from "@/hooks/use-master-data"
import {
  useDowntime,
  useHolds,
  useLogDowntime,
  useRescheduleQueue,
  useResolveHold,
  useShortCloseJobCard,
  useShortCloses,
  useUpdateDowntime,
  useUpdateRescheduleStatus,
} from "@/hooks/use-production"

// The 7 short-close scopes — whole card (JOB_CARD) plus the individual stages.
const SHORT_CLOSE_STAGES = ["JOB_CARD", "WINDER", "OVEN", "PROCESS", "SLITTING", "PACKING", "QC"] as const

// Small relative-age helper (no shared util exists). Returns e.g. "3 h", "2 d".
function relativeAge(iso?: string): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 60) return `${mins} m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

export default function OperationsControlWrapper() {
  return (
    <RoleGate allow={["PlantManager", "Planner", "Owner", "Admin"]}>
      <OperationsControlPage />
    </RoleGate>
  )
}

function OperationsControlPage() {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const activePlantKey = String(activePlant || "").trim().toUpperCase()
  const concretePlantSelected = Boolean(
    activePlantKey &&
      activePlantKey !== "ALL" &&
      activePlantKey !== "00000000-0000-0000-0000-000000000000",
  )
  const today = new Date().toISOString().split("T")[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: shortCloses } = useShortCloses({ start_date: startDate, end_date: today })
  const { data: downtimeRows } = useDowntime({ start_date: startDate, end_date: today })
  const { data: holds } = useHolds()
  const { data: rescheduleQueue } = useRescheduleQueue()
  const shortCloseJob = useShortCloseJobCard()
  const logDowntime = useLogDowntime()
  const updateDowntime = useUpdateDowntime()
  const resolveHold = useResolveHold()
  const updateRescheduleStatus = useUpdateRescheduleStatus()

  // Reschedule panel anchor — the downtime table's "Reschedule" action scrolls
  // here and briefly highlights it so the planner sees the affected job cards.
  const reschedulePanelRef = useRef<HTMLDivElement | null>(null)
  const [reschedulePanelHighlight, setReschedulePanelHighlight] = useState(false)
  const focusReschedulePanel = () => {
    reschedulePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    setReschedulePanelHighlight(true)
    window.setTimeout(() => setReschedulePanelHighlight(false), 2200)
  }

  const handleEndDowntime = async (row: any) => {
    try {
      await updateDowntime.mutateAsync({
        id: row.id,
        plantId: activePlant || undefined,
        data: { ended_at: new Date().toISOString() },
      })
      showToast("Downtime ended", "success")
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.detail ??
        err?.message ??
        "Failed to end downtime."
      showToast(typeof msg === "string" ? msg : "Failed to end downtime.", "error")
    }
  }

  // Masters: reasons + machines + open job cards
  const { data: scReasons } = useReasonCodes("SHORT_CLOSE")
  const { data: dtReasons } = useReasonCodes("DOWNTIME")
  const { data: machinesRaw } = useMachines()
  const machines: any[] = Array.isArray(machinesRaw) ? machinesRaw : []
  const { data: jobCardsRaw } = usePlanningJobCards()
  const openJobCards: any[] = useMemo(() => {
    const all = Array.isArray((jobCardsRaw as any)?.items) ? (jobCardsRaw as any).items : Array.isArray(jobCardsRaw) ? jobCardsRaw : []
    return all.filter((j: any) => String(j.status || "").toUpperCase() !== "COMPLETED" && String(j.status || "").toUpperCase() !== "CANCELLED")
  }, [jobCardsRaw])

  // Short-close modal
  const [scOpen, setScOpen] = useState(false)
  const [scJobCardId, setScJobCardId] = useState("")
  const [scStageType, setScStageType] = useState<string>("JOB_CARD")
  const [scProduced, setScProduced] = useState("")
  const [scReason, setScReason] = useState("")
  const [scDecision, setScDecision] = useState<"CARRY_FORWARD" | "SHORT_CLOSE_SO" | "HOLD">("CARRY_FORWARD")
  const [scNotes, setScNotes] = useState("")
  const [scError, setScError] = useState<string | null>(null)
  const selectedJC = openJobCards.find((j: any) => j.id === scJobCardId)
  const plannedQty = Number(selectedJC?.planned_qty || 0)
  const gapPreview = plannedQty - Number(scProduced || 0)

  const submitShortClose = async () => {
    setScError(null)
    if (!scJobCardId) { setScError("Pick a job card."); return }
    if (!concretePlantSelected) { setScError("Select one concrete plant before writing a short-close."); return }
    if (!scReason) { setScError("Pick a reason code."); return }
    if (!scProduced || Number.isNaN(Number(scProduced))) { setScError("Enter produced qty."); return }
    if (gapPreview <= 0) { setScError("Produced qty must be less than planned."); return }
    try {
      await shortCloseJob.mutateAsync({
        jobCardId: scJobCardId,
        plantId: activePlant || undefined,
        data: {
          produced_qty: Number(scProduced),
          reason_code: scReason,
          decision: scDecision,
          stage_type: scStageType,
          notes: scNotes || undefined,
        },
      })
      showToast(`Short-closed: ${scDecision.replace("_", " ").toLowerCase()}`, "success")
      setScOpen(false)
      setScJobCardId(""); setScStageType("JOB_CARD"); setScProduced(""); setScReason(""); setScDecision("CARRY_FORWARD"); setScNotes("")
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.detail ??
        err?.message ??
        "Failed to short-close."
      setScError(typeof msg === "string" ? msg : "Failed to short-close.")
    }
  }

  // Downtime modal
  const [dtOpen, setDtOpen] = useState(false)
  const [dtMachineId, setDtMachineId] = useState("")
  const [dtStartedAt, setDtStartedAt] = useState(new Date().toISOString().slice(0, 16))
  const [dtEndedAt, setDtEndedAt] = useState("")
  const [dtReason, setDtReason] = useState("")
  const [dtIsPlanned, setDtIsPlanned] = useState(false)
  const [dtNotes, setDtNotes] = useState("")
  const [dtError, setDtError] = useState<string | null>(null)
  const selectedMachine = machines.find((m: any) => m.id === dtMachineId)

  const submitDowntime = async () => {
    setDtError(null)
    if (!dtMachineId) { setDtError("Pick a machine."); return }
    if (!concretePlantSelected) { setDtError("Select one concrete plant before logging downtime."); return }
    if (!dtStartedAt) { setDtError("Start time required."); return }
    if (!dtReason) { setDtError("Pick a reason code."); return }
    try {
      await logDowntime.mutateAsync({
        plantId: activePlant || undefined,
        data: {
          machine_id: dtMachineId,
          machine_code: selectedMachine?.code,
          started_at: new Date(dtStartedAt).toISOString(),
          ended_at: dtEndedAt ? new Date(dtEndedAt).toISOString() : undefined,
          reason_code: dtReason,
          is_planned: dtIsPlanned,
          notes: dtNotes || undefined,
        },
      })
      showToast("Downtime logged", "success")
      setDtOpen(false)
      setDtMachineId(""); setDtEndedAt(""); setDtReason(""); setDtIsPlanned(false); setDtNotes("")
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.detail ??
        err?.message ??
        "Failed to log downtime."
      setDtError(typeof msg === "string" ? msg : "Failed to log downtime.")
    }
  }

  // HOLD tracking (P3.2) — inline resolve form, one open at a time.
  const openHolds: any[] = Array.isArray(holds) ? holds : []
  const [resolveForId, setResolveForId] = useState<string | null>(null)
  const [resolveDecision, setResolveDecision] = useState<"CARRY_FORWARD" | "SHORT_CLOSE_SO">("CARRY_FORWARD")
  const [resolveNote, setResolveNote] = useState("")
  const [resolveError, setResolveError] = useState<string | null>(null)

  const openResolveForm = (holdId: string) => {
    setResolveForId(holdId)
    setResolveDecision("CARRY_FORWARD")
    setResolveNote("")
    setResolveError(null)
  }

  const submitResolveHold = async (shortCloseId: string) => {
    setResolveError(null)
    try {
      await resolveHold.mutateAsync({
        shortCloseId,
        plantId: activePlant || undefined,
        data: { decision: resolveDecision, notes: resolveNote || undefined },
      })
      showToast(`Hold resolved: ${resolveDecision.replace("_", " ").toLowerCase()}`, "success")
      setResolveForId(null)
      setResolveNote("")
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.detail ??
        err?.message ??
        "Failed to resolve hold."
      setResolveError(typeof msg === "string" ? msg : "Failed to resolve hold.")
    }
  }

  // Reschedule queue (P2.14) — downtime that knocked out one or more job cards.
  const rescheduleRows: any[] = Array.isArray(rescheduleQueue) ? rescheduleQueue : []

  const handleRescheduleStatus = async (row: any, status: "DONE" | "DISMISSED") => {
    try {
      await updateRescheduleStatus.mutateAsync({
        id: row.id,
        plantId: activePlant || undefined,
        data: { status },
      })
      showToast(status === "DONE" ? "Marked rescheduled" : "Reschedule dismissed", "success")
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.detail ??
        err?.message ??
        "Failed to update reschedule status."
      showToast(typeof msg === "string" ? msg : "Failed to update reschedule status.", "error")
    }
  }

  const kpis = useMemo(() => {
    const sc: any[] = Array.isArray(shortCloses) ? shortCloses : []
    const dt: any[] = Array.isArray(downtimeRows) ? downtimeRows : []
    const carryForward = sc.filter((s) => s.decision === "CARRY_FORWARD").length
    const totalDowntimeMin = dt.reduce((sum, d) => sum + Number(d.duration_minutes || 0), 0)
    const unplannedDowntimeMin = dt.filter((d) => !d.is_planned).reduce((sum, d) => sum + Number(d.duration_minutes || 0), 0)
    const totalGap = sc.reduce((sum, s) => sum + Number(s.gap_qty || 0), 0)
    return { scCount: sc.length, carryForward, totalGap, dtCount: dt.length, totalDowntimeMin, unplannedDowntimeMin }
  }, [shortCloses, downtimeRows])

  return (
    <div className="space-y-5 px-6 pb-10 pt-2" data-testid="operations-control-page">
      <ReportHero
        eyebrow="Operations control"
        title="Short-close job cards · log downtime · keep the audit trail honest"
        description="Every short-close needs a reason code and a decision (carry-forward / short-close SO / hold). Every downtime event needs a reason code. The reports surface them — this is where they're recorded."
        accent="cyan"
        chips={[
          { label: `${kpis.scCount} short-closes (30d)`, tone: kpis.scCount ? "warn" : "ok" },
          { label: `${kpis.dtCount} downtime events`, tone: kpis.dtCount ? "warn" : "ok" },
          { label: `${formatNumber(kpis.totalGap)} tubes shorted`, tone: kpis.totalGap > 1000 ? "critical" : "neutral" },
          { label: `${Math.round(kpis.unplannedDowntimeMin / 60)} h unplanned downtime`, tone: kpis.unplannedDowntimeMin > 120 ? "critical" : "neutral" },
        ]}
      />

      <ReportFilterBar>
        <FilterField label="Window">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold">Last 30 days</span>
        </FilterField>
        <FilterField label="Plant">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold">{activePlant || "ALL"}</span>
        </FilterField>
        <span className="ml-auto" />
        <button onClick={() => setScOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          Short-close job card
        </button>
        <button onClick={() => setDtOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-800">
          <PauseCircle className="h-3.5 w-3.5" />
          Log downtime
        </button>
      </ReportFilterBar>

      {!concretePlantSelected ? (
        <NoteCallout tone="warn">Select Plant A or Plant B before posting a short-close or downtime entry. All-visible scope is read-only on this screen.</NoteCallout>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <DrillLink href="/planning/board">View planner board</DrillLink>
      </div>

      <KpiRail
        items={[
          { label: "Short-closes (30d)", value: String(kpis.scCount), tone: "amber", detail: `${kpis.carryForward} carried forward` },
          { label: "Tubes shorted", value: formatNumber(kpis.totalGap), tone: "rose" },
          { label: "Downtime events", value: String(kpis.dtCount), tone: "violet" },
          { label: "Unplanned downtime", value: `${Math.round(kpis.unplannedDowntimeMin / 60)} h`, tone: kpis.unplannedDowntimeMin > 120 ? "rose" : "emerald" },
          { label: "Planned downtime", value: `${Math.round((kpis.totalDowntimeMin - kpis.unplannedDowntimeMin) / 60)} h`, tone: "slate" },
          { label: "Open job cards", value: String(openJobCards.length), tone: "cyan" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Recent short-closes" title="Job cards short-closed in last 30 days" description="Each row links to the job card detail.">
          {Array.isArray(shortCloses) && shortCloses.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Job card</th>
                  <th className="py-2 pr-3">Scope</th>
                  <th className="py-2 pr-3 text-right">Planned</th>
                  <th className="py-2 pr-3 text-right">Produced</th>
                  <th className="py-2 pr-3 text-right">Gap</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Decision</th>
                  <th className="py-2 pr-3">Carry-forward</th>
                </tr>
              </thead>
              <tbody>
                {(shortCloses as any[]).slice(0, 20).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs"><Link className="hover:underline" href={`/production/job-cards/${s.job_card_id}`}>{String(s.job_card_id || "").slice(0, 8)}</Link></td>
                    <td className="py-2 pr-3"><Pill tone={(s.stage_type && s.stage_type !== "JOB_CARD") ? "info" : "neutral"}>{(s.stage_type && s.stage_type !== "JOB_CARD") ? s.stage_type : "Whole card"}</Pill></td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(s.planned_qty || 0))}</td>
                    <td className="py-2 pr-3 text-right">{formatNumber(Number(s.produced_qty || 0))}</td>
                    <td className="py-2 pr-3 text-right font-bold text-rose-700">{formatNumber(Number(s.gap_qty || 0))}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.reason_code}</td>
                    <td className="py-2 pr-3"><Pill tone={s.decision === "CARRY_FORWARD" ? "ok" : s.decision === "SHORT_CLOSE_SO" ? "warn" : "neutral"}>{(s.decision || "").replace("_", " ")}</Pill></td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.carry_forward_job_card_id ? <Link className="text-emerald-700 hover:underline" href={`/production/job-cards/${s.carry_forward_job_card_id}`}>{String(s.carry_forward_job_card_id).slice(0, 8)}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <NoteCallout tone="ok">No short-closes recorded. Production is meeting planned quantities.</NoteCallout>
          )}
        </Panel>

        <Panel eyebrow="Recent downtime" title="Machine downtime in last 30 days" description="Planned vs unplanned events with reason codes.">
          {Array.isArray(downtimeRows) && downtimeRows.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Machine</th>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Ended</th>
                  <th className="py-2 pr-3 text-right">Duration</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(downtimeRows as any[]).slice(0, 20).map((d) => {
                  const isOngoing = !d.ended_at
                  const affected: string[] = Array.isArray(d.affected_job_card_ids) ? d.affected_job_card_ids : []
                  const hasAffected = affected.length > 0
                  return (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-mono text-xs">{d.machine_code || String(d.machine_id || "").slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-xs">{d.started_at ? new Date(d.started_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="py-2 pr-3 text-xs">{d.ended_at ? new Date(d.ended_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : <Pill tone="warn">ONGOING</Pill>}</td>
                      <td className="py-2 pr-3 text-right font-bold">{d.duration_minutes ? `${Math.round(Number(d.duration_minutes))} m` : "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{d.reason_code}</td>
                      <td className="py-2 pr-3"><Pill tone={d.is_planned ? "ok" : "warn"}>{d.is_planned ? "PLANNED" : "UNPLANNED"}</Pill></td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {isOngoing ? (
                            <button
                              type="button"
                              onClick={() => handleEndDowntime(d)}
                              disabled={updateDowntime.isPending}
                              className="inline-flex items-center rounded-full border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {updateDowntime.isPending ? "Ending…" : "End now"}
                            </button>
                          ) : null}
                          {hasAffected ? (
                            <button
                              type="button"
                              onClick={focusReschedulePanel}
                              title={`${affected.length} job card${affected.length === 1 ? "" : "s"} need rescheduling`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                            >
                              <CalendarClock className="h-3 w-3" />
                              Reschedule ({affected.length})
                            </button>
                          ) : null}
                          {!isOngoing && !hasAffected ? <span className="text-[11px] text-slate-400">—</span> : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <NoteCallout tone="ok">No downtime logged. All machines have been running.</NoteCallout>
          )}
        </Panel>
      </div>

      {/* HOLD follow-up tracking (P3.2) — short-closes parked on HOLD stay here until resolved. */}
      <Panel
        eyebrow="Open holds"
        title="Short-closes awaiting a final decision"
        description="A HOLD short-close stays open until someone commits to carry-forward or short-closing the SO line."
        actions={<Pill tone={openHolds.length > 0 ? "warn" : "ok"}>{openHolds.length} open</Pill>}
      >
        {openHolds.length > 0 ? (
          <div className="space-y-2">
            {openHolds.map((h: any) => {
              const isResolving = resolveForId === h.id
              return (
                <div key={h.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-mono text-xs">
                        <Link className="font-semibold hover:underline" href={`/production/job-cards/${h.job_card_id}`}>{String(h.job_card_id || "").slice(0, 8)}</Link>
                      </span>
                      <Pill tone={(h.stage_type && h.stage_type !== "JOB_CARD") ? "info" : "neutral"}>{(h.stage_type && h.stage_type !== "JOB_CARD") ? h.stage_type : "Whole card"}</Pill>
                      <span className="text-slate-600">Gap <strong className="text-rose-700">{formatNumber(Number(h.gap_qty || 0))}</strong></span>
                      <span className="font-mono text-xs text-slate-500">{h.reason_code}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" />{relativeAge(h.created_at)} old</span>
                    </div>
                    {!isResolving ? (
                      <button
                        type="button"
                        onClick={() => openResolveForm(h.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-900"
                      >
                        Resolve
                      </button>
                    ) : null}
                  </div>
                  {h.notes ? <p className="mt-1 text-xs text-slate-500">{h.notes}</p> : null}
                  {isResolving ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setResolveDecision("CARRY_FORWARD")}
                          className={`rounded-md border px-3 py-2 text-xs font-semibold ${resolveDecision === "CARRY_FORWARD" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}
                        >
                          Carry forward<br /><span className="text-[10px] font-normal">Spawn top-up JC for the gap</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setResolveDecision("SHORT_CLOSE_SO")}
                          className={`rounded-md border px-3 py-2 text-xs font-semibold ${resolveDecision === "SHORT_CLOSE_SO" ? "border-amber-700 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`}
                        >
                          Short-close SO line<br /><span className="text-[10px] font-normal">Customer agreed to short ship</span>
                        </button>
                      </div>
                      <textarea
                        value={resolveNote}
                        onChange={(e) => setResolveNote(e.target.value)}
                        rows={2}
                        placeholder="Optional note — who decided and why"
                        className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      {resolveError ? <p className="mt-1 text-xs text-rose-700 font-medium">{resolveError}</p> : null}
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setResolveForId(null); setResolveError(null) }}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => submitResolveHold(h.id)}
                          disabled={resolveHold.isPending}
                          className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                        >
                          {resolveHold.isPending ? "Resolving…" : "Confirm decision"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <NoteCallout tone="ok">No open holds. Every short-close has a committed decision.</NoteCallout>
        )}
      </Panel>

      {/* Downtime reschedule nudge (P2.14) — job cards knocked out by a machine going down. */}
      <Panel
        eyebrow="Reschedule queue"
        title="Job cards affected by downtime — reschedule on the board"
        description="When a machine goes down, the job cards on it land here so the planner can move them. Drill into the board, then mark them rescheduled."
        className={reschedulePanelHighlight ? "ring-2 ring-amber-400 ring-offset-2 transition" : "transition"}
        actions={<Pill tone={rescheduleRows.length > 0 ? "warn" : "ok"}>{rescheduleRows.length} pending</Pill>}
      >
        <div ref={reschedulePanelRef} className="scroll-mt-24">
          {rescheduleRows.length > 0 ? (
            <div className="space-y-2">
              {rescheduleRows.map((d: any) => {
                const affected: string[] = Array.isArray(d.affected_job_card_ids) ? d.affected_job_card_ids : []
                return (
                  <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold"><Wrench className="h-3 w-3 text-slate-400" />{d.machine_code || String(d.machine_id || "").slice(0, 8)}</span>
                          <Pill tone={d.is_planned ? "ok" : "warn"}>{d.is_planned ? "PLANNED" : "UNPLANNED"}</Pill>
                          <span className="font-mono text-xs text-slate-500">{d.reason_code}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {d.started_at ? new Date(d.started_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                          {" → "}
                          {d.ended_at ? new Date(d.ended_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : <Pill tone="warn">ONGOING</Pill>}
                          {d.duration_minutes ? <span className="ml-2 font-semibold text-slate-600">{Math.round(Number(d.duration_minutes))} m</span> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Affected:</span>
                          {affected.map((jc) => (
                            <DrillLink key={jc} href={`/planning/board?job_card_id=${jc}`}>{String(jc).slice(0, 8)}</DrillLink>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRescheduleStatus(d, "DONE")}
                          disabled={updateRescheduleStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Mark rescheduled
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRescheduleStatus(d, "DISMISSED")}
                          disabled={updateRescheduleStatus.isPending}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <XCircle className="h-3 w-3" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <NoteCallout tone="ok">No job cards waiting to be rescheduled. Downtime has not displaced production.</NoteCallout>
          )}
        </div>
      </Panel>

      {/* Short-close modal */}
      <Modal
        open={scOpen}
        onClose={() => setScOpen(false)}
        eyebrow="Short close"
        title="Short-close job card"
        size="lg"
        footer={
          <>
            <button onClick={() => setScOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
            <button onClick={submitShortClose} disabled={shortCloseJob.isPending || !concretePlantSelected} className="rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-amber-800 disabled:opacity-50">
              {shortCloseJob.isPending ? "Closing…" : `Close with gap ${gapPreview > 0 ? formatNumber(gapPreview) : ""}`}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Job card *</span>
            <select value={scJobCardId} onChange={(e) => setScJobCardId(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose an open job card…</option>
              {openJobCards.map((j: any) => (
                <option key={j.id} value={j.id}>
                  {j.job_card_no || String(j.id).slice(0, 8)} · {j.product_code || "—"} · planned {formatNumber(Number(j.planned_qty || 0))}
                </option>
              ))}
            </select>
          </label>
          {selectedJC ? (
            <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <strong>{selectedJC.product_code || "—"}</strong> · planned <strong>{formatNumber(plannedQty)}</strong> · status <Pill tone="info">{selectedJC.status}</Pill>
            </div>
          ) : null}
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Short-close scope: whole card or a specific stage *</span>
            <select value={scStageType} onChange={(e) => setScStageType(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {SHORT_CLOSE_STAGES.map((s) => (
                <option key={s} value={s}>{s === "JOB_CARD" ? "Whole job card" : s} {s === "JOB_CARD" ? "(default)" : ""}</option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">Pick a stage (Winder / Oven / Process …) to short-close just that step, or leave it on the whole card.</span>
          </label>
          <LabeledInput label="Produced qty" required value={scProduced} onChange={setScProduced} type="number" placeholder="e.g. 50000" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Gap (auto)</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-rose-700">{gapPreview > 0 ? formatNumber(gapPreview) : "—"}</span>
          </label>
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reason code *</span>
            <select value={scReason} onChange={(e) => setScReason(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {(Array.isArray(scReasons) ? scReasons : []).filter((r: any) => r.is_active !== false).map((r: any) => (
                <option key={r.id} value={r.code}>{r.code} · {r.label}</option>
              ))}
            </select>
            {(!Array.isArray(scReasons) || scReasons.length === 0) ? (
              <span className="text-[11px] text-amber-700">No SHORT_CLOSE reason codes seeded yet. <Link href="/masters/reason-codes" className="underline">Seed them →</Link></span>
            ) : null}
          </label>
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Decision *</span>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setScDecision("CARRY_FORWARD")} className={`rounded-md border px-3 py-2 text-xs font-semibold ${scDecision === "CARRY_FORWARD" ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}>
                Carry forward<br /><span className="text-[10px] font-normal">Spawn top-up JC for the gap</span>
              </button>
              <button type="button" onClick={() => setScDecision("SHORT_CLOSE_SO")} className={`rounded-md border px-3 py-2 text-xs font-semibold ${scDecision === "SHORT_CLOSE_SO" ? "border-amber-700 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`}>
                Short-close SO line<br /><span className="text-[10px] font-normal">Customer agreed to short ship</span>
              </button>
              <button type="button" onClick={() => setScDecision("HOLD")} className={`rounded-md border px-3 py-2 text-xs font-semibold ${scDecision === "HOLD" ? "border-slate-700 bg-slate-100 text-slate-900" : "border-slate-200 bg-white text-slate-700"}`}>
                Hold<br /><span className="text-[10px] font-normal">Decide later</span>
              </button>
            </div>
          </label>
          <div className="sm:col-span-2">
            <LabeledTextarea label="Notes" value={scNotes} onChange={setScNotes} rows={2} placeholder="What happened, who's accountable, what's next" />
          </div>
        </div>
        {scError ? <p className="mt-2 text-xs text-rose-700 font-medium">{scError}</p> : null}
      </Modal>

      {/* Downtime modal */}
      <Modal
        open={dtOpen}
        onClose={() => setDtOpen(false)}
        eyebrow="Downtime"
        title="Log downtime event"
        size="lg"
        footer={
          <>
            <button onClick={() => setDtOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
            <button onClick={submitDowntime} disabled={logDowntime.isPending || !concretePlantSelected} className="rounded-full bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-800 disabled:opacity-50">
              {logDowntime.isPending ? "Logging…" : "Log downtime"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Machine *</span>
            <select value={dtMachineId} onChange={(e) => setDtMachineId(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {machines.filter((m: any) => m.active !== false).map((m: any) => (
                <option key={m.id} value={m.id}>{m.code || m.name} · {m.department || "—"}</option>
              ))}
            </select>
          </label>
          <LabeledInput label="Started at" required type="datetime-local" value={dtStartedAt} onChange={setDtStartedAt} />
          <LabeledInput label="Ended at (blank = still down)" type="datetime-local" value={dtEndedAt} onChange={setDtEndedAt} />
          <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reason code *</span>
            <select value={dtReason} onChange={(e) => setDtReason(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {(Array.isArray(dtReasons) ? dtReasons : []).filter((r: any) => r.is_active !== false).map((r: any) => (
                <option key={r.id} value={r.code}>{r.code} · {r.label}</option>
              ))}
            </select>
            {(!Array.isArray(dtReasons) || dtReasons.length === 0) ? (
              <span className="text-[11px] text-amber-700">No DOWNTIME reason codes seeded yet. <Link href="/masters/reason-codes" className="underline">Seed them →</Link></span>
            ) : null}
          </label>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dtIsPlanned} onChange={(e) => setDtIsPlanned(e.target.checked)} />
            <span>This was <strong>planned</strong> (scheduled maintenance) — uncheck for unplanned breakdowns</span>
          </label>
          <div className="sm:col-span-2">
            <LabeledTextarea label="Notes" value={dtNotes} onChange={setDtNotes} rows={2} />
          </div>
        </div>
        {dtError ? <p className="mt-2 text-xs text-rose-700 font-medium">{dtError}</p> : null}
      </Modal>
    </div>
  )
}
