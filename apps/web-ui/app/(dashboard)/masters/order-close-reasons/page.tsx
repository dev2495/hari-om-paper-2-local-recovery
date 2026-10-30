"use client"

import Link from "next/link"
import { Ban, Check, CircleSlash2, PauseCircle, Pencil, Plus, RotateCcw, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { EmptyState } from "@/components/erp/shell"
import { MastersNav } from "@/components/master/masters-nav"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { closeReasonNeedsNote } from "@/components/sales/order-closure-dialog"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { apiErrorText } from "@/hooks/use-lifecycle"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Order close reasons (client 2026-10-28): the reasons offered when a sales order is cancelled,
 * short-closed or put on customer hold. Owner and Admin add, rename, deactivate and reactivate them.
 * The code never changes once made, because closed orders keep it; renaming changes the name only.
 * Stored as Masters › Reason codes, category SO_CLOSE (the close dialogs read that list).
 */
type CloseReason = { id: string; code: string; label: string; description?: string | null; is_active?: boolean; active?: boolean }

const isActive = (row: CloseReason) => row.is_active !== false && row.active !== false
const needsNote = closeReasonNeedsNote
const QUERY_KEY = ["sales", "order-close-reasons"]

function codeFromName(name: string) {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug ? `SO-${slug}`.slice(0, 40).replace(/-+$/, "") : ""
}

export default function OrderCloseReasonsPage() {
  const { showToast } = useApp()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean).map((role) => String(role)))
  const canEdit = roles.has("Owner") || roles.has("Admin")
  const [show, setShow] = useState<"active" | "inactive" | "all">("active")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [codeTouched, setCodeTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const reasons = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => ((await api.get("/api/sales/order-close-reasons")).data || []) as CloseReason[],
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    // The cancel / short close / hold dialogs read the same list.
    void queryClient.invalidateQueries({ queryKey: ["reason-codes"] })
  }

  const create = useMutation({
    mutationFn: async () => (await api.post("/api/sales/order-close-reasons", { label: name.trim(), code: (codeTouched ? code : codeFromName(name)).trim().toUpperCase(), description: description.trim() || null })).data,
    onSuccess: (row: CloseReason) => {
      refresh()
      setName(""); setCode(""); setCodeTouched(false); setDescription(""); setFormError(null)
      showToast(`Added "${row?.label || "reason"}". It now shows in cancel, short close and hold.`, "success")
    },
    onError: (error) => setFormError(apiErrorText(error, "The reason was not added.")),
  })
  const rename = useMutation({
    mutationFn: async (id: string) => (await api.put(`/api/sales/order-close-reasons/${id}`, { label: editName.trim(), description: editDescription.trim() || null })).data,
    onSuccess: () => { refresh(); setEditingId(null); setEditError(null); showToast("Reason renamed. New closes use the new name; orders already closed keep the name they were closed with.", "success") },
    onError: (error) => setEditError(apiErrorText(error, "The reason was not renamed.")),
  })
  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      active ? (await api.put(`/api/sales/order-close-reasons/${id}`, { is_active: true })).data : (await api.delete(`/api/sales/order-close-reasons/${id}`)).data,
    onSuccess: (_data, variables) => { refresh(); setConfirmId(null); showToast(variables.active ? "Reason is active again." : "Reason deactivated. Orders already closed with it keep it.", "success") },
    onError: (error) => showToast(apiErrorText(error, "The change did not go through."), "error"),
  })

  const rows = useMemo(() => {
    const all = (reasons.data || []).slice().sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || a.label.localeCompare(b.label))
    return all.filter((row) => (show === "all" ? true : show === "active" ? isActive(row) : !isActive(row)))
  }, [reasons.data, show])
  const activeCount = (reasons.data || []).filter(isActive).length
  const inactiveCount = (reasons.data || []).length - activeCount
  const suggestedCode = codeTouched ? code : codeFromName(name)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (name.trim().length < 2) { setFormError("Enter the reason's name, e.g. Customer cancelled the PO."); return }
    if (!suggestedCode) { setFormError("Enter a code."); return }
    create.mutate()
  }

  return (
    <div className="space-y-4" data-testid="order-close-reasons">
      {/* The masters tab strip only for those who can open the other masters. */}
      {canEdit ? <MastersNav /> : null}
      <PageHeader
        badge="Masters · Sales"
        title="Order close reasons"
        description="The reasons people choose when they cancel a sales order, short-close it, or put it on customer hold. Add, rename or deactivate them here; the close dialogs read this list."
      />

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" aria-label="Where these reasons are used">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"><Ban className="h-3.5 w-3.5" aria-hidden="true" />Cancel order</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"><CircleSlash2 className="h-3.5 w-3.5" aria-hidden="true" />Short close</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />Customer hold</span>
        <span>· A code with the word OTHER in it (for example SO-OTHER) asks for a note when used.</span>
      </div>

      {canEdit ? (
        <form onSubmit={submit} className="erp-panel rounded-xl p-4" aria-labelledby="add-reason-title" data-testid="order-close-reasons:add">
          <h2 id="add-reason-title" className="text-[14px] font-semibold">Add a reason</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto] md:items-end">
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="reason-name">
              Name
              <input id="reason-name" data-testid="order-close-reasons:name" value={name} onChange={(event) => { setName(event.target.value); setFormError(null) }} maxLength={200} placeholder="e.g. Customer cancelled the PO" className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal" aria-invalid={Boolean(formError)} aria-describedby={formError ? "reason-form-error" : undefined} />
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="reason-code">
              <span>Code <span className="font-normal text-muted-foreground">(stays fixed)</span></span>
              <input id="reason-code" data-testid="order-close-reasons:code" value={suggestedCode} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "")); setCodeTouched(true) }} maxLength={40} placeholder="SO-…" className="h-11 rounded-lg border border-input bg-card px-3 font-mono text-[13px] font-normal" />
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="reason-description">
              <span>When to use it <span className="font-normal text-muted-foreground">(optional)</span></span>
              <input id="reason-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="e.g. Written cancellation from the customer" className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal" />
            </label>
            <button type="submit" className="erp-btn-primary !h-11 justify-center" disabled={create.isPending} data-testid="order-close-reasons:create"><Plus className="h-4 w-4" />{create.isPending ? "Adding…" : "Add reason"}</button>
          </div>
          {needsNote(suggestedCode) ? <p className="mt-2 text-[12px] text-signal-amber-ink">This code has the word OTHER in it, so people will be asked for a note when they use it.</p> : null}
          {formError ? <p id="reason-form-error" role="alert" className="mt-2 text-[13px] text-signal-rose-ink">{formError}</p> : null}
        </form>
      ) : (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">Only the Owner or an Admin can add, rename or deactivate these reasons. You can see the list.</p>
      )}

      <section className="erp-panel overflow-hidden rounded-xl" aria-labelledby="reason-list-title">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 id="reason-list-title" className="text-[14px] font-semibold">Reasons</h2>
          <span className="text-[12px] text-muted-foreground">{reasons.isLoading ? "Loading…" : `${activeCount} active${inactiveCount ? ` · ${inactiveCount} inactive` : ""}`}</span>
          <div className="ml-auto inline-flex rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="Show">
            {(["active", "inactive", "all"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={show === key} onClick={() => setShow(key)} className={cn("h-11 rounded-md px-3 text-[12.5px] font-medium capitalize sm:h-9", show === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{key}</button>
            ))}
          </div>
        </div>
        {reasons.isLoading ? (
          <LoadingState label="Loading reasons…" className="m-4" />
        ) : reasons.isError ? (
          <ErrorState className="m-4" title="Reasons could not be loaded" message={apiErrorText(reasons.error, "Refresh to try again.")} onRetry={() => { void reasons.refetch() }} />
        ) : rows.length === 0 ? (
          <EmptyState className="m-4" label={show === "inactive" ? "No inactive reasons." : canEdit ? "No reasons yet. Add the first one above, e.g. Customer cancelled the PO." : "No reasons yet. Ask the Owner or an Admin to add them."} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const active = isActive(row)
              const editing = editingId === row.id
              return (
                <li key={row.id} className="px-4 py-3" data-testid={`order-close-reason:${row.code}`}>
                  {editing ? (
                    <form className="grid gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] md:items-end" onSubmit={(event) => {
                      event.preventDefault()
                      if (editName.trim().length < 2) { setEditError("The name needs at least 2 letters, e.g. Customer cancelled the PO."); return }
                      setEditError(null)
                      rename.mutate(row.id)
                    }}>
                      <label className="grid gap-1 text-[12.5px] font-medium">Name
                        <input autoFocus value={editName} onChange={(event) => { setEditName(event.target.value); setEditError(null) }} maxLength={200} className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal" data-testid="order-close-reason:edit-name" aria-invalid={Boolean(editError)} aria-describedby={editError ? `reason-edit-error-${row.id}` : undefined} />
                      </label>
                      <label className="grid gap-1 text-[12.5px] font-medium">When to use it
                        <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={300} className="h-11 rounded-lg border border-input bg-card px-3 text-[14px] font-normal" />
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" className="erp-btn-primary !h-11" disabled={rename.isPending} data-testid="order-close-reason:save"><Check className="h-4 w-4" />Save</button>
                        <button type="button" className="erp-btn-secondary !h-11" onClick={() => { setEditingId(null); setEditError(null) }}><X className="h-4 w-4" />Cancel</button>
                      </div>
                      {editError ? <p id={`reason-edit-error-${row.id}`} role="alert" className="text-[13px] text-signal-rose-ink md:col-span-3" data-testid="order-close-reason:edit-error">{editError}</p> : null}
                      <p className="text-[12px] text-muted-foreground md:col-span-3">The code <span className="font-mono">{row.code}</span> stays the same, so orders already closed with it are not affected.</p>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className={cn("text-[14px] font-semibold", !active && "text-muted-foreground line-through decoration-1")}>{row.label}</p>
                        <p className="text-[12px] text-muted-foreground"><span className="font-mono">{row.code}</span>{row.description ? ` · ${row.description}` : ""}{needsNote(row.code) ? " · asks for a note" : ""}</p>
                      </div>
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", active ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : "border-border bg-muted text-muted-foreground")}>{active ? "Active" : "Inactive"}</span>
                      {canEdit ? (
                        confirmId === row.id ? (
                          <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
                            <span className="text-signal-amber-ink">Hide from new closes?</span>
                            <button type="button" className="erp-btn-secondary !h-11 !text-signal-amber-ink sm:!h-9" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: row.id, active: false })} data-testid="order-close-reason:confirm-deactivate">Deactivate</button>
                            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => setConfirmId(null)}>Keep</button>
                          </span>
                        ) : (
                          <span className="flex gap-2">
                            <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => { setEditingId(row.id); setEditName(row.label); setEditDescription(row.description || ""); setEditError(null) }} data-testid="order-close-reason:rename"><Pencil className="h-3.5 w-3.5" />Rename</button>
                            {active ? (
                              <button type="button" className="erp-btn-secondary !h-11 !text-signal-amber-ink sm:!h-9" onClick={() => setConfirmId(row.id)} data-testid="order-close-reason:deactivate">Deactivate</button>
                            ) : (
                              <button type="button" className="erp-btn-secondary !h-11 !text-signal-emerald-ink sm:!h-9" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: row.id, active: true })} data-testid="order-close-reason:reactivate"><RotateCcw className="h-3.5 w-3.5" />Reactivate</button>
                            )}
                          </span>
                        )
                      ) : null}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <p className="text-[12px] text-muted-foreground">Other reason lists (downtime, scrap, QC reject, job card short close) are in <Link href="/masters/reason-codes" className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline sm:min-h-0">Masters › Reason codes</Link>.</p>
    </div>
  )
}
