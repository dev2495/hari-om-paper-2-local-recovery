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
        {
            header: "Capacity",
            accessorKey: "capacity_value",
            render: (val: any, row: any) => {
                const capacityValue = Number.isFinite(Number(val)) ? Number(val) : 0
                if (String(row.department).toUpperCase() === "OVEN") {
                    const batchSize = Number(row.batch_bamboo_capacity || 0)
                    const cycleHours = Number(row.cycle_time_hours || 0)
                    const dailyBamboo = capacityValue * batchSize
                    return `${capacityValue || "-"} batches/day · ${batchSize || "-"} bamboo/batch · ${cycleHours || "-"}h cycle · ${dailyBamboo || 0} bamboo/day`
                }
                return `${capacityValue || "-"} ${row.capacity_type?.replace(/_/g, ' ') || "capacity"}`
            }
        },
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
            onAdd={(payload) => createMutation.mutateAsync(payload)}
            onEdit={(id, payload) => updateMutation.mutateAsync({ id, data: payload })}
            onDelete={(id) => deleteMutation.mutate(id)}
            FormComponent={MachineForm}
            dialogContentClassName="max-w-2xl"
        />
    )
}
