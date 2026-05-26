"use client"

import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { BadgeCheck, Factory, Gauge, Power, Wrench } from "lucide-react"

interface MasterFormProps {
  initialData?: any
  onSubmit: (data: any) => void
  onCancel: () => void
}

export function PaperForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit, watch } = useForm({ defaultValues: initialData })
  const gsm = Number(watch("gsm") || 0)
  const bulkFactor = Number(watch("bulk_factor") || 0)
  const derivedThickness = gsm > 0 && bulkFactor > 0 ? (gsm * bulkFactor) / 1000 : 0
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Paper Code</label>
          <Input {...register("code", { required: true })} placeholder="KRAFT-230-18BF" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Variety</label>
          <Input {...register("variety", { required: true })} placeholder="KRAFT PAPER" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">GSM</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("gsm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">BF</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("bf", { required: true, valueAsNumber: true })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Bulk Factor</label>
          <Input type="number" step="0.001" inputMode="decimal" {...register("bulk_factor", { valueAsNumber: true })} placeholder="1.300" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Ply Bond</label>
          <Input type="number" step="0.01" {...register("ply_bond")} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Derived Thickness (mm)</label>
        <Input value={derivedThickness ? derivedThickness.toFixed(4) : ""} readOnly disabled />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function AdhesiveForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Variety</label>
          <Input {...register("variety", { required: true })} placeholder="TL4(Vinsol)" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Internal Code</label>
          <Input {...register("internal_code", { required: true })} placeholder="20100" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Solid %</label>
          <Input type="number" step="0.01" {...register("solid_content_percent")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Viscosity</label>
          <Input type="number" step="0.01" {...register("viscosity")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">pH</label>
          <Input type="number" step="0.01" {...register("ph")} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

type ParchmentVendorOption = {
  id: string
  name: string
}

type ParchmentFormProps = MasterFormProps & {
  vendorOptions?: ParchmentVendorOption[]
}

export function ParchmentForm({ initialData, onSubmit, onCancel, vendorOptions = [] }: ParchmentFormProps) {
  const defaultVendorId =
    initialData?.vendor_id ||
    vendorOptions.find((vendor) => vendor.name === initialData?.vendor_name)?.id ||
    ""
  const { register, handleSubmit, watch } = useForm({
    defaultValues: {
      ...initialData,
      vendor_id: defaultVendorId || (vendorOptions.length ? vendorOptions[0]?.id : ""),
      vendor_name: initialData?.vendor_name || "",
    },
  })
  const selectedVendorId = watch("vendor_id")
  const isCreatingVendor = selectedVendorId === "__new__" || (!selectedVendorId && vendorOptions.length === 0)
  const vendorHelp = useMemo(() => {
    if (isCreatingVendor) return "Create a new company, then attach the sub parchment under it."
    return "Pick one of the approved companies, then add the sub parchment."
  }, [isCreatingVendor])

  const submit = handleSubmit((data) => {
    const vendorId = String(data.vendor_id || "").trim()
    const vendorName = String(data.vendor_name || "").trim()
    onSubmit({
      vendor_id: vendorId && vendorId !== "__new__" ? vendorId : undefined,
      vendor_name: vendorId === "__new__" || !vendorId ? vendorName : undefined,
      color_name: String(data.color_name || "").trim(),
      display_name: String(data.display_name || "").trim() || undefined,
    })
  })

  return (
    <form onSubmit={submit} className="space-y-4">
      {vendorOptions.length > 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">Company</label>
          <select
            {...register("vendor_id", { required: true })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {vendorOptions.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
            <option value="__new__">Add new company...</option>
          </select>
          <p className="text-xs text-slate-500">{vendorHelp}</p>
        </div>
      ) : null}
      {isCreatingVendor || vendorOptions.length === 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">New Company Name</label>
          <Input {...register("vendor_name", { required: true })} placeholder="Amma / China / Sagar" />
        </div>
      ) : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Sub Parchment / Color</label>
        <Input {...register("color_name", { required: true })} placeholder="Blue / Red / Printed / Kraft" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function TubeSizeForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Inner Dia (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("inner_diameter_mm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Outer Dia (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("outer_diameter_mm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("length_mm", { required: true, valueAsNumber: true })} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Input {...register("description")} placeholder="34 x 40 x 980 sleeve" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function MandrelForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  const submit = handleSubmit((data) => {
    const outerDiameter = Number(data.outer_diameter_mm)
    const lengthMm = Number(data.length_mm)
    onSubmit({
      outer_diameter_mm: Number.isFinite(outerDiameter) ? outerDiameter : undefined,
      length_mm: Number.isFinite(lengthMm) ? lengthMm : undefined,
    })
  })
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">OD (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("outer_diameter_mm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("length_mm", { required: true, valueAsNumber: true })} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function CustomerForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Customer Name</label>
          <Input {...register("name", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Customer Code</label>
          <Input {...register("customer_code", { required: true })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">PAN No</label>
          <Input {...register("pan_no")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">GST No</label>
          <Input {...register("gst_no")} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Address</label>
        <Input {...register("address")} placeholder="Customer address" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function PlantForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Plant Code</label>
          <Input {...register("code", { required: true })} placeholder="PLANT-1" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Plant Name</label>
          <Input {...register("name", { required: true })} placeholder="Main Factory" />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Address</label>
        <Input {...register("address")} placeholder="123 Industrial Area" />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

const MACHINE_CAPACITY_TYPE_BY_DEPARTMENT: Record<string, string> = {
  SLITTING: "REELS_PER_DAY",
  WINDER: "METERS_PER_DAY",
  OVEN: "BATCHES_PER_DAY",
  PROCESS: "TUBES_PER_DAY",
  PACKING: "TUBES_PER_DAY",
}

const MACHINE_DEPARTMENT_COPY: Record<string, { title: string; help: string; capacity: string; placeholder: string }> = {
  SLITTING: {
    title: "Slitting setup",
    help: "Use only for reel conversion work before winding. Keep this narrow so planners do not route normal tube jobs here.",
    capacity: "Reels converted per shift",
    placeholder: "3",
  },
  WINDER: {
    title: "Winder setup",
    help: "Enter meters made in one shift. ID, OD, length, and mandrel fit are used before the planner allows a job here.",
    capacity: "Meters made per shift",
    placeholder: "14000",
  },
  OVEN: {
    title: "Oven setup",
    help: "Enter batch cycles possible in one shift, then bamboo capacity per batch and curing hours.",
    capacity: "Batch cycles per shift",
    placeholder: "2",
  },
  PROCESS: {
    title: "Process setup",
    help: "Use for finishing/process machines after oven. Capacity is tubes completed in one shift.",
    capacity: "Tubes completed per shift",
    placeholder: "11000",
  },
  PACKING: {
    title: "Packing setup",
    help: "Use for final packing lanes. Capacity is packed tubes in one shift.",
    capacity: "Tubes packed per shift",
    placeholder: "12000",
  },
}

export function MachineForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit, watch, setValue } = useForm({
    defaultValues: {
      department: "WINDER",
      capacity_type: "METERS_PER_DAY",
      machine_state:
        initialData && (initialData.is_active === false || initialData.active === false)
          ? "DISABLED"
          : String(initialData?.status || "UP").toUpperCase(),
      cycle_time_hours: 5.5,
      batch_bamboo_capacity: 500,
      ...initialData,
    },
  })
  const department = String(watch("department") || "WINDER").toUpperCase()
  const machineState = String(watch("machine_state") || "UP").toUpperCase()
  const capacityValue = Number(watch("capacity_value") || 0)
  const batchBambooCapacity = Number(watch("batch_bamboo_capacity") || 0)
  const ovenShiftBamboo = department === "OVEN" && capacityValue > 0 && batchBambooCapacity > 0
    ? capacityValue * batchBambooCapacity
    : 0
  const dailyCapacity = department === "OVEN" ? ovenShiftBamboo * 2 : capacityValue * 2
  const selectedCopy = MACHINE_DEPARTMENT_COPY[department] || MACHINE_DEPARTMENT_COPY.WINDER

  useEffect(() => {
    setValue("capacity_type", MACHINE_CAPACITY_TYPE_BY_DEPARTMENT[department] || "TUBES_PER_DAY")
  }, [department, setValue])

  const submitMachine = (payload: any) => {
    const normalizedDepartment = String(payload.department || department).toUpperCase()
    const normalizedState = String(payload.machine_state || machineState || "UP").toUpperCase()
    const isDisabled = normalizedState === "DISABLED"
    const nextPayload: any = {
      code: payload.code,
      name: payload.name,
      department: normalizedDepartment,
      capacity_type: MACHINE_CAPACITY_TYPE_BY_DEPARTMENT[normalizedDepartment] || "TUBES_PER_DAY",
      capacity_value: Number(payload.capacity_value || 0),
      status: isDisabled ? "DOWN" : normalizedState,
      is_active: !isDisabled,
      id_min_mm: Number(payload.id_min_mm || 1),
      id_max_mm: Number(payload.id_max_mm || 999),
      od_min_mm: Number(payload.od_min_mm || 1),
      od_max_mm: Number(payload.od_max_mm || 999),
      length_min_mm: Number(payload.length_min_mm || 1),
      length_max_mm: Number(payload.length_max_mm || 9999),
      supported_mandrel_ids: Array.isArray(payload.supported_mandrel_ids) ? payload.supported_mandrel_ids : [],
    }
    if (normalizedDepartment === "OVEN") {
      nextPayload.batch_bamboo_capacity = Number(payload.batch_bamboo_capacity || 500)
      nextPayload.cycle_time_hours = Number(payload.cycle_time_hours || 5.5)
    } else {
      nextPayload.batch_bamboo_capacity = null
      nextPayload.cycle_time_hours = null
    }
    onSubmit(nextPayload)
  }

  return (
    <form onSubmit={handleSubmit(submitMachine)} className="max-h-[78vh] space-y-5 overflow-y-auto px-1 pb-1">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white">
        <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">{selectedCopy.title}</p>
            <h3 className="mt-2 text-xl font-semibold">Two-shift machine contract</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{selectedCopy.help}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Planning rule</p>
            <p className="mt-2 text-2xl font-semibold">2 shifts/day</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">Capacity is entered per shift. Daily visible capacity is calculated, not typed.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Machine Code</label>
          <Input className="h-12 rounded-2xl" {...register("code", { required: true })} placeholder="W-01" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Machine Name</label>
          <Input className="h-12 rounded-2xl" {...register("name", { required: true })} placeholder="Winder 1" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Process</label>
          <select {...register("department", { required: true })} className="flex h-12 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm">
            <option value="SLITTING">Slitting</option>
            <option value="WINDER">Winder</option>
            <option value="OVEN">Oven</option>
            <option value="PROCESS">Process</option>
            <option value="PACKING">Packing</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Machine State</label>
          <select {...register("machine_state", { required: true })} className="flex h-12 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm">
            <option value="UP">Running / available</option>
            <option value="MAINT">Maintenance</option>
            <option value="DOWN">Down, keep visible</option>
            <option value="DISABLED">Disabled, hide from production</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Capacity Unit</label>
          <input type="hidden" {...register("capacity_type", { required: true })} />
          <div className="flex h-12 items-center rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            {selectedCopy.capacity}
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-3xl border border-cyan-100 bg-cyan-50/70 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-cyan-950">{selectedCopy.capacity}</label>
          <Input
            className="h-12 rounded-2xl border-cyan-200 bg-white"
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder={selectedCopy.placeholder}
            {...register("capacity_value", { required: true, valueAsNumber: true })}
          />
          <p className="text-xs leading-5 text-cyan-900">
            This value is one shift only. The planner creates Shift A and Shift B separately every day.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/85 p-3">
            <Gauge className="h-4 w-4 text-cyan-700" />
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Per shift</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">
              {department === "OVEN" ? ovenShiftBamboo.toFixed(0) : capacityValue ? capacityValue.toFixed(0) : "-"}
            </p>
          </div>
          <div className="rounded-2xl bg-white/85 p-3">
            <Factory className="h-4 w-4 text-cyan-700" />
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Two shifts</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{dailyCapacity ? dailyCapacity.toFixed(0) : "-"}</p>
          </div>
        </div>
      </div>

      {department === "OVEN" ? (
        <div className="grid gap-4 rounded-3xl border border-amber-100 bg-amber-50/70 p-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-amber-950">Bamboos per batch</label>
            <Input className="h-12 rounded-2xl bg-white" type="number" step="1" inputMode="numeric" {...register("batch_bamboo_capacity", { required: true, valueAsNumber: true })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-amber-950">Cycle hours per batch</label>
            <Input className="h-12 rounded-2xl bg-white" type="number" step="0.1" inputMode="decimal" {...register("cycle_time_hours", { required: true, valueAsNumber: true })} />
          </div>
          <div className="rounded-2xl bg-white/85 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">Planner capacity</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{ovenShiftBamboo.toFixed(0)} bamboo/shift</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Used to split oven slots by load, not just batch count.</p>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Capability window</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Keep ranges tight so wrong-size job cards cannot be scheduled onto this machine.
            </p>
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
            machineState === "UP"
              ? "bg-emerald-50 text-emerald-700"
              : machineState === "MAINT"
                ? "bg-amber-50 text-amber-700"
                : "bg-slate-100 text-slate-600"
          }`}>
            {machineState === "UP" ? "Available" : machineState === "MAINT" ? "Maintenance" : machineState === "DISABLED" ? "Disabled" : "Down"}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">ID Range (mm)</label>
          <div className="flex gap-2">
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("id_min_mm", { valueAsNumber: true })} placeholder="Min" />
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("id_max_mm", { valueAsNumber: true })} placeholder="Max" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">OD Range (mm)</label>
          <div className="flex gap-2">
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("od_min_mm", { valueAsNumber: true })} placeholder="Min" />
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("od_max_mm", { valueAsNumber: true })} placeholder="Max" />
          </div>
        </div>
        </div>
        <div className="mt-4 space-y-2">
          <label className="text-sm font-semibold text-slate-800">Length Range (mm)</label>
          <div className="flex gap-2">
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("length_min_mm", { valueAsNumber: true })} placeholder="Min" />
            <Input className="h-11 rounded-2xl" type="number" step="0.01" {...register("length_max_mm", { valueAsNumber: true })} placeholder="Max" />
          </div>
        </div>
      </div>

      {machineState !== "UP" ? (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {machineState === "MAINT" ? <Wrench className="mt-0.5 h-4 w-4 shrink-0" /> : <Power className="mt-0.5 h-4 w-4 shrink-0" />}
          <p>
            {machineState === "MAINT"
              ? "Maintenance machines stay visible to planners but cannot receive scheduled cards."
              : "Down or disabled machines are blocked from scheduling; disabled machines are also hidden from production selectors."}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          <BadgeCheck className="h-4 w-4" />
          Available machines can be selected by sales release, planner, reel issue, and shop-floor handoff.
        </div>
      )}

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function PackagingBoxForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Code</label>
          <Input {...register("code", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Color</label>
          <Input {...register("size_label", { required: true })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" step="0.01" {...register("length_mm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Width (mm)</label>
          <Input type="number" step="0.01" {...register("width_mm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Height (mm)</label>
          <Input type="number" step="0.01" {...register("height_mm", { required: true })} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Weight (kg)</label>
        <Input type="number" step="0.0001" {...register("weight_kg")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function PlasticSheetForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">SKU</label>
          <Input {...register("sku", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Size Label</label>
          <Input {...register("size_label", { required: true })} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Weight (kg)</label>
        <Input type="number" step="0.0001" {...register("weight_kg")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function FaddaForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">SKU</label>
        <Input {...register("sku", { required: true })} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Weight (kg)</label>
        <Input type="number" step="0.0001" {...register("weight_kg")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function ToolForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Category</label>
          <select
            {...register("category", { required: true })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="NOTCHING_HOLDER">Notching Holder</option>
            <option value="NOTCHING_BLADE">Notching Blade</option>
            <option value="GROOVE">Groove</option>
            <option value="PUNCH">Punch</option>
            <option value="TOCHHA">Tochha</option>
            <option value="WIDER_TOOL">Wider Tool</option>
            <option value="DIE">Die</option>
            <option value="BOX">Box</option>
            <option value="GURU">Guru</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Department</label>
          <select
            {...register("department", { required: true })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="WINDER">Winder</option>
            <option value="OVEN">Oven</option>
            <option value="PROCESS">Process</option>
            <option value="PACKING">Packing</option>
            <option value="COMMON">Common</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input {...register("name", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Code</label>
          <Input {...register("code")} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Subcategory</label>
        <Input {...register("subcategory")} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Spec Text</label>
        <Input {...register("spec_text")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}
