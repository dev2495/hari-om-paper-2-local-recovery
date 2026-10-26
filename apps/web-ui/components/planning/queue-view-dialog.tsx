"use client"

import { ArrowDown, ArrowUp, Bookmark, Lock, Pencil, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useCreatePlannerView, useDeletePlannerView, useUpdatePlannerView, type PlannerView } from "@/hooks/use-planner-views"
import { describeApiError } from "@/lib/api-error"
import {
  DUE_OPTIONS,
  FLAG_OPTIONS,
  SORT_OPTIONS,
  describeQueueFilters,
  normalizeQueueFilters,
  type QueueDue,
  type QueueFilters,
  type QueueFlag,
  type QueueSort,
} from "@/lib/planner-queue-filters"
import { cn } from "@/lib/utils"

import type { QueueDialogMode } from "./queue-filter-bar"

export type QueueFilterOptions = {
  machines: Array<{ id: string; label: string }>
  customers: string[]
  customerCodes: Map<string, string>
  colours: string[]
  sizes: string[]
}

const STAGE_LABEL: Record<string, string> = { WINDER: "Winder", OVEN: "Oven", PROCESS: "Process", SLITTING: "Slitting" }

function CheckList({
  label,
  options,
  selected,
  onChange,
  empty,
  testId,
}: {
  label: string
  options: Array<{ value: string; label: string; hint?: string }>
  selected: string[]
  onChange: (next: string[]) => void
  empty: string
  testId: string
}) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  const stale = selected.filter((value) => !options.some((option) => option.value === value))
  return (
    <fieldset className="min-w-0" data-testid={testId}>
      <legend className="flex w-full items-baseline justify-between text-[12px] font-semibold text-muted-foreground">
        <span>{label}</span>
        {selected.length ? (
          <button type="button" onClick={() => onChange([])} className="text-[11px] font-semibold text-primary hover:underline">Any</button>
        ) : (
          <span className="text-[11px] font-normal">any</span>
        )}
      </legend>
      <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
        {options.length === 0 && stale.length === 0 ? <p className="px-1 py-2 text-[11.5px] text-muted-foreground">{empty}</p> : null}
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] hover:bg-muted">
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} className="h-3.5 w-3.5 shrink-0 accent-primary" />
            <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
            {option.hint ? <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{option.hint}</span> : null}
          </label>
        ))}
        {stale.map((value) => (
          <label key={`stale:${value}`} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] text-muted-foreground hover:bg-muted" title="Not in the queue right now; kept from the saved view">
            <input type="checkbox" checked onChange={() => toggle(value)} className="h-3.5 w-3.5 shrink-0 accent-primary" />
            <span className="min-w-0 flex-1 truncate">{value}</span>
            <span className="shrink-0 text-[10px]">not in queue</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * The pop-up behind "Filters", "+ View" and the view badges: every filter and the sort, a name,
 * "Only me" / "Everyone in this plant", "This stage" / "All stages", and a list to manage saved views.
 */
export function QueueViewDialog({
  mode,
  onClose,
  filters,
  onApply,
  onApplyView,
  onViewSaved,
  options,
  stage,
  views,
  machineLabel,
}: {
  mode: QueueDialogMode | null
  onClose: () => void
  filters: QueueFilters
  onApply: (next: QueueFilters) => void
  onApplyView: (view: PlannerView) => void
  /** After a create/update the workspace marks the view active and remembers it. */
  onViewSaved: (view: PlannerView, filters: QueueFilters) => void
  options: QueueFilterOptions
  stage: string
  views: PlannerView[]
  machineLabel: (id: string) => string
}) {
  const { showToast } = useApp()
  const createView = useCreatePlannerView()
  const updateView = useUpdatePlannerView()
  const deleteView = useDeletePlannerView()
  const [tab, setTab] = useState<"filter" | "views">("filter")
  const [draft, setDraft] = useState<QueueFilters>(filters)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"PERSONAL" | "PLANT">("PERSONAL")
  const [stageScope, setStageScope] = useState<"stage" | "all">("stage")
  const [saveOpen, setSaveOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState<PlannerView | null>(null)
  const open = Boolean(mode)
  const busy = createView.isPending || updateView.isPending || deleteView.isPending

  // Start from the current filters (or the view being edited) every time the pop-up opens.
  useEffect(() => {
    if (!mode) return
    const view = mode.kind === "edit" ? mode.view : null
    setEditing(view)
    setDraft(view ? normalizeQueueFilters(view.filters) : normalizeQueueFilters(filters))
    setName(view?.name || "")
    setScope(view?.scope || "PERSONAL")
    setStageScope(view ? (view.stage ? "stage" : "all") : "stage")
    setSaveOpen(mode.kind === "new" || mode.kind === "edit")
    setTab(mode.kind === "manage" ? "views" : "filter")
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const readOnly = Boolean(editing && !editing.can_edit)
  const stageLabel = STAGE_LABEL[stage] || stage
  const chipCount = useMemo(() => describeQueueFilters(draft, { machine: machineLabel }).length, [draft, machineLabel])
  const set = <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const numberOrNull = (value: string) => (value.trim() === "" || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value)))

  const startEdit = (view: PlannerView) => {
    setEditing(view)
    setDraft(normalizeQueueFilters(view.filters))
    setName(view.name)
    setScope(view.scope)
    setStageScope(view.stage ? "stage" : "all")
    setSaveOpen(true)
    setConfirmDelete(false)
    setTab("filter")
  }

  const payload = () => ({
    name: name.trim(),
    scope,
    stage: stageScope === "stage" ? stage : null,
    filters: normalizeQueueFilters(draft) as unknown as Record<string, unknown>,
  })

  const save = async () => {
    if (!name.trim()) {
      showToast("Give the view a name.", "error")
      return
    }
    try {
      const clean = normalizeQueueFilters(draft)
      const saved = editing
        ? await updateView.mutateAsync({ id: editing.id, position: editing.position, ...payload() })
        : await createView.mutateAsync(payload())
      showToast(editing ? `View "${saved.name}" updated.` : `View "${saved.name}" saved.`, "success")
      onViewSaved(saved, clean)
      onClose()
    } catch (error) {
      showToast(describeApiError(error, "Could not save the view."), "error")
    }
  }

  const remove = async (view: PlannerView) => {
    try {
      await deleteView.mutateAsync(view.id)
      showToast(`View "${view.name}" deleted.`, "success")
      if (editing?.id === view.id) onClose()
    } catch (error) {
      showToast(describeApiError(error, "Could not delete the view."), "error")
    }
  }

  const move = async (view: PlannerView, direction: -1 | 1) => {
    const editable = views.filter((row) => row.can_edit)
    const index = editable.findIndex((row) => row.id === view.id)
    const swapWith = editable[index + direction]
    if (index < 0 || !swapWith) return
    const reordered = [...editable]
    reordered[index] = swapWith
    reordered[index + direction] = view
    try {
      for (const [position, row] of reordered.entries()) {
        if (row.position !== position + 1) {
          await updateView.mutateAsync({ id: row.id, name: row.name, scope: row.scope, stage: row.stage, filters: row.filters, position: position + 1 })
        }
      }
    } catch (error) {
      showToast(describeApiError(error, "Could not reorder the views."), "error")
    }
  }

  const title = tab === "views" ? "Saved views" : editing ? (readOnly ? `View: ${editing.name}` : `Edit view: ${editing.name}`) : mode?.kind === "new" ? "New view" : "Queue filters"

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl gap-3" data-testid="planner-view-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {tab === "views"
              ? "One click on a badge applies a view. Views for everyone in the plant can only be changed by the person who made them or a plant head."
              : readOnly
                ? `Made by ${editing?.owner_name || "a colleague"} for everyone in this plant. You can apply it; only they or a plant head can change it.`
                : "Pick what the queue should show. Apply it now, or save it as a view to get a badge next to All, Due ≤3d and Overdue."}
          </DialogDescription>
        </DialogHeader>

        <div className="tube-segment !h-9 w-fit" role="tablist" aria-label="Filters or saved views">
          <button type="button" role="tab" aria-selected={tab === "filter"} onClick={() => setTab("filter")}>Filters{chipCount ? ` · ${chipCount}` : ""}</button>
          <button type="button" role="tab" aria-selected={tab === "views"} onClick={() => setTab("views")} data-testid="planner-view-tab-views">Saved views · {views.length}</button>
        </div>

        {tab === "filter" ? (
          <div className="max-h-[62dvh] space-y-3 overflow-y-auto pr-1" data-testid="planner-view-filters">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Search</span>
                <input
                  value={draft.search}
                  disabled={readOnly}
                  onChange={(event) => set("search", event.target.value)}
                  placeholder="Card, customer, code, order, PO, size, colour"
                  className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] disabled:opacity-60"
                  data-testid="planner-view-search"
                />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Sort</span>
                <select value={draft.sort} disabled={readOnly} onChange={(event) => set("sort", event.target.value as QueueSort)} className="h-9 w-full rounded-lg border border-input bg-card px-2 text-[13px] disabled:opacity-60">
                  {SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <fieldset>
              <legend className="text-[12px] font-semibold text-muted-foreground">Due</legend>
              <div className="mt-1 flex flex-wrap gap-1" data-testid="planner-view-due">
                {DUE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={draft.due === option.key}
                    onClick={() => set("due", option.key as QueueDue)}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-60",
                      draft.due === option.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {draft.due === "custom" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <label className="flex items-center gap-1.5">From<input type="date" value={draft.due_from || ""} disabled={readOnly} onChange={(event) => set("due_from", event.target.value || null)} className="h-8 rounded-lg border border-input bg-card px-2 text-[12px]" /></label>
                  <label className="flex items-center gap-1.5">To<input type="date" value={draft.due_to || ""} disabled={readOnly} onChange={(event) => set("due_to", event.target.value || null)} className="h-8 rounded-lg border border-input bg-card px-2 text-[12px]" /></label>
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <CheckList
                label={stage === "WINDER" ? "Release winder" : "Machine"}
                options={options.machines.map((machine) => ({ value: machine.id, label: machine.label }))}
                selected={draft.machines}
                onChange={(next) => !readOnly && set("machines", next)}
                empty="No machines for this stage."
                testId="planner-view-machines"
              />
              <CheckList
                label="Customer"
                options={options.customers.map((customer) => ({ value: customer, label: customer, hint: options.customerCodes.get(customer) || undefined }))}
                selected={draft.customers}
                onChange={(next) => !readOnly && set("customers", next)}
                empty="No customers in the queue."
                testId="planner-view-customers"
              />
              <CheckList
                label="Colour"
                options={options.colours.map((colour) => ({ value: colour, label: colour }))}
                selected={draft.colours}
                onChange={(next) => !readOnly && set("colours", next)}
                empty="No colours in the queue."
                testId="planner-view-colours"
              />
              <CheckList
                label="Size"
                options={options.sizes.map((size) => ({ value: size, label: size }))}
                selected={draft.sizes}
                onChange={(next) => !readOnly && set("sizes", next)}
                empty="No sizes in the queue."
                testId="planner-view-sizes"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset>
                <legend className="text-[12px] font-semibold text-muted-foreground">Quantity (pcs)</legend>
                <div className="mt-1 flex items-center gap-2">
                  <input type="number" min={0} inputMode="numeric" placeholder="From" aria-label="Minimum quantity" value={draft.qty_min ?? ""} disabled={readOnly} onChange={(event) => set("qty_min", numberOrNull(event.target.value))} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] disabled:opacity-60" data-testid="planner-view-qty-min" />
                  <span className="text-muted-foreground">–</span>
                  <input type="number" min={0} inputMode="numeric" placeholder="To" aria-label="Maximum quantity" value={draft.qty_max ?? ""} disabled={readOnly} onChange={(event) => set("qty_max", numberOrNull(event.target.value))} className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px] disabled:opacity-60" data-testid="planner-view-qty-max" />
                </div>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12.5px]">
                  <input type="checkbox" checked={draft.show_waiting} disabled={readOnly} onChange={(event) => set("show_waiting", event.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" data-testid="planner-view-show-waiting" />
                  <span>
                    Show cards waiting for the previous plan
                    <span className="block text-[11px] text-muted-foreground">They sit at the bottom with a lock and cannot be placed yet.</span>
                  </span>
                </label>
              </fieldset>
              <fieldset>
                <legend className="text-[12px] font-semibold text-muted-foreground">Only cards that are</legend>
                <div className="mt-1 space-y-0.5 rounded-lg border border-border bg-card p-1.5" data-testid="planner-view-flags">
                  {FLAG_OPTIONS.map((option) => (
                    <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] hover:bg-muted" title={option.hint}>
                      <input
                        type="checkbox"
                        checked={draft.flags.includes(option.key)}
                        disabled={readOnly}
                        onChange={() => set("flags", draft.flags.includes(option.key) ? draft.flags.filter((flag) => flag !== option.key) : ([...draft.flags, option.key] as QueueFlag[]))}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="flex-1">{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            {!readOnly ? (
              <div className="rounded-xl border border-border bg-muted/40 p-3" data-testid="planner-view-save">
                {!saveOpen ? (
                  <button type="button" onClick={() => setSaveOpen(true)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline" data-testid="planner-view-save-open">
                    <Bookmark className="h-3.5 w-3.5" />Save these filters as a view
                  </button>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <label className="min-w-0 space-y-1">
                      <span className="text-[12px] font-semibold text-muted-foreground">View name</span>
                      <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. Winder 2 this week" className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]" data-testid="planner-view-name" />
                    </label>
                    <fieldset>
                      <legend className="text-[12px] font-semibold text-muted-foreground">Who sees it</legend>
                      <div className="tube-segment mt-1 !h-9" role="radiogroup">
                        <button type="button" role="radio" aria-checked={scope === "PERSONAL"} data-state={scope === "PERSONAL" ? "active" : undefined} onClick={() => setScope("PERSONAL")} data-testid="planner-view-scope-personal">Only me</button>
                        <button type="button" role="radio" aria-checked={scope === "PLANT"} data-state={scope === "PLANT" ? "active" : undefined} onClick={() => setScope("PLANT")} data-testid="planner-view-scope-plant">Everyone in this plant</button>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="text-[12px] font-semibold text-muted-foreground">Where</legend>
                      <div className="tube-segment mt-1 !h-9" role="radiogroup">
                        <button type="button" role="radio" aria-checked={stageScope === "stage"} data-state={stageScope === "stage" ? "active" : undefined} onClick={() => setStageScope("stage")}>This stage ({stageLabel})</button>
                        <button type="button" role="radio" aria-checked={stageScope === "all"} data-state={stageScope === "all" ? "active" : undefined} onClick={() => setStageScope("all")}>All stages</button>
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="max-h-[62dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border" data-testid="planner-view-list">
            {views.length === 0 ? <li className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">No saved views yet. Set filters on the first tab and save them as a view.</li> : null}
            {views.map((view, index) => (
              <li key={view.id} className="flex items-center gap-2 px-3 py-2" data-testid={`planner-view-row:${view.id}`}>
                <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{view.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {view.scope === "PLANT" ? "Everyone in this plant" : "Only me"} · {view.stage ? `${STAGE_LABEL[view.stage] || view.stage} only` : "All stages"}
                    {!view.mine && view.owner_name ? ` · by ${view.owner_name}` : ""}
                    {!view.can_edit ? " · read-only" : ""}
                  </p>
                </div>
                <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={() => { onApplyView(view); onClose() }}>Apply</button>
                {view.can_edit ? (
                  <>
                    <button type="button" className="tube-icon-button !h-8 !w-8" aria-label={`Edit view ${view.name}`} title="Edit or rename" onClick={() => startEdit(view)}><Pencil size={14} /></button>
                    <button type="button" className="tube-icon-button !h-8 !w-8" aria-label={`Move view ${view.name} up`} disabled={busy || index === 0} onClick={() => void move(view, -1)}><ArrowUp size={14} /></button>
                    <button type="button" className="tube-icon-button !h-8 !w-8" aria-label={`Move view ${view.name} down`} disabled={busy || index === views.length - 1} onClick={() => void move(view, 1)}><ArrowDown size={14} /></button>
                    <button type="button" className="tube-icon-button !h-8 !w-8 hover:!text-signal-rose-ink" aria-label={`Delete view ${view.name}`} disabled={busy} onClick={() => { if (window.confirm(`Delete the view "${view.name}"?`)) void remove(view) }}><Trash2 size={14} /></button>
                  </>
                ) : (
                  <span className="grid h-8 w-8 place-items-center text-muted-foreground" title="Only the person who made it or a plant head can change it"><Lock size={14} /></span>
                )}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
            {editing && editing.can_edit && tab === "filter" ? (
              confirmDelete ? (
                <>
                  <span className="text-[12px] text-muted-foreground">Delete this view{editing.scope === "PLANT" ? " for everyone" : ""}?</span>
                  <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px] !text-signal-rose-ink" disabled={busy} onClick={() => void remove(editing)}>Yes, delete</button>
                  <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={() => setConfirmDelete(true)} data-testid="planner-view-delete">
                  <Trash2 className="h-3.5 w-3.5" />Delete view
                </button>
              )
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" className="erp-btn-secondary" onClick={onClose}>Cancel</button>
            {tab === "filter" ? (
              <button type="button" className={saveOpen && !readOnly ? "erp-btn-secondary" : "erp-btn-primary"} onClick={() => { onApply(normalizeQueueFilters(draft)); onClose() }} data-testid="planner-view-apply">
                Apply filters
              </button>
            ) : null}
            {tab === "filter" && saveOpen && !readOnly ? (
              <button type="button" className="erp-btn-primary" disabled={busy} onClick={() => void save()} data-testid="planner-view-save-submit">
                {editing ? "Save changes" : "Save view"}
              </button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
