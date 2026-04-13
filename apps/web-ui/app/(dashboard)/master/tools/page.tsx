"use client"

import { CrudTable } from "@/components/common/crud-table"
import { ToolForm } from "@/components/forms/master-forms"
import { useCreateTool, useDeleteTool, useTools, useUpdateTool } from "@/hooks/use-master-data"

export default function ToolsPage() {
  const { data, isLoading } = useTools()
  const createMutation = useCreateTool()
  const updateMutation = useUpdateTool()
  const deleteMutation = useDeleteTool()

  return (
    <CrudTable
      title="Tool Masters"
      columns={[
        { header: "Category", accessorKey: "category" },
        { header: "Name", accessorKey: "name" },
        { header: "Code", accessorKey: "code" },
        { header: "Department", accessorKey: "department" },
        { header: "Spec Text", accessorKey: "spec_text" },
      ]}
      data={data || []}
      isLoading={isLoading}
      onAdd={(data) => createMutation.mutate(data)}
      onEdit={(id, data) => updateMutation.mutate({ id, data })}
      onDelete={(id) => deleteMutation.mutate(id)}
      FormComponent={ToolForm}
    />
  )
}
