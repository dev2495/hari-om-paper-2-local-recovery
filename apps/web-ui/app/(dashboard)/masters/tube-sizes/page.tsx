"use client"

import { CrudTable } from "@/components/common/crud-table"
import { TubeSizeForm } from "@/components/forms/master-forms"
import { useTubeSizes, useCreateTubeSize, useUpdateTubeSize, useDeleteTubeSize } from "@/hooks/use-master-data"

export default function TubeSizesPage() {
    const { data, isLoading } = useTubeSizes({ include_inactive: true })
    const createMutation = useCreateTubeSize()
    const updateMutation = useUpdateTubeSize()
    const deleteMutation = useDeleteTubeSize()

    const columns = [
        { header: "Inner Dia (mm)", accessorKey: "inner_diameter_mm" },
        { header: "Outer Dia (mm)", accessorKey: "outer_diameter_mm" },
        { header: "Length (mm)", accessorKey: "length_mm" },
        { header: "Description", accessorKey: "description" },
    ]

    return (
        <CrudTable
            title="Tube Sizes"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutateAsync(data)}
            onEdit={(id, data) => updateMutation.mutateAsync({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={TubeSizeForm}
        />
    )
}
