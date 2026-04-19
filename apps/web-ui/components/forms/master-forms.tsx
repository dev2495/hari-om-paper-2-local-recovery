"use client"

import { useMemo } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

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
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Price</label>
          <Input type="number" step="0.01" {...register("price")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Derived Thickness (mm)</label>
          <Input value={derivedThickness ? derivedThickness.toFixed(4) : ""} readOnly disabled />
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
      <div className="space-y-2">
        <label className="text-sm font-medium">Color</label>
        <Input {...register("color")} placeholder="Amber" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Recipe / Notes</label>
        <textarea
          {...register("recipe_text")}
          rows={4}
          className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Standard mix notes, dilution notes, or viscosity handling"
        />
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
    if (isCreatingVendor) return "Create a new vendor, then attach the parchment color under it."
    return "Pick one of the approved vendors, then add the parchment color or pattern."
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
          <label className="text-sm font-medium">Vendor</label>
          <select
            {...register("vendor_id", { required: true })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {vendorOptions.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
            <option value="__new__">Add new vendor…</option>
          </select>
          <p className="text-xs text-slate-500">{vendorHelp}</p>
        </div>
      ) : null}
      {isCreatingVendor || vendorOptions.length === 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">New Vendor Name</label>
          <Input {...register("vendor_name", { required: true })} placeholder="Amma / China / Sagar" />
        </div>
      ) : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Color Name</label>
        <Input {...register("color_name", { required: true })} placeholder="Blue / Red / Printed / Kraft" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Display Name</label>
        <Input {...register("display_name")} placeholder="Sagar Blue / Amma White" />
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
    const tolerance = Number(data.od_tolerance_mm)
    onSubmit({
      ...data,
      mandrel_code: String(data.mandrel_code || "").trim(),
      outer_diameter_mm: Number.isFinite(outerDiameter) ? outerDiameter : undefined,
      od_tolerance_mm: Number.isFinite(tolerance) ? tolerance : 0.1,
      length_mm: Number.isFinite(lengthMm) ? lengthMm : undefined,
      material: String(data.material || "").trim() || null,
    })
  })
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Mandrel Code</label>
        <Input {...register("mandrel_code", { required: true })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Outer Diameter (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("outer_diameter_mm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">OD Tolerance (± mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" placeholder="0.10" {...register("od_tolerance_mm", { valueAsNumber: true })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" step="0.01" inputMode="decimal" {...register("length_mm", { required: true, valueAsNumber: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Material</label>
          <Input {...register("material")} placeholder="Steel" />
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
          <label className="text-sm font-medium">Customer Code</label>
          <Input {...register("customer_code", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input {...register("name", { required: true })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Primary Contact Name</label>
          <Input {...register("primary_contact_name")} placeholder="Dispatch coordinator" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Primary Contact Phone</label>
          <Input {...register("primary_contact_phone")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Primary Contact Email</label>
          <Input type="email" {...register("primary_contact_email")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Address</label>
          <Input {...register("address")} placeholder="Customer address" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Billing Address</label>
          <Input {...register("billing_address")} placeholder="Billing address" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Shipping Address</label>
          <Input {...register("shipping_address")} placeholder="Shipping address" />
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
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Dispatch Contact Name</label>
          <Input {...register("dispatch_contact_name")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Dispatch Contact Phone</label>
          <Input {...register("dispatch_contact_phone")} />
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

export function MachineForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto max-h-[70vh] px-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Machine Code</label>
          <Input {...register("code", { required: true })} placeholder="W-01" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Machine Name</label>
          <Input {...register("name", { required: true })} placeholder="Winder 1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Department</label>
          <select {...register("department", { required: true })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            <option value="WINDER">Winder</option>
            <option value="OVEN">Oven</option>
            <option value="PROCESS">Process</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Capacity Type</label>
          <select {...register("capacity_type", { required: true })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            <option value="TUBES_PER_SHIFT">Tubes per Shift</option>
            <option value="TUBES_PER_HOUR">Tubes per Hour</option>
            <option value="KG_PER_HOUR">KG per Hour</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Capacity Value</label>
        <Input type="number" {...register("capacity_value", { required: true })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">ID Range (mm)</label>
          <div className="flex gap-2">
            <Input type="number" {...register("id_min_mm")} placeholder="Min" />
            <Input type="number" {...register("id_max_mm")} placeholder="Max" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">OD Range (mm)</label>
          <div className="flex gap-2">
            <Input type="number" {...register("od_min_mm")} placeholder="Min" />
            <Input type="number" {...register("od_max_mm")} placeholder="Max" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Length Range (mm)</label>
        <div className="flex gap-2">
          <Input type="number" {...register("length_min_mm")} placeholder="Min" />
          <Input type="number" {...register("length_max_mm")} placeholder="Max" />
        </div>
      </div>
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
          <label className="text-sm font-medium">Size Label</label>
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
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Weight (kg)</label>
          <Input type="number" step="0.0001" {...register("weight_kg")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Rate / Piece</label>
          <Input type="number" step="0.0001" {...register("rate_per_piece")} />
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
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Weight (kg)</label>
          <Input type="number" step="0.0001" {...register("weight_kg")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Rate / Kg</label>
          <Input type="number" step="0.0001" {...register("rate_per_kg")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Rate / Piece</label>
          <Input type="number" step="0.0001" {...register("rate_per_piece")} />
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

export function FaddaForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">SKU</label>
        <Input {...register("sku", { required: true })} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Weight (kg)</label>
          <Input type="number" step="0.0001" {...register("weight_kg")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Rate / Kg</label>
          <Input type="number" step="0.0001" {...register("rate_per_kg")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Rate / Piece</label>
          <Input type="number" step="0.0001" {...register("rate_per_piece")} />
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
