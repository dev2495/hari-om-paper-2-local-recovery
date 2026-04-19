"use client"

import { CrudTable } from "@/components/common/crud-table"
import { PlantForm } from "@/components/forms/master-forms"
import { useCreatePlant, useDeletePlant, usePlants, useUpdatePlant } from "@/hooks/use-system"

export default function PlantsPage() {
    const { data, isLoading } = usePlants()
    const createMutation = useCreatePlant()
    const updateMutation = useUpdatePlant()
    const deleteMutation = useDeletePlant()

    const columns = [
        { header: "Code", accessorKey: "code" },
        { header: "Name", accessorKey: "name" },
        { header: "Address", accessorKey: "address" },
        {
            header: "Status",
            accessorKey: "is_active",
            render: (val: boolean) => (
                <span className={`status-chip ${val ? 'status-chip-ok' : 'status-chip-warn'}`}>
                    {val ? 'Active' : 'Inactive'}
                </span>
            )
        },
    ]

    return (
        <CrudTable
            title="Plants"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(payload) => createMutation.mutateAsync(payload)}
            onEdit={(id, payload) => updateMutation.mutateAsync({ id, data: payload })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={PlantForm}
        />
    )
}
