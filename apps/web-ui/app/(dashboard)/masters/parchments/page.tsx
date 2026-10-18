"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, PowerOff, Ruler, SwatchBook, Tags } from "lucide-react"

import { CrudTable } from "@/components/common/crud-table"
import { MastersNav } from "@/components/master/masters-nav"
import { QcBandDialog, type QcBandTarget } from "@/components/qc/QcBandDialog"
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
  useDeleteParchmentVendor,
  useDeleteParchment,
  useParchmentVendors,
  useParchments,
  useUpdateParchmentVendor,
  useUpdateParchment,
} from "@/hooks/use-master-data"

function CompanyQuickForm({
  initialName = "",
  onSubmit,
  onCancel,
}: {
  initialName?: string
  onSubmit: (data: { name: string }) => Promise<any>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(initialName)
  }, [initialName])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) {
      setError("Company name is required.")
      return
    }
    setError(null)
    try {
      await onSubmit({ name: nextName })
      setName("")
      onCancel()
    } catch (submissionError: any) {
      setError(submissionError?.response?.data?.detail || submissionError?.message || "Unable to save company")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">{error}</div> : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Company Name</label>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Amma / China / Sagar" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Company</Button>
      </div>
    </form>
  )
}

export default function ParchmentsPage() {
  const { data: vendors = [], isLoading: vendorsLoading } = useParchmentVendors({ include_inactive: true })
  const { data: colors = [], isLoading: colorsLoading } = useParchments({ include_inactive: true })
  const createVendor = useCreateParchmentVendor()
  const updateVendor = useUpdateParchmentVendor()
  const deleteVendor = useDeleteParchmentVendor()
  const createColor = useCreateParchment()
  const updateColor = useUpdateParchment()
  const deleteColor = useDeleteParchment()
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<{ id: string; name: string } | null>(null)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [bandTarget, setBandTarget] = useState<QcBandTarget | null>(null)

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
    <div className="min-w-0 space-y-4">
      <MastersNav />
      <section className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Parchments</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">Company first, then its colours (sub parchments). The spec sheet allows parchment by company; orders and stock use the colour rows. Inward QC bands can be set per company or per colour.</p>
          </div>
          <div className="flex shrink-0 gap-2 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 font-semibold"><Tags className="h-3.5 w-3.5 text-muted-foreground" />{vendorOptions.length} companies</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 font-semibold"><SwatchBook className="h-3.5 w-3.5 text-muted-foreground" />{activeColors.length} colours</span>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Companies</h2>
              <p className="text-[12.5px] text-muted-foreground">Parchment families allowed on spec sheets</p>
            </div>
            <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
              <DialogTrigger asChild>
                <Button className="h-9 rounded-lg">
                  <Plus className="mr-2 h-4 w-4" />
                  Add company
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add company</DialogTitle>
                  <DialogDescription>Create a parchment company family that should appear in the spec-sheet allowed list.</DialogDescription>
                </DialogHeader>
                <CompanyQuickForm
                  onSubmit={(data) => createVendor.mutateAsync(data)}
                  onCancel={() => setVendorDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
          {companyError ? (
            <div className="mt-4 rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">
              {companyError}
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {vendorOptions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
                No companies yet. Add the parchment companies first, then add the actual sub parchments under each one.
              </div>
            ) : (
              vendorOptions.map((vendor) => {
                const count = activeColors.filter((row: any) => row.vendor_id === vendor.id).length
                return (
                  <div key={vendor.id} className="rounded-lg border border-border bg-card px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-foreground">{vendor.name}</p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{count} colour{count === 1 ? "" : "s"}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setBandTarget({ materialType: "PARCHMENT", scope: "GROUP", scopeKey: vendor.name, title: vendor.name, subtitle: "Company — applies to all its colours unless a colour sets its own" })}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft px-2 text-[12px] font-semibold text-signal-cyan-ink"
                          title="Inward QC band for this company"
                        >
                          <Ruler className="h-3.5 w-3.5" />QC band
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCompanyError(null)
                            setEditingVendor(vendor)
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted"
                          title="Edit company"
                          aria-label="Edit company"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setCompanyError(null)
                            try {
                              await deleteVendor.mutateAsync(vendor.id)
                            } catch (error: any) {
                              setCompanyError(error?.response?.data?.detail || error?.message || "Company removal failed.")
                            }
                          }}
                          disabled={count > 0 || deleteVendor.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-signal-amber-line hover:text-signal-amber-ink disabled:cursor-not-allowed disabled:opacity-45"
                          title={count > 0 ? "Remove sub parchments before removing this company" : "Disable company"}
                          aria-label={count > 0 ? "Company has linked sub parchments" : "Disable company"}
                        >
                          <PowerOff className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <CrudTable
          embedded
          title="Parchments"
          columns={[
            { header: "Sub Parchment", accessorKey: "color_name" },
            { header: "Company", accessorKey: "vendor_name" },
            { header: "Display", accessorKey: "display_name" },
          ]}
          data={activeColors}
          isLoading={colorsLoading || vendorsLoading}
          onAdd={(data) => createColor.mutateAsync(data)}
          onEdit={(id, data) => updateColor.mutateAsync({ id, data })}
          onDelete={(id) => deleteColor.mutate(id)}
          FormComponent={(props) => <ParchmentForm {...props} vendorOptions={vendorOptions} />}
          qcBand={(row) => row?.vendor_name && row?.color_name ? {
            materialType: "PARCHMENT", scope: "SUBGROUP", scopeKey: `${row.vendor_name}||${row.color_name}`, title: `${row.color_name} · ${row.vendor_name}`,
            subtitle: "Colour — overrides the company band",
          } : null}
        />
      </section>

      <QcBandDialog target={bandTarget} onClose={() => setBandTarget(null)} />

      <Dialog open={!!editingVendor} onOpenChange={(open) => !open && setEditingVendor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
            <DialogDescription>Rename the parchment company without changing its linked sub parchments.</DialogDescription>
          </DialogHeader>
          {editingVendor ? (
            <CompanyQuickForm
              initialName={editingVendor.name}
              onSubmit={(data) => updateVendor.mutateAsync({ id: editingVendor.id, data })}
              onCancel={() => setEditingVendor(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
