"use client"

import Link from "next/link"
import { Building2, ChevronRight, Factory, Plus, Shield, User as UserIcon, Users2 } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { usePlants, useUsers } from "@/hooks/use-system"

const PLANT_SCOPE_ALIASES: Record<string, string> = {
  "00000000-0000-0000-0000-0000000000a1": "Plant A",
  "00000000-0000-0000-0000-0000000000b2": "Plant B",
  PLANT_A: "Plant A",
  PLANT_B: "Plant B",
}

function formatCreated(value: string | undefined | null) {
  if (!value) return "Legacy user"
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return "Legacy user"
  return timestamp.toLocaleDateString("en-GB")
}

export default function UsersPage() {
  const { user, activePlant } = useAuth()
  const { data: users = [], isLoading: usersLoading } = useUsers()
  const { data: plants = [] } = usePlants()

  const plantMap = new Map<string, string>()
  ;(Array.isArray(plants) ? plants : []).forEach((plant: any) => {
    const label = plant?.name || plant?.code || plant?.id || "Unknown plant"
    ;[plant?.id, plant?.code].filter(Boolean).forEach((value) => {
      plantMap.set(String(value), label)
    })
  })
  Object.entries(PLANT_SCOPE_ALIASES).forEach(([key, value]) => {
    if (!plantMap.has(key)) {
      plantMap.set(key, value)
    }
  })

  const scopedUsers = (Array.isArray(users) ? users : []).filter((entry: any) => {
    if (!activePlant || activePlant === "ALL") return true
    const allowedPlants = [...(entry?.allowed_plant_ids || []), ...(entry?.allowed_plants || []), entry?.plant_id]
      .map((value) => String(value || ""))
      .filter(Boolean)
    return allowedPlants.includes(activePlant)
  })

  const globalUsers = scopedUsers.filter((entry: any) => {
    const allowedPlants = [...(entry?.allowed_plant_ids || []), ...(entry?.allowed_plants || [])].filter(Boolean)
    return entry?.is_owner_all_plants || allowedPlants.length === 0
  }).length

  const scopeLabel =
    activePlant === "ALL"
      ? "All visible plants"
      : plantMap.get(String(activePlant || "")) || activePlant || user?.plant_id || "Global"

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-slate-950 via-cyan-950 to-slate-800 p-6 text-white shadow-2xl shadow-slate-900/15">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">System Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] md:text-4xl">Users, plants, and machine governance</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-50/78">
              Resolve user access, plant scope, and machine setup from one workspace. This surface now reads the actual auth payload instead of legacy placeholders.
            </p>
          </div>
          <Link
            href="/system/users/new"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-50"
          >
            <Plus className="h-4 w-4" />
            Add New User
          </Link>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { label: "Visible users", value: `${scopedUsers.length}`, note: "Current plant scope" },
            { label: "Global access", value: `${globalUsers}`, note: "Users spanning all plants" },
            { label: "Current scope", value: scopeLabel, note: "Top plant switcher governs this list" },
          ].map((item) => (
            <div key={item.label} className="rounded-3xl border border-white/15 bg-white/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/70">{item.label}</p>
              <p className="mt-2 text-lg font-semibold">{item.value}</p>
              <p className="mt-1 text-xs text-cyan-50/65">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-[1.75rem] border border-slate-200 bg-white/85 p-2 shadow-lg shadow-slate-900/5">
        {[
          { href: "/system/users", label: "Users", icon: Users2, active: true },
          { href: "/system/plants", label: "Plants", icon: Building2, active: false },
          { href: "/system/machines", label: "Machines", icon: Factory, active: false },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              item.active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white/92 shadow-xl shadow-slate-900/5">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">User management</h2>
            <p className="text-sm text-slate-500">Roles are rendered from the real auth-service payload and plant IDs are resolved back to plant names.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {scopeLabel}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Roles</th>
                <th className="px-6 py-4">Plant scope</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {usersLoading ? (
                [...Array(5)].map((_, index) => (
                  <tr key={index} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-5">
                      <div className="h-12 rounded-2xl bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : scopedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">
                    No users found for this scope.
                  </td>
                </tr>
              ) : (
                scopedUsers.map((entry: any) => {
                  const roles = Array.isArray(entry?.roles) ? entry.roles.filter(Boolean) : []
                  const allowedPlants = Array.from(
                    new Set([...(entry?.allowed_plant_ids || []), ...(entry?.allowed_plants || []), entry?.plant_id].filter(Boolean)),
                  )
                  const scopeItems = entry?.is_owner_all_plants
                    ? ["All plants"]
                    : allowedPlants.length > 0
                      ? allowedPlants.map((plantId: string) => plantMap.get(String(plantId)) || String(plantId))
                      : ["Global"]

                  return (
                    <tr key={entry.id} className="transition hover:bg-slate-50/80">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-900">
                            <UserIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{entry.name || entry.email}</p>
                            <p className="text-xs text-slate-500">{entry.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {roles.length > 0 ? (
                            roles.map((role: string) => (
                              <span
                                key={`${entry.id}-${role}`}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                              >
                                <Shield className="h-3 w-3" />
                                {role}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-slate-400">No role mapped</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {scopeItems.map((scope: string) => (
                            <span
                              key={`${entry.id}-${scope}`}
                              className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-900"
                            >
                              <ChevronRight className="h-3 w-3" />
                              {scope}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                            entry?.is_active === false ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {entry?.is_active === false ? "Inactive" : "Active"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatCreated(entry?.created_at)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
