"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { useMandrels, useTubeSizes } from "@/hooks/use-master-data"
import {
  useAddReelIssue,
  useCloseJobCard,
  useCreateJobCard,
  useJobCards,
  useUpdateJobCard,
  useValidateJobCard,
} from "@/hooks/use-production"
import { useReleasedSalesLines } from "@/hooks/use-sales"
import { useRecipesForSpec, useSpecs } from "@/hooks/use-specs"

type JobCardPlannerForm = {
  date: string
  shift: string
  operator_name: string
  supervisor_name: string
  tube_length_mm: string
}

export default function JobCardsPage() {
  const [queryOrderId, setQueryOrderId] = useState("")
  const [queryLineId, setQueryLineId] = useState("")

  const { data: jobs, isLoading } = useJobCards()
  const { data: specs } = useSpecs()
  const { data: mandrels } = useMandrels()
  const { data: tubeSizes } = useTubeSizes()
  const { data: releasedLines = [] } = useReleasedSalesLines()

  const createMutation = useCreateJobCard()
  const updateMutation = useUpdateJobCard()
  const addReelMutation = useAddReelIssue()
  const validateMutation = useValidateJobCard()
  const closeMutation = useCloseJobCard()

  const [selectedLineId, setSelectedLineId] = useState("")
  const [selectedRecipeId, setSelectedRecipeId] = useState("")
  const [latestJobId, setLatestJobId] = useState("")
  const [plannerForm, setPlannerForm] = useState<JobCardPlannerForm>({
    date: new Date().toISOString().slice(0, 10),
    shift: "Day",
    operator_name: "",
    supervisor_name: "",
    tube_length_mm: "150",
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    setQueryOrderId(params.get("sales_order_id") || "")
    setQueryLineId(params.get("sales_order_line_id") || "")
  }, [])

  useEffect(() => {
    if (queryLineId) {
      setSelectedLineId(queryLineId)
    }
  }, [queryLineId])

  const linesWithContext = useMemo(
    () =>
      (releasedLines || []).filter((line: any) => {
        if (queryOrderId && line.order_id !== queryOrderId) {
          return false
        }
        return true
      }),
    [releasedLines, queryOrderId]
  )

  const selectedLine = useMemo(
    () => linesWithContext.find((line: any) => line.id === selectedLineId),
    [linesWithContext, selectedLineId]
  )

  const selectedSpec = useMemo(
    () => (specs || []).find((spec: any) => spec.id === selectedLine?.approved_spec_id),
    [specs, selectedLine?.approved_spec_id]
  )

  const { data: recipes = [] } = useRecipesForSpec(String(selectedLine?.approved_spec_id || ""), "approved")

  useEffect(() => {
    if (!selectedSpec) return
    const tube = (tubeSizes || []).find((item: any) => item.id === selectedSpec.tube_size_id)
    if (tube?.length_mm) {
      setPlannerForm((state) => ({ ...state, tube_length_mm: String(tube.length_mm) }))
    }
  }, [selectedSpec, tubeSizes])

  useEffect(() => {
    if (!selectedRecipeId && recipes.length > 0) {
      setSelectedRecipeId(recipes[0].id)
    }
  }, [recipes, selectedRecipeId])

  const selectedTubeSize = useMemo(
    () => (tubeSizes || []).find((tube: any) => tube.id === selectedSpec?.tube_size_id),
    [tubeSizes, selectedSpec?.tube_size_id]
  )

  const selectedMandrel = useMemo(
    () => (mandrels || []).find((mandrel: any) => mandrel.id === selectedSpec?.mandrel_id),
    [mandrels, selectedSpec?.mandrel_id]
  )

  const createJobCard = async () => {
    if (!selectedLine || !selectedSpec) {
      window.alert("Select a released sales-order line first.")
      return
    }
    if (!selectedRecipeId) {
      window.alert("No approved recipe found for selected spec.")
      return
    }
    if (!plannerForm.operator_name.trim()) {
      window.alert("Operator name is required.")
      return
    }

    const response = await createMutation.mutateAsync({
      date: plannerForm.date,
      shift: plannerForm.shift,
      sales_order_id: selectedLine.order_id,
      sales_order_line_id: selectedLine.id,
      spec_id: selectedLine.approved_spec_id,
      recipe_id: selectedRecipeId,
      planned_tubes_qty: Number(selectedLine.qty || 0),
      parchment_color: selectedLine.parchment_color || null,
      mandrel_id: selectedSpec.mandrel_id,
      operator_name: plannerForm.operator_name,
      supervisor_name: plannerForm.supervisor_name || null,
      total_reel_weight_issued: 0,
      bamboo_produced_qty: 0,
      tubes_produced_qty: 0,
      finished_weight: 0,
      bamboo_scrap_qty: 0,
      bamboo_weight_total: 0,
      oven_input_weight: 0,
      oven_output_weight: 0,
      tube_scrap_qty: 0,
      tube_length_mm: Number(plannerForm.tube_length_mm || 0),
    })

    const jobId = response?.data?.id
    if (jobId) {
      setLatestJobId(jobId)
      window.alert("Job card created. You can print it now and then enter EOD values later.")
    }
  }

  const promptEodEntry = (job: any) => {
    const reel = window.prompt("Total reel issued weight", String(job.total_reel_weight_issued || 0))
    if (reel === null) return
    const bamboo = window.prompt("Bamboo produced qty", String(job.bamboo_produced_qty || 0))
    if (bamboo === null) return
    const tubes = window.prompt("Tubes produced qty", String(job.tubes_produced_qty || 0))
    if (tubes === null) return
    const finishedWeight = window.prompt("Finished weight", String(job.finished_weight || 0))
    if (finishedWeight === null) return
    const tubeScrap = window.prompt("Tube scrap qty", String(job.tube_scrap_qty || 0))
    if (tubeScrap === null) return
    const bambooScrap = window.prompt("Bamboo scrap qty", String(job.bamboo_scrap_qty || 0))
    if (bambooScrap === null) return
    const ovenInput = window.prompt("Oven input weight", String(job.oven_input_weight || 0))
    if (ovenInput === null) return
    const ovenOutput = window.prompt("Oven output weight", String(job.oven_output_weight || 0))
    if (ovenOutput === null) return
    const actualCs = window.prompt("Actual CS (optional)", job.actual_cs ? String(job.actual_cs) : "")

    updateMutation.mutate({
      id: job.id,
      data: {
        total_reel_weight_issued: Number(reel || 0),
        bamboo_produced_qty: Number(bamboo || 0),
        tubes_produced_qty: Number(tubes || 0),
        finished_weight: Number(finishedWeight || 0),
        tube_scrap_qty: Number(tubeScrap || 0),
        bamboo_scrap_qty: Number(bambooScrap || 0),
        oven_input_weight: Number(ovenInput || 0),
        oven_output_weight: Number(ovenOutput || 0),
        actual_cs: actualCs ? Number(actualCs) : null,
      },
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-6 text-white shadow-xl">
        <h1 className="text-3xl font-semibold">Sales-Order Driven Job Cards</h1>
        <p className="mt-2 max-w-4xl text-sm text-cyan-100">
          Workflow: release sales order line to create job card, print hard copy, capture shopfloor values, then post
          EOD entry, validate, and close with FG inward.
        </p>
      </section>

      <section className="glass rounded-2xl border border-white/60 p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-slate-900">1) Plan Job Card From Released SO Line</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <select
            value={selectedLineId}
            onChange={(e) => setSelectedLineId(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 px-3"
          >
            <option value="">Select released sales line</option>
            {linesWithContext.map((line: any) => (
              <option key={line.id} value={line.id}>
                {line.order_no} | line {line.id.slice(0, 8)} | qty {line.qty} | due {line.due_date}
              </option>
            ))}
          </select>

          <select
            value={selectedRecipeId}
            onChange={(e) => setSelectedRecipeId(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 px-3"
            disabled={!selectedLine}
          >
            <option value="">Select approved recipe</option>
            {recipes.map((recipe: any) => (
              <option key={recipe.id} value={recipe.id}>
                Recipe v{recipe.version} ({recipe.status})
              </option>
            ))}
          </select>

          <input
            type="date"
            value={plannerForm.date}
            onChange={(e) => setPlannerForm((s) => ({ ...s, date: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          />
          <select
            value={plannerForm.shift}
            onChange={(e) => setPlannerForm((s) => ({ ...s, shift: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          >
            <option value="Day">Day</option>
            <option value="Night">Night</option>
          </select>

          <input
            placeholder="Operator name"
            value={plannerForm.operator_name}
            onChange={(e) => setPlannerForm((s) => ({ ...s, operator_name: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          />
          <input
            placeholder="Supervisor name"
            value={plannerForm.supervisor_name}
            onChange={(e) => setPlannerForm((s) => ({ ...s, supervisor_name: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          />

          <input
            type="number"
            placeholder="Tube length mm"
            value={plannerForm.tube_length_mm}
            onChange={(e) => setPlannerForm((s) => ({ ...s, tube_length_mm: e.target.value }))}
            className="h-10 rounded-lg border border-slate-200 px-3"
          />
          <button
            onClick={() => createJobCard()}
            className="h-10 rounded-lg bg-cyan-800 px-4 text-sm font-medium text-white"
          >
            Create Job Card
          </button>
        </div>

        {selectedLine && selectedSpec && (
          <div className="mt-4 grid gap-3 rounded-xl border border-cyan-100 bg-cyan-50 p-4 text-sm text-slate-700 md:grid-cols-5">
            <div>
              <p className="text-xs text-slate-500">Order</p>
              <p className="font-semibold">{selectedLine.order_no}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Required Qty</p>
              <p className="font-semibold">{selectedLine.qty}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Parchment Color</p>
              <p className="font-semibold">{selectedLine.parchment_color || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Spec</p>
              <p className="font-semibold">
                CS {selectedSpec.required_cs} | Wt {selectedSpec.target_tube_weight}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tube</p>
              <p className="font-semibold">
                ID {selectedTubeSize?.inner_diameter_mm || "-"} / OD {selectedTubeSize?.outer_diameter_mm || "-"} / L{" "}
                {selectedTubeSize?.length_mm || plannerForm.tube_length_mm}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Mandrel</p>
              <p className="font-semibold">{selectedMandrel?.mandrel_code || selectedSpec.mandrel_id}</p>
            </div>
          </div>
        )}

        {latestJobId && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/production/job-cards/print?jobId=${latestJobId}`}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Open Printable Job Card
            </Link>
          </div>
        )}
      </section>

      <section className="glass rounded-2xl border border-white/60 p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-slate-900">2) EOD Entry, Validation, and Close</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Job Card</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">SO Link</th>
                  <th className="py-2">Planned</th>
                  <th className="py-2">Actual</th>
                  <th className="py-2">State</th>
                  <th className="py-2">Variance</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(jobs || []).map((job: any) => (
                  <tr key={job.id} className="border-b border-slate-100">
                    <td className="py-2 font-medium">{job.job_card_no || job.id.slice(0, 8)}</td>
                    <td className="py-2">{job.date}</td>
                    <td className="py-2 text-xs">
                      <div>{job.sales_order_id ? `SO ${String(job.sales_order_id).slice(0, 8)}` : "-"}</div>
                      <div>{job.sales_order_line_id ? `Line ${String(job.sales_order_line_id).slice(0, 8)}` : ""}</div>
                    </td>
                    <td className="py-2">{job.planned_tubes_qty || "-"}</td>
                    <td className="py-2">
                      Tubes {job.tubes_produced_qty || 0}, Wt {job.finished_weight || 0}
                    </td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{job.job_state}</span>
                    </td>
                    <td className="py-2">
                      {job.piece_variance_percent ? `${Number(job.piece_variance_percent).toFixed(2)}%` : "-"} /{" "}
                      {job.weight_variance_percent ? `${Number(job.weight_variance_percent).toFixed(2)}%` : "-"}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/production/job-cards/print?jobId=${job.id}`}
                          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800"
                        >
                          Print
                        </Link>
                        <button
                          onClick={() => promptEodEntry(job)}
                          className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-900"
                        >
                          Enter EOD
                        </button>
                        <button
                          onClick={() => {
                            const reelBarcode = window.prompt("Reel barcode")
                            if (!reelBarcode) return
                            const weightRaw = window.prompt("Reel weight used")
                            if (!weightRaw) return
                            addReelMutation.mutate({
                              jobId: job.id,
                              data: { reel_barcode: reelBarcode, weight_used: Number(weightRaw) },
                            })
                          }}
                          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800"
                        >
                          Add Reel
                        </button>
                        <button
                          onClick={() => validateMutation.mutate({ id: job.id, data: {} })}
                          className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900"
                        >
                          Validate
                        </button>
                        <button
                          onClick={() => {
                            const fgItemId = window.prompt("FG Item ID for close")
                            if (!fgItemId) return
                            closeMutation.mutate({
                              id: job.id,
                              data: { fg_item_id: fgItemId },
                            })
                          }}
                          className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900"
                        >
                          Close + FG
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
