"use client"

import { CrudTable } from "@/components/common/crud-table"
import { ParchmentForm } from "@/components/forms/master-forms"
import { useParchments, useCreateParchment, useUpdateParchment, useDeleteParchment } from "@/hooks/use-master-data"

export default function ParchmentsPage() {
    const { data, isLoading } = useParchments()
    const createMutation = useCreateParchment()
    const updateMutation = useUpdateParchment()
    const deleteMutation = useDeleteParchment()

    const columns = [
        { header: "Vendor", accessorKey: "vendor_name" },
        { header: "Color", accessorKey: "color_name" },
        { header: "Display", accessorKey: "display_name" },
    ]

    return (
        <CrudTable
            title="Parchments"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutate(data)}
            onEdit={(id, data) => updateMutation.mutate({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={ParchmentForm}
        />
    )
}
