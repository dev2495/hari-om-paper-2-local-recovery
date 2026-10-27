"use client"

import { useEffect, useRef, useState } from "react"
import { Bookmark, BookmarkPlus, Check, ChevronDown, Lock, Trash2 } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useCreatePlannerView, useDeletePlannerView, usePlannerViews, type PlannerView } from "@/hooks/use-planner-views"
import { describeApiError } from "@/lib/api-error"
import { cn } from "@/lib/utils"

/**
 * Saved views for a list page (client 2026-10-27): the same planner views API with a page key
 * ("JOB_CARDS", "ORDERS") instead of a stage. One click applies a view; the current filters can be
 * saved for me or for everyone in the plant.
 */
export function SavedViewsMenu({
  viewKey,
  current,
  activeViewId,
  onApply,
  onClearActive,
  summary,
  testId = "saved-views",
}: {
  viewKey: string
  /** The filters as they are now, saved verbatim. */
  current: Record<string, unknown>
  activeViewId: string | null
  onApply: (view: PlannerView) => void
  onClearActive: () => void
  /** One line describing the current filters, shown next to "Save". */
  summary: string
  testId?: string
}) {
  const { showToast } = useApp()
  const viewsQuery = usePlannerViews(viewKey)
  const createView = useCreatePlannerView()
  const deleteView = useDeletePlannerView()
  const views = Array.isArray(viewsQuery.data) ? viewsQuery.data : []
  const active = views.find((view) => view.id === activeViewId) || null
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"PERSONAL" | "PLANT">("PERSONAL")
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const save = async () => {
    if (!name.trim()) {
      showToast("Give the view a name.", "error")
      return
    }
    try {
      const saved = await createView.mutateAsync({ name: name.trim(), scope, stage: viewKey, filters: current })
      showToast(`View "${saved.name}" saved.`, "success")
      setName("")
      setSaving(false)
      onApply(saved)
      setOpen(false)
    } catch (error) {
      showToast(describeApiError(error, "Could not save the view."), "error")
    }
  }

  const remove = async (view: PlannerView) => {
    if (!window.confirm(`Delete the view "${view.name}"?`)) return
    try {
      await deleteView.mutateAsync(view.id)
      if (view.id === activeViewId) onClearActive()
      showToast(`View "${view.name}" deleted.`, "success")
    } catch (error) {
      showToast(describeApiError(error, "Could not delete the view."), "error")
    }
  }

  return (
    <div ref={root} className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("inline-flex h-9 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold", active ? "border-primary/40 bg-primary/10 text-primary" : "border-input bg-card text-foreground hover:bg-muted")}
        data-testid={`${testId}-trigger`}
      >
        <Bookmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">View: {active ? active.name : "All cards"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="Saved views" className="tube-popover right-0 top-full mt-1.5 w-80 !p-2">
          <button type="button" role="menuitem" onClick={() => { onClearActive(); setOpen(false) }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[.05]", !active && "font-semibold")}>
            {!active ? <Check className="h-3.5 w-3.5 text-primary" /> : <span className="w-3.5" />}
            All cards
          </button>
          {viewsQuery.isLoading ? <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading views…</p> : null}
          {views.map((view) => (
            <div key={view.id} className="flex items-center gap-1" data-testid={`${testId}-row`}>
              <button type="button" role="menuitem" onClick={() => { onApply(view); setOpen(false) }} className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[.05]", view.id === activeViewId && "font-semibold")}>
                {view.id === activeViewId ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : <span className="w-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{view.scope === "PLANT" ? "everyone" : "me"}</span>
              </button>
              {view.can_edit ? (
                <button type="button" className="tube-icon-button !h-7 !w-7 hover:!text-signal-rose-ink" aria-label={`Delete view ${view.name}`} onClick={() => void remove(view)} disabled={deleteView.isPending}><Trash2 size={13} /></button>
              ) : (
                <span className="grid h-7 w-7 place-items-center text-muted-foreground" title={`By ${view.owner_name || "a colleague"} for everyone; only they or the plant head can change it`}><Lock size={13} /></span>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-border pt-2">
            {!saving ? (
              <button type="button" role="menuitem" onClick={() => setSaving(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] font-semibold text-primary hover:bg-foreground/[.05]" data-testid={`${testId}-save-open`}>
                <BookmarkPlus className="h-3.5 w-3.5" />Save current filters as a view
              </button>
            ) : (
              <div className="space-y-2 px-1">
                <p className="text-[11.5px] text-muted-foreground">{summary || "No filters set: the view shows every card."}</p>
                <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="View name, e.g. Winding this week" className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-[13px]" data-testid={`${testId}-name`} autoFocus />
                <div className="tube-segment !h-9 w-full" role="radiogroup" aria-label="Who sees it">
                  <button type="button" role="radio" aria-checked={scope === "PERSONAL"} data-state={scope === "PERSONAL" ? "active" : undefined} onClick={() => setScope("PERSONAL")} className="flex-1 justify-center">Only me</button>
                  <button type="button" role="radio" aria-checked={scope === "PLANT"} data-state={scope === "PLANT" ? "active" : undefined} onClick={() => setScope("PLANT")} className="flex-1 justify-center">Everyone in this plant</button>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="erp-btn-secondary !h-8 !px-2.5 text-[12px]" onClick={() => setSaving(false)}>Cancel</button>
                  <button type="button" className="erp-btn-primary !h-8 !px-2.5 text-[12px]" disabled={createView.isPending} onClick={() => void save()} data-testid={`${testId}-save`}>Save view</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
