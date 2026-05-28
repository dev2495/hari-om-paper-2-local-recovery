"use client"

import { useState } from "react"
import Link from "next/link"
import { Building2, Factory, MapPin, Plus, Warehouse, Wrench } from "lucide-react"

import { PlantSwitcher } from "@/components/PlantSwitcher"
import { useAuth } from "@/context/AuthContext"
import { useCreateInventoryLocation, useInventoryLocations } from "@/hooks/use-inventory"
import { displayPlantScope } from "@/lib/plant-scope"

const purposeTone: Record<string, string> = {
  STORAGE: "border-cyan-200 bg-cyan-50 text-cyan-950",
  WIP: "border-amber-200 bg-amber-50 text-amber-950",
  QC: "border-rose-200 bg-rose-50 text-rose-950",
  DISPATCH: "border-emerald-200 bg-emerald-50 text-emerald-950",
  SCRAP: "border-slate-300 bg-slate-100 text-slate-700",
}

export default function SystemLocationsPage() {
  const { activePlant } = useAuth()
  const locationsQuery = useInventoryLocations()
  const createLocation = useCreateInventoryLocation()
  const [form, setForm] = useState({ code: "", warehouse: "", zone: "", bin: "", purpose: "STORAGE" })
  const [submitError, setSubmitError] = useState("")
  const locations = Array.isArray(locationsQuery.data) ? locationsQuery.data : []
  const writeBlocked = !activePlant || activePlant === "ALL"

  const purposeCounts = locations.reduce((acc: Record<string, number>, row: any) => {
    const purpose = String(row.purpose || "STORAGE").toUpperCase()
    acc[purpose] = (acc[purpose] || 0) + 1
    return acc
  }, {})

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (writeBlocked) return
    setSubmitError("")
    try {
      await createLocation.mutateAsync({
        code: form.code,
        warehouse: form.warehouse,
        zone: form.zone || null,
        bin: form.bin || null,
        purpose: form.purpose,
      })
      setForm({ code: "", warehouse: form.warehouse, zone: "", bin: "", purpose: "STORAGE" })
    } catch (error: any) {
      setSubmitError(error?.response?.data?.detail || error?.message || "Location save failed.")
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-950 via-cyan-950 to-emerald-900 p-6 text-white shadow-2xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">System setup</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Inventory locations</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-cyan-50/78">
              Create warehouses, zones, bins, WIP holding points, QC hold areas, dispatch staging, and scrap locations used by stores and production.
            </p>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/70">Current write scope</p>
            <p className="mt-2 text-lg font-semibold">{displayPlantScope(activePlant, "Select plant")}</p>
            {writeBlocked ? <p className="mt-1 text-xs text-amber-100">Select one plant before creating a location.</p> : null}
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-[1.75rem] border border-slate-200 bg-white/85 p-2 shadow-lg shadow-slate-900/5">
        {[
          { href: "/system/users", label: "Users", icon: Building2 },
          { href: "/system/plants", label: "Plants", icon: Building2 },
          { href: "/system/machines", label: "Machines", icon: Factory },
          { href: "/system/locations", label: "Locations", icon: MapPin },
          { href: "/system/tolerances", label: "Tolerances", icon: Wrench },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              item.href === "/system/locations" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={handleSubmit} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Create</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">New storage location</h2>
            </div>
            <div className="rounded-2xl bg-cyan-950 p-3 text-white">
              <Warehouse className="h-5 w-5" />
            </div>
          </div>
          {writeBlocked ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Global scope is read-only for location creation. Use the plant switcher to pick Plant A or Plant B.
              <div className="mt-3"><PlantSwitcher compact /></div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3">
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Location code
              <input required value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="RM-A-01" className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Warehouse
              <input required value={form.warehouse} onChange={(event) => setForm((current) => ({ ...current, warehouse: event.target.value }))} placeholder="RAW STORE" className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Zone
                <input value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))} placeholder="A" className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                Bin
                <input value={form.bin} onChange={(event) => setForm((current) => ({ ...current, bin: event.target.value }))} placeholder="01" className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
              </label>
            </div>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Purpose
              <select value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700">
                <option value="STORAGE">Storage</option>
                <option value="WIP">WIP</option>
                <option value="QC">QC hold</option>
                <option value="DISPATCH">Dispatch staging</option>
                <option value="SCRAP">Scrap</option>
              </select>
            </label>
          </div>
          {createLocation.isError || submitError ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {submitError || "Location save failed. Check duplicate code and selected plant."}
            </div>
          ) : null}
          <button disabled={writeBlocked || createLocation.isPending} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Create location
          </button>
        </form>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Location master</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Warehouses, zones, and bins</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {["STORAGE", "WIP", "QC", "DISPATCH", "SCRAP"].map((purpose) => (
                <span key={purpose} className={`rounded-full border px-3 py-1 text-xs font-semibold ${purposeTone[purpose]}`}>
                  {purpose} · {purposeCounts[purpose] || 0}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3">Zone / Bin</th>
                  <th className="px-4 py-3">Purpose</th>
                  <th className="px-4 py-3">Plant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {locations.map((row: any) => (
                  <tr key={row.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-950">{row.code}</td>
                    <td className="px-4 py-3 text-slate-700">{row.warehouse}</td>
                    <td className="px-4 py-3 text-slate-600">{[row.zone, row.bin].filter(Boolean).join(" / ") || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${purposeTone[String(row.purpose || "STORAGE").toUpperCase()] || purposeTone.STORAGE}`}>
                        {row.purpose || "STORAGE"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{displayPlantScope(row.plant_id, "-")}</td>
                  </tr>
                ))}
                {!locations.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No locations in this scope yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
