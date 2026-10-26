"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Download, ExternalLink, Focus, LoaderCircle, Printer, RefreshCw, SquareDashedMousePointer, X } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/workspace/page-header"
import { EmptyQueryState, ErrorState, LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { productionApi } from "@/lib/api"
import { cn } from "@/lib/utils"

import { AttentionList } from "./attention-list"
import { FiltersBar } from "./filters-bar"
import { KpiStrip, type KpiFocus } from "./kpi-strip"
import {
  RESULT_META,
  RESULT_ORDER,
  SLOT_HEADERS,
  STAGE_ORDER,
  boardHref,
  buildTimeline,
  downloadWorkbook,
  filterSlots,
  fmtClock,
  fmtDay,
  fmtNum,
  isSilentSlot,
  isoDate,
  machineMap,
  machineName,
  parseState,
  printHref,
  requeueCountdown,
  resolveRange,
  shiftLabel,
  slotRow,
  stageLabel,
  stateToQuery,
  unitLabel,
  type OverviewState,
  type PrintSelection,
} from "./lib"
import { PrintSelectionForm } from "./print-selection-form"
import { QueueCards } from "./queue-cards"
import { SlotPanel } from "./slot-panel"
import { SlotTable } from "./slot-table"
import { StageSummary } from "./stage-summary"
import { Timeline } from "./timeline"
import { Legend, Section } from "./ui"
import type { OverviewSlot, PlanningOverview as PlanningOverviewData, Stage } from "./types"

/**
 * Planning overview (client 2026-10-26): the plan of a period against what the floor logged, per
 * machine and shift, with what needs action, the queues and a print of every stage in one click.
 * Planning is only the plan; the job card log is the truth. Nothing here blocks the floor.
 */
export function PlanningOverview() {
  const router = useRouter()
  const pathname = usePathname() || "/planning/overview"
  const searchParams = useSearchParams()
  const { activePlant, user, isLoading: authLoading } = useAuth()

  const state = useMemo(() => parseState(searchParams), [searchParams])
  const update = useCallback(
    (patch: Partial<OverviewState>) => {
      const next = { ...parseState(new URLSearchParams(window.location.search)), ...patch }
      const query = stateToQuery(next)
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const clientToday = isoDate(now)
  const range = useMemo(() => resolveRange(state, clientToday), [state, clientToday])
  const canQuery = !authLoading && Boolean(user) && activePlant !== "ALL"
  const query = useQuery({
    queryKey: ["planning-overview", range[0], range[1], activePlant || "default"],
    queryFn: async () => (await productionApi.getPlanningOverview({ date_from: range[0], date_to: range[1] })).data as PlanningOverviewData,
    enabled: canQuery,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const today = data?.today || clientToday
  const machines = useMemo(() => machineMap(data?.machines), [data?.machines])

  // Stage chips count against the other filters, so a stage count never surprises after a click.
  const baseSlots = useMemo(() => filterSlots(data?.slots || [], { stages: [], machine: state.machine, shift: state.shift, q: state.q }), [data?.slots, state.machine, state.shift, state.q])
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const slot of baseSlots) counts[slot.stage] = (counts[slot.stage] || 0) + 1
    return counts
  }, [baseSlots])
  const filtered = useMemo(() => (state.stages.length ? baseSlots.filter((slot) => state.stages.includes(slot.stage)) : baseSlots), [baseSlots, state.stages])
  const activeStages: Stage[] = state.stages.length ? state.stages : STAGE_ORDER

  const [focus, setFocus] = useState<KpiFocus>(null)
  const matchesFocus = useCallback(
    (slot: OverviewSlot) => {
      if (!focus) return true
      if (focus === "SILENT") return isSilentSlot(slot) && (requeueCountdown(slot, now)?.hours || 0) > 0
      if (focus === "DONE") return slot.result === "DONE" || slot.result === "PARTLY"
      return slot.result === focus
    },
    [focus, now],
  )
  const focused = useMemo(() => (focus ? filtered.filter(matchesFocus) : filtered), [filtered, focus, matchesFocus])
  const isDimmed = useMemo(() => (focus ? (slot: OverviewSlot) => !matchesFocus(slot) : undefined), [focus, matchesFocus])
  const model = useMemo(() => (data ? buildTimeline(data, filtered, state, now) : null), [data, filtered, state, now])
  const attention = useMemo(
    () => (data?.attention || []).filter((item) => (!item.stage || activeStages.includes(item.stage)) && (!state.machine || !item.machine_id || String(item.machine_id) === state.machine)),
    [data?.attention, activeStages, state.machine],
  )
  const legend = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const slot of filtered) counts[slot.result] = (counts[slot.result] || 0) + 1
    return RESULT_ORDER.filter((key) => counts[key]).map((key) => ({ tone: RESULT_META[key].tone, label: RESULT_META[key].short, Icon: RESULT_META[key].Icon, count: counts[key] }))
  }, [filtered])

  const [openSlot, setOpenSlot] = useState<OverviewSlot | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const toggleSelect = useCallback((slot: OverviewSlot) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slot.id)) next.delete(slot.id)
      else next.add(slot.id)
      return next
    })
  }, [])
  const selectMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const [printOpen, setPrintOpen] = useState(false)
  const [printSelection, setPrintSelection] = useState<PrintSelection | null>(null)
  const [onlySelected, setOnlySelected] = useState(false)
  const openPrint = () => {
    setPrintSelection({ stages: state.stages, from: range[0], to: range[1], machines: state.machine ? [state.machine] : [], shifts: state.shift ? [state.shift] : [], slots: [] })
    setOnlySelected(selected.size > 0)
    setPrintOpen(true)
  }
  const printLink = useMemo(() => {
    if (!printSelection) return "#"
    if (onlySelected && selected.size && data) {
      const chosen = data.slots.filter((slot) => selected.has(slot.id))
      const dates = chosen.map((slot) => slot.plan_date).sort()
      return printHref({ stages: STAGE_ORDER.filter((stage) => chosen.some((slot) => slot.stage === stage)), from: dates[0] || range[0], to: dates[dates.length - 1] || range[1], machines: [], shifts: [], slots: chosen.map((slot) => slot.id) })
    }
    return printHref(printSelection)
  }, [printSelection, onlySelected, selected, data, range])

  const exportExcel = () =>
    downloadWorkbook((workbook) => {
      const sheet = workbook.addWorksheet("Planned slots")
      sheet.addRow(SLOT_HEADERS)
      for (const slot of focused.slice().sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.shift_code.localeCompare(b.shift_code) || a.job_card_no.localeCompare(b.job_card_no))) sheet.addRow(slotRow(slot, machines))
      const load = workbook.addWorksheet("Machine load")
      load.addRow(["Stage", "Machine", "Date", "Shift", "Slots", "Planned qty", "Made qty", "Unit", "Load", "Capacity", "Load %"])
      for (const row of (data?.load || []).filter((item) => activeStages.includes(item.stage) && (!state.machine || String(item.machine_id) === state.machine) && (!state.shift || item.shift_code === state.shift)))
        load.addRow([stageLabel(row.stage), machineName(machines, row.machine_id), row.plan_date, shiftLabel(row.shift_code), row.slots, row.planned_qty, row.made_qty, unitLabel(row.unit), row.load, row.capacity ?? "", row.pct ?? ""])
      const needs = workbook.addWorksheet("Needs action")
      needs.addRow(["Severity", "Kind", "Job card", "Stage", "Date", "Shift", "Machine", "Title", "Detail"])
      for (const item of attention) needs.addRow([item.severity, item.kind, item.job_card_no || "", stageLabel(item.stage), item.plan_date || "", shiftLabel(item.shift_code), machineName(machines, item.machine_id), item.title, item.detail])
      const queue = workbook.addWorksheet("Queues")
      queue.addRow(["Stage", "Open cards", "Open pcs", "Due in 3 days", "Overdue", "Back from silent slots", "Waiting cards", "Waiting for"])
      for (const row of data?.queue || []) queue.addRow([stageLabel(row.stage), row.open_cards, row.open_pcs, row.due_3d, row.overdue, row.missed, row.waiting_cards, stageLabel(row.waiting_for)])
    }, `planning-overview-${range[0]}-to-${range[1]}.xlsx`)

  const firstStage = activeStages[0] || "WINDER"
  const updatedAt = data?.now ? fmtClock(data.now) : ""

  return (
    <div className="space-y-4" data-testid="planning-overview">
      <PageHeader
        badge="Planning"
        title="Planning overview"
        description="Every planned slot of the period against what the floor logged for that card, stage, day and shift. Planning is only the plan; the job card log is the truth, and nothing here blocks the floor."
        actions={
          <>
            <Link href={boardHref({ stage: firstStage, plan_date: today })} className="erp-btn-secondary" data-testid="open-board">
              Open planner board
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <button type="button" className="erp-btn-secondary" onClick={() => void query.refetch()} disabled={!canQuery || query.isFetching} title={updatedAt ? `Updated ${updatedAt}` : undefined}>
              {query.isFetching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Refresh
            </button>
            <button type="button" className="erp-btn-secondary" onClick={() => void exportExcel()} disabled={!focused.length}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Excel
            </button>
            <button type="button" className="erp-btn-primary" onClick={openPrint} disabled={!data} data-testid="open-print">
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Print{selected.size ? ` · ${selected.size} selected` : ""}
            </button>
          </>
        }
      />

      {activePlant === "ALL" ? (
        <EmptyQueryState title="Pick one plant" message="The planning overview reads one plant's machines and slots. Choose a plant in the top bar to see its plan." />
      ) : query.isError ? (
        <ErrorState title="The planning overview could not load" message="Refresh to retry. Slots are not zero while the request is failing." onRetry={() => void query.refetch()} />
      ) : !data ? (
        <LoadingState label="Matching the plan with the floor log…" />
      ) : (
        <>
          <FiltersBar state={state} onChange={update} machines={data.machines || []} range={range} today={today} stageCounts={stageCounts} />
          <KpiStrip data={data} slots={filtered} state={state} now={now} focus={focus} onFocus={setFocus} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section
              title="What needs action"
              subtitle={attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"} · silent slots, stage order, due dates, overloads and due cards not planned` : "Checked against the floor log just now"}
              action={updatedAt ? <span className="text-[11.5px] text-muted-foreground">Updated {updatedAt}</span> : null}
            >
              <AttentionList items={attention} slots={data.slots || []} onOpenSlot={setOpenSlot} />
            </Section>
            <Section title="Waiting to be planned" subtitle="Open cards per stage. A card's Oven opens for planning once its Winding has a slot; Process once Oven has one.">
              <QueueCards queue={data.queue || []} stages={state.stages} today={today} />
            </Section>
          </div>

          <Section
            title={state.view === "timeline" ? "Plan by machine and shift" : "Planned slots"}
            subtitle={
              <>
                {fmtNum(focused.length)} of {fmtNum(filtered.length)} slot{filtered.length === 1 ? "" : "s"} · {fmtDay(range[0])}
                {range[0] !== range[1] ? ` – ${fmtDay(range[1])}` : ""} · {state.view === "timeline" ? "tap a slot for details; the box scrolls sideways" : "click a row for details; tick rows to print only those"}
              </>
            }
            action={
              <>
                {focus ? (
                  <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary bg-accent px-2 text-[12px] font-semibold text-accent-foreground" onClick={() => setFocus(null)}>
                    <Focus className="h-3.5 w-3.5" aria-hidden="true" />
                    Showing {focus === "SILENT" ? "slots going back to the queue" : focus === "DONE" ? "done and partly done" : RESULT_META[focus].label.toLowerCase()}
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                {state.view === "timeline" ? (
                  <button
                    type="button"
                    aria-pressed={selectMode}
                    onClick={() => setSelectMode((value) => !value)}
                    className={cn("inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[12px] font-semibold transition-colors", selectMode ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
                    data-testid="select-mode"
                  >
                    <SquareDashedMousePointer className="h-3.5 w-3.5" aria-hidden="true" />
                    {selectMode ? "Tap slots to select" : "Select slots to print"}
                  </button>
                ) : null}
                {selected.size ? (
                  <button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear {selected.size} selected
                  </button>
                ) : null}
              </>
            }
            bodyClassName={state.view === "timeline" ? "p-2 sm:p-3" : "p-4"}
          >
            {state.view === "timeline" && model ? (
              <>
                <Legend items={legend} className="mb-2 px-1" />
                <Timeline model={model} shifts={data.shifts || []} now={now} onOpenSlot={setOpenSlot} selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect} isDimmed={isDimmed} />
              </>
            ) : (
              <SlotTable slots={focused} machines={machines} now={now} today={today} onOpenSlot={setOpenSlot} selected={selected} onToggleSelect={toggleSelect} onSelectMany={selectMany} />
            )}
          </Section>

          <Section
            title="By stage"
            subtitle={`Slots by result for each stage in this period${data.summary?.unplanned_runs ? ` · ${data.summary.unplanned_runs} floor run${data.summary.unplanned_runs === 1 ? "" : "s"} logged before planning` : ""}`}
          >
            <StageSummary slots={filtered} loads={data.load || []} state={state} />
          </Section>
        </>
      )}

      <SlotPanel slot={openSlot} runs={data?.runs || []} machines={machines} now={now} today={today} missedHours={data?.missed_slot_hours || 36} onClose={() => setOpenSlot(null)} selectedForPrint={Boolean(openSlot && selected.has(openSlot.id))} onToggleSelect={toggleSelect} />

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="!max-w-3xl" data-testid="print-dialog">
          <DialogHeader>
            <DialogTitle>Print planning sheets</DialogTitle>
            <DialogDescription>One A4 sheet per stage for the shop floor: every planned slot by day, shift and machine, with a Made column and signature lines. Pick what to print.</DialogDescription>
          </DialogHeader>
          {printSelection ? (
            <PrintSelectionForm value={printSelection} onChange={setPrintSelection} machines={data?.machines || []} today={today} selectedSlotCount={selected.size} onlySelected={onlySelected} onOnlySelected={setOnlySelected} />
          ) : null}
          <DialogFooter className="items-center">
            <button type="button" className="erp-btn-secondary" onClick={() => setPrintOpen(false)}>
              Cancel
            </button>
            <Link href={printLink} target="_blank" rel="noopener" className="erp-btn-primary" onClick={() => setPrintOpen(false)} data-testid="print-go">
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              Open print sheets
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
