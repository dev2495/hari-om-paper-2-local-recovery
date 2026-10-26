"use client"

import { Bookmark, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { useId, useMemo } from "react"

import type { PlannerView } from "@/hooks/use-planner-views"
import {
  QUICK_BADGES,
  SORT_OPTIONS,
  activeQuickBadge,
  describeQueueFilters,
  type QueueFilters,
  type QueueSort,
  type QuickBadgeKey,
} from "@/lib/planner-queue-filters"
import { cn } from "@/lib/utils"

const fmt = (value: number) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })

export type QueueDialogMode = { kind: "filters" } | { kind: "new" } | { kind: "edit"; view: PlannerView } | { kind: "manage" }

export type QueueSelection = {
  count: number
  pcs: number
  /** Cards in the current filter that can be selected (locked cards cannot). */
  selectable: number
  onSelectAll: () => void
  onClear: () => void
}

/**
 * Header of the open queue (board and month calendar): search, sort, quick badges, saved views,
 * removable filter chips, the "12 of 40" count, and select-all / the selection bar.
 */
export function QueueFilterBar({
  filters,
  onFilters,
  total,
  visible,
  visiblePcs,
  hiddenWaiting,
  quickCounts,
  views,
  activeViewId,
  onQuick,
  onApplyView,
  onOpenDialog,
  machineLabel,
  selection,
  hint,
}: {
  filters: QueueFilters
  onFilters: (next: QueueFilters) => void
  total: number
  visible: number
  visiblePcs: number
  hiddenWaiting: number
  quickCounts: Record<QuickBadgeKey, number>
  views: PlannerView[]
  activeViewId: string | null
  onQuick: (key: QuickBadgeKey) => void
  onApplyView: (view: PlannerView) => void
  onOpenDialog: (mode: QueueDialogMode) => void
  machineLabel: (id: string) => string
  selection: QueueSelection
  hint?: string
}) {
  const searchId = useId()
  const chips = useMemo(() => describeQueueFilters(filters, { machine: machineLabel }), [filters, machineLabel])
  const quick = activeViewId ? null : activeQuickBadge(filters)
  const allSelected = selection.selectable > 0 && selection.count >= selection.selectable
  const badgeClass = (active: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
    )

  return (
    <div className="shrink-0 border-b border-border p-2.5" data-testid="planner-queue-filters">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Open queue</h2>
        <span className="text-[11.5px] tabular-nums text-muted-foreground" data-testid="planner-queue-count">
          {visible === total ? `${fmt(total)} cards` : `${fmt(visible)} of ${fmt(total)} cards`} · {fmt(visiblePcs)} pcs
        </span>
      </div>

      <div className="mt-2 flex gap-1.5">
        <label htmlFor={searchId} className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-input bg-card px-2 focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            id={searchId}
            aria-label="Search queue"
            value={filters.search}
            onChange={(event) => onFilters({ ...filters, search: event.target.value })}
            placeholder="Card, customer, code, order, size, colour"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            data-testid="planner-queue-search"
          />
          {filters.search ? (
            <button type="button" aria-label="Clear search" onClick={() => onFilters({ ...filters, search: "" })} className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>
        <select
          aria-label="Sort queue"
          value={filters.sort}
          onChange={(event) => onFilters({ ...filters, sort: event.target.value as QueueSort })}
          className="h-8 max-w-[7.5rem] rounded-lg border border-input bg-card px-1.5 text-[12px]"
          data-testid="planner-queue-sort"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Queue views">
        {QUICK_BADGES.map((badge) => (
          <button
            key={badge.key}
            type="button"
            aria-pressed={quick === badge.key}
            onClick={() => onQuick(badge.key)}
            className={badgeClass(quick === badge.key)}
            data-testid={`planner-quick:${badge.key}`}
          >
            {badge.label} <span className="tabular-nums opacity-75">{fmt(quickCounts[badge.key] || 0)}</span>
          </button>
        ))}
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={activeViewId === view.id}
            onClick={() => onApplyView(view)}
            title={`${view.scope === "PLANT" ? "Everyone in this plant" : "Only me"} · ${view.stage ? "this stage" : "all stages"}${view.owner_name && !view.mine ? ` · by ${view.owner_name}` : ""}`}
            className={cn(badgeClass(activeViewId === view.id), "max-w-[11rem]")}
            data-testid={`planner-view-badge:${view.id}`}
          >
            <Bookmark className="h-3 w-3 shrink-0 opacity-80" />
            <span className="truncate">{view.name}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOpenDialog({ kind: "new" })}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[11.5px] font-medium text-muted-foreground hover:border-primary/60 hover:text-foreground"
          title="Save the current filters as a view"
          data-testid="planner-view-new"
        >
          <Plus className="h-3 w-3" />View
        </button>
        <button
          type="button"
          onClick={() => onOpenDialog({ kind: "filters" })}
          aria-label={chips.length ? `Filters, ${chips.length} active` : "Filters"}
          title="All filters, sort and saved views"
          className={cn(
            "relative ml-auto inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors",
            chips.length ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
          data-testid="planner-queue-filters-open"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters{chips.length ? <span className="tabular-nums">{chips.length}</span> : null}
        </button>
      </div>

      {chips.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="planner-filter-chips">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-primary/10 pl-2 pr-1 text-[11px] font-medium text-primary" data-testid={`planner-filter-chip:${chip.key}`}>
              <span className="truncate">{chip.label}</span>
              <button type="button" aria-label={`Remove filter ${chip.label}`} onClick={() => onFilters(chip.clear(filters))} className="grid h-4 w-4 place-items-center rounded hover:bg-primary/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onQuick("all")} className="h-6 px-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground" data-testid="planner-filter-clear">
            Clear all
          </button>
        </div>
      ) : null}

      {hiddenWaiting > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {fmt(hiddenWaiting)} waiting {hiddenWaiting === 1 ? "card is" : "cards are"} hidden.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onFilters({ ...filters, show_waiting: true })}>Show</button>
        </p>
      ) : null}

      {selection.count > 0 ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-[11.5px] font-semibold text-primary animate-scale-in" data-testid="planner-selection-bar">
          <input
            type="checkbox"
            aria-label={allSelected ? "Clear selection" : "Select every card in this filter"}
            checked={allSelected}
            ref={(node) => { if (node) node.indeterminate = !allSelected && selection.count > 0 }}
            onChange={() => (allSelected ? selection.onClear() : selection.onSelectAll())}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="min-w-0 flex-1 truncate">
            {fmt(selection.count)} {selection.count === 1 ? "card" : "cards"} selected · {fmt(selection.pcs)} pcs
          </span>
          <button type="button" onClick={selection.onClear} className="rounded px-1.5 py-0.5 hover:bg-primary/15" data-testid="planner-selection-clear">Clear</button>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <label className={cn("inline-flex items-center gap-1.5", selection.selectable ? "cursor-pointer" : "opacity-60")}>
            <input
              type="checkbox"
              checked={false}
              disabled={!selection.selectable}
              onChange={selection.onSelectAll}
              aria-label="Select every card in this filter"
              className="h-3.5 w-3.5 accent-primary"
              data-testid="planner-select-all"
            />
            Select all {selection.selectable ? fmt(selection.selectable) : ""}
          </label>
          <span className="truncate">{hint || "Drag selected cards together"}</span>
        </div>
      )}
    </div>
  )
}
