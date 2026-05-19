"use client"

import React from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePapers, useVendors } from "@/hooks/use-master-data" // Assuming reels are papers
import { useInventoryItems } from "@/hooks/use-inventory"

interface FormProps {
    onSubmit: (data: any) => void
}

export function InwardForm({ onSubmit }: FormProps) {
    const { register, handleSubmit, reset } = useForm()
    const { data: papers } = usePapers()
    const { data: vendors = [] } = useVendors()

    const submitHandler = (data: any) => {
        onSubmit({ ...data, type: 'INWARD' })
        reset()
    }

    return (
        <form onSubmit={handleSubmit(submitHandler)} className="space-y-4 max-w-md bg-white p-6 rounded shadow">
            <h3 className="text-lg font-medium">Inward / GRN</h3>
            <div className="space-y-2">
                <label className="text-sm font-medium">Material</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("item_id", { required: true })}>
                    <option value="">Select Material</option>
                    {papers?.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.gsm} GSM)</option>)}
                </select>
            </div>
            <div className="space-y-2">
                <label className="text-sm font-medium">Inward Rate</label>
                <Input type="number" step="0.01" {...register("unit_cost")} placeholder="Captured on received batch" />
            </div>
            <div className="space-y-2">
                <label className="text-sm font-medium">Vendor</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("supplier_name", { required: true })}>
                    <option value="">Select Vendor</option>
                    {(vendors || []).map((vendor: any) => <option key={vendor.id} value={vendor.name}>{vendor.supplier_code} ({vendor.name})</option>)}
                </select>
            </div>
            <div className="space-y-2">
                <label className="text-sm font-medium">Weight/Qty (Kg)</label>
                <Input type="number" step="0.1" {...register("quantity", { required: true })} />
            </div>
            <Button type="submit" className="w-full">Receiver Material</Button>
        </form>
    )
}

export function IssueForm({ onSubmit }: FormProps) {
    const { register, handleSubmit, reset } = useForm()
    const { data: items } = useInventoryItems()

    const submitHandler = (data: any) => {
        onSubmit({ ...data, type: 'ISSUE' })
        reset()
    }

    // Need jobs to issue to?
    // User requirement: "Select batch -> issue to job"

    return (
        <form onSubmit={handleSubmit(submitHandler)} className="space-y-4 max-w-md bg-white p-6 rounded shadow">
            <h3 className="text-lg font-medium">Issue Material</h3>
            <div className="space-y-2">
                <label className="text-sm font-medium">Batch Number</label>
                <Input {...register("batch_number", { required: true })} placeholder="Scan Batch" />
            </div>
            <div className="space-y-2">
                <label className="text-sm font-medium">Job ID</label>
                <Input {...register("job_id", { required: true })} placeholder="JOB-001" />
            </div>
            <div className="space-y-2">
                <label className="text-sm font-medium">Quantity to Issue</label>
                <Input type="number" step="0.1" {...register("quantity", { required: true })} />
            </div>
            <Button type="submit" className="w-full" variant="secondary">Issue Material</Button>
        </form>
    )
}
