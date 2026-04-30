"use client"

import dayjs from "dayjs"
import { Printer } from "lucide-react"
import { useMemo } from "react"
import { useSearchParams } from "next/navigation"

import { EmptyState } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { usePlanningBoard } from "@/hooks/use-production"
import { jobCardRef } from "@/lib/job-card-display"
import { displayPlantScope } from "@/lib/plant-scope"

const SECTION_STAGE_MAP: Record<string, string> = {
  winder: "WINDER",
  oven: "OVEN",
  process: "PROCESS",
  slitting: "SLITTING",
}

function formatDate(value?: string | null, template = "DD MMM YYYY") {
  if (!value) return "-"
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format(template) : String(value)
}

function formatWhole(value?: number | string | null) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(0) : "0"
}

function formatOne(value?: number | string | null) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "0.0"
}

function plannerSize(job: any) {
  return job?.product_size_label && job.product_size_label !== "-"
    ? job.product_size_label
    : job?.spec_reference || job?.product_code || "Spec pending"
}

export default function PlanningPrintPage() {
  const searchParams = useSearchParams()
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const section = String(searchParams?.get("section") || "winder").toLowerCase()
  const stage = SECTION_STAGE_MAP[section] || "WINDER"
  const startDate = searchParams?.get("plan_date") || dayjs().format("YYYY-MM-DD")
  const scopedPlantId = activePlant === "ALL" ? undefined : activePlant || undefined
  const canQuery = !authLoading && Boolean(user) && activePlant !== "ALL"

  const days = [0, 1, 2].map((offset) => dayjs(startDate).add(offset, "day").format("YYYY-MM-DD"))
  const board0 = usePlanningBoard(stage, days[0], true, scopedPlantId, canQuery)
  const board1 = usePlanningBoard(stage, days[1], true, scopedPlantId, canQuery)
  const board2 = usePlanningBoard(stage, days[2], true, scopedPlantId, canQuery)

  const stageViews = useMemo(
    () =>
      [board0.data, board1.data, board2.data].map((response: any, index) => ({
        date: days[index],
        view: Array.isArray(response?.stages)
          ? response.stages.find((row: any) => String(row.stage || "").toUpperCase() === stage)
          : null,
      })),
    [board0.data, board1.data, board2.data, days, stage],
  )

  const scheduledRows = useMemo(
    () =>
      stageViews.flatMap((entry) =>
        (entry.view?.lanes || [])
          .filter((lane: any) => lane.machine_id || lane.shift_code)
          .flatMap((lane: any) =>
            (lane.jobs || []).map((job: any) => ({
              ...job,
              plan_date: entry.date,
              machine: lane.machine_code || lane.machine_name || "-",
              shift: lane.shift_label || lane.shift_code || "-",
              load: lane.current_load,
              capacity: lane.capacity_value,
              unit: lane.capacity_unit || "",
            })),
          ),
      ),
    [stageViews],
  )

  if (activePlant === "ALL") {
    return <EmptyState label="Select one plant before printing the planner sheet." />
  }

  return (
    <div className="mx-auto max-w-[1180px] bg-white p-6 text-slate-950 print:max-w-none print:p-0">
      <div className="no-print mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Printer className="h-4 w-4" />
          Print planner sheet
        </button>
      </div>

      <section className="border-2 border-slate-950 p-4">
        <div className="flex items-start justify-between gap-4 border-b-2 border-slate-950 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em]">Shop Floor Planning Sheet</p>
            <h1 className="mt-1 text-2xl font-black">{stage} plan</h1>
            <p className="mt-1 text-sm">
              Window {formatDate(days[0])} to {formatDate(days[2])} · Plant {displayPlantScope(activePlant, "-")}
            </p>
          </div>
          <div className="text-right text-xs">
            <p>Printed {dayjs().format("DD MMM YYYY HH:mm")}</p>
            <p>Use this sheet with supervisor output entry.</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
          <div className="border border-slate-400 p-2">
            <p className="font-bold uppercase">Scheduled Slots</p>
            <p className="mt-1 text-xl font-black">{scheduledRows.length}</p>
          </div>
          <div className="border border-slate-400 p-2">
            <p className="font-bold uppercase">Scheduled Tubes</p>
            <p className="mt-1 text-xl font-black">
              {formatWhole(scheduledRows.reduce((sum: number, job: any) => sum + Number(job.segment_planned_qty || 0), 0))}
            </p>
          </div>
          <div className="border border-slate-400 p-2">
            <p className="font-bold uppercase">Scheduled Bamboo</p>
            <p className="mt-1 text-xl font-black">
              {formatWhole(scheduledRows.reduce((sum: number, job: any) => sum + Number(job.target_bamboo_count || 0), 0))}
            </p>
          </div>
          <div className="border border-slate-400 p-2">
            <p className="font-bold uppercase">Scheduled Weight</p>
            <p className="mt-1 text-xl font-black">
              {formatOne(scheduledRows.reduce((sum: number, job: any) => sum + Number(job.planned_weight_kg || 0), 0))} kg
            </p>
          </div>
        </div>

        <h2 className="mt-5 text-sm font-black uppercase tracking-[0.14em]">Scheduled Machine Slots</h2>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              {["Date", "Machine", "Shift", "Job", "Customer", "Size", "Tubes", "Bamboo", "Weight", "Remarks"].map((header) => (
                <th key={header} className="border border-slate-500 px-2 py-1.5 text-left font-black">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scheduledRows.length === 0 ? (
              <tr>
                <td className="border border-slate-500 px-2 py-3 text-center" colSpan={10}>No scheduled jobs in this window.</td>
              </tr>
            ) : (
              scheduledRows.map((job: any) => (
                <tr key={`${job.segment_id}-${job.plan_date}-${job.machine}-${job.shift}`}>
                  <td className="border border-slate-500 px-2 py-1.5">{formatDate(job.plan_date, "DD MMM")}</td>
                  <td className="border border-slate-500 px-2 py-1.5">{job.machine}</td>
                  <td className="border border-slate-500 px-2 py-1.5">{job.shift}</td>
                  <td className="border border-slate-500 px-2 py-1.5 font-bold">{jobCardRef(job)}</td>
                  <td className="border border-slate-500 px-2 py-1.5">{job.customer_name || "-"}</td>
                  <td className="border border-slate-500 px-2 py-1.5">{plannerSize(job)}</td>
                  <td className="border border-slate-500 px-2 py-1.5 text-right">{formatWhole(job.segment_planned_qty)}</td>
                  <td className="border border-slate-500 px-2 py-1.5 text-right">{formatWhole(job.target_bamboo_count)}</td>
                  <td className="border border-slate-500 px-2 py-1.5 text-right">{formatOne(job.planned_weight_kg)} kg</td>
                  <td className="border border-slate-500 px-2 py-1.5">Output pending until supervisor entry closes this step.</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="mt-4 border border-slate-400 bg-slate-50 px-3 py-2 text-xs font-semibold">
          Queue cards are intentionally excluded from shop-floor print. Only scheduled machine/shift slots are printable for floor execution.
        </p>
      </section>

      <style jsx global>{`
        @media print {
          .no-print,
          aside,
          header {
            display: none !important;
          }
          body {
            background: white !important;
          }
        }
      `}</style>
    </div>
  )
}
