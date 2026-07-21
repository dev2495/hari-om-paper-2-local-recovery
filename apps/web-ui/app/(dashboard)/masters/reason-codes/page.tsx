"use client"

import { useMemo, useState } from "react"

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

const CATEGORIES = ["DOWNTIME", "SCRAP", "QC_REJECT", "SHORT_CLOSE", "RM_ISSUE", "RETURN", "OTHER"] as const
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
    const byCat = (c: string) => rows.filter((r) => r.category === c).length
    return { total, active, downtime: byCat("DOWNTIME"), scrap: byCat("SCRAP"), shortClose: byCat("SHORT_CLOSE") }
  }, [rows])

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
    if (!selected) return
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
    { key: "label", label: "Label", sortAccessor: (r) => r.label || "", render: (r) => <div><div className="text-sm font-semibold">{r.label}</div>{r.description ? <div className="text-[11px] text-slate-500">{r.description}</div> : null}</div> },
    { key: "category", label: "Category", width: "130px", sortAccessor: (r) => r.category || "", render: (r) => <Pill tone="info">{(r.category || "").replace("_", " ")}</Pill> },
    { key: "severity", label: "Severity", width: "110px", sortAccessor: (r) => r.severity === "CRITICAL" ? 0 : r.severity === "WATCH" ? 1 : 2, render: (r) => <Pill tone={sevToTone(r.severity)}>{r.severity}</Pill> },
    { key: "is_active", label: "Status", width: "100px", sortAccessor: (r) => (r.is_active === false ? 0 : 1), render: (r) => r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill> },
  ]

  return (
    <CockpitShell
      hero={<MasterHero eyebrow="Master · Reason codes" title={`${kpis.active} active reasons · ${kpis.downtime} downtime + ${kpis.scrap} scrap + ${kpis.shortClose} short-close`} description="Normalized reason taxonomy used by downtime logging, scrap entries, QC rejects, and short-close on job-card close. Without these, every Pareto is a free-text mess." accent="cyan" chips={[
        { label: `${kpis.total} total`, tone: "neutral" },
        { label: `${kpis.active} active`, tone: "ok" },
        { label: "Owner / Admin / PlantManager write", tone: "warn" },
      ]} />}
      kpis={<>
        <KpiTile label="Total reasons" value={String(kpis.total)} tone="cyan" detail={`${kpis.active} active`} />
        <KpiTile label="Downtime" value={String(kpis.downtime)} tone="rose" />
        <KpiTile label="Scrap" value={String(kpis.scrap)} tone="amber" />
        <KpiTile label="Short-close" value={String(kpis.shortClose)} tone="violet" />
      </>}
      filters={<>
        <FilterField label="Search"><SearchField value={search} onChange={setSearch} placeholder="code, label, description…" /></FilterField>
        <FilterField label="Category">
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
            <option value="ALL">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All</option>
          </select>
        </FilterField>
        <span className="ml-auto" />
        <button onClick={() => { setCreateForm({ ...blank }); setCreateOpen(true) }} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">+ New reason</button>
      </>}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <DataGrid<ReasonRow> columns={columns} rows={filtered} selectedId={selectedId} onSelect={(r) => setSelectedId(r.id)} emptyHint={query.isLoading ? "Loading…" : rows.length === 0 ? "No reason codes yet — seed the first ones (DT-POWER, SCR-MOISTURE, SHORT-RM)." : "No reasons match filters."} />

        <DetailDrawer open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.label || "—"} subtitle={selected ? `${selected.code} · ${selected.category}` : undefined} accent="cyan"
          chips={selected ? [
            selected.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            { label: selected.severity || "WATCH", tone: sevToTone(selected.severity) === "critical" ? "critical" as const : sevToTone(selected.severity) === "warn" ? "warn" as const : "ok" as const },
          ] : []}
          tabs={selected ? [{
            key: "overview", label: "Overview", content: (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Code</span><span className="font-mono">{selected.code}</span></div>
                <div className="grid grid-cols-[120px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Category</span><span>{selected.category}</span></div>
                <div className="grid grid-cols-[120px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Severity</span><Pill tone={sevToTone(selected.severity)}>{selected.severity}</Pill></div>
                <div className="grid grid-cols-[120px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Description</span><span>{selected.description || "—"}</span></div>
              </div>
            )
          }] : []}
          footer={selected ? (
            <div className="flex justify-end gap-2">
              {selected.is_active === false ? (
                <button onClick={async () => { await updateReason.mutateAsync({ id: selected.id, data: { is_active: true } }); showToast("Reactivated", "success") }} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Reactivate</button>
              ) : (
                <button onClick={() => setConfirmDeactivate(true)} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50">Deactivate</button>
              )}
              <button onClick={startEdit} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">Edit</button>
            </div>
          ) : null}
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Create" title="+ New reason code" size="md" footer={<>
        <button onClick={() => setCreateOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitCreate} disabled={createReason.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{createReason.isPending ? "Creating…" : "Create"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={createForm.code} onChange={(v) => setCreateForm({ ...createForm, code: v })} placeholder="DT-POWER" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category *</span>
            <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <LabeledInput label="Label" required value={createForm.label} onChange={(v) => setCreateForm({ ...createForm, label: v })} placeholder="Power cut" />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Severity</span>
            <select value={createForm.severity} onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <LabeledTextarea label="Description" value={createForm.description} onChange={(v) => setCreateForm({ ...createForm, description: v })} rows={2} />
          </div>
        </div>
        {createError ? <p className="mt-2 text-xs text-rose-700">{createError}</p> : null}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Edit" title={editForm.label || "Reason code"} size="md" footer={<>
        <button onClick={() => setEditOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitEdit} disabled={updateReason.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{updateReason.isPending ? "Saving…" : "Save"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={editForm.code || ""} onChange={(v) => setEditForm({ ...editForm, code: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Category *</span>
            <select value={editForm.category || ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><LabeledInput label="Label" required value={editForm.label || ""} onChange={(v) => setEditForm({ ...editForm, label: v })} /></div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Severity</span>
            <select value={editForm.severity || ""} onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><LabeledTextarea label="Description" value={editForm.description || ""} onChange={(v) => setEditForm({ ...editForm, description: v })} rows={2} /></div>
        </div>
        {editError ? <p className="mt-2 text-xs text-rose-700">{editError}</p> : null}
      </Modal>

      <ConfirmDialog open={confirmDeactivate} title="Deactivate reason code?" body={<><strong>{selected?.label}</strong> will be hidden from new entries. Existing rows referencing this code stay intact.</>} confirmLabel="Deactivate" tone="warn"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={async () => { if (!selected) return; try { await deleteReason.mutateAsync(selected.id); showToast("Deactivated", "success"); setConfirmDeactivate(false) } catch (err) { showToast(errorMessage(err), "error") } }}
      />
    </CockpitShell>
  )
}
