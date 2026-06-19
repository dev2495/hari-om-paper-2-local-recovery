"use client"

import { useMemo, useState } from "react"

import { useApp } from "@/context/AppContext"
import {
  CockpitShell,
  ConfirmDialog,
  DataGrid,
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
import {
  useCreateHoliday,
  useDeleteHoliday,
  useHolidays,
  useUpdateHoliday,
} from "@/hooks/use-master-data"

type Holiday = {
  id: string
  holiday_date?: string
  holiday_type?: string
  description?: string
  impact_shifts?: string
}

const HOLIDAY_TYPES = ["PUBLIC_HOLIDAY", "PLANT_HOLIDAY", "MAINTENANCE_DAY", "STRIKE", "POWER_CUT", "OTHER"] as const

function errorMessage(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Action failed"
}
function fmtDate(value: string | undefined) {
  if (!value) return "—"
  try { return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) } catch { return value }
}

export default function HolidaysWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <HolidaysPage />
    </RoleGate>
  )
}

function HolidaysPage() {
  const { showToast } = useApp()
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const query = useHolidays(year)
  const createHoliday = useCreateHoliday()
  const updateHoliday = useUpdateHoliday()
  const deleteHoliday = useDeleteHoliday()

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("ALL")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const blank = { holiday_date: new Date().toISOString().split("T")[0], holiday_type: "PUBLIC_HOLIDAY", description: "", impact_shifts: "" }
  const [createForm, setCreateForm] = useState({ ...blank })
  const [createError, setCreateError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)

  const rows: Holiday[] = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((h) => {
      if (needle && ![h.description, h.holiday_type, h.holiday_date].some((v) => String(v || "").toLowerCase().includes(needle))) return false
      if (typeFilter !== "ALL" && (h.holiday_type || "") !== typeFilter) return false
      return true
    })
  }, [rows, search, typeFilter])

  const selected = rows.find((r) => r.id === selectedId) || null

  const kpis = useMemo(() => {
    const total = rows.length
    const upcoming = rows.filter((h) => h.holiday_date && new Date(h.holiday_date) >= new Date()).length
    const byType = (t: string) => rows.filter((h) => h.holiday_type === t).length
    return { total, upcoming, publicCount: byType("PUBLIC_HOLIDAY"), maintenanceCount: byType("MAINTENANCE_DAY") }
  }, [rows])

  const submitCreate = async () => {
    setCreateError(null)
    if (!createForm.holiday_date) { setCreateError("Date is required."); return }
    try {
      await createHoliday.mutateAsync({
        holiday_date: createForm.holiday_date,
        holiday_type: createForm.holiday_type,
        description: createForm.description.trim() || undefined,
        impact_shifts: createForm.impact_shifts.trim() || undefined,
      })
      setCreateOpen(false); setCreateForm({ ...blank }); showToast("Holiday added", "success")
    } catch (err) { setCreateError(errorMessage(err)) }
  }

  const startEdit = () => {
    if (!selected) return
    setEditForm({
      id: selected.id,
      holiday_date: selected.holiday_date ? new Date(selected.holiday_date).toISOString().split("T")[0] : "",
      holiday_type: selected.holiday_type,
      description: selected.description || "",
      impact_shifts: selected.impact_shifts || "",
    })
    setEditError(null); setEditOpen(true)
  }
  const submitEdit = async () => {
    setEditError(null)
    try {
      await updateHoliday.mutateAsync({
        id: editForm.id,
        data: {
          holiday_date: editForm.holiday_date,
          holiday_type: editForm.holiday_type,
          description: editForm.description || undefined,
          impact_shifts: editForm.impact_shifts || undefined,
        },
      })
      setEditOpen(false); showToast("Holiday updated", "success")
    } catch (err) { setEditError(errorMessage(err)) }
  }

  const columns: GridColumn<Holiday>[] = [
    { key: "holiday_date", label: "Date", width: "140px", sortAccessor: (r) => r.holiday_date || "", render: (r) => <span className="text-sm font-semibold text-slate-950">{fmtDate(r.holiday_date)}</span> },
    { key: "holiday_type", label: "Type", width: "150px", sortAccessor: (r) => r.holiday_type || "", render: (r) => <Pill tone={r.holiday_type === "MAINTENANCE_DAY" ? "warn" : r.holiday_type === "POWER_CUT" || r.holiday_type === "STRIKE" ? "critical" : "info"}>{(r.holiday_type || "").replace("_", " ")}</Pill> },
    { key: "description", label: "Description", render: (r) => <span className="text-sm text-slate-700">{r.description || "—"}</span> },
    { key: "impact_shifts", label: "Shifts affected", width: "140px", render: (r) => <span className="text-xs font-mono">{r.impact_shifts || "ALL"}</span> },
  ]

  return (
    <CockpitShell
      hero={<MasterHero eyebrow="Master · Plant calendar" title={`${kpis.total} holidays for ${year} · ${kpis.upcoming} upcoming`} description="Plant calendar of non-working days. Drives OTIF math (due dates shift to next working day), anomaly suppression, and adherence math." accent="cyan" chips={[
        { label: `${kpis.publicCount} public`, tone: "ok" },
        { label: `${kpis.maintenanceCount} maintenance`, tone: "warn" },
        { label: "Owner / Admin write", tone: "warn" },
      ]} />}
      kpis={<>
        <KpiTile label="Total" value={String(kpis.total)} tone="cyan" detail={`Year ${year}`} />
        <KpiTile label="Upcoming" value={String(kpis.upcoming)} tone="emerald" />
        <KpiTile label="Public" value={String(kpis.publicCount)} tone="violet" />
        <KpiTile label="Maintenance" value={String(kpis.maintenanceCount)} tone="amber" />
      </>}
      filters={<>
        <FilterField label="Year">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FilterField>
        <FilterField label="Search"><SearchField value={search} onChange={setSearch} placeholder="description, type…" /></FilterField>
        <FilterField label="Type">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
            <option value="ALL">All</option>
            {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        </FilterField>
        <span className="ml-auto" />
        <button onClick={() => { setCreateForm({ ...blank }); setCreateOpen(true) }} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">+ New holiday</button>
      </>}
    >
      <DataGrid<Holiday> columns={columns} rows={filtered} selectedId={selectedId} onSelect={(r) => setSelectedId(r.id)} emptyHint={query.isLoading ? "Loading…" : rows.length === 0 ? "No holidays for this year — add the first." : "No holidays match the filter."} />

      {selected ? (
        <div className="rounded-[1.2rem] border border-slate-200 bg-white p-3 flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-slate-700"><strong>{fmtDate(selected.holiday_date)}</strong> · {selected.holiday_type?.replace("_", " ")} · {selected.description || "(no description)"}</span>
          <button onClick={startEdit} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-cyan-300">Edit</button>
          <button onClick={() => setConfirmDelete(true)} className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">Delete</button>
        </div>
      ) : null}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Create" title="+ New holiday" size="md" footer={<>
        <button onClick={() => setCreateOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitCreate} disabled={createHoliday.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{createHoliday.isPending ? "Adding…" : "Add"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Date" required type="date" value={createForm.holiday_date} onChange={(v) => setCreateForm({ ...createForm, holiday_date: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type</span>
            <select value={createForm.holiday_type} onChange={(e) => setCreateForm({ ...createForm, holiday_type: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <LabeledInput label="Description" value={createForm.description} onChange={(v) => setCreateForm({ ...createForm, description: v })} placeholder="Diwali · Ganesh Chaturthi · Annual maintenance" />
          </div>
          <div className="sm:col-span-2">
            <LabeledInput label="Impact shifts (CSV, blank = all)" value={createForm.impact_shifts} onChange={(v) => setCreateForm({ ...createForm, impact_shifts: v })} placeholder="A,B,C — leave blank for full day" />
          </div>
        </div>
        {createError ? <p className="mt-2 text-xs text-rose-700">{createError}</p> : null}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Edit" title="Edit holiday" size="md" footer={<>
        <button onClick={() => setEditOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
        <button onClick={submitEdit} disabled={updateHoliday.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">{updateHoliday.isPending ? "Saving…" : "Save"}</button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Date" type="date" value={editForm.holiday_date || ""} onChange={(v) => setEditForm({ ...editForm, holiday_date: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type</span>
            <select value={editForm.holiday_type || "PUBLIC_HOLIDAY"} onChange={(e) => setEditForm({ ...editForm, holiday_type: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><LabeledInput label="Description" value={editForm.description || ""} onChange={(v) => setEditForm({ ...editForm, description: v })} /></div>
          <div className="sm:col-span-2"><LabeledInput label="Impact shifts" value={editForm.impact_shifts || ""} onChange={(v) => setEditForm({ ...editForm, impact_shifts: v })} /></div>
        </div>
        {editError ? <p className="mt-2 text-xs text-rose-700">{editError}</p> : null}
      </Modal>

      <ConfirmDialog open={confirmDelete} title="Delete holiday?" body={<>Permanently remove this holiday entry. Cannot be undone.</>} confirmLabel="Delete" tone="critical"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { if (!selected) return; try { await deleteHoliday.mutateAsync(selected.id); setSelectedId(null); showToast("Holiday removed", "success"); setConfirmDelete(false) } catch (err) { showToast(errorMessage(err), "error") } }}
      />
    </CockpitShell>
  )
}
