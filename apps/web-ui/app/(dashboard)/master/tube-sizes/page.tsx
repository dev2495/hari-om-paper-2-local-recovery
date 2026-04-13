"use client"

import { CrudTable } from "@/components/common/crud-table"
import { TubeSizeForm } from "@/components/forms/master-forms"
import { useTubeSizes, useCreateTubeSize, useUpdateTubeSize, useDeleteTubeSize } from "@/hooks/use-master-data"

export default function TubeSizesPage() {
    const { data, isLoading } = useTubeSizes()
    const createMutation = useCreateTubeSize()
    const updateMutation = useUpdateTubeSize()
    const deleteMutation = useDeleteTubeSize()

    const columns = [
        { header: "Inner Dia (mm)", accessorKey: "inner_dia" },
        { header: "Outer Dia (mm)", accessorKey: "outer_dia" },
        { header: "Length (mm)", accessorKey: "length" },
    ]

    return (
        <CrudTable
            title="Tube Sizes"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutate(data)}
            onEdit={(id, data) => updateMutation.mutate({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={TubeSizeForm}
        />
    )
}
