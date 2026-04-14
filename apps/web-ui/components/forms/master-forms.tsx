"use client"

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
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
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
          <Input type="number" {...register("gsm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">BF</label>
          <Input type="number" step="0.01" {...register("bf", { required: true })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Bulk Factor</label>
          <Input type="number" step="0.01" {...register("bulk_factor")} placeholder="1.00" />
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
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

export function ParchmentForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Vendor Name</label>
        <Input {...register("vendor_name", { required: true })} placeholder="Vendor" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Color Name</label>
        <Input {...register("color_name", { required: true })} placeholder="Blue" />
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
          <Input type="number" {...register("inner_diameter_mm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Outer Dia (mm)</label>
          <Input type="number" {...register("outer_diameter_mm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" {...register("length_mm", { required: true })} />
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

export function MandrelForm({ initialData, onSubmit, onCancel }: MasterFormProps) {
  const { register, handleSubmit } = useForm({ defaultValues: initialData })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Mandrel Code</label>
        <Input {...register("mandrel_code", { required: true })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Outer Diameter (mm)</label>
          <Input type="number" {...register("outer_diameter_mm", { required: true })} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Length (mm)</label>
          <Input type="number" {...register("length_mm", { required: true })} />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Material</label>
        <Input {...register("material")} placeholder="Steel" />
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
          <label className="text-sm font-medium">Contact Email</label>
          <Input type="email" {...register("contact_email")} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Contact Phone</label>
          <Input {...register("contact_phone")} />
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
