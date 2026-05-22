"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useForm } from "react-hook-form"

import { PlantSwitcher } from "@/components/PlantSwitcher"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { useCreateDispatch, useCustomers, useDispatches } from "@/hooks/use-dispatch"
import { useInventoryItems } from "@/hooks/use-inventory"
import { displayPlantScope } from "@/lib/plant-scope"

function formatDate(value?: string | null) {
  if (!value) return "-"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString()
}

function compactId(value?: string | null) {
  if (!value) return "-"
  return value.length > 8 ? value.slice(0, 8) : value
}

export default function DispatchPage() {
  const { activePlant } = useAuth()
  const concretePlant = activePlant && activePlant.toUpperCase() !== "ALL" ? activePlant : null
  const writeBlocked = !concretePlant
  const { data: dispatches = [], isLoading: dispatchesLoading } = useDispatches(concretePlant)
  const { data: customers = [] } = useCustomers()
  const { data: inventory = [] } = useInventoryItems()
  const createMutation = useCreateDispatch(concretePlant)

  const customerById = useMemo(() => {
    const map = new Map<string, string>()
    customers.forEach((customer: any) => {
      map.set(String(customer.id), customer.name || customer.customer_name || String(customer.id))
    })
    return map
  }, [customers])

  const fgItems = useMemo(
    () =>
      inventory.filter((item: any) => {
        const type = String(item.type || item.item_type || "").toUpperCase()
        return type === "FG" || type === "FINISHED_GOODS"
      }),
    [inventory],
  )

  const { register, handleSubmit, reset } = useForm()

  const onSubmit = (data: any) => {
    if (writeBlocked) return
    const dispatchRef = String(data.dispatch_ref || `MANUAL-DISPATCH-${Date.now()}`).trim()
    createMutation.mutate(
      {
        item_id: data.item_id,
        qty: Number(data.qty || 0),
        dispatch_ref: dispatchRef,
        external_ref: dispatchRef,
      },
      {
        onSuccess: () => reset(),
      },
    )
  }

  return (
    <div className="space-y-6 p-8">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Dispatch control</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Dispatch & Shipments</h2>
            <p className="mt-2 text-sm text-slate-600">
              Plant scope: <span className="font-semibold text-slate-900">{displayPlantScope(activePlant, "No plant selected")}</span>
            </p>
          </div>
          <PlantSwitcher />
        </div>
        {writeBlocked ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Select one plant from the switcher before loading dispatch-ready jobs or posting stock out.
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-semibold text-slate-950">Manual FG Dispatch</h3>
            <p className="mt-1 text-sm text-slate-500">Use for approved finished-goods stock movement outside the job-card seal flow.</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Finished Goods Item</label>
              <select
                disabled={writeBlocked}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                {...register("item_id", { required: true })}
              >
                <option value="">Select FG</option>
                {fgItems.map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name || item.item_name || item.code || item.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Dispatch Reference</label>
              <Input disabled={writeBlocked} placeholder="Challan or dispatch ref" {...register("dispatch_ref")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Dispatch Quantity</label>
              <Input disabled={writeBlocked} type="number" min="0" step="0.01" {...register("qty", { required: true, valueAsNumber: true })} />
            </div>
            <Button type="submit" disabled={writeBlocked || createMutation.isPending} className="w-full">
              {createMutation.isPending ? "Posting..." : "Create Shipment"}
            </Button>
            {createMutation.isError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {(createMutation.error as any)?.response?.data?.detail || (createMutation.error as Error)?.message || "Dispatch failed"}
              </p>
            ) : null}
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-950">Dispatch-Ready Job Cards</h3>
              <p className="mt-1 text-sm text-slate-500">Packing-complete or sealed jobs for the selected plant.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{dispatches.length} jobs</span>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Job Card</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-left">Stage</th>
                  <th className="p-3 text-left">Dispatch</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {dispatchesLoading ? (
                  <tr>
                    <td className="p-5 text-center text-slate-500" colSpan={7}>
                      Loading dispatch-ready jobs...
                    </td>
                  </tr>
                ) : dispatches.length ? (
                  dispatches.map((row: any) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="p-3 text-slate-600">{formatDate(row.created_at)}</td>
                      <td className="p-3 font-medium text-slate-900">{compactId(String(row.id || ""))}</td>
                      <td className="p-3 text-slate-700">{customerById.get(String(row.customer_id)) || compactId(String(row.customer_id || ""))}</td>
                      <td className="p-3 text-right tabular-nums text-slate-900">{Number(row.planned_qty || 0).toLocaleString()}</td>
                      <td className="p-3 text-slate-700">{row.current_stage || row.status || "-"}</td>
                      <td className="p-3 text-slate-700">{row.dispatch_status || "Pending"}</td>
                      <td className="p-3 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/dispatch/${row.id}`}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-5 text-center text-slate-500" colSpan={7}>
                      {writeBlocked ? "Select one plant to load dispatch-ready jobs." : "No dispatch-ready job cards for this plant."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
