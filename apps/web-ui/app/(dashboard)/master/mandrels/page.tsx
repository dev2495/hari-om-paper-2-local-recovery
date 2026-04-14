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
        { header: "Mandrel Code", accessorKey: "mandrel_code" },
        { header: "OD (mm)", accessorKey: "outer_diameter_mm" },
        { header: "Length (mm)", accessorKey: "length_mm" },
        { header: "Material", accessorKey: "material" },
    ]

    return (
        <CrudTable
            title="Mandrels"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutate(data)}
            onEdit={(id, data) => updateMutation.mutate({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={MandrelForm}
        />
    )
}
