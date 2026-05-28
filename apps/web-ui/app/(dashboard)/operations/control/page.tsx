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
import { useMemo, useState } from "react"
import { AlertTriangle, PauseCircle } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { RoleGate } from "@/components/workspace/role-gate"
import {
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
  useLogDowntime,
  useShortCloseJobCard,
  useShortCloses,
} from "@/hooks/use-production"

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
  const shortCloseJob = useShortCloseJobCard()
  const logDowntime = useLogDowntime()

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
          notes: scNotes || undefined,
        },
      })
      showToast(`Short-closed: ${scDecision.replace("_", " ").toLowerCase()}`, "success")
      setScOpen(false)
      setScJobCardId(""); setScProduced(""); setScReason(""); setScDecision("CARRY_FORWARD"); setScNotes("")
    } catch (err: any) {
      setScError(err?.response?.data?.detail || err?.message || "Failed to short-close.")
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
      setDtError(err?.response?.data?.detail || err?.message || "Failed to log downtime.")
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
                </tr>
              </thead>
              <tbody>
                {(downtimeRows as any[]).slice(0, 20).map((d) => (
                  <tr key={d.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs">{d.machine_code || String(d.machine_id || "").slice(0, 8)}</td>
                    <td className="py-2 pr-3 text-xs">{d.started_at ? new Date(d.started_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="py-2 pr-3 text-xs">{d.ended_at ? new Date(d.ended_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : <Pill tone="warn">ONGOING</Pill>}</td>
                    <td className="py-2 pr-3 text-right font-bold">{d.duration_minutes ? `${Math.round(Number(d.duration_minutes))} m` : "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{d.reason_code}</td>
                    <td className="py-2 pr-3"><Pill tone={d.is_planned ? "ok" : "warn"}>{d.is_planned ? "PLANNED" : "UNPLANNED"}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <NoteCallout tone="ok">No downtime logged. All machines have been running.</NoteCallout>
          )}
        </Panel>
      </div>

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
              <span className="text-[11px] text-amber-700">No SHORT_CLOSE reason codes seeded yet. <Link href="/master/reason-codes" className="underline">Seed them →</Link></span>
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
              <span className="text-[11px] text-amber-700">No DOWNTIME reason codes seeded yet. <Link href="/master/reason-codes" className="underline">Seed them →</Link></span>
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
