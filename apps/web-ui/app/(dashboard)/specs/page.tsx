"use client"

import { CrudTable } from "@/components/common/crud-table"
import { SpecForm } from "@/components/forms/spec-form"
import { useSpecs, useCreateSpec } from "@/hooks/use-specs"

export default function SpecsPage() {
  const { data, isLoading } = useSpecs()
  const createMutation = useCreateSpec()
  // Update mutation would go here

  const columns = [
    { header: "Customer", accessorKey: "customer_name" },
    { header: "Tube Size", accessorKey: "tube_size_id", render: (val: any) => val }, // TODO: Map ID to name
    { header: "CS", accessorKey: "target_cs" },
    {
      header: "Status",
      accessorKey: "status",
      render: (val: string) => (
        <span className={`px-2 py-1 rounded text-xs font-semibold ${val === 'APPROVED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          {val || 'DRAFT'}
        </span>
      )
    },
  ]

  return (
    <CrudTable
      title="Specifications"
      columns={columns}
      data={data}
      isLoading={isLoading}
      onAdd={(data) => createMutation.mutate(data)}
      // onEdit... (Assuming separate edit or dialog)
      FormComponent={SpecForm}
      dialogContentClassName="max-w-4xl"
    />
  )
}
