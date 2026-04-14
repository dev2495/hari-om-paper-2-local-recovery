"use client"

import dayjs from "dayjs"
import { Printer } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useMachines, usePlanningQueue } from "@/hooks/use-production"
import { useTubeSizes } from "@/hooks/use-master-data"

const VALID_STAGES = new Set(["WINDER", "OVEN", "PROCESS", "PACKING"])

export default function PlannerPrintPage() {
  const [stage, setStage] = useState("WINDER")
  const [planDate, setPlanDate] = useState(dayjs().format("YYYY-MM-DD"))
  const [includeUnscheduled, setIncludeUnscheduled] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const params = new URLSearchParams(window.location.search)
    const stageParam = String(params.get("stage") || "WINDER").toUpperCase()
    setStage(VALID_STAGES.has(stageParam) ? stageParam : "WINDER")
    setPlanDate(params.get("plan_date") || dayjs().format("YYYY-MM-DD"))
    setIncludeUnscheduled(params.get("include_unscheduled") !== "false")
  }, [])

  const queueQuery = usePlanningQueue(stage, planDate, includeUnscheduled)
  const machinesQuery = useMachines()
  const tubeSizesQuery = useTubeSizes()

  const machineMap = useMemo(() => {
    const rows = Array.isArray(machinesQuery.data) ? machinesQuery.data : []
    return new Map(rows.map((machine: any) => [machine.id, `${machine.code} - ${machine.name}`]))
  }, [machinesQuery.data])

  const tubeSizeMap = useMemo(() => {
    const rows = Array.isArray(tubeSizesQuery.data) ? tubeSizesQuery.data : []
    return new Map(rows.map((tube: any) => [tube.id, tube.name || tube.code || tube.id]))
  }, [tubeSizesQuery.data])

  const buckets = useMemo(() => {
    const rows = Array.isArray(queueQuery.data?.buckets) ? queueQuery.data.buckets : []
    return rows.map((bucket: any) => ({
      machine_id: bucket.machine_id,
      machine_name: bucket.machine_id ? machineMap.get(bucket.machine_id) || bucket.machine_id : "Unscheduled",
      jobs: [...(bucket.jobs || [])].sort((a, b) => a.sequence_no - b.sequence_no),
    }))
  }, [queueQuery.data, machineMap])

  return (
    <div className="mx-auto max-w-6xl space-y-4 print:max-w-none">
      <div className="no-print flex justify-end">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>

      <section className="rounded-2xl border border-slate-300 bg-white p-6 shadow-xl print:rounded-none print:border-black print:shadow-none">
        <div className="border-b border-slate-200 pb-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Hari Om Paper</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Daily Planner Sheet</h1>
          <p className="mt-1 text-sm text-slate-600">
            Stage: <span className="font-semibold text-slate-900">{stage}</span> | Date:{" "}
            <span className="font-semibold text-slate-900">{dayjs(planDate).format("DD MMM YYYY")}</span>
          </p>
        </div>

        {queueQuery.isLoading && <p className="mt-4 text-sm text-slate-600">Loading queue...</p>}
        {queueQuery.isError && <p className="mt-4 text-sm text-rose-600">Failed to load queue.</p>}

        {!queueQuery.isLoading && !queueQuery.isError && (
          <div className="mt-4 space-y-6">
            {buckets.map((bucket: any, index: number) => (
              <div key={`${bucket.machine_id || "UNASSIGNED"}-${index}`} className="print:break-inside-avoid">
                <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-bold uppercase tracking-wide text-slate-800">
                  {bucket.machine_name}
                </h2>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-left text-slate-700">
                      <th className="border border-slate-300 px-2 py-1">Seq</th>
                      <th className="border border-slate-300 px-2 py-1">Job Card</th>
                      <th className="border border-slate-300 px-2 py-1">Customer</th>
                      <th className="border border-slate-300 px-2 py-1">Tube Size</th>
                      <th className="border border-slate-300 px-2 py-1">Planned Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.jobs.map((job: any) => (
                      <tr key={job.job_card_id}>
                        <td className="border border-slate-300 px-2 py-1">{job.sequence_no}</td>
                        <td className="border border-slate-300 px-2 py-1">{job.job_card_id.slice(0, 8)}</td>
                        <td className="border border-slate-300 px-2 py-1">{job.customer_name || "-"}</td>
                        <td className="border border-slate-300 px-2 py-1">
                          {tubeSizeMap.get(job.tube_size_id || "") || (job.tube_size_id ? job.tube_size_id.slice(0, 8) : "-")}
                        </td>
                        <td className="border border-slate-300 px-2 py-1">{Number(job.planned_qty || 0).toFixed(0)}</td>
                      </tr>
                    ))}
                    {bucket.jobs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="border border-slate-300 px-2 py-3 text-center text-slate-500">
                          No queued jobs
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  )
}
