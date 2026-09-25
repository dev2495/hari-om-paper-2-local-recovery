"use client"

import Link from "next/link"
import { CrudTable } from "@/components/common/crud-table"
import { MachineForm } from "@/components/forms/master-forms"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { useCreateMachine, useDeleteMachine, useMachines, useUpdateMachine } from "@/hooks/use-master-data"
import { Building2, Factory, MapPin, PowerOff, RotateCcw, Users2, Wrench } from "lucide-react"

function SystemSetupNav() {
    const items = [
        { href: "/system/users", label: "Users", icon: Users2 },
        { href: "/system/plants", label: "Plants", icon: Building2 },
        { href: "/system/machines", label: "Machines", icon: Factory },
        { href: "/system/locations", label: "Locations", icon: MapPin },
        { href: "/system/tolerances", label: "Tolerances", icon: Wrench },
    ]

    return (
        <section className="flex flex-wrap items-center gap-2 rounded-[1.75rem] border border-border bg-card/85 p-2 shadow-lg shadow-slate-900/5">
            {items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        item.href === "/system/machines" ? "bg-slate-950 text-white" : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                </Link>
            ))}
        </section>
    )
}

function machineState(row: any) {
    if (row?.is_active === false || row?.active === false) return "DISABLED"
    return String(row?.status || "UP").toUpperCase()
}

function stateClasses(state: string) {
    if (state === "UP") return "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
    if (state === "MAINT") return "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
    if (state === "DOWN") return "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink"
    return "border-border bg-muted text-muted-foreground"
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
            render: (_val: any, row: any) => <span className="text-sm leading-6 text-muted-foreground">{capacitySummary(row)}</span>,
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
        <div className="space-y-5">
            <SystemSetupNav />
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
                                className="rounded-xl border border-signal-amber-line bg-card text-signal-amber-ink hover:bg-signal-amber-soft"
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
                                    className="rounded-xl border border-signal-emerald-line bg-card text-signal-emerald-ink hover:bg-signal-emerald-soft"
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
                                    className="rounded-xl border border-signal-amber-line bg-card text-signal-amber-ink hover:bg-signal-amber-soft"
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
        </div>
    )
}
