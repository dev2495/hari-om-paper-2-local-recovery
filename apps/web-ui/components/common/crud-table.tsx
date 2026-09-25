"use client"

import React, { useMemo, useState } from 'react'
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingState, EmptyQueryState } from "@/components/workspace/query-state"
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
            <section className="rounded-[1.75rem] border border-border bg-card/90 px-4 py-4 shadow-premium">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-[12px] font-semibold text-muted-foreground">
                            {workspace === "masters" ? "Master Workspace" : "System Workspace"}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
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
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border bg-muted text-muted-foreground hover:border-border hover:bg-card"
                                    }`}
                                >
                                    {link.label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-premium">
                <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1.4fr)_320px] lg:px-8">
                    <div>
                        <p className="text-[12px] font-semibold text-muted-foreground">Master Data Workspace</p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{subtitle}</p>
                        <p className="mt-3 inline-flex max-w-3xl rounded-full border border-signal-amber-line bg-signal-amber-soft px-3 py-1.5 text-xs font-semibold text-signal-amber-ink">
                            Master data is never physically deleted. Disable hides it from future dropdowns while old orders, specs, job cards, and ledgers keep their historical references.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-[1.5rem] border border-border bg-card/80 p-4 shadow-sm">
                        <div>
                            <p className="text-[12px] font-semibold text-muted-foreground">{metricLabel}</p>
                            <p className="mt-2 text-3xl font-semibold text-foreground">{filteredData.length}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{data.length} total records available in this scope.</p>
                            {writeBlocked ? (
                                <p className="mt-3 rounded-xl border border-signal-amber-line bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber-ink">
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
                                    <Button className="h-11 rounded-xl bg-primary text-primary-foreground shadow-lg shadow-slate-900/10 hover:bg-primary/90" disabled={writeBlocked}>
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
                                        <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">
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

            <section className="rounded-[2rem] border border-border bg-card/90 px-5 py-5 shadow-premium">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative w-full max-w-xl">
                        <Label htmlFor={`search-${lowercaseTitle}`} className="sr-only">Search {title}</Label>
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id={`search-${lowercaseTitle}`}
                            placeholder={`Search ${title.toLowerCase()}...`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-12 rounded-full border-border bg-muted pl-11 shadow-inner"
                        />
                    </div>
                    <div className="rounded-full border border-border bg-muted px-4 py-2 text-[12px] font-semibold text-muted-foreground">
                        {filteredData.length === data.length ? "All rows visible" : `${filteredData.length} of ${data.length} rows visible`}
                    </div>
                </div>
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-border bg-card/90 shadow-premium">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] caption-bottom text-sm">
                        <thead className="bg-muted text-[12px] text-muted-foreground">
                        <tr className="border-b border-border">
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
                                <td colSpan={columns.length + 1} className="p-4">
                                    <LoadingState label={`Loading ${title.toLowerCase()}…`} />
                                </td>
                            </tr>
                        ) : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="p-4">
                                    <EmptyQueryState
                                        title={`No ${title.toLowerCase()} matched this search.`}
                                        message="Clear the search box or add a new record."
                                    />
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row, i) => {
                                const rowActive = row?.active !== false && row?.is_active !== false
                                return (
                                <tr key={i} className={`border-b border-border transition-colors hover:bg-signal-cyan-soft/35 ${rowActive ? "" : "bg-muted/80 text-muted-foreground"}`}>
                                    {columns.map((col, j) => (
                                        <td key={j} className="p-4 align-middle text-muted-foreground">
                                            {col.render ? col.render(row[col.accessorKey], row) : row[col.accessorKey]}
                                        </td>
                                    ))}
                                    <td className="p-4 align-middle text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className={`rounded-full px-2 py-1 text-[11.5px] font-semibold ${rowActive ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-muted text-muted-foreground"}`}>
                                                {rowActive ? "Active" : "Disabled"}
                                            </span>
                                            {rowActions ? rowActions(row) : null}
                                            {FormComponent && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={`Edit ${title}`}
                                                    aria-label={`Edit ${title}`}
                                                    className="rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted"
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
                                                    className="rounded-xl border border-signal-amber-line bg-card text-signal-amber-ink hover:bg-signal-amber-soft"
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
                                                    className="rounded-xl border border-signal-emerald-line bg-card text-signal-emerald-ink hover:bg-signal-emerald-soft"
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
                            <div className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink">
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
