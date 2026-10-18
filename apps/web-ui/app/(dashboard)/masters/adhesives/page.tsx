"use client"

import { CrudTable } from "@/components/common/crud-table"
import { AdhesiveForm } from "@/components/forms/master-forms"
import { useAdhesives, useCreateAdhesive, useUpdateAdhesive, useDeleteAdhesive } from "@/hooks/use-master-data"

export default function AdhesivesPage() {
    const { data, isLoading } = useAdhesives({ include_inactive: true })
    const createMutation = useCreateAdhesive()
    const updateMutation = useUpdateAdhesive()
    const deleteMutation = useDeleteAdhesive()

    const columns = [
        { header: "Variety", accessorKey: "variety" },
        { header: "Code", accessorKey: "internal_code" },
        { header: "Solid %", accessorKey: "solid_content_percent" },
        { header: "Viscosity", accessorKey: "viscosity" },
        { header: "pH", accessorKey: "ph" },
    ]

    return (
        <CrudTable
            title="Adhesives"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(data) => createMutation.mutateAsync(data)}
            onEdit={(id, data) => updateMutation.mutateAsync({ id, data })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={AdhesiveForm}
            qcBand={(row) => row?.internal_code ? {
                materialType: "ADHESIVE", scope: "ITEM", scopeKey: String(row.internal_code), title: `${row.internal_code}${row.name ? ` · ${row.name}` : ""}`,
                subtitle: row.variety || undefined, group: row.variety || null,
                nominals: { viscosity: row.viscosity, solid_content: row.solid_content_percent, ph: row.ph },
            } : null}
        />
    )
}
