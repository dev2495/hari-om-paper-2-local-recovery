"use client"

import { useMemo, useState } from "react"
import { Plus, SwatchBook, Tags } from "lucide-react"

import { CrudTable } from "@/components/common/crud-table"
import { ParchmentForm } from "@/components/forms/master-forms"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  useCreateParchment,
  useCreateParchmentVendor,
  useDeleteParchment,
  useParchmentVendors,
  useParchments,
  useUpdateParchment,
} from "@/hooks/use-master-data"

function VendorQuickForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { name: string }) => Promise<any>
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) {
      setError("Vendor name is required.")
      return
    }
    setError(null)
    try {
      await onSubmit({ name: nextName })
      setName("")
      onCancel()
    } catch (submissionError: any) {
      setError(submissionError?.response?.data?.detail || submissionError?.message || "Unable to save vendor")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Vendor Name</label>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Amma / China / Sagar" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Vendor</Button>
      </div>
    </form>
  )
}

export default function ParchmentsPage() {
  const { data: vendors = [], isLoading: vendorsLoading } = useParchmentVendors()
  const { data: colors = [], isLoading: colorsLoading } = useParchments()
  const createVendor = useCreateParchmentVendor()
  const createColor = useCreateParchment()
  const updateColor = useUpdateParchment()
  const deleteColor = useDeleteParchment()
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false)

  const vendorOptions = useMemo(
    () =>
      (vendors || []).map((vendor: any) => ({
        id: String(vendor.id),
        name: String(vendor.name),
      })),
    [vendors],
  )

  const activeColors = useMemo(
    () => (colors || []).filter((row: any) => !String(row?.id || "").startsWith("vendor:")),
    [colors],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-premium">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Parchment Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Vendor first, then color code</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Keep the vendor directory separate from the actual parchment color entries. The spec sheet only needs the approved vendor families at the top, while downstream flows keep using the actual color rows.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Tags className="h-3.5 w-3.5" />
                Vendors
              </div>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{vendorOptions.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <SwatchBook className="h-3.5 w-3.5" />
                Active colors
              </div>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{activeColors.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-5 shadow-premium">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Approved vendors</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">Vendor directory</h2>
            </div>
            <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Vendor
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add vendor</DialogTitle>
                  <DialogDescription>Create a parchment vendor family that should appear in the spec-sheet allowed list.</DialogDescription>
                </DialogHeader>
                <VendorQuickForm
                  onSubmit={(data) => createVendor.mutateAsync(data)}
                  onCancel={() => setVendorDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
          <div className="mt-5 space-y-3">
            {vendorOptions.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No vendors yet. Add the vendor families first, then add the actual parchment colors under each one.
              </div>
            ) : (
              vendorOptions.map((vendor) => {
                const count = activeColors.filter((row: any) => row.vendor_id === vendor.id).length
                return (
                  <div key={vendor.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-base font-semibold text-slate-950">{vendor.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{count} color entries linked</p>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <CrudTable
          title="Parchments"
          columns={[
            { header: "Vendor", accessorKey: "vendor_name" },
            { header: "Color", accessorKey: "color_name" },
            { header: "Display", accessorKey: "display_name" },
          ]}
          data={activeColors}
          isLoading={colorsLoading || vendorsLoading}
          onAdd={(data) => createColor.mutateAsync(data)}
          onEdit={(id, data) => updateColor.mutateAsync({ id, data })}
          onDelete={(id) => deleteColor.mutate(id)}
          FormComponent={(props) => <ParchmentForm {...props} vendorOptions={vendorOptions} />}
        />
      </section>
    </div>
  )
}
