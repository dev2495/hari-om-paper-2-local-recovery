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
import {
  useCreateEmployee,
  useDeleteEmployee,
  useEmployees,
  useShifts,
  useUpdateEmployee,
} from "@/hooks/use-master-data"

type Employee = {
  id: string
  employee_code?: string
  name?: string
  role?: string
  department?: string
  phone?: string
  email?: string
  skills?: string
  default_shift?: string
  joining_date?: string | null
  is_active?: boolean
}

const ROLES = ["Operator", "Supervisor", "Packer", "QC Inspector", "Storeman", "Dispatcher", "Manager"] as const
const DEPARTMENTS = ["WINDER", "OVEN", "PROCESS", "PACKING", "QC", "DISPATCH", "STORE", "GENERAL"] as const

function errorMessage(err: any) {
  return err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Action failed"
}
function compact(v: unknown) {
  return String(v || "").trim()
}

export default function EmployeesWrapper() {
  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <EmployeesPage />
    </RoleGate>
  )
}

function EmployeesPage() {
  const { showToast } = useApp()
  const employeesQuery = useEmployees()
  const createEmployee = useCreateEmployee()
  const updateEmployee = useUpdateEmployee()
  const deleteEmployee = useDeleteEmployee()
  const { data: shiftRows } = useShifts()
  const shifts: any[] = Array.isArray(shiftRows) ? shiftRows : []

  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("ALL")
  const [deptFilter, setDeptFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const blank = {
    employee_code: "",
    name: "",
    role: "",
    department: "",
    phone: "",
    email: "",
    skills: "",
    default_shift: "",
  }
  const [createForm, setCreateForm] = useState({ ...blank })
  const [createError, setCreateError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Employee>({ id: "" })
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const employees: Employee[] = useMemo(
    () => (Array.isArray(employeesQuery.data) ? employeesQuery.data : []),
    [employeesQuery.data],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return employees.filter((e) => {
      if (needle && ![e.employee_code, e.name, e.role, e.department, e.phone, e.email].some((v) => String(v || "").toLowerCase().includes(needle))) return false
      if (roleFilter !== "ALL" && (e.role || "") !== roleFilter) return false
      if (deptFilter !== "ALL" && (e.department || "") !== deptFilter) return false
      const active = e.is_active !== false
      if (statusFilter === "ACTIVE" && !active) return false
      if (statusFilter === "INACTIVE" && active) return false
      return true
    })
  }, [employees, search, roleFilter, deptFilter, statusFilter])

  const selected = employees.find((e) => e.id === selectedId) || null

  const kpis = useMemo(() => {
    const total = employees.length
    const active = employees.filter((e) => e.is_active !== false).length
    const operators = employees.filter((e) => (e.role || "").toLowerCase() === "operator" && e.is_active !== false).length
    const supervisors = employees.filter((e) => (e.role || "").toLowerCase() === "supervisor" && e.is_active !== false).length
    return { total, active, operators, supervisors }
  }, [employees])

  const submitCreate = async () => {
    setCreateError(null)
    if (!compact(createForm.employee_code) || !compact(createForm.name)) {
      setCreateError("Code and name are required.")
      return
    }
    try {
      const res = await createEmployee.mutateAsync({
        employee_code: createForm.employee_code.trim(),
        name: createForm.name.trim(),
        role: createForm.role || undefined,
        department: createForm.department || undefined,
        phone: createForm.phone.trim() || undefined,
        email: createForm.email.trim() || undefined,
        skills: createForm.skills.trim() || undefined,
        default_shift: createForm.default_shift || undefined,
      })
      const id = (res as any)?.data?.id || (res as any)?.id
      if (id) setSelectedId(id)
      setCreateOpen(false)
      setCreateForm({ ...blank })
      showToast("Employee created", "success")
    } catch (err) {
      setCreateError(errorMessage(err))
    }
  }

  const startEdit = () => {
    if (!selected) return
    setEditForm({ ...selected })
    setEditError(null)
    setEditOpen(true)
  }

  const submitEdit = async () => {
    setEditError(null)
    if (!compact(editForm.employee_code) || !compact(editForm.name)) {
      setEditError("Code and name are required.")
      return
    }
    try {
      await updateEmployee.mutateAsync({
        id: editForm.id,
        data: {
          employee_code: editForm.employee_code,
          name: editForm.name,
          role: editForm.role || undefined,
          department: editForm.department || undefined,
          phone: editForm.phone || undefined,
          email: editForm.email || undefined,
          skills: editForm.skills || undefined,
          default_shift: editForm.default_shift || undefined,
        },
      })
      setEditOpen(false)
      showToast("Employee updated", "success")
    } catch (err) {
      setEditError(errorMessage(err))
    }
  }

  const columns: GridColumn<Employee>[] = [
    {
      key: "employee_code",
      label: "Code",
      width: "120px",
      sortAccessor: (r) => r.employee_code || "",
      render: (r) => <span className="font-mono text-xs">{r.employee_code || "—"}</span>,
    },
    {
      key: "name",
      label: "Name",
      sortAccessor: (r) => r.name || "",
      render: (r) => (
        <div>
          <div className="text-sm font-semibold text-slate-950">{r.name || "—"}</div>
          <div className="text-[11px] text-slate-500">{r.phone || r.email || "—"}</div>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      width: "120px",
      sortAccessor: (r) => r.role || "",
      render: (r) => r.role ? <Pill tone="info">{r.role}</Pill> : <span className="text-slate-400 text-[11px]">—</span>,
    },
    {
      key: "department",
      label: "Dept",
      width: "100px",
      sortAccessor: (r) => r.department || "",
      render: (r) => <span className="text-xs text-slate-700">{r.department || "—"}</span>,
    },
    {
      key: "default_shift",
      label: "Default shift",
      width: "120px",
      sortAccessor: (r) => r.default_shift || "",
      render: (r) => <span className="font-mono text-xs">{r.default_shift || "—"}</span>,
    },
    {
      key: "is_active",
      label: "Status",
      width: "100px",
      sortAccessor: (r) => (r.is_active === false ? 0 : 1),
      render: (r) => (r.is_active === false ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="ok">Active</Pill>),
    },
  ]

  return (
    <CockpitShell
      hero={
        <MasterHero
          eyebrow="Master · Employees"
          title={`${kpis.active} active employees · ${kpis.operators} operators · ${kpis.supervisors} supervisors`}
          description="Shop-floor people: operators, supervisors, packers, QC inspectors, dispatchers. Each can have a default shift and skill matrix that feeds per-operator productivity reports."
          accent="cyan"
          chips={[
            { label: `${kpis.total} total`, tone: "neutral" },
            { label: `${kpis.active} active`, tone: "ok" },
            { label: "Owner / Admin write", tone: "warn" },
          ]}
        />
      }
      kpis={
        <>
          <KpiTile label="Total" value={String(kpis.total)} tone="cyan" />
          <KpiTile label="Active" value={String(kpis.active)} tone="emerald" detail={`${kpis.total - kpis.active} inactive`} />
          <KpiTile label="Operators" value={String(kpis.operators)} tone="violet" />
          <KpiTile label="Supervisors" value={String(kpis.supervisors)} tone="amber" />
        </>
      }
      filters={
        <>
          <FilterField label="Search">
            <SearchField value={search} onChange={setSearch} placeholder="name, code, phone…" />
          </FilterField>
          <FilterField label="Role">
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
              <option value="ALL">All</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </FilterField>
          <FilterField label="Dept">
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
              <option value="ALL">All</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </FilterField>
          <FilterField label="Status">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </select>
          </FilterField>
          <span className="ml-auto" />
          <button onClick={() => { setCreateForm({ ...blank }); setCreateOpen(true) }} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">
            + New employee
          </button>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.9fr)]">
        <DataGrid<Employee>
          columns={columns}
          rows={filtered}
          selectedId={selectedId}
          onSelect={(r) => setSelectedId(r.id)}
          emptyHint={employeesQuery.isLoading ? "Loading…" : employees.length === 0 ? "No employees yet — click + New employee." : "No employees match the filters."}
        />
        <DetailDrawer
          open={Boolean(selected)}
          onClose={() => setSelectedId(null)}
          title={selected?.name || "—"}
          subtitle={selected ? `${selected.employee_code || "no code"} · ${selected.role || "no role"}` : undefined}
          accent="cyan"
          chips={selected ? [
            selected.is_active === false ? { label: "INACTIVE", tone: "warn" as const } : { label: "ACTIVE", tone: "ok" as const },
            selected.default_shift ? { label: `Shift ${selected.default_shift}`, tone: "ok" as const } : null,
          ].filter(Boolean) as any[] : []}
          tabs={selected ? [
            {
              key: "overview",
              label: "Overview",
              content: (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Code</span><span className="font-mono">{selected.employee_code || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Role</span><span>{selected.role || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Department</span><span>{selected.department || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Phone</span><span>{selected.phone || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Email</span><span>{selected.email || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Skills</span><span>{selected.skills || "—"}</span></div>
                  <div className="grid grid-cols-[110px_1fr] gap-2"><span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Default shift</span><span className="font-mono">{selected.default_shift || "—"}</span></div>
                </div>
              ),
            },
          ] : []}
          footer={selected ? (
            <div className="flex justify-end gap-2">
              {selected.is_active === false ? (
                <button onClick={async () => { await updateEmployee.mutateAsync({ id: selected.id, data: { is_active: true } }); showToast("Reactivated", "success") }} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Reactivate</button>
              ) : (
                <button onClick={() => setConfirmDeactivate(true)} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50">Deactivate</button>
              )}
              <button onClick={startEdit} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-900">Edit</button>
            </div>
          ) : null}
        />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Create" title="+ New employee" size="lg" footer={
        <>
          <button onClick={() => setCreateOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
          <button onClick={submitCreate} disabled={createEmployee.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {createEmployee.isPending ? "Creating…" : "Create"}
          </button>
        </>
      }>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={createForm.employee_code} onChange={(v) => setCreateForm({ ...createForm, employee_code: v })} placeholder="EMP-001" />
          <LabeledInput label="Name" required value={createForm.name} onChange={(v) => setCreateForm({ ...createForm, name: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role</span>
            <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Department</span>
            <select value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <LabeledInput label="Phone" value={createForm.phone} onChange={(v) => setCreateForm({ ...createForm, phone: v })} />
          <LabeledInput label="Email" value={createForm.email} onChange={(v) => setCreateForm({ ...createForm, email: v })} />
          <LabeledInput label="Skills (csv)" value={createForm.skills} onChange={(v) => setCreateForm({ ...createForm, skills: v })} placeholder="WINDER, OVEN" />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Default shift</span>
            <select value={createForm.default_shift} onChange={(e) => setCreateForm({ ...createForm, default_shift: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {shifts.filter((s) => s.is_active !== false).map((s) => <option key={s.id} value={s.code}>{s.code} · {s.name}</option>)}
            </select>
          </label>
        </div>
        {createError ? <p className="mt-2 text-xs text-rose-700">{createError}</p> : null}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Edit" title={editForm.name || "Employee"} size="lg" footer={
        <>
          <button onClick={() => setEditOpen(false)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
          <button onClick={submitEdit} disabled={updateEmployee.isPending} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {updateEmployee.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Code" required value={editForm.employee_code || ""} onChange={(v) => setEditForm({ ...editForm, employee_code: v })} />
          <LabeledInput label="Name" required value={editForm.name || ""} onChange={(v) => setEditForm({ ...editForm, name: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Role</span>
            <select value={editForm.role || ""} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Department</span>
            <select value={editForm.department || ""} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <LabeledInput label="Phone" value={editForm.phone || ""} onChange={(v) => setEditForm({ ...editForm, phone: v })} />
          <LabeledInput label="Email" value={editForm.email || ""} onChange={(v) => setEditForm({ ...editForm, email: v })} />
          <LabeledInput label="Skills (csv)" value={editForm.skills || ""} onChange={(v) => setEditForm({ ...editForm, skills: v })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Default shift</span>
            <select value={editForm.default_shift || ""} onChange={(e) => setEditForm({ ...editForm, default_shift: e.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {shifts.filter((s) => s.is_active !== false).map((s) => <option key={s.id} value={s.code}>{s.code} · {s.name}</option>)}
            </select>
          </label>
        </div>
        {editError ? <p className="mt-2 text-xs text-rose-700">{editError}</p> : null}
      </Modal>

      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate employee?"
        body={<><strong>{selected?.name}</strong> will be hidden from active lists. Existing job-card history is preserved.</>}
        confirmLabel="Deactivate"
        tone="warn"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={async () => {
          if (!selected) return
          try {
            await deleteEmployee.mutateAsync(selected.id)
            showToast("Deactivated", "success")
            setConfirmDeactivate(false)
          } catch (err) {
            showToast(errorMessage(err), "error")
          }
        }}
      />
    </CockpitShell>
  )
}
