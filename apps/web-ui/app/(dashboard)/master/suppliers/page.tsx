"use client"

import { FormEvent, useMemo, useState } from "react"
import { Building2, Plus, PowerOff, Truck } from "lucide-react"

import { useApp } from "@/context/AppContext"
import { useCreateVendor, useDeleteVendor, useVendors } from "@/hooks/use-master-data"

const categories = ["RAW_MATERIAL", "PACKAGING", "CONSUMABLE", "SERVICE", "OTHER"]

export default function SupplierMasterPage() {
  const { showToast } = useApp()
  const { data: vendors = [] } = useVendors()
  const createVendor = useCreateVendor()
  const deleteVendor = useDeleteVendor()
  const [form, setForm] = useState({
    supplier_code: "",
    name: "",
    category: "RAW_MATERIAL",
    contact_name: "",
    contact_phone: "",
    gst_no: "",
  })

  const rows = useMemo(
    () => (Array.isArray(vendors) ? vendors : []).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))),
    [vendors],
  )

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await createVendor.mutateAsync({
        ...form,
        supplier_code: form.supplier_code.trim(),
        name: form.name.trim(),
        contact_name: form.contact_name || null,
        contact_phone: form.contact_phone || null,
        gst_no: form.gst_no || null,
      })
      showToast("Vendor added to master.", "success")
      setForm({ supplier_code: "", name: "", category: "RAW_MATERIAL", contact_name: "", contact_phone: "", gst_no: "" })
    } catch (error: any) {
      showToast(error?.response?.data?.detail || "Unable to add vendor", "error")
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(8,145,178,0.2),transparent_28%),linear-gradient(135deg,#07111f,#124d61_58%,#7c3f12)] p-7 text-white shadow-2xl shadow-slate-900/15">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">Vendor master</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">Approved vendors for inward and purchase flows</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-cyan-50/80">
              Inventory inward screens use this actual vendor dropdown. Parchment companies are maintained separately inside the parchment master.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-white/15 bg-white/10 px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/70">Active vendors</p>
            <p className="mt-2 text-3xl font-semibold">{rows.length}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <form onSubmit={handleSubmit} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-950 p-3 text-white">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Add vendor</h2>
              <p className="text-sm text-slate-500">Owner/admin controlled master data.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            <input required value={form.supplier_code} onChange={(e) => setForm((s) => ({ ...s, supplier_code: e.target.value.toUpperCase() }))} placeholder="Vendor code" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
            <input required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Vendor name" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
            <select value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100">
              {categories.map((category) => <option key={category} value={category}>{category.replace(/_/g, " ")}</option>)}
            </select>
            <input value={form.contact_name} onChange={(e) => setForm((s) => ({ ...s, contact_name: e.target.value }))} placeholder="Contact person" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
            <input value={form.contact_phone} onChange={(e) => setForm((s) => ({ ...s, contact_phone: e.target.value }))} placeholder="Phone" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
            <input value={form.gst_no} onChange={(e) => setForm((s) => ({ ...s, gst_no: e.target.value.toUpperCase() }))} placeholder="GST no" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-cyan-100" />
            <button disabled={createVendor.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-cyan-950 disabled:opacity-60">
              <Plus className="h-4 w-4" />
              Save vendor
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Vendor register</h2>
              <p className="text-sm text-slate-500">Used by reel inward, raw material inward, and MRP purchase draft handoff.</p>
            </div>
            <Truck className="h-5 w-5 text-cyan-900" />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">GST</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((supplier: any) => (
                  <tr key={supplier.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-cyan-50 p-2 text-cyan-900">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-950">{supplier.name}</p>
                          <p className="text-xs text-slate-500">{supplier.supplier_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{String(supplier.category || "-").replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-slate-600">{supplier.contact_name || supplier.contact_phone || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{supplier.gst_no || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteVendor.mutateAsync(supplier.id)
                            showToast("Vendor deactivated.", "success")
                          } catch (error: any) {
                            showToast(error?.response?.data?.detail || error?.message || "Vendor deactivation failed.", "error")
                          }
                        }}
                        disabled={deleteVendor.isPending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700"
                        title="Disable vendor"
                        aria-label="Disable vendor"
                      >
                        <PowerOff className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No vendors yet. Add approved vendors before inward entry.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  )
}
