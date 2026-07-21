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
  MasterHero,
  Modal,
  Pill,
  SearchField,
  type GridColumn,
} from "@/components/master/master-cockpit"
import { RoleGate } from "@/components/workspace/role-gate"
import { useCreateShift, useDeleteShift, useShifts, useUpdateShift } from "@/hooks/use-master-data"

type Shift = {
  id: string
  code?: string
  name?: string
  start_time?: string
  end_time?: string
  hours?: number
  is_night?: boolean
  break_minutes?: number
  night_premium_percent?: number
  is_active?: boolean
}

function errorMessage(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Action failed"
}
function compact(v: unknown) { return String(v || "").trim() }

export default function ShiftsWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <ShiftsPage />
    </RoleGate>
  )
}

function ShiftsPage() {
  const { showToast } = useApp()
  const query = useShifts({ include_inactive: true })
  const createShift = useCreateShift()
  const updateShift = useUpdateShift()
  const deleteShift = useDeleteShift()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const blank = { code: "", name: "", start_time: "06:00", end_time: "14:00", hours: "8", is_night: false, break_minutes: "30", night_premium_percent: "0" }
  const [createForm, setCreateForm] = useState({ ...blank })
  const [createError, setCreateError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const rows: Shift[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((s) => {
      if (needle && ![s.code, s.name].some((v) => String(v || "").toLowerCase().includes(needle))) return false
      const active = s.is_active !== false
      if (statusFilter === "ACTIVE" && !active) return false
      if (statusFilter === "INACTIVE" && active) return false
      return true
    })
  }, [rows, search, statusFilter])

  const selected = rows.find((r) => r.id === selectedId) || null
  const kpis = useMemo(() => ({
    total: rows.length,
    active: rows.filter((s) => s.is_active !== false).length,
    night: rows.filter((s) => s.is_night && s.is_active !== false).length,
    totalHours: rows.filter((s) => s.is_active !== false).reduce((sum, s) => sum + Number(s.hours || 0), 0),
  }), [rows])

  const submitCreate = async () => {
    setCreateError(null)
    if (!compact(createForm.code) || !compact(createForm.name)) {
      setCreateError("Code and name are required.")
      return
    }
    try {
      await createShift.mutateAsync({
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        start_time: createForm.start_time,
        end_time: createForm.end_time,
        hours: Number(createForm.hours || 8),
        is_night: createForm.is_night,
        break_minutes: Number(createForm.break_minutes || 30),
        night_premium_percent: Number(createForm.night_premium_percent || 0),
      })
      setCreateOpen(false)
      setCreateForm({ ...blank })
      showToast("Shift created", "success")
    } catch (err) {
      setCreateError(errorMessage(err))
    }
  }

  const startEdit = () => {
    if (!selected) return
    setEditForm({ ...selected, hours: String(selected.hours || ""), break_minutes: String(selected.break_minutes || ""), night_premium_percent: String(selected.night_premium_percent || "") })
    setEditError(null); setEditOpen(true)
  }
  const submitEdit = async () => {
    setEditError(null)
    try {
      await updateShift.mutateAsync({
        id: editForm.id,
        data: {
          code: editForm.code,
          name: editForm.name,
          start_time: editForm.start_time,
          end_time: editForm.end_time,
          hours: Number(editForm.hours || 8),
          is_night: !!editForm.is_night,
          break_minutes: Number(editForm.break_minutes || 30),
          night_premium_percent: Number(editForm.night_premium_percent || 0),
        },
      })
      setEditOpen(false); showToast("Shift updated", "success")
    } catch (err) { setEditError(errorMessage(err)) }
  }

  const columns: GridColumn<Shift>[] = [
    { key: "code", label: "Code", width: "100px", sortAccessor: (r) => r.code || "", render: (r) => <span className="font-mono text-xs font-bold">{r.code}</span> },
    { key: "name", label: "Name", sortAccessor: (r) => r.name || "", render: (r) => <span className="text-sm font-semibold">{r.name}</span> },
    { key: "time", label: "Window", width: "140px", render: (r) => <span className="text-xs font-mono">{r.start_time} → {r.end_time}</span> },
    { key: "hours", label: "Hours", width: "70px", align: "right", sortAccessor: (r) => Number(r.hours || 0), render: (r) => <span>{r.hours} h</span> },
    { key: "is_night", label: "Type", width: "100px", render: (r) => r.is_night ? <Pill tone="info">Night</Pill> : <Pill tone="ok">Day</Pill> },
    { key: "is_active", label: "Status", width: "100px", sortAccessor: (r) => (r.is_active === false ? 0 : 1), render: (r) => r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill> },
  ]

  return (
    <CockpitShell
      hero={<MasterHero eyebrow="Master · Shifts" title={`${kpis.active} active shifts · ${kpis.totalHours.toFixed(0)} working hours/day`} description="Named work windows per plant. Drives OEE Availability denominator, planner board day boundaries, and night-premium attribution." accent="cyan" chips={[
        { label: `${kpis.total} total`, tone: "neutral" },
        { label: `${kpis.night} night`, tone: "warn" },
        { label: "Owner / Admin write", tone: "warn" },
      ]} />}
      kpis={<>
        <KpiTile label="Total shifts" value={String(kpis.total)} tone="cyan" />
        <KpiTile label="Active" value={String(kpis.active)} tone="emerald" />
        <KpiTile label="Night shifts" value={String(kpis.night)} tone="violet" />
        <KpiTile label="Hours / day" value={`${kpis.totalHours.toFixed(0)} h`} tone="amber" detail="Sum of active shift hours" />
      </>}
      filters={<>
        <FilterField label="Search"><SearchField value={search} onChange={setSearch} placeholder="code, name…" /></FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All</option>
          </select>
        </FilterField>
        <span className="ml-auto" />
        <button onClick={() => { setCreateForm({ ...blank }); setCreateOpen(true) }} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">+ New shift</button>
      </>}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <DataGrid<Shift> columns={columns} rows={filtered} selectedId={selectedId} onSelect={(r) => setSelectedId(r.id)} emptyHint={query.isLoading ? "Loading…" : rows.length === 0 ? "No shifts yet — create the first one." : "No shifts match filters."} />
        <DetailDrawer open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.name || "—"} subtitle={selected ? `${selected.code} · ${selected.start_time} → ${selected.end_time}` : undefined} accent="cyan"
          chips={selected ? [selected.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const }, selected.is_night ? { label: "NIGHT", tone: "warn" as const } : { label: "DAY", tone: "ok" as const }] : []}
          tabs={selected ? [{
            key: "overview", label: "Overview", content: (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-[140px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Code</span><span className="font-mono">{selected.code}</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Window</span><span className="font-mono">{selected.start_time} → {selected.end_time}</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Working hours</span><span>{selected.hours} h</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Break</span><span>{selected.break_minutes} min</span></div>
                <div className="grid grid-cols-[140px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Night premium</span><span>{(selected.night_premium_percent || 0).toFixed(0)}%</span></div>
              </div>
            )
          }] : []}
          footer={selected ? (
            <div className="flex justify-end gap-2">
              {selected.is_active === false ? (
                <button onClick={async () => { await updateShift.mutateAsync({ id: selected.id, data: { is_active: true } }); showToast("Reactivated", "success") }} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Reactivate</button>
              ) : (
                <button onClick={() => setConfirmDeactivate(true)} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50">Deactivate</button>
              )}
              <button onClick={startEdit} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">Edit</button>
            </div>
          ) : null}
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Create" title="+ New shift" size="md" footer={<>
        <button onClick={() => setCreateOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitCreate} disabled={createShift.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{createShift.isPending ? "Creating…" : "Create"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={createForm.code} onChange={(v) => setCreateForm({ ...createForm, code: v })} placeholder="A / DAY / NIGHT" />
          <LabeledInput label="Name" required value={createForm.name} onChange={(v) => setCreateForm({ ...createForm, name: v })} placeholder="Day Shift A" />
          <LabeledInput label="Start time" value={createForm.start_time} onChange={(v) => setCreateForm({ ...createForm, start_time: v })} placeholder="HH:MM" />
          <LabeledInput label="End time" value={createForm.end_time} onChange={(v) => setCreateForm({ ...createForm, end_time: v })} placeholder="HH:MM" />
          <LabeledInput label="Hours" value={createForm.hours} onChange={(v) => setCreateForm({ ...createForm, hours: v })} type="number" />
          <LabeledInput label="Break (min)" value={createForm.break_minutes} onChange={(v) => setCreateForm({ ...createForm, break_minutes: v })} type="number" />
          <LabeledInput label="Night premium (%)" value={createForm.night_premium_percent} onChange={(v) => setCreateForm({ ...createForm, night_premium_percent: v })} type="number" />
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={createForm.is_night} onChange={(e) => setCreateForm({ ...createForm, is_night: e.target.checked })} /> Night shift</label>
        </div>
        {createError ? <p className="mt-2 text-xs text-rose-700">{createError}</p> : null}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Edit" title={editForm.name || "Shift"} size="md" footer={<>
        <button onClick={() => setEditOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitEdit} disabled={updateShift.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{updateShift.isPending ? "Saving…" : "Save"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={editForm.code || ""} onChange={(v) => setEditForm({ ...editForm, code: v })} />
          <LabeledInput label="Name" required value={editForm.name || ""} onChange={(v) => setEditForm({ ...editForm, name: v })} />
          <LabeledInput label="Start time" value={editForm.start_time || ""} onChange={(v) => setEditForm({ ...editForm, start_time: v })} />
          <LabeledInput label="End time" value={editForm.end_time || ""} onChange={(v) => setEditForm({ ...editForm, end_time: v })} />
          <LabeledInput label="Hours" value={editForm.hours || ""} onChange={(v) => setEditForm({ ...editForm, hours: v })} type="number" />
          <LabeledInput label="Break (min)" value={editForm.break_minutes || ""} onChange={(v) => setEditForm({ ...editForm, break_minutes: v })} type="number" />
          <LabeledInput label="Night premium (%)" value={editForm.night_premium_percent || ""} onChange={(v) => setEditForm({ ...editForm, night_premium_percent: v })} type="number" />
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={!!editForm.is_night} onChange={(e) => setEditForm({ ...editForm, is_night: e.target.checked })} /> Night shift</label>
        </div>
        {editError ? <p className="mt-2 text-xs text-rose-700">{editError}</p> : null}
      </Modal>

      <ConfirmDialog open={confirmDeactivate} title="Deactivate shift?" body={<><strong>{selected?.name}</strong> will be hidden from active lists.</>} confirmLabel="Deactivate" tone="warn"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={async () => { if (!selected) return; try { await deleteShift.mutateAsync(selected.id); showToast("Deactivated", "success"); setConfirmDeactivate(false) } catch (err) { showToast(errorMessage(err), "error") } }}
      />
    </CockpitShell>
  )
}
