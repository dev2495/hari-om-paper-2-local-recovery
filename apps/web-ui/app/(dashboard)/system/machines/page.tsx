"use client"

import { CrudTable } from "@/components/common/crud-table"
import { MachineForm } from "@/components/forms/master-forms"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { useCreateMachine, useDeleteMachine, useMachines, useUpdateMachine } from "@/hooks/use-master-data"
import { PowerOff, RotateCcw, Wrench } from "lucide-react"

function machineState(row: any) {
    if (row?.is_active === false || row?.active === false) return "DISABLED"
    return String(row?.status || "UP").toUpperCase()
}

function stateClasses(state: string) {
    if (state === "UP") return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (state === "MAINT") return "border-amber-200 bg-amber-50 text-amber-700"
    if (state === "DOWN") return "border-rose-200 bg-rose-50 text-rose-700"
    return "border-slate-200 bg-slate-100 text-slate-600"
}

function capacitySummary(row: any) {
    const department = String(row.department || "").toUpperCase()
    const value = Number.isFinite(Number(row.capacity_value)) ? Number(row.capacity_value) : 0
    const daily = value * 2
    if (department === "OVEN") {
        const batchSize = Number(row.batch_bamboo_capacity || 0)
        const cycleHours = Number(row.cycle_time_hours || 0)
        const bambooPerShift = value * batchSize
        return `${value || "-"} batch cycles/shift · ${batchSize || "-"} bamboo/batch · ${cycleHours || "-"}h cycle · ${bambooPerShift || 0} bamboo/shift · ${(bambooPerShift * 2) || 0} bamboo/day`
    }
    if (department === "WINDER") return `${value || "-"} meters/shift · ${daily || 0} meters/day`
    if (department === "SLITTING") return `${value || "-"} reels/shift · ${daily || 0} reels/day`
    return `${value || "-"} tubes/shift · ${daily || 0} tubes/day`
}

export default function MachinesPage() {
    const { activePlant } = useAuth()
    const { data, isLoading } = useMachines({ includeInactive: true })
    const createMutation = useCreateMachine()
    const updateMutation = useUpdateMachine()
    const deleteMutation = useDeleteMachine()
    const writeBlocked = activePlant === "ALL"

    const setMachineState = (row: any, state: "UP" | "MAINT" | "DOWN" | "DISABLED") => {
        const disabled = state === "DISABLED"
        return updateMutation.mutateAsync({
            id: row.id,
            data: {
                status: disabled ? "DOWN" : state,
                is_active: !disabled,
            },
        })
    }

    const columns = [
        { header: "Code", accessorKey: "code" },
        { header: "Name", accessorKey: "name" },
        { header: "Department", accessorKey: "department" },
        {
            header: "Capacity",
            accessorKey: "capacity_value",
            render: (_val: any, row: any) => <span className="text-sm leading-6 text-slate-700">{capacitySummary(row)}</span>,
        },
        {
            header: "Status",
            accessorKey: "status",
            render: (_val: string, row: any) => {
                const state = machineState(row)
                return (
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${stateClasses(state)}`}>
                    {state === "UP" ? "Running" : state === "MAINT" ? "Maintenance" : state === "DISABLED" ? "Disabled" : "Down"}
                </span>
                )
            },
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
            rowActions={(row) => {
                const state = machineState(row)
                return (
                    <>
                        {state === "UP" ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Send to maintenance"
                            aria-label="Send to maintenance"
                            className="rounded-xl border border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                            disabled={writeBlocked || updateMutation.isPending}
                            onClick={() => setMachineState(row, "MAINT")}
                        >
                            <Wrench className="h-4 w-4" />
                        </Button>
                        ) : (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Restore machine"
                                aria-label="Restore machine"
                                className="rounded-xl border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                                disabled={writeBlocked || updateMutation.isPending}
                                onClick={() => setMachineState(row, "UP")}
                            >
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                        )}
                        {state !== "DISABLED" ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Disable machine"
                                aria-label="Disable machine"
                                className="rounded-xl border border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                                disabled={writeBlocked || deleteMutation.isPending}
                                onClick={() => deleteMutation.mutateAsync(row.id)}
                            >
                                <PowerOff className="h-4 w-4" />
                            </Button>
                        ) : null}
                    </>
                )
            }}
            FormComponent={MachineForm}
            dialogContentClassName="max-w-2xl"
        />
    )
}
