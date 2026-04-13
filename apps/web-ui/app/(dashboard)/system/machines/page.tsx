"use client"

import { CrudTable } from "@/components/common/crud-table"
import { MachineForm } from "@/components/forms/master-forms"
import { useCreateMachine, useDeleteMachine, useMachines, useUpdateMachine } from "@/hooks/use-master-data"

export default function MachinesPage() {
    const { data, isLoading } = useMachines()
    const createMutation = useCreateMachine()
    const updateMutation = useUpdateMachine()
    const deleteMutation = useDeleteMachine()

    const columns = [
        { header: "Code", accessorKey: "code" },
        { header: "Name", accessorKey: "name" },
        { header: "Department", accessorKey: "department" },
        { header: "Capacity", accessorKey: "capacity_value", render: (val: any, row: any) => `${val} ${row.capacity_type?.replace(/_/g, ' ')}` },
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
            title="Machines"
            columns={columns}
            data={data}
            isLoading={isLoading}
            onAdd={(payload) => createMutation.mutate(payload)}
            onEdit={(id, payload) => updateMutation.mutate({ id, data: payload })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={MachineForm}
            dialogContentClassName="max-w-2xl"
        />
    )
}
