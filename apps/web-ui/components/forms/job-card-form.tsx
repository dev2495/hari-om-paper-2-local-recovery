"use client"

import React, { useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSpecs } from "@/hooks/use-specs"
import { useMachines } from "@/hooks/use-production"
import { Plus, Trash2 } from "lucide-react"

interface JobCardFormProps {
    initialData?: any
    onSubmit: (data: any) => void
    onCancel: () => void
}

export function JobCardForm({ initialData, onSubmit, onCancel }: JobCardFormProps) {
    const { register, control, handleSubmit, watch, setValue } = useForm({
        defaultValues: initialData || {
            date: new Date().toISOString().split('T')[0],
            shift: "Day",
            machine_id: "",
            spec_id: "",
            bamboo_qty: 0,
            oven_in_weight: 0,
            oven_out_weight: 0,
            tubes_produced: 0,
            scrap_weight: 0,
            cs_value: 0,
            reels: []
        }
    })

    const { fields, append, remove } = useFieldArray({
        control,
        name: "reels"
    })

    const { data: specs } = useSpecs()
    const { data: machines } = useMachines()

    // Real-time calculations
    const reels = watch("reels")
    const ovenIn = parseFloat(watch("oven_in_weight") || 0)
    const ovenOut = parseFloat(watch("oven_out_weight") || 0)
    const scrap = parseFloat(watch("scrap_weight") || 0)

    const totalReelWeight = reels?.reduce((sum: number, r: any) => sum + (parseFloat(r.weight) || 0), 0) || 0

    // Simple logic: Loss = Total Input - Total Output
    // Shrinkage is typically OvenIn - OvenOut
    const shrinkWeight = ovenIn > 0 ? ovenIn - ovenOut : 0
    const shrinkPercent = ovenIn > 0 ? ((shrinkWeight / ovenIn) * 100).toFixed(2) : "0"

    // Scrap % = Scrap / Total Input
    const scrapPercent = totalReelWeight > 0 ? ((scrap / totalReelWeight) * 100).toFixed(2) : "0"

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-5xl mx-auto p-6 bg-white rounded-lg shadow">

            <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Date</label>
                    <Input type="date" {...register("date", { required: true })} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Shift</label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("shift")}>
                        <option value="Day">Day</option>
                        <option value="Night">Night</option>
                    </select>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Machine</label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("machine_id", { required: true })}>
                        <option value="">Select Machine</option>
                        {machines
                            ?.filter((m: any) => String(m?.status || "UP").toUpperCase() === "UP")
                            .map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Specification</label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("spec_id", { required: true })}>
                        <option value="">Select Spec</option>
                        {specs?.map((s: any) => <option key={s.id} value={s.id}>{s.customer_name} - {s.target_cs}</option>)}
                    </select>
                </div>
            </div>

            {/* Reel Usage */}
            <div className="space-y-4 border p-4 rounded-md">
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold">Reel Usage</h3>
                    <Button type="button" size="sm" onClick={() => append({ batch_number: "", weight: 0 })}>
                        <Plus className="mr-2 h-4 w-4" /> Add Reel
                    </Button>
                </div>
                {fields.map((field, index) => (
                    <div key={field.id} className="flex gap-4 items-end">
                        <div className="flex-1 space-y-2">
                            <label className="text-xs">Batch Number</label>
                            <Input {...register(`reels.${index}.batch_number` as const, { required: true })} placeholder="Scan Batch" />
                        </div>
                        <div className="w-32 space-y-2">
                            <label className="text-xs">Weight (Kg)</label>
                            <Input type="number" step="0.1" {...register(`reels.${index}.weight` as const, { required: true })} />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="mb-0.5 text-destructive" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
                <div className="text-right text-sm font-medium text-muted-foreground">
                    Total Input: {totalReelWeight} Kg
                </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Bamboo Qty</label>
                    <Input type="number" {...register("bamboo_qty")} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Oven In Weight (Kg)</label>
                    <Input type="number" step="0.1" {...register("oven_in_weight")} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Oven Out Weight (Kg)</label>
                    <Input type="number" step="0.1" {...register("oven_out_weight")} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Tubes Produced</label>
                    <Input type="number" {...register("tubes_produced")} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Scrap Weight (Kg)</label>
                    <Input type="number" step="0.1" {...register("scrap_weight")} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Final CS</label>
                    <Input type="number" {...register("cs_value")} />
                </div>
            </div>

            {/* Calculations Panel */}
            <div className="grid grid-cols-4 gap-4 bg-gray-100 p-4 rounded-md">
                <div className="text-center">
                    <div className="text-xs text-muted-foreground">Shrinkage</div>
                    <div className="text-xl font-bold">{shrinkPercent}%</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-muted-foreground">Scrap</div>
                    <div className="text-xl font-bold text-red-600">{scrapPercent}%</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-muted-foreground">Bamboo Loss</div>
                    <div className="text-xl font-bold">-- %</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-muted-foreground">Variance</div>
                    <div className="text-xl font-bold">--</div>
                </div>
            </div>

            <div className="flex justify-end gap-4">
                <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                <Button type="submit" size="lg">Submit Job Card</Button>
            </div>
        </form>
    )
}
