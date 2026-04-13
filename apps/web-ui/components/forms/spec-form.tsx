"use client"

import React from "react"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePapers, useTubeSizes, useParchments } from "@/hooks/use-master-data"
import { Plus, Trash2 } from "lucide-react"

interface SpecFormProps {
    initialData?: any
    onSubmit: (data: any) => void
    onCancel: () => void
}

export function SpecForm({ initialData, onSubmit, onCancel }: SpecFormProps) {
    const { register, control, handleSubmit, watch } = useForm({
        defaultValues: initialData || {
            customer_name: "",
            tube_size_id: "",
            target_cs: "",
            parchment_color_id: "",
            adhesive_ratio: "20/80",
            shrink_percentage: 0,
            plies: []
        }
    })

    const { fields, append, remove, move } = useFieldArray({
        control,
        name: "plies"
    })

    const { data: papers } = usePapers()
    const { data: tubeSizes } = useTubeSizes()
    const { data: parchments } = useParchments()

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-4xl mx-auto p-6 bg-white rounded-lg shadow">

            <div className="grid grid-cols-2 gap-6">
                {/* Spec Details */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">Specification Details</h3>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Customer Name</label>
                        <Input {...register("customer_name", { required: true })} placeholder="e.g. Acme Corp" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Tube Size</label>
                        <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            {...register("tube_size_id", { required: true })}
                        >
                            <option value="">Select Tube Size</option>
                            {tubeSizes?.map((t: any) => (
                                <option key={t.id} value={t.id}>{t.inner_dia} x {t.outer_dia} x {t.length}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Target CS (Crushing Strength)</label>
                        <Input type="number" {...register("target_cs", { required: true })} placeholder="e.g. 400" />
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-lg font-semibold border-b pb-2">Parameters</h3>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Parchment Color</label>
                        <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            {...register("parchment_color_id")}
                        >
                            <option value="">Select Parchment</option>
                            {parchments?.map((p: any) => (
                                <option key={p.id} value={p.id}>{p.vendor} - {p.color}</option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Adhesive Ratio (Silicate/Water)</label>
                        <Input {...register("adhesive_ratio")} placeholder="20/80" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Shrinkage %</label>
                        <Input type="number" step="0.1" {...register("shrink_percentage")} placeholder="1.5" />
                    </div>
                </div>
            </div>

            {/* Recipe Builder */}
            <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                    <h3 className="text-lg font-semibold">Recipe (Plies)</h3>
                    <Button type="button" onClick={() => append({ paper_id: "", layers: 1 })} size="sm">
                        <Plus className="mr-2 h-4 w-4" /> Add Ply
                    </Button>
                </div>

                {fields.length === 0 && <p className="text-muted-foreground text-sm italic">No plies added yet.</p>}

                <div className="space-y-2">
                    {fields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-4 p-4 border rounded-lg bg-gray-50">
                            <span className="font-bold text-gray-500 w-8">#{index + 1}</span>

                            <div className="flex-1">
                                <label className="text-xs font-medium text-muted-foreground">Paper</label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                                    {...register(`plies.${index}.paper_id` as const, { required: true })}
                                >
                                    <option value="">Select Paper</option>
                                    {papers?.map((p: any) => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.gsm} GSM)</option>
                                    ))}
                                </select>
                            </div>

                            <div className="w-24">
                                <label className="text-xs font-medium text-muted-foreground">Layers</label>
                                <Input
                                    type="number"
                                    {...register(`plies.${index}.layers` as const, { required: true, min: 1 })}
                                    className="h-9"
                                />
                            </div>

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive mt-4"
                                onClick={() => remove(index)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t">
                <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                <Button type="submit" size="lg">Save Specification</Button>
            </div>
        </form>
    )
}
