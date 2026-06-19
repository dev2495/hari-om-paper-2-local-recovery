"use client"

import { CrudTable } from "@/components/common/crud-table"
import { MandrelForm } from "@/components/forms/master-forms"
import { useMandrels, useCreateMandrel, useUpdateMandrel, useDeleteMandrel } from "@/hooks/use-master-data"

export default function MandrelsPage() {
    const { data, isLoading } = useMandrels()
    const createMutation = useCreateMandrel()
    const updateMutation = useUpdateMandrel()
    const deleteMutation = useDeleteMandrel()

    const columns = [
        { header: "OD (mm)", accessorKey: "outer_diameter_mm" },
        { header: "Length (mm)", accessorKey: "length_mm" },
    ]

    return (
        <CrudTable
            title="Mandrels"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutateAsync(data)}
            onEdit={(id, data) => updateMutation.mutateAsync({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={MandrelForm}
        />
    )
}
