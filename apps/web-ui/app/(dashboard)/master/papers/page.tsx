"use client"

import { CrudTable } from "@/components/common/crud-table"
import { PaperForm } from "@/components/forms/master-forms"
import { usePapers, useCreatePaper, useUpdatePaper, useDeletePaper } from "@/hooks/use-master-data"

export default function PapersPage() {
  const { data, isLoading } = usePapers()
  const createMutation = useCreatePaper()
  const updateMutation = useUpdatePaper()
  const deleteMutation = useDeletePaper()

  const columns = [
    { header: "Code", accessorKey: "code" },
    { header: "Variety", accessorKey: "variety" },
    { header: "GSM", accessorKey: "gsm" },
    { header: "BF", accessorKey: "bf" },
    { header: "Ply Bond", accessorKey: "ply_bond" },
    { header: "Bulk Factor", accessorKey: "bulk_factor" },
    { header: "Thickness (mm)", accessorKey: "thickness_mm" },
    { header: "Price", accessorKey: "price" },
  ]

  return (
    <CrudTable
      title="Papers"
      columns={columns}
      data={data}
      isLoading={isLoading}
      onAdd={(data) => createMutation.mutateAsync(data)}
      onEdit={(id, data) => updateMutation.mutateAsync({ id, data })}
      onDelete={(id) => deleteMutation.mutate(id)}
      FormComponent={PaperForm}
    />
  )
}
