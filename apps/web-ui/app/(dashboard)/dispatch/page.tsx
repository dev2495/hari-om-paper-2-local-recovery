"use client"

import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDispatches, useCreateDispatch, useCustomers } from "@/hooks/use-dispatch"
import { useInventoryItems } from "@/hooks/use-inventory"

export default function DispatchPage() {
  const { data: dispatches } = useDispatches()
  const { data: customers } = useCustomers()
  const { data: inventory } = useInventoryItems() // To select FG
  const createMutation = useCreateDispatch()

  const { register, handleSubmit, reset } = useForm()

  const onSubmit = (data: any) => {
    createMutation.mutate(data)
    reset()
  }

  return (
    <div className="space-y-8 p-8">
      <h2 className="text-3xl font-bold tracking-tight">Dispatch & Shipments</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Create Shipment Form */}
        <div className="bg-white p-6 rounded shadow space-y-4">
          <h3 className="text-lg font-medium">Create New Shipment</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Customer</label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("customer_id", { required: true })}>
                <option value="">Select Customer</option>
                {customers?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Finished Goods Item</label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register("item_id", { required: true })}>
                <option value="">Select FG</option>
                {inventory?.filter((i: any) => i.type === 'FG').map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dispatch Quantity</label>
              <Input type="number" {...register("quantity", { required: true })} />
            </div>
            <Button type="submit" className="w-full">Create Shipment</Button>
          </form>
        </div>

        {/* Dispatch List */}
        <div className="bg-white p-6 rounded shadow space-y-4">
          <h3 className="text-lg font-medium">Recent Dispatches</h3>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {dispatches?.map((d: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-3">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="p-3">{d.customer_name}</td>
                    <td className="p-3 text-right">{d.quantity}</td>
                    <td className="p-3">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
