"use client"

import React, { useMemo, useState } from 'react'
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Pencil, Plus, PowerOff, RotateCcw, Search } from "lucide-react"
import { useAuth } from "@/context/AuthContext"

interface Column {
    header: string
    accessorKey: string
    render?: (value: any, row: any) => React.ReactNode
}

interface CrudTableProps {
    title: string
    columns: Column[]
    data: any[]
    isLoading?: boolean
    onAdd?: (data: any) => void
    onEdit?: (id: string, data: any) => void
    onDelete?: (id: string) => void
    rowActions?: (row: any) => React.ReactNode
    FormComponent?: React.ComponentType<{
        initialData?: any
        onSubmit: (data: any) => void
        onCancel: () => void
    }>
    dialogContentClassName?: string
}

function describeDataset(title: string) {
    switch (title.toLowerCase()) {
        case "papers":
            return "Recipe-grade paper masters used in specification math and production handoff."
        case "adhesives":
            return "Adhesive chemistry, process parameters, and recipe notes shared across spec and floor execution."
        case "parchments":
            return "Approved parchment companies and sub parchment options used across sales and specification flows."
        case "mandrels":
            return "Mandrel truth for manufacturing ID guidance, winder setup, and job-card readiness."
        case "tube sizes":
            return "Tube size masters feeding commercial references, spec dimensions, and bamboo planning."
        case "packaging":
            return "Packing dropdown truth for boxes, plastic sheets, and fadda consumption."
        case "box masters":
            return "Outer carton masters used by the spec sheet, packing handoff, and dispatch validation."
        case "plastic sheet masters":
            return "Plastic sleeve masters with size and weight used across packing and dispatch. Batch pricing is captured during inward."
        case "fadda masters":
            return "Fadda SKUs used in the final packing handoff. Batch pricing is captured during inward."
        case "tools":
            return "Tooling catalog for notch sheet dropdowns, maintenance status, scrap state, and usage trace."
        case "plants":
            return "Plant master records used for scope control, scheduling, and reporting."
        case "machines":
            return "Machine registry with department and capacity attributes for planner and job-card execution."
        default:
            return `Recovered ${title.toLowerCase()} master data with searchable rows and direct add/edit actions.`
    }
}

const WORKSPACE_LINKS = {
    masters: [
        { href: "/masters/papers", label: "Papers" },
        { href: "/masters/tube-sizes", label: "Tube Sizes" },
        { href: "/masters/mandrels", label: "Mandrels" },
        { href: "/masters/parchments", label: "Parchments" },
        { href: "/masters/adhesives", label: "Adhesives" },
        { href: "/masters/customers", label: "Customers" },
        { href: "/masters/vendors", label: "Vendors" },
        { href: "/masters/contact-directory", label: "Contacts" },
        { href: "/masters/packaging", label: "Packaging" },
        { href: "/masters/tools", label: "Tools" },
    ],
    system: [
        { href: "/system/users", label: "Users" },
        { href: "/system/plants", label: "Plants" },
        { href: "/system/machines", label: "Machines" },
        { href: "/system/locations", label: "Locations" },
    ],
} as const

function datasetWorkspace(title: string) {
    const value = title.toLowerCase()
    if (["plants", "machines", "users", "locations"].includes(value)) return "system"
    return "masters"
}

export function CrudTable({
    title,
    columns,
    data = [],
    isLoading,
    onAdd,
    onEdit,
    onDelete,
    rowActions,
    FormComponent,
    dialogContentClassName
}: CrudTableProps) {
    const pathname = usePathname()
    const [search, setSearch] = useState("")
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editItem, setEditItem] = useState<any>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const { activePlant } = useAuth()

    const filteredData = useMemo(
        () =>
            data.filter((item) =>
                Object.values(item).some((val) =>
                    String(val).toLowerCase().includes(search.toLowerCase()),
                ),
            ),
        [data, search],
    )

    const metricLabel = filteredData.length === data.length ? "Visible records" : "Filtered records"
    const subtitle = describeDataset(title)
    const workspace = datasetWorkspace(title)
    const workspaceLinks = WORKSPACE_LINKS[workspace]
    const lowercaseTitle = title.toLowerCase()
    const writeBlocked = activePlant === "ALL" && !["plants", "users"].includes(lowercaseTitle)

    const formatError = (error: any) => {
        const detail = error?.response?.data?.detail
        if (Array.isArray(detail)) {
            return detail.map((item: any) => item?.msg || JSON.stringify(item)).join(", ")
        }
        if (typeof detail === "string" && detail.trim()) {
            return detail
        }
        if (typeof error?.message === "string" && error.message.trim()) {
            return error.message
        }
        return "Save failed. Check the form values and current plant scope."
    }

    const handleAdd = async (formData: any) => {
        if (!onAdd) return
        setSubmitError(null)
        try {
            await Promise.resolve(onAdd(formData))
            setIsAddOpen(false)
        } catch (error) {
            setSubmitError(formatError(error))
        }
    }

    const handleEdit = async (formData: any) => {
        if (!onEdit || !editItem) return
        setSubmitError(null)
        try {
            await Promise.resolve(onEdit(editItem.id, formData))
            setEditItem(null)
        } catch (error) {
            setSubmitError(formatError(error))
        }
    }

    return (
        <div className="space-y-6">
            <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 px-4 py-4 shadow-premium">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {workspace === "masters" ? "Master Workspace" : "System Workspace"}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                            Jump across the recovered {workspace === "masters" ? "master-data" : "system setup"} surfaces without going back to the sidebar.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {workspaceLinks.map((link) => {
                            const active = pathname === link.href
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                        active
                                            ? "border-slate-950 bg-slate-950 text-white"
                                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                                    }`}
                                >
                                    {link.label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#ecfeff_100%)] shadow-premium">
                <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_320px] lg:px-8">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Master Data Workspace</p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p>
                        <p className="mt-3 inline-flex max-w-3xl rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                            Master data is never physically deleted. Disable hides it from future dropdowns while old orders, specs, job cards, and ledgers keep their historical references.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-white/80 p-4 shadow-sm">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{metricLabel}</p>
                            <p className="mt-2 text-3xl font-semibold text-slate-950">{filteredData.length}</p>
                            <p className="mt-1 text-sm text-slate-500">{data.length} total records available in this scope.</p>
                            {writeBlocked ? (
                                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    Pick a concrete plant before adding, editing, or deleting {title.toLowerCase()}.
                                </p>
                            ) : null}
                        </div>
                        {FormComponent ? (
                            <Dialog
                                open={isAddOpen}
                                onOpenChange={(open) => {
                                    setIsAddOpen(open)
                                    if (!open) setSubmitError(null)
                                }}
                            >
                                <DialogTrigger asChild>
                                    <Button className="h-11 rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800" disabled={writeBlocked}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Add New
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className={dialogContentClassName}>
                                    <DialogHeader>
                                        <DialogTitle>Add {title}</DialogTitle>
                                        <DialogDescription>
                                            Enter the details for the new {title.toLowerCase()}.
                                        </DialogDescription>
                                    </DialogHeader>
                                    {submitError ? (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                            {submitError}
                                        </div>
                                    ) : null}
                                    <FormComponent
                                        onSubmit={handleAdd}
                                        onCancel={() => {
                                            setSubmitError(null)
                                            setIsAddOpen(false)
                                        }}
                                    />
                                </DialogContent>
                            </Dialog>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white/90 px-5 py-5 shadow-premium">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative w-full max-w-xl">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder={`Search ${title.toLowerCase()}...`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-12 rounded-full border-slate-200 bg-slate-50 pl-11 shadow-inner"
                        />
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {filteredData.length === data.length ? "All rows visible" : `${filteredData.length} of ${data.length} rows visible`}
                    </div>
                </div>
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 shadow-premium">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] caption-bottom text-sm">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                        <tr className="border-b border-slate-200">
                            {columns.map((col, i) => (
                                <th key={i} className="h-12 px-4 text-left align-middle font-semibold">
                                    {col.header}
                                </th>
                            ))}
                            <th className="h-12 px-4 text-right align-middle font-semibold">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                        {isLoading ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="h-28 text-center text-slate-500">
                                    Loading...
                                </td>
                            </tr>
                        ) : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="h-28 text-center text-slate-500">
                                    No rows matched this search.
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row, i) => {
                                const rowActive = row?.active !== false && row?.is_active !== false
                                return (
                                <tr key={i} className={`border-b border-slate-100 transition-colors hover:bg-cyan-50/35 ${rowActive ? "" : "bg-slate-50/80 text-slate-500"}`}>
                                    {columns.map((col, j) => (
                                        <td key={j} className="p-4 align-middle text-slate-700">
                                            {col.render ? col.render(row[col.accessorKey], row) : row[col.accessorKey]}
                                        </td>
                                    ))}
                                    <td className="p-4 align-middle text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${rowActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                                                {rowActive ? "Active" : "Disabled"}
                                            </span>
                                            {rowActions ? rowActions(row) : null}
                                            {FormComponent && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={`Edit ${title}`}
                                                    aria-label={`Edit ${title}`}
                                                    className="rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                                    disabled={writeBlocked}
                                                    onClick={() => setEditItem(row)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {onDelete && rowActive && (
                                                <Button
                                            variant="ghost"
                                            size="icon"
                                                    title={`Disable ${title}`}
                                                    aria-label={`Disable ${title}`}
                                                    className="rounded-xl border border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                                                    disabled={writeBlocked}
                                                    onClick={() => onDelete(row.id)}
                                                >
                                                    <PowerOff className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {!rowActive && onEdit ? (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={`Reactivate ${title}`}
                                                    aria-label={`Reactivate ${title}`}
                                                    className="rounded-xl border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                                                    disabled={writeBlocked}
                                                    onClick={() => onEdit(row.id, { active: true })}
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    </td>
                                </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
            </section>

            {/* Edit Dialog */}
            {FormComponent && editItem && (
                <Dialog
                    open={!!editItem}
                    onOpenChange={(open) => {
                        if (!open) {
                            setSubmitError(null)
                            setEditItem(null)
                        }
                    }}
                >
                    <DialogContent className={dialogContentClassName}>
                        <DialogHeader>
                            <DialogTitle>Edit {title}</DialogTitle>
                        </DialogHeader>
                        {submitError ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                                {submitError}
                            </div>
                        ) : null}
                        <FormComponent
                            initialData={editItem}
                            onSubmit={handleEdit}
                            onCancel={() => {
                                setSubmitError(null)
                                setEditItem(null)
                            }}
                        />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
