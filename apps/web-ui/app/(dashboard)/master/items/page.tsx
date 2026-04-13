"use client"

import { useState } from "react"
import { Plus, Package, Search, Filter } from "lucide-react"
import { useCreateItem, useInventoryItems } from "@/hooks/use-inventory"

export default function ItemMasterPage() {
    const { data: items, isLoading } = useInventoryItems()
    const createItem = useCreateItem()
    const [form, setForm] = useState({ item_code: "", name: "", type: "FINISHED_GOOD", uom: "KG" })

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header section */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Item Master</h1>
                    <p className="text-slate-400 mt-1">Manage Raw Materials and Finished Goods inventory definitions.</p>
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
                {/* Create Form */}
                <section className="glass-card p-6 h-fit sticky top-24">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="bg-cyan-500/10 p-2 rounded-lg">
                            <Plus className="h-5 w-5 text-cyan-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-white">Define New Item</h2>
                    </div>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            createItem.mutate(form)
                            setForm({ item_code: "", name: "", type: "FINISHED_GOOD", uom: "KG" })
                        }}
                        className="space-y-4"
                    >
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Item Code</label>
                            <input
                                required
                                placeholder="e.g., RP-001"
                                value={form.item_code}
                                onChange={(e) => setForm((s) => ({ ...s, item_code: e.target.value }))}
                                className="h-11 w-full rounded-xl bg-slate-950/50 border border-slate-800 px-4 text-sm text-white focus:border-cyan-500/50 outline-none transition"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Item Name</label>
                            <input
                                required
                                placeholder="e.g., Raw Paper 120GSM"
                                value={form.name}
                                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                                className="h-11 w-full rounded-xl bg-slate-950/50 border border-slate-800 px-4 text-sm text-white focus:border-cyan-500/50 outline-none transition"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Type</label>
                                <select
                                    value={form.type}
                                    onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}
                                    className="h-11 w-full rounded-xl bg-slate-950/50 border border-slate-800 px-2 text-sm text-white focus:border-cyan-500/50 outline-none transition"
                                >
                                    <option value="FINISHED_GOOD">FG</option>
                                    <option value="RAW_PAPER">Raw Paper</option>
                                    <option value="ADHESIVE">Adhesive</option>
                                    <option value="PARCHMENT">Parchment Lot</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">UOM</label>
                                <select
                                    value={form.uom}
                                    onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))}
                                    className="h-11 w-full rounded-xl bg-slate-950/50 border border-slate-800 px-2 text-sm text-white focus:border-cyan-500/50 outline-none transition"
                                >
                                    <option value="KG">KG</option>
                                    <option value="PCS">PCS</option>
                                </select>
                            </div>
                        </div>

                        <button
                            disabled={createItem.isPending}
                            className="w-full mt-4 h-11 rounded-xl bg-cyan-600 font-bold text-white hover:bg-cyan-500 transition shadow-lg shadow-cyan-900/20 disabled:opacity-50"
                        >
                            {createItem.isPending ? "Creating..." : "Add to Master"}
                        </button>
                    </form>
                </section>

                {/* List Table */}
                <section className="lg:col-span-2 glass-card overflow-hidden">
                    <div className="p-6 border-b border-white/5 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">Inventory Items</h3>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                                <input
                                    placeholder="Search..."
                                    className="h-9 w-48 rounded-lg bg-slate-900/50 border border-slate-800 pl-9 pr-3 text-xs text-white outline-none focus:border-slate-700 transition"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-950/30 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                <tr>
                                    <th className="px-6 py-4 text-left">Code</th>
                                    <th className="px-6 py-4 text-left">Item Name</th>
                                    <th className="px-6 py-4 text-left">Category</th>
                                    <th className="px-6 py-4 text-left">UOM</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-500">Loading master records...</td>
                                    </tr>
                                ) : (items || []).length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-slate-500">No items defined in this plant.</td>
                                    </tr>
                                ) : (items || []).map((row: any) => (
                                    <tr key={row.id} className="hover:bg-white/5 transition group">
                                        <td className="px-6 py-4 font-mono text-cyan-400">{row.item_code}</td>
                                        <td className="px-6 py-4 font-medium text-slate-200">{row.name}</td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400 uppercase">
                                                {row.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-400">{row.uom}</td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="flex justify-center">
                                                <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    )
}
