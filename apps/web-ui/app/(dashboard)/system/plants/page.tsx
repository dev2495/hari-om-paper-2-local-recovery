"use client"

import Link from "next/link"
import { CrudTable } from "@/components/common/crud-table"
import { PlantForm } from "@/components/forms/master-forms"
import { useCreatePlant, useDeletePlant, usePlants, useUpdatePlant } from "@/hooks/use-system"
import { Building2, Factory, MapPin, Users2, Wrench } from "lucide-react"

function SystemSetupNav() {
    const items = [
        { href: "/system/users", label: "Users", icon: Users2 },
        { href: "/system/plants", label: "Plants", icon: Building2 },
        { href: "/system/machines", label: "Machines", icon: Factory },
        { href: "/system/locations", label: "Locations", icon: MapPin },
        { href: "/system/tolerances", label: "Tolerances", icon: Wrench },
    ]

    return (
        <section className="flex flex-wrap items-center gap-2 rounded-[1.75rem] border border-slate-200 bg-white/85 p-2 shadow-lg shadow-slate-900/5">
            {items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        item.href === "/system/plants" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                </Link>
            ))}
        </section>
    )
}

export default function PlantsPage() {
    const { data, isLoading } = usePlants()
    const createMutation = useCreatePlant()
    const updateMutation = useUpdatePlant()
    const deleteMutation = useDeletePlant()

    const columns = [
        { header: "Code", accessorKey: "code" },
        { header: "Name", accessorKey: "name" },
        { header: "Address", accessorKey: "address" },
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
        <div className="space-y-5">
            <SystemSetupNav />
            <CrudTable
                title="Plants"
                columns={columns}
                data={data}
                isLoading={isLoading}
                onAdd={(payload) => createMutation.mutateAsync(payload)}
                onEdit={(id, payload) => updateMutation.mutateAsync({ id, data: payload })}
                onDelete={(id) => deleteMutation.mutate(id)}
                FormComponent={PlantForm}
            />
        </div>
    )
}
