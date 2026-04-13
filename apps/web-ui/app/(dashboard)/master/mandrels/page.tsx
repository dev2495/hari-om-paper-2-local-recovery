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
        { header: "Name/ID", accessorKey: "name" },
        { header: "Size (mm)", accessorKey: "size" },
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
