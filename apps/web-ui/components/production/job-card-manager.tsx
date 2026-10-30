"use client"

/**
 * Job card manager (client 2026-10-27: "too bad, improve it to perfection… so much better and
 * easier"). The management console for planners and the plant head.
 *
 * Left: the cards (status chips, search with "/", ↑ ↓ to move, grouped by order, tick for bulk).
 * Right: the selected card at a glance (qty, stage track, where it is now), one action area with
 * what is possible first and what is locked compact with its reason, each action with a live
 * "what will happen" preview, the card family as a tree and the management changes with
 * before → after. Day-to-day logging stays on the job card page and the floor forms.
 */

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, CalendarClock, CalendarX2, Check, ChevronRight, ClipboardCheck, Download, ExternalLink, Flag, Flame,
  GitFork, History, Layers, Lock, PackagePlus, PauseOctagon, Pencil, Printer, Scissors, ScissorsLineDashed, Search, ShoppingCart, SquareCheckBig, Undo2, X,
} from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ActionPanel, actionAvailability, fmt, inputClass, isBatchEntry, stateWord, type ActionInfo, type LifecycleAction } from "@/components/production/job-card-actions"
import { ColorChip, JobCardNo, LifecycleBadge, TrackBadge } from "@/components/production/lifecycle-chips"
import { PageHeader } from "@/components/workspace/page-header"
import { useApp } from "@/context/AppContext"
import { apiErrorText, invalidateJobCardViews, useJobCardLifecycle, useMissedSlotSweep, type JobCardLifecycle } from "@/hooks/use-lifecycle"
import { useJobCardRows } from "@/hooks/use-job-card-rows"
import { useMachines, useQualityHolds } from "@/hooks/use-production"
import { productionApi } from "@/lib/api"
import { compactRef, jobCardRef } from "@/lib/job-card-display"
import {
  dayText, downloadText, dueInDays, dueText, groupRows, isOpenCard, jobCardsCsv, managementTrail, orderRef, serverTime, shiftText, stageWord, trackStatus,
  type TrackStatus, type TrailEvent, type TrailKind,
} from "@/lib/job-card-tracking"
import { matchesSearch } from "@/lib/planner-queue-filters"
import { cn } from "@/lib/utils"

type Chip = "OPEN" | "QUEUE" | "SCHEDULED" | "RUNNING" | "CLOSED"
const CHIPS: Array<{ key: Chip; label: string; hint: string }> = [
  { key: "OPEN", label: "All open", hint: "Every card still in production" },
  { key: "QUEUE", label: "Queue", hint: "Released, not on the planner board yet" },
  { key: "SCHEDULED", label: "Scheduled", hint: "On the board with a slot" },
  { key: "RUNNING", label: "Running", hint: "Runs logged, waiting QC, on hold or at dispatch" },
  { key: "CLOSED", label: "Closed", hint: "Done, force-closed or cancelled" },
]

function chipOf(track: TrackStatus): Chip {
  if (track === "QUEUE") return "QUEUE"
  if (track === "SCHEDULED") return "SCHEDULED"
  if (track === "CLOSED_EARLY" || track === "DONE") return "CLOSED"
  return "RUNNING"
}

function planShort(job: any) {
  const label = String(job?.plan_status_label || "")
  return label.includes(": ") ? label.split(": ").slice(1).join(": ") : label || "—"
}

const NOT_PLANNED = ["NOT_PLANNED", "WAITING", "NO_PLAN_NEEDED"]

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  return Boolean(element.closest("input,textarea,select,[contenteditable=true],[role=dialog]"))
}

export function JobCardManager() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useApp()
  const selectedId = String(searchParams?.get("card") || "") || null
  const select = useCallback((id: string | null) => router.replace(id ? `${pathname}?card=${id}` : pathname, { scroll: false }), [router, pathname])

  const cards = useJobCardRows()
  const machinesQuery = useMachines()
  const holdsQuery = useQualityHolds({ status: "ACTIVE" })
  useMissedSlotSweep()
  const rows: any[] = cards.rows
  const machines: any[] = useMemo(() => (Array.isArray(machinesQuery.data) ? machinesQuery.data : []), [machinesQuery.data])
  const machineLabel = useCallback((id: string) => {
    const row = machines.find((machine: any) => String(machine.id) === id)
    return String(row?.code || row?.name || "").trim() || compactRef(id, "MC")
  }, [machines])
  const holdByCard = useMemo(() => {
    const map = new Map<string, string>()
    for (const hold of Array.isArray(holdsQuery.data) ? holdsQuery.data : []) {
      if (String(hold?.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue
      const id = String(hold?.job_card_id || "")
      if (id && !map.has(id)) map.set(id, String(hold?.reason || "Quality hold"))
    }
    return map
  }, [holdsQuery.data])
  const holdReason = useCallback((job: any) => (job ? holdByCard.get(String(job.id)) || null : null), [holdByCard])
  const statusOf = useCallback((job: any) => trackStatus(job, Boolean(holdByCard.get(String(job?.id)))), [holdByCard])

  const [search, setSearch] = useState("")
  const [chip, setChip] = useState<Chip>("OPEN")
  const [groupByOrder, setGroupByOrder] = useState(true)
  const [checked, setChecked] = useState<string[]>([])
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const [bulk, setBulk] = useState<"close" | "print" | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const actionRef = useRef<HTMLDivElement | null>(null)

  const withStatus = useMemo(() => rows.map((job) => ({ job, track: statusOf(job) })), [rows, statusOf])
  const searched = useMemo(() => withStatus.filter((row) => matchesSearch(row.job, search.trim())), [withStatus, search])
  const chipCounts = useMemo(() => {
    const counts: Record<Chip, number> = { OPEN: 0, QUEUE: 0, SCHEDULED: 0, RUNNING: 0, CLOSED: 0 }
    for (const row of searched) {
      const key = chipOf(row.track)
      counts[key] += 1
      if (key !== "CLOSED") counts.OPEN += 1
    }
    return counts
  }, [searched])
  const listRows = useMemo(
    () =>
      searched
        .filter((row) => (chip === "OPEN" ? chipOf(row.track) !== "CLOSED" : chipOf(row.track) === chip))
        .map((row) => row.job)
        .sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || String(a.job_card_no || "").localeCompare(String(b.job_card_no || ""))),
    [searched, chip],
  )
  const groups = useMemo(() => groupRows(listRows, groupByOrder ? "order" : "none", machineLabel, statusOf), [listRows, groupByOrder, machineLabel, statusOf])
  // The order the rows are drawn in (groups keep the due-date order inside), for ↑ ↓.
  const drawnIds = useMemo(() => groups.flatMap((bucket) => bucket.rows.map((job: any) => String(job.id))), [groups])

  const lifecycle = useJobCardLifecycle(selectedId)
  const data = lifecycle.data
  const selectedRow = useMemo(() => rows.find((job) => String(job.id) === selectedId) || null, [rows, selectedId])

  useEffect(() => { setAction(null) }, [selectedId])
  useEffect(() => {
    if (action) actionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [action])

  // Keep the selected card in view in the left list without scrolling the page itself.
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-card-id="${selectedId}"]`)
    if (!list || !row) return
    const top = row.offsetTop - list.offsetTop
    if (top < list.scrollTop + 28 || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 34)
  }, [selectedId, drawnIds.length])

  // Keyboard: "/" finds a card, ↑ ↓ (or j k) move through the list, Esc clears the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "/" && !isTyping(event.target)) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (isTyping(event.target) && event.target !== searchRef.current) return
      const down = event.key === "ArrowDown" || (event.key === "j" && event.target !== searchRef.current)
      const up = event.key === "ArrowUp" || (event.key === "k" && event.target !== searchRef.current)
      if (!down && !up) return
      if (!drawnIds.length) return
      event.preventDefault()
      const at = selectedId ? drawnIds.indexOf(selectedId) : -1
      const next = at < 0 ? (down ? 0 : drawnIds.length - 1) : Math.min(drawnIds.length - 1, Math.max(0, at + (down ? 1 : -1)))
      if (drawnIds[next] && drawnIds[next] !== selectedId) select(drawnIds[next])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drawnIds, selectedId, select])

  const checkedRows = rows.filter((job) => checked.includes(String(job.id)))
  const toggleChecked = (id: string) => setChecked((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]))
  const allVisibleChecked = listRows.length > 0 && listRows.every((job) => checked.includes(String(job.id)))

  const exportChecked = () => {
    downloadText(`job-cards-selected-${new Date().toLocaleDateString("en-CA")}.csv`, jobCardsCsv(checkedRows, { machineLabel, holdReason }))
    showToast(`${checkedRows.length} card${checkedRows.length === 1 ? "" : "s"} exported.`, "success")
  }

  const actions = data ? actionAvailability(data, selectedRow ? selectedRow.entry_model : undefined) : []
  const firstStage = String(data?.first_stage || "winder").toLowerCase()

  return (
    <div className="space-y-4" data-testid="job-card-manager">
      <PageHeader
        badge="Production · management"
        title="Job card manager"
        description="Split, edit, emergency insert, force close and cancel in one place. Each shows what will happen before you confirm and asks for a reason. Logging and QC stay on the job card page and the floor forms."
        actions={
          <>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-signal-violet-line bg-signal-violet-soft px-2.5 text-[12px] font-semibold text-signal-violet-ink"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Planners and plant head</span>
            <Link href="/production/job-cards" className="erp-btn-secondary !h-9"><ClipboardCheck className="h-4 w-4" />Job cards list</Link>
            <Link href={`/planning/board?section=${firstStage}${data ? `&job_card_id=${data.id}` : ""}`} className="erp-btn-secondary !h-9"><CalendarClock className="h-4 w-4" />Planner board</Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* ── Left: the cards ───────────────────────────────────────── */}
        <aside
          className={cn("erp-panel min-w-0 flex-col rounded-xl p-3 lg:sticky lg:top-[calc(var(--topbar-h)+12px)] lg:flex lg:max-h-[calc(100dvh-var(--topbar-h)-24px)]", selectedId ? "hidden" : "flex")}
          aria-label="Cards"
          data-testid="manager-list"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Cards <span className="tabular-nums text-muted-foreground" data-testid="manager-count">{listRows.length}</span></p>
            <div className="tube-segment !h-auto" role="group" aria-label="Group the cards">
              <button type="button" aria-pressed={groupByOrder} onClick={() => setGroupByOrder(true)} className="!h-6 !px-2 !text-[11.5px]" data-testid="manager-group">By order</button>
              <button type="button" aria-pressed={!groupByOrder} onClick={() => setGroupByOrder(false)} className="!h-6 !px-2 !text-[11.5px]">By due date</button>
            </div>
          </div>
          <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring/30">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="Find a card"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { setSearch(""); (event.target as HTMLInputElement).blur() }
                if (event.key === "Enter" && drawnIds[0]) { event.preventDefault(); select(drawnIds[0]) }
              }}
              placeholder="Card, order, customer, colour…"
              className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              data-testid="manager-search"
            />
            {search ? (
              <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            ) : (
              <kbd className="hidden rounded border border-border bg-muted px-1.5 text-[10.5px] text-muted-foreground lg:inline">/</kbd>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Which cards">
            {CHIPS.map((row) => (
              <button
                key={row.key}
                type="button"
                title={row.hint}
                aria-pressed={chip === row.key}
                onClick={() => setChip(row.key)}
                className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold transition-colors", chip === row.key ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}
                data-testid={`manager-chip:${row.key}`}
              >
                {row.label}<span className="tabular-nums opacity-75">{chipCounts[row.key]}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allVisibleChecked} onChange={(event) => setChecked(event.target.checked ? Array.from(new Set([...checked, ...listRows.map((job) => String(job.id))])) : checked.filter((id) => !listRows.some((job) => String(job.id) === id)))} className="h-3.5 w-3.5 accent-primary" aria-label="Select all shown" data-testid="manager-select-all" />
              Select all shown
            </label>
            <span className="hidden lg:inline">↑ ↓ to move</span>
          </div>

          <div ref={listRef} className="relative mt-1.5 min-h-[240px] flex-1 overflow-y-auto rounded-lg border border-border" role="list" data-testid="manager-rows">
            {cards.isLoading ? (
              <div className="space-y-2 p-2">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton h-14 rounded-lg" />)}</div>
            ) : cards.isError ? (
              <p className="p-3 text-[12.5px] text-signal-rose-ink" role="alert">{apiErrorText(cards.error, "Cards could not be loaded.")} <button type="button" className="font-semibold underline" onClick={() => cards.refetch()}>Try again</button></p>
            ) : listRows.length === 0 ? (
              <div className="p-5 text-center text-[12.5px] text-muted-foreground" data-testid="manager-list-empty">
                <Search className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden="true" />
                {search.trim() ? <>No card matches “{search.trim()}” here.</> : <>No {CHIPS.find((row) => row.key === chip)?.label.toLowerCase()} cards.</>}
                <div className="mt-2 flex justify-center gap-3">
                  {search ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setSearch("")}>Clear search</button> : null}
                  {chip !== "OPEN" ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setChip("OPEN")}>Show all open</button> : null}
                </div>
              </div>
            ) : (
              groups.map((bucket) => (
                <div key={bucket.key} role="presentation">
                  {groupByOrder ? (
                    <p className="sticky top-0 z-[1] flex items-baseline gap-1 border-b border-border bg-[hsl(var(--surface-2))] px-2.5 py-1 text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{bucket.label}</span>
                      <span className="min-w-0 flex-1 truncate">{bucket.sub ? ` · ${bucket.sub}` : ""}</span>
                      <span className="shrink-0 tabular-nums">{bucket.rows.length}</span>
                    </p>
                  ) : null}
                  {bucket.rows.map((job: any) => (
                    <ListRow
                      key={job.id}
                      job={job}
                      track={statusOf(job)}
                      selected={String(job.id) === selectedId}
                      checked={checked.includes(String(job.id))}
                      hold={holdReason(job)}
                      machineLabel={machineLabel}
                      showOrder={!groupByOrder}
                      onSelect={() => select(String(job.id))}
                      onToggle={() => toggleChecked(String(job.id))}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
          {!cards.complete ? <p className="mt-1 text-[11px] text-signal-amber-ink">Showing the first 4,000 cards; search to find older ones.</p> : null}

          {checked.length ? (
            <div className="mt-2 animate-enter-up rounded-lg border border-primary/40 bg-primary/5 p-2" data-testid="manager-bulk-bar">
              <p className="flex items-center justify-between text-[12.5px] font-semibold">
                <span><SquareCheckBig className="mr-1 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />{checked.length} ticked · {fmt(checkedRows.reduce((sum, job) => sum + Number(job.planned_qty || 0), 0))} pcs</span>
                <button type="button" className="text-[12px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setChecked([])}>Clear</button>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={() => setBulk("print")} data-testid="manager-bulk-print"><Printer className="h-3.5 w-3.5" />Print</button>
                <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={exportChecked} data-testid="manager-bulk-export"><Download className="h-3.5 w-3.5" />Export CSV</button>
                <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px] !text-signal-rose-ink" onClick={() => setBulk("close")} data-testid="manager-bulk-close"><Undo2 className="h-3.5 w-3.5" />Force close…</button>
              </div>
            </div>
          ) : null}
        </aside>

        {/* ── Right: the selected card ──────────────────────────────── */}
        <section className={cn("min-w-0 space-y-4", selectedId ? "block" : "hidden lg:block")} aria-label="Selected card" data-testid="manager-workspace">
          {selectedId ? (
            <button type="button" onClick={() => select(null)} className="erp-btn-secondary !h-9 lg:hidden" data-testid="manager-back"><ArrowLeft className="h-4 w-4" />All cards</button>
          ) : null}
          {!selectedId ? (
            <EmptyWorkspace rows={rows} statusOf={statusOf} loading={cards.isLoading} onOpen={select} />
          ) : lifecycle.isError && !data ? (
            <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-4 text-[13px] text-signal-rose-ink" role="alert">
              <p>{apiErrorText(lifecycle.error, "The job card could not be loaded.")}</p>
              <div className="mt-2 flex gap-3">
                <button type="button" className="font-semibold underline" onClick={() => lifecycle.refetch()}>Try again</button>
                <button type="button" className="font-semibold underline" onClick={() => select(null)}>Pick another card</button>
              </div>
            </div>
          ) : !data ? (
            <div className="space-y-3"><div className="skeleton h-40 rounded-xl" /><div className="skeleton h-32 rounded-xl" /><div className="skeleton h-40 rounded-xl" /></div>
          ) : (
            <>
              <CardSummary data={data} row={selectedRow} hold={holdReason(selectedRow)} machineLabel={machineLabel} parent={selectedRow?.parent_job_card_id ? rows.find((job) => String(job.id) === String(selectedRow.parent_job_card_id)) : null} onOpen={select} />

              <ActionsSection
                data={data}
                actions={actions}
                action={action}
                setAction={setAction}
                firstStage={firstStage}
                actionRef={actionRef}
                panel={action ? (
                  <ActionPanel
                    key={`${data.id}:${action}`}
                    action={action}
                    data={data}
                    machines={machines}
                    wide
                    onDone={() => { setAction(null); invalidateJobCardViews(queryClient) }}
                    onOpenCard={(id) => select(id)}
                  />
                ) : null}
              />

              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <FamilyTree data={data} row={selectedRow} rows={rows} statusOf={statusOf} onOpen={select} />
                <Trail data={data} machineLabel={machineLabel} onOpen={select} />
              </div>
            </>
          )}
        </section>
      </div>

      <BulkCloseDialog open={bulk === "close"} rows={checkedRows} holdReason={holdReason} onClose={() => setBulk(null)} onFinished={(doneIds) => { setChecked((current) => current.filter((id) => !doneIds.includes(id))); invalidateJobCardViews(queryClient) }} />
      <BulkPrintDialog open={bulk === "print"} rows={checkedRows} onClose={() => setBulk(null)} />
    </div>
  )
}

// ── left list row ──────────────────────────────────────────────────────────

function ListRow({ job, track, selected, checked, hold, machineLabel, showOrder, onSelect, onToggle }: {
  job: any
  track: TrackStatus
  selected: boolean
  checked: boolean
  hold: string | null
  machineLabel: (id: string) => string
  showOrder: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const days = dueInDays(job.due_date)
  const flagged = Number(job.qc_flagged_runs || 0)
  const where = track === "QUEUE"
    ? `next: ${stageWord(job.current_stage)}`
    : [stageWord(job.current_stage), job.current_machine_id ? machineLabel(String(job.current_machine_id)) : null, job.current_plan_date && !NOT_PLANNED.includes(String(job.plan_status || "")) ? `${dayText(job.current_plan_date)} ${shiftText(job.current_shift_code).replace("Shift ", "")}`.trim() : null].filter(Boolean).join(" · ")
  return (
    <div
      role="listitem"
      data-card-id={String(job.id)}
      className={cn("group flex items-start gap-2 border-b border-border/70 px-2.5 py-2 transition-colors last:border-b-0", selected ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-foreground/[.03]")}
      data-testid="manager-row"
      data-selected={selected || undefined}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary" aria-label={`Tick ${jobCardRef(job)}`} data-testid="manager-row-check" />
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left focus-visible:outline-none" aria-current={selected ? "true" : undefined} data-testid="manager-row-open">
        <span className="flex items-center justify-between gap-2">
          <JobCardNo job={job} className="min-w-0 flex-wrap" />
          <TrackBadge status={track} className="!h-5 !px-1.5 !text-[10.5px]" />
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {showOrder ? <>{orderRef(job)} · </> : null}{job.customer_name || "—"} · <span className="font-medium text-foreground/90">{fmt(job.planned_qty)} pcs</span> · {job.parchment_color ? String(job.parchment_color).split(/[·/]/)[0].trim() : "plain"}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{where}</span>
          {job.due_date ? <span className={cn("shrink-0", days !== null && days < 0 ? "font-semibold text-signal-rose-ink" : days !== null && days <= 3 ? "font-semibold text-signal-amber-ink" : "")}>· due {dayText(job.due_date)}</span> : <span className="shrink-0" data-testid="manager-no-date">· No date</span>}
        </span>
        {hold || flagged > 0 ? (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {hold ? <span className="inline-flex max-w-full items-center gap-1 truncate rounded bg-signal-rose-soft px-1 text-[10.5px] font-semibold text-signal-rose-ink"><PauseOctagon className="h-3 w-3 shrink-0" aria-hidden="true" />Hold · {hold}</span> : null}
            {flagged > 0 ? <span className="inline-flex items-center gap-1 rounded bg-signal-amber-soft px-1 text-[10.5px] font-semibold text-signal-amber-ink"><Flag className="h-3 w-3" aria-hidden="true" />Flagged QC · {flagged} run{flagged > 1 ? "s" : ""}</span> : null}
          </span>
        ) : null}
      </button>
    </div>
  )
}

// ── empty workspace (nothing selected) ─────────────────────────────────────

function EmptyWorkspace({ rows, statusOf, loading, onOpen }: { rows: any[]; statusOf: (job: any) => TrackStatus; loading: boolean; onOpen: (id: string) => void }) {
  const open = rows.filter((job) => isOpenCard(job))
  const picks = [
    { key: "missed", title: "Missed slot, back in the queue", icon: CalendarX2, tone: "amber" as const, rows: open.filter((job) => job.missed_slot_open) },
    { key: "overdue", title: "Past due date", icon: AlertTriangle, tone: "rose" as const, rows: open.filter((job) => { const days = dueInDays(job.due_date); return days !== null && days < 0 }) },
    { key: "flag", title: "Flagged QC readings", icon: Flag, tone: "amber" as const, rows: open.filter((job) => Number(job.qc_flagged_runs || 0) > 0) },
    { key: "queue", title: "Not planned yet", icon: CalendarClock, tone: "slate" as const, rows: open.filter((job) => statusOf(job) === "QUEUE") },
  ].filter((group) => group.rows.length)
  return (
    <div className="erp-panel rounded-xl p-5" data-testid="manager-empty">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><GitFork className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h2 className="text-[16px] font-semibold">Pick a card</h2>
          <p className="mt-0.5 max-w-xl text-[13px] text-muted-foreground">Choose a card on the left (or press <kbd className="rounded border border-border bg-muted px-1 text-[11px]">/</kbd> and type its number). You will see what you can do with it now, a preview before anything changes, its family and who changed what.</p>
        </div>
      </div>
      {loading ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{[0, 1].map((index) => <div key={index} className="skeleton h-28 rounded-xl" />)}</div> : picks.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {picks.map((group) => (
            <div key={group.key} className="rounded-xl border border-border bg-card p-3" data-testid={`manager-suggest-${group.key}`}>
              <p className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", group.tone === "rose" ? "text-signal-rose-ink" : group.tone === "amber" ? "text-signal-amber-ink" : "text-foreground")}>
                <group.icon className="h-3.5 w-3.5" aria-hidden="true" />{group.title}<span className="ml-auto tabular-nums text-muted-foreground">{group.rows.length}</span>
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {group.rows.slice(0, 4).map((job) => (
                  <li key={job.id}>
                    <button type="button" onClick={() => onOpen(String(job.id))} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-muted">
                      <span className="font-mono font-semibold">{jobCardRef(job)}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.customer_name || "—"} · {fmt(job.planned_qty)} pcs</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {group.rows.length > 4 ? <p className="mt-1 px-1.5 text-[11.5px] text-muted-foreground">+ {group.rows.length - 4} more in the list</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">Nothing needs a decision right now: no missed slots, nothing overdue, no flagged readings.</p>
      )}
    </div>
  )
}

// ── selected card summary ──────────────────────────────────────────────────

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "rose" | "violet" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
      <p className="truncate text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-[18px] font-semibold leading-tight tabular-nums", tone === "rose" && "text-signal-rose-ink", tone === "violet" && "text-signal-violet-ink")}>{value}</p>
      {sub ? <p className="truncate text-[11px] tabular-nums text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function StageTrack({ data }: { data: JobCardLifecycle }) {
  const current = String(data.current_stage || "").toUpperCase()
  const closed = ["FORCE_CLOSED", "CANCELLED"].includes(data.state)
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Stages" data-testid="manager-stage-track">
      {data.stages.map((stage, index) => {
        const done = stage.status === "COMPLETED" || current === "DONE"
        const now = !done && stage.stage === current && !(closed && data.close_mode === "CANCELLED")
        const made = stage.output_qty || stage.running_total
        return (
          <li key={stage.stage} className="flex items-center gap-1">
            <span
              title={`${stageWord(stage.stage)}: ${done ? "done" : now ? "now" : "to do"} · ${fmt(made)} of ${fmt(stage.planned_in_unit)} ${stage.unit}`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-semibold ring-1 ring-inset",
                done ? "bg-signal-emerald-soft text-signal-emerald-ink ring-signal-emerald-line" : now ? "bg-signal-blue-soft text-signal-blue-ink ring-signal-blue-line" : "bg-muted text-muted-foreground ring-transparent",
              )}
            >
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
              {stageWord(stage.stage)}
              {(now || done) && stage.planned_in_unit ? <span className="font-normal tabular-nums opacity-80">{fmt(made)}/{fmt(stage.planned_in_unit)}{stage.unit === "bamboo" ? " b" : ""}</span> : null}
            </span>
            {index < data.stages.length - 1 ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

function CardSummary({ data, row, hold, machineLabel, parent, onOpen }: { data: JobCardLifecycle; row: any; hold: string | null; machineLabel: (id: string) => string; parent: any; onOpen: (id: string) => void }) {
  const planned = data.planned_qty
  const made = data.made_qty
  const pct = planned > 0 ? Math.min(100, (Math.min(made, data.max_output_qty) / Math.max(planned, 1)) * 100) : 0
  const flagged = Number(row?.qc_flagged_runs || 0)
  const days = row?.due_date ? dueInDays(row.due_date) : null
  const batch = isBatchEntry(row?.entry_model)
  return (
    <header className="erp-panel rounded-xl p-4" data-testid="manager-card-head">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <JobCardNo job={{ ...(row || {}), ...data, job_card_no: data.job_card_no }} className="[&>span:first-child]:text-[20px]" />
            {row ? <TrackBadge status={trackStatus(row, Boolean(hold))} /> : <LifecycleBadge state={data.state} />}
            {flagged > 0 ? (
              <Link href={`/production/job-cards/${data.id}?tab=qc`} className="inline-flex items-center gap-1 rounded-full bg-signal-amber-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal-amber-ink ring-1 ring-inset ring-signal-amber-line" title="A reading outside its band: allowed, flagged, never held" data-testid="manager-flag">
                <Flag className="h-3 w-3" aria-hidden="true" />Flagged QC · {flagged} run{flagged > 1 ? "s" : ""}
              </Link>
            ) : null}
            {row ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" title={batch ? "Batch entry: runs and QC on the card page; it closes short with Close stage" : "Old card form: force close is possible"}>{batch ? "batch entry" : "old form"}</span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <strong className="font-semibold text-foreground">{row ? orderRef(row) : compactRef(data.sales_order_id, "SO")}</strong>
            {row?.customer_name ? <> · {row.customer_name}</> : null}
            {row?.product_size_label || row?.product_code ? <> · {row.product_size_label || row.product_code}</> : null}
            {" · "}<ColorChip color={data.parchment_color} empty="plain" className="!text-[13px]" />
            {row?.due_date ? <> · due <span className={cn(days !== null && days < 0 ? "font-semibold text-signal-rose-ink" : days !== null && days <= 3 ? "font-semibold text-signal-amber-ink" : "")}>{dayText(row.due_date)} ({dueText(days)})</span></> : row ? <> · No date</> : null}
          </p>
          {parent ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {row?.split_kind === "CARRY_FORWARD" ? "Top-up of" : "Split from"} <button type="button" className="font-mono font-semibold text-primary hover:underline" onClick={() => onOpen(String(parent.id))}>{jobCardRef(parent)}</button>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={`/production/job-cards/${data.id}`} className="erp-btn-secondary !h-8 text-[12px]" data-testid="manager-open-card"><ExternalLink className="h-3.5 w-3.5" />Card page</Link>
          <Link href={`/production/job-cards/${data.id}/print`} className="erp-btn-secondary !h-8 text-[12px]"><Printer className="h-3.5 w-3.5" />Print</Link>
          <Link href={`/sales-orders/${data.sales_order_id}`} className="erp-btn-secondary !h-8 text-[12px]"><ShoppingCart className="h-3.5 w-3.5" />Sales order</Link>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4" data-testid="manager-stats">
        <Stat label="Planned" value={fmt(planned)} sub={data.pcs_per_bamboo ? `${fmt(Math.ceil(planned / data.pcs_per_bamboo))} bamboo × ${data.pcs_per_bamboo}` : "pcs"} />
        <Stat label="Made" value={fmt(made)} sub={data.pcs_per_bamboo ? `${fmt(data.made_in_anchor_unit)} bamboo ${String(data.anchor_stage).toUpperCase() === "WINDER" ? "wound" : `at ${stageWord(data.anchor_stage).toLowerCase()}`}` : `at ${stageWord(data.anchor_stage).toLowerCase()}`} />
        <Stat label="Not started" value={fmt(data.open_first_stage_qty)} sub={`on ${stageWord(data.first_stage).toLowerCase()}`} tone={data.open_first_stage_qty > 0 && data.state !== "QUEUED" ? "violet" : undefined} />
        <Stat label="Back to order" value={fmt(data.returned_qty)} sub={data.returned_qty ? "not released again yet" : "nothing returned"} tone={data.returned_qty ? "rose" : undefined} />
      </div>
      <div className="mt-2">
        <div className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full origin-left animate-[bar-grow_700ms_var(--ease-workspace)_both] rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{fmt(pct)}% made · the floor may run up to +{data.output_tolerance_pct}% ({fmt(data.max_output_qty)} pcs)</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <StageTrack data={data} />
        <p className="text-[12.5px] text-muted-foreground">
          {data.state === "QUEUED" ? <>Next: <strong className="text-foreground">{stageWord(data.current_stage)}</strong></> : <>Now at <strong className="text-foreground">{stageWord(data.current_stage)}</strong></>}
          {row?.current_machine_id && data.state !== "QUEUED" ? <> on <strong className="text-foreground">{machineLabel(String(row.current_machine_id))}</strong></> : null}
          {row ? <> · {planShort(row)}</> : null}
        </p>
      </div>

      <SlotList data={data} machineLabel={machineLabel} />

      {hold ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink"><PauseOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><strong>On hold:</strong> {hold}. The next stage waits until the hold is cleared on the card page.</span></p>
      ) : null}
      {data.close_reason ? (
        <p className="mt-3 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[12.5px] text-signal-rose-ink" data-testid="manager-close-reason">
          <span className="font-semibold">{data.close_mode === "CANCELLED" ? "Cancelled" : "Force-closed"}</span>
          {data.closed_by ? ` by ${data.closed_by}` : ""}{serverTime(data.closed_at) ? ` · ${serverTime(data.closed_at)!.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}: {data.close_reason}
        </p>
      ) : null}
      {data.missed_slot_open ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-[12.5px] text-signal-amber-ink">
          <CalendarX2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><strong>Missed slot: back in the queue{data.missed_slot_count > 1 ? ` (${data.missed_slot_count} times)` : ""}.</strong> Planned {dayText(data.last_missed_slot?.plan_date)} {shiftText(data.last_missed_slot?.shift_code)}, nothing was logged 36 h after the shift. Plan it again on the board, or log the run if it did happen.</span>
        </p>
      ) : null}
    </header>
  )
}

/** The planner slots of every stage (date · shift · machine · qty), folded away until asked for. */
function SlotList({ data, machineLabel }: { data: JobCardLifecycle; machineLabel: (id: string) => string }) {
  const stages = data.stages.map((stage) => ({ ...stage, slots: stage.segments.filter((segment) => segment.status !== "CANCELLED" && (segment.machine_id || ["ASSIGNED", "RUNNING", "COMPLETED"].includes(segment.status))) })).filter((stage) => stage.slots.length)
  const total = stages.reduce((sum, stage) => sum + stage.slots.length, 0)
  if (!total) return null
  const tone = (status: string) => (status === "RUNNING" ? "bg-signal-amber-soft text-signal-amber-ink" : status === "COMPLETED" ? "bg-signal-emerald-soft text-signal-emerald-ink" : status === "ASSIGNED" || status === "PLANNED" ? "bg-signal-blue-soft text-signal-blue-ink" : "bg-muted text-muted-foreground")
  return (
    <details className="group mt-3 rounded-lg border border-border bg-card px-3 py-2" data-testid="manager-slots">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />Planner slots <span className="font-normal tabular-nums">({total})</span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {stages.map((stage) => (
          <li key={stage.stage} className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="w-20 shrink-0 font-semibold">{stageWord(stage.stage)}</span>
            {stage.slots.map((slot) => (
              <span key={slot.id} className={cn("rounded-md px-1.5 py-0.5 tabular-nums", tone(slot.status))} title={String(slot.status).toLowerCase()}>
                {slot.plan_date ? dayText(slot.plan_date) : "queue"}{slot.shift_code ? ` · ${shiftText(slot.shift_code).replace("Shift ", "")}` : ""}{slot.machine_id ? ` · ${machineLabel(String(slot.machine_id))}` : ""} · {fmt(slot.planned_qty)}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  )
}

// ── actions ────────────────────────────────────────────────────────────────

const ACTION_TONE: Record<LifecycleAction, string> = {
  split: "bg-signal-violet-soft text-signal-violet-ink",
  edit: "bg-primary/10 text-primary",
  emergency: "bg-signal-amber-soft text-signal-amber-ink",
  force_close: "bg-signal-rose-soft text-signal-rose-ink",
  cancel: "bg-signal-rose-soft text-signal-rose-ink",
}

function ActionsSection({ data, actions, action, setAction, firstStage, actionRef, panel }: {
  data: JobCardLifecycle
  actions: ActionInfo[]
  action: LifecycleAction | null
  setAction: (value: LifecycleAction | null) => void
  firstStage: string
  actionRef: React.MutableRefObject<HTMLDivElement | null>
  panel: ReactNode
}) {
  const allowed = actions.filter((item) => item.allowed)
  // Locked actions, each pointing elsewhere only once (Force close and Cancel often share "Close stage").
  const locked = actions.filter((item) => !item.allowed).map((item, index, list) => (item.instead && list.slice(0, index).some((other) => other.instead?.href === item.instead?.href && other.instead?.label === item.instead?.label) ? { ...item, instead: null } : item))
  return (
    <section className="erp-panel rounded-xl p-4" data-testid="manager-actions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">What can you do with {data.job_card_no}?</h2>
        <p className="text-[12px] text-muted-foreground">{allowed.length ? `${allowed.length} possible now · ${stateWord(data.state)} card` : `Nothing to change: ${stateWord(data.state)} card`}</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
        {allowed.map((item) => {
          const on = action === item.key
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={on}
              onClick={() => setAction(on ? null : item.key)}
              data-testid={`manager-action-${item.key}`}
              className={cn(
                "group flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150",
                on ? (item.danger ? "border-signal-rose-line bg-signal-rose-soft shadow-sm" : "border-primary/50 bg-primary/10 shadow-sm") : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
              )}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", ACTION_TONE[item.key])}><item.icon className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[13.5px] font-semibold">{item.label}{on ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}</span>
                <span className="block text-[12px] leading-4 text-muted-foreground">{item.hint}</span>
              </span>
            </button>
          )
        })}
        <Link
          href={`/planning/board?section=${firstStage}&job_card_id=${data.id}&order_id=${data.sales_order_id}`}
          className="group flex items-start gap-3 rounded-xl border border-dashed border-border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-signal-blue-line hover:shadow-md"
          data-testid="manager-action-split-plan"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal-blue-soft text-signal-blue-ink"><ScissorsLineDashed className="h-4 w-4" aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[13.5px] font-semibold">Split plan<span className="text-[11.5px] font-medium text-muted-foreground">on the Planner board</span><ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" /></span>
            <span className="block text-[12px] leading-4 text-muted-foreground">Run this one card over more days, shifts or machines: a planning change, it stays one card.</span>
          </span>
        </Link>
      </div>

      {panel ? (
        <div ref={actionRef} className="mt-3 animate-enter-up scroll-mt-24 rounded-xl border border-border bg-[hsl(var(--surface-2))] p-4 shadow-sm" data-testid="manager-action-panel">
          {panel}
        </div>
      ) : null}

      {locked.length ? (
        <div className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2" data-testid="manager-locked">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Not possible now</p>
          <ul className="mt-1 divide-y divide-border/70">
            {locked.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-1.5 text-[12.5px]" data-testid={`manager-locked-${item.key}`}>
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="w-36 shrink-0 font-semibold text-muted-foreground">{item.label}</span>
                <span className="min-w-0 flex-1 basis-48 text-foreground/85">{item.why}</span>
                {item.instead ? <Link href={item.instead.href} className="shrink-0 text-[12px] font-semibold text-primary hover:underline">{item.instead.label} <ArrowRight className="inline h-3 w-3" aria-hidden="true" /></Link> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

// ── family tree ────────────────────────────────────────────────────────────

type FamilyNode = { id: string; no: string; qty: number; kind: string; status: string; closeMode: string | null; self: boolean; row: any; children: FamilyNode[] }

function FamilyTree({ data, row, rows, statusOf, onOpen }: { data: JobCardLifecycle; row: any; rows: any[]; statusOf: (job: any) => TrackStatus; onOpen: (id: string) => void }) {
  const byId = useMemo(() => new Map(rows.map((job) => [String(job.id), job])), [rows])
  const tree = useMemo(() => {
    const members = data.family
    const ids = new Set(members.map((member) => member.id))
    const parentOf = (id: string) => {
      const parent = byId.get(id)?.parent_job_card_id
      return parent && ids.has(String(parent)) ? String(parent) : null
    }
    const root = members.find((member) => !parentOf(member.id) && !member.split_kind) || members.find((member) => !parentOf(member.id)) || members[0]
    const build = (id: string, seen: Set<string>): FamilyNode | null => {
      const member = members.find((item) => item.id === id)
      if (!member || seen.has(id)) return null
      seen.add(id)
      const kids = members.filter((item) => item.id !== id && (parentOf(item.id) === id || (!parentOf(item.id) && id === root?.id && item.id !== root?.id)))
      return {
        id: member.id,
        no: member.job_card_no || member.id.slice(0, 8),
        qty: member.planned_qty,
        kind: member.id === root?.id ? "original card" : member.split_kind === "CARRY_FORWARD" ? "top-up" : "split card",
        status: member.status,
        closeMode: member.close_mode,
        self: member.is_self,
        row: byId.get(member.id) || null,
        children: kids.map((kid) => build(kid.id, seen)).filter(Boolean) as FamilyNode[],
      }
    }
    return root ? build(root.id, new Set()) : null
  }, [data.family, byId])
  const onCards = data.family.reduce((sum, member) => sum + member.planned_qty, 0)
  const ordered = row?.order_line_qty
  return (
    <section className="erp-panel rounded-xl p-4" data-testid="manager-family">
      <h2 className="flex items-center gap-1.5 text-[14px] font-semibold"><GitFork className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Card family</h2>
      <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-border bg-[hsl(var(--surface-2))] px-3 py-2 text-[12.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Layers className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{row ? orderRef(row) : compactRef(data.sales_order_id, "SO")}{row?.order_line_no ? ` · line ${row.order_line_no}` : ""}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{row?.customer_name || "—"}{row?.po_number ? ` · PO ${row.po_number}` : ""}</span>
        </span>
        <span className="shrink-0 text-right text-[11.5px] text-muted-foreground">
          {ordered ? <><strong className="text-[13px] tabular-nums text-foreground">{fmt(ordered)} pcs</strong> ordered<br /></> : null}
          {fmt(onCards)} pcs on {data.family.length} card{data.family.length === 1 ? "" : "s"}
        </span>
      </div>
      {tree ? (
        <div className="ml-3.5 border-l-2 border-border pl-4 pt-2" role="tree" aria-label="Cards of this order line">
          <TreeNode node={tree} statusOf={statusOf} onOpen={onOpen} />
        </div>
      ) : null}
      {data.family.length === 1 ? <p className="mt-2 text-[11.5px] text-muted-foreground">Only card on this line. A split adds the new card here, with its own number.</p> : null}
    </section>
  )
}

function TreeNode({ node, statusOf, onOpen }: { node: FamilyNode; statusOf: (job: any) => TrackStatus; onOpen: (id: string) => void }) {
  const track = node.row ? statusOf(node.row) : null
  const ppb = Number(node.row?.pcs_per_bamboo || 0)
  return (
    <div role="treeitem" aria-selected={node.self} aria-expanded={node.children.length ? true : undefined} className="space-y-1.5">
      <div className="relative">
        <span className="absolute -left-4 top-1/2 h-0.5 w-3.5 bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          disabled={node.self}
          className={cn("flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors", node.self ? "border-primary/60 bg-primary/10 ring-2 ring-primary/15" : "border-border bg-card hover:border-primary/40 hover:bg-muted/50")}
          data-testid="manager-family-card"
          data-self={node.self || undefined}
        >
          <span className="font-mono text-[13px] font-semibold">{node.no}</span>
          <span className="tabular-nums"><strong>{fmt(node.qty)} pcs</strong>{ppb ? <span className="text-muted-foreground"> · {fmt(Math.ceil(node.qty / ppb))} b</span> : null}</span>
          {track ? <TrackBadge status={track} className="!h-5 !px-1.5 !text-[10.5px]" /> : <span className="text-[11.5px] text-muted-foreground">{node.closeMode ? (node.closeMode === "CANCELLED" ? "cancelled" : "closed early") : String(node.status || "").replace(/_/g, " ").toLowerCase()}</span>}
          <span className="text-[11.5px] text-muted-foreground">{node.kind}{node.row?.current_stage && track && !["DONE", "CLOSED_EARLY"].includes(track) ? ` · ${stageWord(node.row.current_stage).toLowerCase()}` : ""}</span>
          {node.self ? <span className="ml-auto rounded bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary">this card</span> : <span className="ml-auto inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-primary">open<ChevronRight className="h-3 w-3" aria-hidden="true" /></span>}
        </button>
      </div>
      {node.children.length ? (
        <div className="ml-5 space-y-1.5 border-l-2 border-border pl-4" role="group">
          {node.children.map((child) => <TreeNode key={child.id} node={child} statusOf={statusOf} onOpen={onOpen} />)}
        </div>
      ) : null}
    </div>
  )
}

// ── management changes ─────────────────────────────────────────────────────

const TRAIL_STYLE: Record<TrailKind, { icon: any; className: string; word: string }> = {
  RELEASE: { icon: PackagePlus, className: "bg-signal-emerald-soft text-signal-emerald-ink", word: "release" },
  EDIT: { icon: Pencil, className: "bg-primary/10 text-primary", word: "edit" },
  SPLIT: { icon: Scissors, className: "bg-signal-violet-soft text-signal-violet-ink", word: "split" },
  CLOSE: { icon: Undo2, className: "bg-signal-rose-soft text-signal-rose-ink", word: "force close" },
  CANCEL: { icon: Ban, className: "bg-signal-rose-soft text-signal-rose-ink", word: "cancel" },
  EMERGENCY: { icon: Flame, className: "bg-signal-amber-soft text-signal-amber-ink", word: "emergency" },
  PLAN: { icon: CalendarClock, className: "bg-signal-blue-soft text-signal-blue-ink", word: "plan" },
  OTHER: { icon: History, className: "bg-muted text-muted-foreground", word: "other" },
}

function dayHeading(at: string | null) {
  const date = serverTime(at)
  if (!date) return "Earlier"
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(date)) / 86_400_000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

function Trail({ data, machineLabel, onOpen }: { data: JobCardLifecycle; machineLabel: (id: string) => string; onOpen: (id: string) => void }) {
  const [showPlan, setShowPlan] = useState(false)
  const all = useMemo(() => managementTrail(data.events, data.planned_qty, machineLabel), [data.events, data.planned_qty, machineLabel])
  const planCount = all.filter((event) => event.kind === "PLAN").length
  const events = showPlan ? all : all.filter((event) => event.kind !== "PLAN")
  let lastDay = ""
  return (
    <section className="erp-panel rounded-xl p-4" data-testid="manager-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[14px] font-semibold"><History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Management changes</h2>
        <div className="flex items-center gap-3">
          {planCount ? (
            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={showPlan} onChange={(event) => setShowPlan(event.target.checked)} className="h-3.5 w-3.5 accent-primary" data-testid="manager-history-plan" />
              planner moves ({planCount})
            </label>
          ) : null}
          <Link href={`/production/job-cards/${data.id}?tab=history`} className="text-[12px] font-semibold text-primary hover:underline">Full history <ExternalLink className="inline h-3 w-3" aria-hidden="true" /></Link>
        </div>
      </div>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">Who, when, what, before → after. Runs and QC are on the card page history.</p>
      {events.length === 0 ? (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[12.5px] text-muted-foreground" data-testid="manager-history-empty">No management changes yet: the card is as released.</p>
      ) : (
        <ol className="mt-2" data-testid="manager-history-list">
          {events.slice(0, 20).map((event) => {
            const day = dayHeading(event.at)
            const heading = day !== lastDay ? day : null
            lastDay = day
            return <TrailRow key={event.id} event={event} heading={heading} onOpen={onOpen} />
          })}
        </ol>
      )}
    </section>
  )
}

function TrailRow({ event, heading, onOpen }: { event: TrailEvent; heading: string | null; onOpen: (id: string) => void }) {
  const style = TRAIL_STYLE[event.kind]
  const Icon = style.icon
  const at = serverTime(event.at)
  return (
    <li data-testid="manager-history-row" data-kind={event.kind}>
      {heading ? <p className="pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</p> : null}
      <div className="relative flex gap-3 pb-3 pl-0.5 before:absolute before:bottom-0 before:left-[14px] before:top-8 before:w-px before:bg-border last:before:hidden">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", style.className)}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 text-[12.5px]">
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <strong className="font-semibold">{event.title}</strong>
            <span className="text-[11.5px] text-muted-foreground">{at ? at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""} · {event.actor || "system"}{event.role ? ` · ${String(event.role).split(",")[0]}` : ""}</span>
          </p>
          {event.changes.length ? (
            <p className="mt-0.5 flex flex-wrap gap-1.5">
              {event.changes.map((change) => (
                <span key={change.label} className="inline-flex flex-wrap items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[12px] tabular-nums">
                  <span className="text-muted-foreground">{change.label}</span>
                  {change.before ? <><span className="text-muted-foreground line-through decoration-signal-rose-ink/60">{change.before}</span><ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" /></> : null}
                  <strong>{change.after}</strong>
                </span>
              ))}
            </p>
          ) : null}
          {event.detail ? <p className="mt-0.5 text-muted-foreground">{event.detail}</p> : null}
          {event.reason ? <p className="mt-0.5"><span className="text-muted-foreground">Reason:</span> {event.reason}</p> : null}
          {event.card ? <button type="button" className="mt-0.5 text-[12px] font-semibold text-primary hover:underline" onClick={() => onOpen(event.card!.id)}>Open {event.card.no} <ArrowRight className="inline h-3 w-3" aria-hidden="true" /></button> : null}
        </div>
      </div>
    </li>
  )
}

// ── bulk ───────────────────────────────────────────────────────────────────

type BulkVerdict = { tone: "ok" | "no"; text: string }

function bulkVerdict(job: any, holdReason: (job: any) => string | null): BulkVerdict {
  if (!isOpenCard(job)) return { tone: "no", text: "Already closed: left as it is." }
  if (isBatchEntry(job.entry_model)) return { tone: "no", text: "Batch-entry card: left as it is. Close it short with Close stage on its card page." }
  if (!job.release_lot_id) return { tone: "no", text: "No sales release lot: left as it is." }
  const hold = holdReason(job)
  return { tone: "ok", text: `Closes at what is made (cancelled if nothing is made); the rest goes back to the order.${hold ? ` The hold stays recorded: ${hold}.` : ""}` }
}

function BulkCloseDialog({ open, rows: ticked, holdReason, onClose, onFinished }: { open: boolean; rows: any[]; holdReason: (job: any) => string | null; onClose: () => void; onFinished: (doneIds: string[]) => void }) {
  const [reason, setReason] = useState("")
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  // The cards as they were when the dialog opened: closed ones leave the ticked set, but the result stays readable.
  const [rows, setRows] = useState<any[]>([])
  const [eligible, setEligible] = useState<any[]>([])
  useEffect(() => {
    if (!open) return
    setReason(""); setResults({}); setRunning(false)
    setRows(ticked)
    setEligible(ticked.filter((job) => bulkVerdict(job, holdReason).tone === "ok"))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const finished = Object.keys(results).length > 0 && !running
  const run = async () => {
    setRunning(true)
    const next: Record<string, { ok: boolean; message: string }> = {}
    for (const job of eligible) {
      const id = String(job.id)
      try {
        const response = await productionApi.forceCloseJobCard(id, { reason: reason.trim() })
        const made = Number(response?.data?.made_qty || 0)
        const back = Number(response?.data?.returned_qty || 0)
        next[id] = { ok: true, message: response?.data?.close_mode === "CANCELLED" ? `Cancelled · ${fmt(back)} pcs back to the order` : `Closed at ${fmt(made)} pcs · ${fmt(back)} pcs back to the order` }
      } catch (error) {
        next[id] = { ok: false, message: `Not done: ${apiErrorText(error)}` }
      }
      setResults({ ...next })
    }
    setRunning(false)
    onFinished(Object.entries(next).filter(([, row]) => row.ok).map(([id]) => id))
  }
  const okCount = Object.values(results).filter((row) => row.ok).length
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !running) onClose() }}>
      <DialogContent className="max-w-2xl gap-3" data-testid="manager-bulk-close-dialog">
        <DialogHeader>
          <DialogTitle>Force close {eligible.length} of {rows.length} ticked card{rows.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>One reason for all. Each card closes at what is made (or is cancelled if nothing is made); the balance goes back to its sales order. Cards the rule does not allow are left as they are, with the reason.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[46dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border" data-testid="manager-bulk-close-list">
          {rows.map((job) => {
            const verdict = bulkVerdict(job, holdReason)
            const result = results[String(job.id)]
            return (
              <li key={job.id} className="flex items-start gap-3 px-3 py-2 text-[12.5px]">
                <span className="w-24 shrink-0 font-mono font-semibold">{jobCardRef(job)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{job.customer_name || "—"} · {fmt(job.planned_qty)} pcs · {stageWord(job.current_stage)}</span>
                  {result ? (
                    <span className={cn("block", result.ok ? "text-signal-emerald-ink" : "text-signal-rose-ink")}>{result.ok ? <Check className="mr-1 inline h-3 w-3" /> : <X className="mr-1 inline h-3 w-3" />}{result.message}</span>
                  ) : (
                    <span className={cn("block", verdict.tone === "no" ? "text-signal-amber-ink" : "text-muted-foreground")}>{verdict.tone === "no" ? <Lock className="mr-1 inline h-3 w-3" /> : null}{verdict.text}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {!finished ? (
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-muted-foreground">Reason (one for all) <span className="text-signal-rose-ink">*</span></span>
            <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. customer cancelled PO 0872F" disabled={running || eligible.length === 0} data-testid="manager-bulk-reason" />
          </label>
        ) : (
          <p className="text-[12.5px]" role="status">{okCount} of {eligible.length} closed.{eligible.length - okCount ? " The others were refused with the message shown." : ""}</p>
        )}
        <DialogFooter>
          {finished ? (
            <button type="button" className="erp-btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="erp-btn-secondary" onClick={onClose} disabled={running}>Cancel</button>
              <button type="button" className="erp-btn-primary !bg-signal-rose-ink !text-white hover:!opacity-90" disabled={running || reason.trim().length < 3 || eligible.length === 0} onClick={() => void run()} data-testid="manager-bulk-close-confirm">
                {running ? "Closing…" : eligible.length ? `Yes, force close ${eligible.length} card${eligible.length === 1 ? "" : "s"}` : "No card can be force closed"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkPrintDialog({ open, rows, onClose }: { open: boolean; rows: any[]; onClose: () => void }) {
  const openAll = () => {
    for (const job of rows) window.open(`/production/job-cards/${job.id}/print`, "_blank", "noopener")
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent className="max-w-md gap-3" data-testid="manager-bulk-print-dialog">
        <DialogHeader>
          <DialogTitle>Print {rows.length} card{rows.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Each card prints on its own A4 sheet. Open all at once (allow pop-ups), or one by one.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[46dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {rows.map((job) => (
            <li key={job.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
              <span className="w-24 shrink-0 font-mono font-semibold">{jobCardRef(job)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.customer_name || "—"} · {fmt(job.planned_qty)} pcs</span>
              <Link href={`/production/job-cards/${job.id}/print`} target="_blank" className="erp-btn-secondary !h-7 !px-2 text-[12px]"><Printer className="h-3.5 w-3.5" />Print</Link>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <button type="button" className="erp-btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="erp-btn-primary" onClick={openAll} data-testid="manager-bulk-print-all"><Printer className="h-4 w-4" />Open all {rows.length}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
