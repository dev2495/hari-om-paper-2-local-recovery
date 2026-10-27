"use client"

import { Bookmark, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import { useCreatePlannerView, useDeletePlannerView, usePlannerViews, type PlannerView } from "@/hooks/use-planner-views"
import { describeApiError } from "@/lib/api-error"

/**
 * Saved views for a list page (key "ORDERS" / "JOB_CARDS"): a select with the saved filter sets,
 * "+ Save current view…" and "Manage views…". The filters are the page's own JSON; the page applies
 * them. Personal views are the user's own, plant views are shared with everyone on the plant.
 */
export function SavedViewsSelect({ viewKey, plantId, filters, isDefault, defaultLabel, onApply, onReset, testId }: {
  viewKey: string
  plantId?: string
  filters: Record<string, unknown>
  isDefault: boolean
  defaultLabel: string
  onApply: (filters: Record<string, unknown>, view: PlannerView) => void
  onReset: () => void
  testId?: string
}) {
  const { showToast } = useApp()
  const viewsQuery = usePlannerViews(viewKey, plantId)
  const createView = useCreatePlannerView()
  const deleteView = useDeletePlannerView()
  const views: PlannerView[] = Array.isArray(viewsQuery.data) ? viewsQuery.data : []
  const [activeId, setActiveId] = useState<string>("")
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"PERSONAL" | "PLANT">("PERSONAL")

  // Changing the filters by hand leaves the saved view (key order does not matter).
  const activeView = views.find((view) => view.id === activeId)
  const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as object).sort().map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value ?? null)
  const same = activeView ? stable(activeView.filters) === stable(filters) : false
  const value = isDefault ? "default" : same ? activeId : "custom"

  useEffect(() => {
    if (dialog === "save") { setName(""); setScope("PERSONAL") }
  }, [dialog])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { showToast("Give the view a name.", "error"); return }
    try {
      const view = await createView.mutateAsync({ name: trimmed, scope, stage: viewKey, filters })
      setActiveId(view.id)
      setDialog(null)
      showToast(`View "${trimmed}" saved.`, "success")
    } catch (error) {
      showToast(describeApiError(error, "The view could not be saved."), "error")
    }
  }

  const remove = async (view: PlannerView) => {
    try {
      await deleteView.mutateAsync(view.id)
      if (activeId === view.id) { setActiveId(""); onReset() }
      showToast(`View "${view.name}" removed.`, "success")
    } catch (error) {
      showToast(describeApiError(error, "The view could not be removed."), "error")
    }
  }

  return (
    <>
      <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card pl-2.5 text-[13px]">
        <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Saved view</span>
        <select
          data-testid={testId}
          value={value}
          onChange={(event) => {
            const next = event.target.value
            if (next === "default") { setActiveId(""); onReset(); return }
            if (next === "save") { setDialog("save"); return }
            if (next === "manage") { setDialog("manage"); return }
            if (next === "custom") return
            const view = views.find((row) => row.id === next)
            if (view) { setActiveId(view.id); onApply(view.filters || {}, view) }
          }}
          className="h-full max-w-[220px] bg-transparent pr-2 text-[13px] font-medium text-foreground outline-none"
        >
          <option value="default">View: {defaultLabel}</option>
          {value === "custom" ? <option value="custom">View: custom filters</option> : null}
          {views.map((view) => <option key={view.id} value={view.id}>View: {view.name}{view.scope === "PLANT" ? " (plant)" : ""}</option>)}
          <option value="save">+ Save current view…</option>
          {views.length ? <option value="manage">Manage views…</option> : null}
        </select>
      </label>

      <Dialog open={dialog === "save"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
        <DialogContent className="sm:max-w-sm" data-testid={testId ? `${testId}-save` : undefined}>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>The status tab, KPI tile, search and filters as they are now.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-[13px] font-medium">
            Name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Due this week · WPL" className="h-10 rounded-lg border border-input bg-card px-3 text-[13px] font-normal" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save() } }} />
          </label>
          <div className="tube-segment" role="group" aria-label="Who sees this view">
            <button type="button" aria-pressed={scope === "PERSONAL"} onClick={() => setScope("PERSONAL")}>Only me</button>
            <button type="button" aria-pressed={scope === "PLANT"} onClick={() => setScope("PLANT")}>Everyone on the plant</button>
          </div>
          <DialogFooter>
            <button type="button" className="erp-btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
            <button type="button" className="erp-btn-primary" disabled={createView.isPending} onClick={() => void save()}>{createView.isPending ? "Saving…" : "Save view"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "manage"} onOpenChange={(open) => { if (!open) setDialog(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Saved views</DialogTitle>
            <DialogDescription>Remove views you no longer use. Plant views can be removed by whoever made them, plant heads and owners.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {views.map((view) => (
              <li key={view.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{view.name}<span className="ml-1.5 text-[11px] text-muted-foreground">{view.scope === "PLANT" ? "plant" : "only me"}{view.owner_name && !view.mine ? ` · ${view.owner_name}` : ""}</span></span>
                <button type="button" aria-label={`Remove view ${view.name}`} disabled={!view.can_edit || deleteView.isPending} onClick={() => void remove(view)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button type="button" className="erp-btn-secondary" onClick={() => setDialog(null)}>Close</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
