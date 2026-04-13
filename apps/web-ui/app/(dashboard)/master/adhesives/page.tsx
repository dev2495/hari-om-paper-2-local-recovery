"use client"

import { CrudTable } from "@/components/common/crud-table"
import { AdhesiveForm } from "@/components/forms/master-forms"
import { useAdhesives, useCreateAdhesive, useUpdateAdhesive, useDeleteAdhesive } from "@/hooks/use-master-data"

export default function AdhesivesPage() {
    const { data, isLoading } = useAdhesives()
    const createMutation = useCreateAdhesive()
    const updateMutation = useUpdateAdhesive()
    const deleteMutation = useDeleteAdhesive()

    const columns = [
        { header: "Name", accessorKey: "name" },
        { header: "ID", accessorKey: "id" },
    ]

    return (
        <CrudTable
            title="Adhesives"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutate(data)}
            onEdit={(id, data) => updateMutation.mutate({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={AdhesiveForm}
        />
    )
}
