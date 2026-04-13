"use client"

import React, { useState } from 'react'
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
import { Plus, Pencil, Trash2, Search } from "lucide-react"

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
    FormComponent?: React.ComponentType<{
        initialData?: any
        onSubmit: (data: any) => void
        onCancel: () => void
    }>
    dialogContentClassName?: string
}

export function CrudTable({
    title,
    columns,
    data = [],
    isLoading,
    onAdd,
    onEdit,
    onDelete,
    FormComponent,
    dialogContentClassName
}: CrudTableProps) {
    const [search, setSearch] = useState("")
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editItem, setEditItem] = useState<any>(null)

    const filteredData = data.filter(item =>
        Object.values(item).some(val =>
            String(val).toLowerCase().includes(search.toLowerCase())
        )
    )

    const handleAdd = (formData: any) => {
        if (onAdd) onAdd(formData)
        setIsAddOpen(false)
    }

    const handleEdit = (formData: any) => {
        if (onEdit && editItem) onEdit(editItem.id, formData)
        setEditItem(null)
    }

    return (
        <div className="space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                <div className="flex items-center space-x-2">
                    {FormComponent && (
                        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add New
                                </Button>
                            </DialogTrigger>
                            <DialogContent className={dialogContentClassName}>
                                <DialogHeader>
                                    <DialogTitle>Add {title}</DialogTitle>
                                    <DialogDescription>
                                        Enter the details for the new {title.toLowerCase()}.
                                    </DialogDescription>
                                </DialogHeader>
                                <FormComponent
                                    onSubmit={handleAdd}
                                    onCancel={() => setIsAddOpen(false)}
                                />
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>

            <div className="flex items-center py-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <div className="rounded-md border">
                <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                            {columns.map((col, i) => (
                                <th key={i} className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                                    {col.header}
                                </th>
                            ))}
                            <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                        {isLoading ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="h-24 text-center">
                                    Loading...
                                </td>
                            </tr>
                        ) : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="h-24 text-center">
                                    No results.
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row, i) => (
                                <tr key={i} className="border-b transition-colors hover:bg-muted/50">
                                    {columns.map((col, j) => (
                                        <td key={j} className="p-4 align-middle">
                                            {col.render ? col.render(row[col.accessorKey], row) : row[col.accessorKey]}
                                        </td>
                                    ))}
                                    <td className="p-4 align-middle text-right">
                                        <div className="flex justify-end space-x-2">
                                            {FormComponent && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setEditItem(row)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {onDelete && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-destructive"
                                                    onClick={() => onDelete(row.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Edit Dialog */}
            {FormComponent && editItem && (
                <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
                    <DialogContent className={dialogContentClassName}>
                        <DialogHeader>
                            <DialogTitle>Edit {title}</DialogTitle>
                        </DialogHeader>
                        <FormComponent
                            initialData={editItem}
                            onSubmit={handleEdit}
                            onCancel={() => setEditItem(null)}
                        />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
