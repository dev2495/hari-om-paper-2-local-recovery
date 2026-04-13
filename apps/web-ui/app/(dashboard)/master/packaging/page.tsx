"use client"

import { CrudTable } from "@/components/common/crud-table"
import { FaddaForm, PackagingBoxForm, PlasticSheetForm } from "@/components/forms/master-forms"
import {
  useCreatePackagingBox,
  useCreatePackagingFadda,
  useCreatePackagingPlasticSheet,
  useDeletePackagingBox,
  useDeletePackagingFadda,
  useDeletePackagingPlasticSheet,
  usePackagingBoxes,
  usePackagingFadda,
  usePackagingPlasticSheets,
  useUpdatePackagingBox,
  useUpdatePackagingFadda,
  useUpdatePackagingPlasticSheet,
} from "@/hooks/use-master-data"

export default function PackagingMasterPage() {
  const boxesQuery = usePackagingBoxes()
  const plasticsQuery = usePackagingPlasticSheets()
  const faddaQuery = usePackagingFadda()

  const createBox = useCreatePackagingBox()
  const updateBox = useUpdatePackagingBox()
  const deleteBox = useDeletePackagingBox()

  const createPlastic = useCreatePackagingPlasticSheet()
  const updatePlastic = useUpdatePackagingPlasticSheet()
  const deletePlastic = useDeletePackagingPlasticSheet()

  const createFadda = useCreatePackagingFadda()
  const updateFadda = useUpdatePackagingFadda()
  const deleteFadda = useDeletePackagingFadda()

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-200/60 bg-gradient-to-r from-slate-900 via-cyan-900 to-cyan-700 p-6 text-white shadow-xl">
        <h1 className="text-3xl font-semibold">Packaging Master</h1>
        <p className="mt-2 max-w-3xl text-sm text-cyan-100">
          Restore the packing dropdowns used by specifications, job-card handoff, and dispatch validation.
        </p>
      </section>

      <CrudTable
        title="Box Masters"
        columns={[
          { header: "Code", accessorKey: "code" },
          { header: "Size Label", accessorKey: "size_label" },
          {
            header: "Dimensions",
            accessorKey: "length_mm",
            render: (_value, row) => `${row.length_mm} x ${row.width_mm} x ${row.height_mm} mm`,
          },
          { header: "Weight (kg)", accessorKey: "weight_kg" },
          { header: "Rate / Piece", accessorKey: "rate_per_piece" },
          { header: "Source", accessorKey: "source" },
        ]}
        data={boxesQuery.data || []}
        isLoading={boxesQuery.isLoading}
        onAdd={(data) => createBox.mutate(data)}
        onEdit={(id, data) => updateBox.mutate({ id, data })}
        onDelete={(id) => deleteBox.mutate(id)}
        FormComponent={PackagingBoxForm}
      />

      <CrudTable
        title="Plastic Sheet Masters"
        columns={[
          { header: "SKU", accessorKey: "sku" },
          { header: "Size Label", accessorKey: "size_label" },
          { header: "Weight (kg)", accessorKey: "weight_kg" },
          { header: "Rate / Kg", accessorKey: "rate_per_kg" },
          { header: "Rate / Piece", accessorKey: "rate_per_piece" },
        ]}
        data={plasticsQuery.data || []}
        isLoading={plasticsQuery.isLoading}
        onAdd={(data) => createPlastic.mutate(data)}
        onEdit={(id, data) => updatePlastic.mutate({ id, data })}
        onDelete={(id) => deletePlastic.mutate(id)}
        FormComponent={PlasticSheetForm}
      />

      <CrudTable
        title="Fadda Masters"
        columns={[
          { header: "SKU", accessorKey: "sku" },
          { header: "Weight (kg)", accessorKey: "weight_kg" },
          { header: "Rate / Kg", accessorKey: "rate_per_kg" },
          { header: "Rate / Piece", accessorKey: "rate_per_piece" },
        ]}
        data={faddaQuery.data || []}
        isLoading={faddaQuery.isLoading}
        onAdd={(data) => createFadda.mutate(data)}
        onEdit={(id, data) => updateFadda.mutate({ id, data })}
        onDelete={(id) => deleteFadda.mutate(id)}
        FormComponent={FaddaForm}
      />
    </div>
  )
}
