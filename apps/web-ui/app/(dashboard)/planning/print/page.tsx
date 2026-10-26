"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Printer } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { PrintSelectionForm } from "@/components/planning/overview/print-selection-form"
import { PlanningPrintSheet, buildPrintStages } from "@/components/planning/overview/print-sheet"
import { Checkbox } from "@/components/planning/overview/ui"
import { SECTION_STAGE, STAGE_ORDER, addDays, fmtNum, isStage, isoDate, type PrintSelection } from "@/components/planning/overview/lib"
import type { PlanningOverview, ShiftCode } from "@/components/planning/overview/types"
import { useAuth } from "@/context/AuthContext"
import { productionApi } from "@/lib/api"
import { displayPlantScope } from "@/lib/plant-scope"

/**
 * Shop-floor planning sheets, one A4 page per stage (client 2026-10-26: "print all stages planning
 * from a single click", "print with selection").
 *
 * Query params: `stages=WINDER,OVEN` · `date_from` / `date_to` · `machines=id,id` · `shifts=SHIFT_A`
 * · `slots=id,id` (only those slots). The planner's old link `?section=winder&plan_date=…` still
 * works: one stage, that day and the two after it.
 */
function parsePrintParams(params: URLSearchParams | null, today: string): PrintSelection {
  const get = (key: string) => String(params?.get(key) || "")
  const list = (key: string) => get(key).split(",").map((value) => value.trim()).filter(Boolean)
  const stagesParam = list("stages").map((value) => value.toUpperCase()).filter(isStage)
  const section = SECTION_STAGE[get("section").toLowerCase()]
  const stages = stagesParam.length ? stagesParam : section ? [section] : []
  const legacyDate = get("plan_date")
  const from = get("date_from") || legacyDate || today
  const to = get("date_to") || (legacyDate ? addDays(legacyDate, 2) : get("date_from") ? from : addDays(today, 2))
  const shifts = list("shifts").map((value) => value.toUpperCase()).filter((value): value is ShiftCode => value === "SHIFT_A" || value === "SHIFT_B")
  return { stages: stages.length === STAGE_ORDER.length ? [] : stages, from, to: to < from ? from : to, machines: list("machines"), shifts: shifts.length === 2 ? [] : shifts, slots: list("slots") }
}

export default function PlanningPrintPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading planning sheets…</p>}>
      <PlanningPrint />
    </Suspense>
  )
}

function PlanningPrint() {
  const searchParams = useSearchParams()
  const { activePlant, user, isLoading: authLoading } = useAuth()
  const today = isoDate(new Date())
  const initial = useMemo(() => parsePrintParams(searchParams, today), [searchParams, today])
  const [selection, setSelection] = useState<PrintSelection>(initial)
  const [onlySelected, setOnlySelected] = useState(true)
  useEffect(() => {
    setSelection(initial)
    setOnlySelected(true)
  }, [initial])

  const canQuery = !authLoading && Boolean(user) && activePlant !== "ALL"
  const query = useQuery({
    queryKey: ["planning-overview", selection.from, selection.to, activePlant || "default"],
    queryFn: async () => (await productionApi.getPlanningOverview({ date_from: selection.from, date_to: selection.to })).data as PlanningOverview,
    enabled: canQuery,
    staleTime: 30_000,
  })
  const data = query.data
  const effective = useMemo<PrintSelection>(() => ({ ...selection, slots: onlySelected ? selection.slots : [] }), [selection, onlySelected])
  const stages = useMemo(() => buildPrintStages(data, effective), [data, effective])
  const sheets = stages.filter((stage) => stage.slots > 0)

  if (activePlant === "ALL") {
    return <EmptyState label="Select one plant before printing the planning sheets." />
  }

  return (
    <div className="space-y-4" data-testid="planning-print">
      <div className="no-print rounded-xl border border-border bg-card p-4 shadow-premium" data-print-hide>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight">Print planning sheets</h1>
            <p className="text-[12.5px] text-muted-foreground">One A4 sheet per stage. Change the selection here, then print; the sheet below is what comes out.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/planning/overview" className="erp-btn-secondary">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Planning overview
            </Link>
            <button type="button" onClick={() => window.print()} className="erp-btn-primary" disabled={!sheets.length} data-testid="print-now">
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print {sheets.length ? `${sheets.length} sheet${sheets.length === 1 ? "" : "s"}` : ""}
            </button>
          </div>
        </div>
        <div className="mt-4">
          <PrintSelectionForm dense value={selection} onChange={setSelection} machines={data?.machines || []} today={today} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          {initial.slots.length ? <Checkbox checked={onlySelected} onChange={setOnlySelected} label={<>Only the <strong>{initial.slots.length}</strong> slot{initial.slots.length === 1 ? "" : "s"} chosen on the overview</>} /> : null}
          <span>
            {sheets.length
              ? `Prints ${sheets.map((stage) => `${stage.label} (${fmtNum(stage.slots)} slot${stage.slots === 1 ? "" : "s"})`).join(", ")}.`
              : data
                ? "No planned slots match this selection."
                : ""}
          </span>
        </div>
      </div>

      {!canQuery && !authLoading ? null : query.isLoading ? (
        <LoadingState label="Loading the planned slots…" />
      ) : query.isError ? (
        <ErrorState title="The planning sheets could not load" message="Refresh to retry." onRetry={() => void query.refetch()} />
      ) : (
        <PlanningPrintSheet data={data} selection={effective} plantLabel={displayPlantScope(activePlant, "-")} />
      )}

      <style jsx global>{`
        @media print {
          .no-print,
          aside,
          nav,
          header:not(.pp-keep) {
            display: none !important;
          }
          html,
          body {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .bg-dashboard-mesh {
            background: #fff !important;
          }
          .bg-dashboard-mesh > div,
          .bg-dashboard-mesh main {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
          }
          .pp-sheet {
            max-width: none !important;
          }
          .pp-stage {
            break-after: page;
            page-break-after: always;
            margin-top: 0 !important;
          }
          .pp-stage:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .pp-table thead {
            display: table-header-group;
          }
          .pp-row,
          .pp-group {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}
