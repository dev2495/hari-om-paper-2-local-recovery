"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import {
  CockpitShell,
  ConfirmDialog,
  DataGrid,
  DetailDrawer,
  FilterField,
  KpiTile,
  LabeledInput,
  LabeledTextarea,
  MasterHero,
  Modal,
  Pill,
  SearchField,
  type GridColumn,
} from "@/components/master/master-cockpit"
import { useReasonCategories, type ReasonCategory } from "@/components/reasons"
import { RoleGate } from "@/components/workspace/role-gate"
import {
  useCreateReasonCode,
  useDeleteReasonCode,
  useReasonCodes,
  useUpdateReasonCode,
} from "@/hooks/use-master-data"

type ReasonRow = {
  id: string
  code?: string
  label?: string
  category?: string
  severity?: string
  description?: string
  is_active?: boolean
}

// Every reason list comes from master data (reason_catalog.py, owner decision 4, 1 Nov 2026: every "why"
// in the app is a code from one of these lists). Order cancel / short close reasons (SO_CLOSE) are kept on
// Masters › Order close reasons only: their code never changes there, because closed orders keep it.
const CLOSE_REASONS_HREF = "/masters/order-close-reasons"
const GROUP_ORDER = ["Sales", "Job cards and floor", "Quality", "Stores and stock", "Purchase", "Specifications", "Dispatch", "Not linked yet"]
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ")
const SEVERITIES = ["OK", "WATCH", "CRITICAL"] as const

function errorMessage(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Action failed"
}
function compact(v: unknown) { return String(v || "").trim() }
function sevToTone(s?: string): "ok" | "warn" | "critical" | "neutral" {
  if (s === "CRITICAL") return "critical"
  if (s === "WATCH") return "warn"
  if (s === "OK") return "ok"
  return "neutral"
}

export default function ReasonCodesWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin", "PlantManager"]}>
      <ReasonCodesPage />
    </RoleGate>
  )
}

function ReasonCodesPage() {
  const { showToast } = useApp()
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")
  const categoriesQuery = useReasonCategories()
  const categories: ReasonCategory[] = useMemo(() => categoriesQuery.data || [], [categoriesQuery.data])
  const categoryByKey = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories])
  const categoryLabel = (value: string) => categoryByKey.get(value)?.label || titleCase(value)
  const groups = useMemo(() => GROUP_ORDER.map((group) => ({ group, items: categories.filter((c) => c.group === group) })).filter((g) => g.items.length), [categories])
  // Deep link from a reason picker or the complaints page: /masters/reason-codes?category=CUSTOMER_COMPLAINT
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("category")
    if (wanted) setCategoryFilter(wanted.toUpperCase())
  }, [])
  const filterCategory = categoryByKey.get(categoryFilter)
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const query = useReasonCodes(categoryFilter === "ALL" ? undefined : categoryFilter, { includeInactive: true })
  const createReason = useCreateReasonCode()
  const updateReason = useUpdateReasonCode()
  const deleteReason = useDeleteReasonCode()

  const [createOpen, setCreateOpen] = useState(false)
  const blank = { code: "", label: "", category: "DOWNTIME", severity: "WATCH", description: "" }
  const [createForm, setCreateForm] = useState({ ...blank })
  const [createError, setCreateError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const rows: ReasonRow[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (needle && ![r.code, r.label, r.description].some((v) => String(v || "").toLowerCase().includes(needle))) return false
      const active = r.is_active !== false
      if (statusFilter === "ACTIVE" && !active) return false
      if (statusFilter === "INACTIVE" && active) return false
      return true
    })
  }, [rows, search, statusFilter])

  const selected = rows.find((r) => r.id === selectedId) || null

  const kpis = useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.is_active !== false).length
    const linked = categories.filter((c) => c.linked).length
    const emptyLists = categories.filter((c) => c.linked && !Number(c.active || 0)).length
    return { total, active, linked, emptyLists }
  }, [rows, categories])

  const submitCreate = async () => {
    setCreateError(null)
    if (!compact(createForm.code) || !compact(createForm.label)) {
      setCreateError("Code and label are required.")
      return
    }
    try {
      await createReason.mutateAsync({
        code: createForm.code.trim().toUpperCase(),
        label: createForm.label.trim(),
        category: createForm.category,
        severity: createForm.severity,
        description: createForm.description.trim() || undefined,
      })
      setCreateOpen(false); setCreateForm({ ...blank }); showToast("Reason code created", "success")
    } catch (err) { setCreateError(errorMessage(err)) }
  }

  const startEdit = () => {
    if (!selected || selected.category === "SO_CLOSE") return
    setEditForm({ ...selected }); setEditError(null); setEditOpen(true)
  }
  const submitEdit = async () => {
    setEditError(null)
    try {
      await updateReason.mutateAsync({
        id: editForm.id,
        data: {
          code: editForm.code,
          label: editForm.label,
          category: editForm.category,
          severity: editForm.severity,
          description: editForm.description || undefined,
        },
      })
      setEditOpen(false); showToast("Updated", "success")
    } catch (err) { setEditError(errorMessage(err)) }
  }

  const columns: GridColumn<ReasonRow>[] = [
    { key: "code", label: "Code", width: "140px", sortAccessor: (r) => r.code || "", render: (r) => <span className="font-mono text-xs font-bold">{r.code}</span> },
    { key: "label", label: "Label", sortAccessor: (r) => r.label || "", render: (r) => <div><div className="text-sm font-semibold">{r.label}</div>{r.description ? <div className="text-[11px] text-muted-foreground">{r.description}</div> : null}</div> },
    { key: "category", label: "List", width: "170px", sortAccessor: (r) => r.category || "", render: (r) => <Pill tone="info">{categoryLabel(r.category || "")}</Pill> },
    { key: "severity", label: "Severity", width: "110px", sortAccessor: (r) => r.severity === "CRITICAL" ? 0 : r.severity === "WATCH" ? 1 : 2, render: (r) => <Pill tone={sevToTone(r.severity)}>{r.severity}</Pill> },
    { key: "is_active", label: "Status", width: "100px", sortAccessor: (r) => (r.is_active === false ? 0 : 1), render: (r) => r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill> },
  ]

  return (
    <CockpitShell
      hero={<MasterHero eyebrow={`Every "why" in the app · ${kpis.linked} lists · ${kpis.active} active codes`} title="Reason codes" description="Every place that asks for a reason picks a code from one of these lists, with an optional note. Codes with OTHER in them always need a short note. Each list says where it is used." accent="cyan" chips={[
        { label: `${kpis.total} codes`, tone: "neutral" },
        { label: `${kpis.active} active`, tone: "ok" },
        ...(kpis.emptyLists ? [{ label: `${kpis.emptyLists} lists with no active code`, tone: "warn" as const }] : []),
        { label: "Owner / Admin / Plant Manager write", tone: "warn" },
      ]} />}
      kpis={<>
        <KpiTile label="Reason lists" value={String(kpis.linked)} tone="cyan" detail="used by a screen" />
        <KpiTile label="Active codes" value={String(kpis.active)} tone="amber" detail={`${kpis.total} in all`} />
        <KpiTile label="Lists with no code" value={String(kpis.emptyLists)} tone="rose" detail="the action cannot be saved" />
      </>}
      filters={<>
        <FilterField label="Search"><SearchField value={search} onChange={setSearch} placeholder="code, label, description…" /></FilterField>
        <FilterField label="Category">
          <select data-testid="reason-codes:category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="max-w-[16rem] rounded-md border border-border bg-card px-2 py-1 text-sm">
            <option value="ALL">All lists</option>
            {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-md border border-border bg-card px-2 py-1 text-sm">
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All</option>
          </select>
        </FilterField>
        <span className="ml-auto" />
        <button onClick={() => { setCreateForm({ ...blank, category: filterCategory && !filterCategory.owner_only ? filterCategory.key : blank.category }); setCreateOpen(true) }} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90">+ New reason</button>
      </>}
    >
      <section className="mb-4 grid gap-3" aria-label="Reason lists" data-testid="reason-codes:lists">
        {categoriesQuery.isError ? <p role="alert" className="text-[13px] text-signal-rose-ink">The reason lists could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void categoriesQuery.refetch()}>Try again</button></p> : null}
        {groups.map((g) => (
          <div key={g.group} className="grid gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((c) => {
                const selectedList = categoryFilter === c.key
                const empty = c.linked && !Number(c.active || 0)
                return (
                  <button key={c.key} type="button" data-testid={`reason-codes:list-${c.key}`} aria-pressed={selectedList} onClick={() => setCategoryFilter(selectedList ? "ALL" : c.key)}
                    className={`rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 ${selectedList ? "border-primary ring-1 ring-primary/30" : empty ? "border-signal-amber-line" : "border-border"}`}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-foreground">{c.label}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${empty ? "bg-signal-amber-soft text-signal-amber-ink" : "bg-muted text-muted-foreground"}`}>{Number(c.active || 0)} active</span>
                    </span>
                    <span className="mt-1 block font-mono text-[10.5px] text-muted-foreground">{c.key}{c.owner_only ? " · Owner / Admin only" : ""}</span>
                    {c.used_in.length ? (
                      <span className="mt-1.5 block text-[12px] text-muted-foreground">Used in: {c.used_in.join(" · ")}</span>
                    ) : <span className="mt-1.5 block text-[12px] text-muted-foreground">No screen uses this list. Kept so older records stay readable.</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <DataGrid<ReasonRow> columns={columns} rows={filtered} selectedId={selectedId} onSelect={(r) => setSelectedId(r.id)} emptyHint={query.isLoading ? "Loading…" : rows.length === 0 ? "No codes in this list yet. Add the first one with + New reason." : "No reasons match filters."} />

        <DetailDrawer open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.label || "—"} subtitle={selected ? `${selected.code} · ${selected.category}` : undefined} accent="cyan"
          chips={selected ? [
            selected.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            { label: selected.severity || "WATCH", tone: sevToTone(selected.severity) === "critical" ? "critical" as const : sevToTone(selected.severity) === "warn" ? "warn" as const : "ok" as const },
          ] : []}
          tabs={selected ? [{
            key: "overview", label: "Overview", content: (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Code</span><span className="font-mono">{selected.code}</span></div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">List</span><span>{categoryLabel(selected.category || "")} <span className="font-mono text-[11px] text-muted-foreground">{selected.category}</span></span></div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Used in</span><span>{categoryByKey.get(selected.category || "")?.used_in.join(" · ") || "No screen"}</span></div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Severity</span><Pill tone={sevToTone(selected.severity)}>{selected.severity}</Pill></div>
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Description</span><span>{selected.description || "—"}</span></div>
              </div>
            )
          }] : []}
          footer={selected?.category === "SO_CLOSE" ? (
            <div className="flex flex-wrap items-center justify-end gap-2" data-testid="reason-codes:so-close-readonly">
              <span className="text-[12px] text-muted-foreground">Order close reasons are changed on their own page.</span>
              <Link href={CLOSE_REASONS_HREF} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90">Open Order close reasons</Link>
            </div>
          ) : selected ? (
            <div className="flex justify-end gap-2">
              {selected.is_active === false ? (
                <button onClick={async () => { await updateReason.mutateAsync({ id: selected.id, data: { is_active: true } }); showToast("Reactivated", "success") }} className="rounded-full border border-signal-emerald-line bg-card px-3 py-1.5 text-xs font-semibold text-signal-emerald-ink hover:bg-signal-emerald-soft">Reactivate</button>
              ) : (
                <button onClick={() => setConfirmDeactivate(true)} className="rounded-full border border-signal-amber-line bg-card px-3 py-1.5 text-xs font-semibold text-signal-amber-ink hover:bg-signal-amber-soft">Deactivate</button>
              )}
              <button onClick={startEdit} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90">Edit</button>
            </div>
          ) : null}
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Create" title="+ New reason code" size="md" footer={<>
        <button onClick={() => setCreateOpen(false)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">Cancel</button>
        <button onClick={submitCreate} disabled={createReason.isPending} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow disabled:opacity-50">{createReason.isPending ? "Creating…" : "Create"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={createForm.code} onChange={(v) => setCreateForm({ ...createForm, code: v })} placeholder="DT-POWER" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11.5px] font-semibold text-muted-foreground">List *</span>
            <select data-testid="reason-codes:create-category" value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.filter((c) => !c.owner_only).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
            </select>
            {categoryByKey.get(createForm.category)?.used_in.length ? <span className="text-[11px] text-muted-foreground">Used in: {categoryByKey.get(createForm.category)?.used_in.join(" · ")}</span> : null}
            <span className="text-[11px] text-muted-foreground">Order cancel / short close reasons: add them on <Link href={CLOSE_REASONS_HREF} className="font-semibold text-primary underline">Order close reasons</Link>.</span>
          </label>
          <div className="sm:col-span-2">
            <LabeledInput label="Label" required value={createForm.label} onChange={(v) => setCreateForm({ ...createForm, label: v })} placeholder="Power cut" />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11.5px] font-semibold text-muted-foreground">Severity</span>
            <select value={createForm.severity} onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value })} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <LabeledTextarea label="Description" value={createForm.description} onChange={(v) => setCreateForm({ ...createForm, description: v })} rows={2} />
          </div>
        </div>
        {createError ? <p className="mt-2 text-xs text-signal-rose-ink">{createError}</p> : null}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Edit" title={editForm.label || "Reason code"} size="md" footer={<>
        <button onClick={() => setEditOpen(false)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">Cancel</button>
        <button onClick={submitEdit} disabled={updateReason.isPending} className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow disabled:opacity-50">{updateReason.isPending ? "Saving…" : "Save"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={editForm.code || ""} onChange={(v) => setEditForm({ ...editForm, code: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11.5px] font-semibold text-muted-foreground">List *</span>
            <select value={editForm.category || ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.filter((c) => !c.owner_only).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
            </select>
          </label>
          <div className="sm:col-span-2"><LabeledInput label="Label" required value={editForm.label || ""} onChange={(v) => setEditForm({ ...editForm, label: v })} /></div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11.5px] font-semibold text-muted-foreground">Severity</span>
            <select value={editForm.severity || ""} onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><LabeledTextarea label="Description" value={editForm.description || ""} onChange={(v) => setEditForm({ ...editForm, description: v })} rows={2} /></div>
        </div>
        {editError ? <p className="mt-2 text-xs text-signal-rose-ink">{editError}</p> : null}
      </Modal>

      <ConfirmDialog open={confirmDeactivate} title="Deactivate reason code?" body={<><strong>{selected?.label}</strong> will be hidden from new entries. Existing rows referencing this code stay intact.</>} confirmLabel="Deactivate" tone="warn"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={async () => { if (!selected) return; try { await deleteReason.mutateAsync(selected.id); showToast("Deactivated", "success"); setConfirmDeactivate(false) } catch (err) { showToast(errorMessage(err), "error") } }}
      />
    </CockpitShell>
  )
}
