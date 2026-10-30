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
import { Pencil, Plus, PowerOff, RotateCcw, Ruler, Search } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { MastersNav } from "@/components/master/masters-nav"
import { QcBandDialog, type QcBandTarget } from "@/components/qc/QcBandDialog"
import { cn } from "@/lib/utils"

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
    /** Inward QC band popup for a row (material masters): returns the band scope for that row. */
    qcBand?: (row: any) => QcBandTarget | null
    /** Hide the master switcher and page header when the table is embedded in another page. */
    embedded?: boolean
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

const SYSTEM_LINKS = [
    { href: "/system/users", label: "Users" },
    { href: "/system/plants", label: "Plants" },
    { href: "/system/machines", label: "Machines" },
    // Locations moved to Stores (client 2026-10-28).
    { href: "/inventory/locations", label: "Locations" },
] as const

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
    qcBand,
    embedded = false,
    FormComponent,
    dialogContentClassName
}: CrudTableProps) {
    const pathname = usePathname()
    const [search, setSearch] = useState("")
    const [status, setStatus] = useState<"ACTIVE" | "DISABLED" | "ALL">("ACTIVE")
    const [bandTarget, setBandTarget] = useState<QcBandTarget | null>(null)
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editItem, setEditItem] = useState<any>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const { activePlant } = useAuth()

    const isActive = (row: any) => row?.active !== false && row?.is_active !== false
    const activeCount = data.filter(isActive).length
    const disabledCount = data.length - activeCount
    const filteredData = useMemo(
        () =>
            data.filter((item) =>
                (status === "ALL" || (status === "ACTIVE") === isActive(item)) &&
                Object.values(item).some((val) =>
                    String(val).toLowerCase().includes(search.toLowerCase()),
                ),
            ),
        [data, search, status],
    )

    const subtitle = describeDataset(title)
    const workspace = datasetWorkspace(title)
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

    const addDialog = FormComponent ? (
        <Dialog
            open={isAddOpen}
            onOpenChange={(open) => {
                setIsAddOpen(open)
                if (!open) setSubmitError(null)
            }}
        >
            <DialogTrigger asChild>
                <Button className="h-10 rounded-lg bg-primary px-4 text-primary-foreground hover:bg-primary/90" disabled={writeBlocked}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add {title.toLowerCase().replace(/s$/, "")}
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
    ) : null

    return (
        <div className="min-w-0 space-y-4" data-testid={`crud-table-${lowercaseTitle.replace(/\s+/g, "-")}`}>
            {embedded ? null : workspace === "masters" ? <MastersNav /> : (
                <nav aria-label="System setup" className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-2">
                    {SYSTEM_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}
                            className={cn("inline-flex min-h-8 items-center rounded-lg px-2.5 text-[12.5px] font-semibold", pathname === link.href ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-muted")}>
                            {link.label}
                        </Link>
                    ))}
                </nav>
            )}

            <section className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div className="min-w-0">
                        {embedded ? <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2> : <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{title}</h1>}
                        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{subtitle}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">{addDialog}</div>
                </header>
                {writeBlocked ? (
                    <p className="border-b border-signal-amber-line bg-signal-amber-soft px-5 py-2 text-[12.5px] text-signal-amber-ink">
                        Pick one plant in the plant selector before adding or editing {title.toLowerCase()}.
                    </p>
                ) : null}
                <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="relative w-full max-w-md">
                        <Label htmlFor={`search-${lowercaseTitle}`} className="sr-only">Search {title}</Label>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id={`search-${lowercaseTitle}`}
                            placeholder={`Search ${title.toLowerCase()}…`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-10 rounded-lg pl-9"
                        />
                    </div>
                    <div role="tablist" aria-label="Show records" className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
                        {([["ACTIVE", `Active ${activeCount}`], ["DISABLED", `Disabled ${disabledCount}`], ["ALL", `All ${data.length}`]] as const).map(([value, label]) => (
                            <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => setStatus(value)}
                                className={cn("min-h-8 rounded-md px-3 text-[12.5px] font-semibold transition-colors", status === value ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-[13px]">
                        <thead className="bg-muted/60 text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">
                        <tr className="border-b border-border">
                            {columns.map((col, i) => (
                                <th key={i} className="h-10 px-4 text-left align-middle font-semibold">
                                    {col.header}
                                </th>
                            ))}
                            <th className="h-10 px-4 text-right align-middle font-semibold">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
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
                                        title={data.length ? `No ${status === "DISABLED" ? "disabled " : status === "ACTIVE" ? "active " : ""}${title.toLowerCase()} match.` : `No ${title.toLowerCase()} yet.`}
                                        message={data.length ? "Clear the search or switch between Active / Disabled / All." : "Use the Add button to create the first record."}
                                    />
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row, i) => {
                                const rowActive = isActive(row)
                                const band = qcBand ? qcBand(row) : null
                                return (
                                <tr key={row?.id ?? i} className={cn("border-b border-border last:border-0 transition-colors hover:bg-muted/40", rowActive ? "" : "bg-muted/50 text-muted-foreground")}>
                                    {columns.map((col, j) => (
                                        <td key={j} className={cn("px-4 py-3 align-middle", j === 0 ? "font-semibold text-foreground" : "text-foreground/80")}>
                                            {col.render ? col.render(row[col.accessorKey], row) : (row[col.accessorKey] ?? <span className="text-muted-foreground">—</span>)}
                                        </td>
                                    ))}
                                    <td className="px-4 py-2.5 align-middle text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                            {!rowActive ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">Disabled</span> : null}
                                            {rowActions ? rowActions(row) : null}
                                            {band && rowActive ? (
                                                <Button variant="ghost" className="h-8 rounded-lg border border-signal-cyan-line bg-signal-cyan-soft px-2.5 text-[12px] font-semibold text-signal-cyan-ink hover:bg-signal-cyan-soft/70"
                                                    title="Inward QC band for this line" onClick={() => setBandTarget(band)}>
                                                    <Ruler className="mr-1.5 h-3.5 w-3.5" />QC band
                                                </Button>
                                            ) : null}
                                            {FormComponent && (
                                                <Button
                                                    variant="ghost"
                                                    title={`Edit ${title}`}
                                                    aria-label={`Edit ${title}`}
                                                    className="h-8 rounded-lg border border-border bg-card px-2.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                                                    disabled={writeBlocked}
                                                    onClick={() => setEditItem(row)}
                                                >
                                                    <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                                                </Button>
                                            )}
                                            {onDelete && rowActive && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title={`Disable ${title}`}
                                                    aria-label={`Disable ${title}`}
                                                    className="h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:border-signal-amber-line hover:bg-signal-amber-soft hover:text-signal-amber-ink"
                                                    disabled={writeBlocked}
                                                    onClick={() => onDelete(row.id)}
                                                >
                                                    <PowerOff className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                            {!rowActive && onEdit ? (
                                                <Button
                                                    variant="ghost"
                                                    title={`Reactivate ${title}`}
                                                    aria-label={`Reactivate ${title}`}
                                                    className="h-8 rounded-lg border border-signal-emerald-line bg-card px-2.5 text-[12px] font-semibold text-signal-emerald-ink hover:bg-signal-emerald-soft"
                                                    disabled={writeBlocked}
                                                    onClick={() => onEdit(row.id, { active: true })}
                                                >
                                                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reactivate
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
                <p className="border-t border-border bg-muted/30 px-5 py-2.5 text-[12px] text-muted-foreground">
                    Records are never deleted. Disabling hides a record from new dropdowns; old orders, specs, job cards and ledgers keep their references.
                </p>
            </section>

            <QcBandDialog target={bandTarget} onClose={() => setBandTarget(null)} />

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
