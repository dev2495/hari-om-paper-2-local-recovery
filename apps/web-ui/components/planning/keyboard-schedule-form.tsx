"use client"

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react"

import { jobCardRef } from "@/lib/job-card-display"

type DropTarget = {
  machine_id: string | null
  plan_date: string | null
  shift_code: string | null
  sequence_no: number
}

export function KeyboardScheduleForm({
  jobs,
  machines,
  dates,
  shifts,
  selectedJob,
  onSelectJob,
  onSchedule,
  busy,
}: {
  jobs: any[]
  machines: Array<{ id: string; code?: string; name?: string; status?: string }>
  dates: string[]
  shifts: Array<{ code: string; label?: string }>
  selectedJob: any | null
  onSelectJob: (job: any | null) => void
  onSchedule: (job: any, target: DropTarget) => Promise<void> | void
  busy?: boolean
}) {
  const [jobId, setJobId] = useState("")
  const [planDate, setPlanDate] = useState(dates[0] || "")
  const [machineId, setMachineId] = useState(machines[0]?.id || "")
  const [shiftCode, setShiftCode] = useState(shifts[0]?.code || "")

  useEffect(() => {
    if (selectedJob) setJobId(String(selectedJob.segment_id || selectedJob.job_card_id || ""))
  }, [selectedJob])

  useEffect(() => {
    if (!planDate && dates[0]) setPlanDate(dates[0])
  }, [dates, planDate])

  const options = useMemo(
    () =>
      jobs.map((job) => ({
        id: String(job.segment_id || job.job_card_id || ""),
        job,
        label: `${jobCardRef(job)} · ${Number(job.segment_planned_qty || job.planned_qty || 0)} pcs`,
      })),
    [jobs],
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const option = options.find((row) => row.id === jobId)
    if (!option) return
    await onSchedule(option.job, {
      machine_id: machineId || null,
      plan_date: planDate || null,
      shift_code: shiftCode || null,
      sequence_no: 1,
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") onSelectJob(null)
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      data-testid="planner-keyboard-schedule"
      className="rounded-[1.2rem] border border-slate-200 bg-white/90 p-3 shadow-sm"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Keyboard scheduling</p>
      <p className="mt-1 text-xs text-slate-600">Same move as drag-and-drop. Focus a queue card and press Enter, or pick a card here.</p>
      <div className="mt-3 grid gap-2 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-600">
          Job card
          <select
            data-testid="planner-keyboard-schedule:job"
            value={jobId}
            onChange={(event) => {
              setJobId(event.target.value)
              const option = options.find((row) => row.id === event.target.value)
              onSelectJob(option?.job || null)
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          >
            <option value="">Select a queued card</option>
            {options.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Date
          <select data-testid="planner-keyboard-schedule:date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            {dates.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Machine
          <select data-testid="planner-keyboard-schedule:machine" value={machineId} onChange={(event) => setMachineId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>{machine.code || machine.name || machine.id}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Shift
          <select data-testid="planner-keyboard-schedule:shift" value={shiftCode} onChange={(event) => setShiftCode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            {shifts.map((shift) => (
              <option key={shift.code} value={shift.code}>{shift.label || shift.code}</option>
            ))}
          </select>
        </label>
        <button type="submit" data-testid="planner-keyboard-schedule:submit" disabled={busy || !jobId} className="self-end rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Schedule
        </button>
      </div>
    </form>
  )
}
