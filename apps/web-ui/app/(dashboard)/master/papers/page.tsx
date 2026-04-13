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
    { header: "Name", accessorKey: "name" },
    { header: "GSM", accessorKey: "gsm" },
    { header: "Type", accessorKey: "type" },
  ]

  return (
    <CrudTable
      title="Papers"
      columns={columns}
      data={data}
      isLoading={isLoading}
      onAdd={(data) => createMutation.mutate(data)}
      onEdit={(id, data) => updateMutation.mutate({ id, data })}
      onDelete={(id) => deleteMutation.mutate(id)}
      FormComponent={PaperForm}
    />
  )
}
