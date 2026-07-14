"use client"

import React, { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, KeyRound, Save, Shield, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useApp } from "@/context/AppContext"
import { authApi } from "@/lib/api"
import { cn } from "@/lib/utils"

const FALLBACK_PLANTS = [
  { id: "PLANT_A", name: "Plant A" },
  { id: "PLANT_B", name: "Plant B" },
]

const BUSINESS_ROLES = [
  {
    key: "Owner",
    label: "Owner",
    roles: ["Owner"],
    summary: "Full company visibility, analytics, specs, approvals, and control room.",
    scope: "All modules",
  },
  {
    key: "Admin",
    label: "Admin",
    roles: ["Admin"],
    summary: "System setup, users, plants, machines, locations, and role governance.",
    scope: "System + ops view",
  },
  {
    key: "Sales",
    label: "Sales",
    roles: ["Sales"],
    summary: "Customer PO, sales orders, releases, and commercial tracking.",
    scope: "Sales + dispatch status",
  },
  {
    key: "Planner",
    label: "Planner",
    roles: ["Planner"],
    summary: "Release queue, planning board, tracker, job-card movement, and MRP signals.",
    scope: "Planning spine",
  },
  {
    key: "PlantManager",
    label: "Plant manager / supervisor",
    roles: ["PlantManager"],
    summary: "Machine execution, supervisor entry, stage completion, QC holds, and reconciliation.",
    scope: "Plant floor",
  },
  {
    key: "Store",
    label: "Store",
    roles: ["Store"],
    summary: "Raw material inward, issues, locations, stock risk, and MRP shortage response.",
    scope: "Inventory",
  },
  {
    key: "Dispatch",
    label: "Dispatch",
    roles: ["Dispatch"],
    summary: "FG readiness, challans, dispatch validation, and customer handoff.",
    scope: "Logistics",
  },
  {
    key: "Operator",
    label: "Operator",
    roles: ["Operator"],
    summary: "QR scan only, assigned job card, and simple production input.",
    scope: "Floor input",
  },
]

const OVERRIDE_RIGHTS = [
  { key: "sales", label: "Sales order rights", detail: "Can create customer PO, manage sales orders, and request releases.", roles: ["Sales"] },
  { key: "planner", label: "Planner board rights", detail: "Can schedule released work, tracker, and MRP planning surfaces.", roles: ["Planner"] },
  { key: "plant_floor", label: "Supervisor / plant floor", detail: "Can enter stage outputs, see job cards, and close floor truth.", roles: ["PlantManager"] },
  { key: "store", label: "Inventory and stock close", detail: "Can run inward, issue, stock close, and shortage response.", roles: ["Store"] },
  { key: "dispatch", label: "Dispatch rights", detail: "Can create/validate challan and FG dispatch handoff.", roles: ["Dispatch"] },
  { key: "operator", label: "QR operator", detail: "Can use scan-only operator entry surfaces.", roles: ["Operator"] },
  { key: "reports", label: "Reports and analytics", detail: "Adds owner-grade reports/analytics visibility for exceptions.", roles: ["Owner"] },
  { key: "system", label: "System setup", detail: "Adds admin setup rights for users, plants, machines, locations, and masters.", roles: ["Admin"] },
]

function uniqueRoles(roleNames: string[], availableRoles: Set<string>) {
  const resolved = Array.from(new Set(roleNames.filter(Boolean)))
  const available = resolved.filter((role) => availableRoles.size === 0 || availableRoles.has(role))
  return available.length > 0 ? available : resolved.slice(0, 1)
}

export default function NewUserPage() {
  const router = useRouter()
  const { showToast } = useApp()
  const [availableRoles, setAvailableRoles] = useState<Set<string>>(new Set())
  const [plants, setPlants] = useState(FALLBACK_PLANTS)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    plant_id: "PLANT_A",
    business_role: "Planner",
    overrides: [] as string[],
    is_owner_all_plants: false,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const loadAccessMetadata = async () => {
      const [rolesResult, plantsResult] = await Promise.allSettled([authApi.getRoles(), authApi.getPlants()])
      if (rolesResult.status === "fulfilled") {
        const roles = Array.isArray(rolesResult.value.data) ? rolesResult.value.data : []
        setAvailableRoles(new Set(roles.map((role: any) => String(role.name || role.id)).filter(Boolean)))
      }
      if (plantsResult.status === "fulfilled") {
        const nextPlants = (Array.isArray(plantsResult.value.data) ? plantsResult.value.data : [])
          .filter((plant) => String(plant?.code || plant?.id || "").toUpperCase() !== "ALL" && plant?.is_active !== false)
          .map((plant) => ({ id: String(plant.id || plant.code), name: String(plant.name || plant.code || plant.id) }))
        if (nextPlants.length > 0) {
          setPlants(nextPlants)
          setFormData((current) => ({
            ...current,
            plant_id: nextPlants.some((plant) => plant.id === current.plant_id) ? current.plant_id : nextPlants[0].id,
          }))
        }
      }
    }
    loadAccessMetadata()
  }, [])

  const selectedBusinessRole = useMemo(
    () => BUSINESS_ROLES.find((role) => role.key === formData.business_role) || BUSINESS_ROLES[0],
    [formData.business_role],
  )

  const resolvedRoleNames = useMemo(() => {
    const overrideRoles = OVERRIDE_RIGHTS
      .filter((right) => formData.overrides.includes(right.key))
      .flatMap((right) => right.roles)
    return uniqueRoles([...selectedBusinessRole.roles, ...overrideRoles], availableRoles)
  }, [availableRoles, formData.overrides, selectedBusinessRole])

  const toggleOverride = (key: string) => {
    setFormData((prev) => ({
      ...prev,
      overrides: prev.overrides.includes(key) ? prev.overrides.filter((item) => item !== key) : [...prev.overrides, key],
    }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await authApi.createUser({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        plant_id: formData.plant_id,
        role_names: resolvedRoleNames,
        is_owner_all_plants: formData.is_owner_all_plants || ["Owner", "Admin"].includes(formData.business_role),
      })
      showToast("User created with condensed role matrix.", "success")
      router.push("/system/users")
    } catch (err: any) {
      showToast(err.response?.data?.detail || "Failed to create user", "error")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/system/users" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-700">User access matrix</p>
          <h1 className="text-2xl font-semibold text-slate-950">Create user with clean business roles</h1>
          <p className="text-sm text-slate-500">Only eight roles are shown. Overrides add precise rights without exposing old maker/checker role clutter.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-5 rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-900/5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Account</h2>
              <p className="text-sm text-slate-500">Plant and login setup.</p>
            </div>
          </div>
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Full name</span>
              <input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2" placeholder="e.g. Store Manager" />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input required type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2" placeholder="user@hariom.com" />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Initial password</span>
              <input required minLength={12} maxLength={128} type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2" aria-describedby="password-policy" />
              <span id="password-policy" className="text-xs text-slate-500">At least 12 characters with uppercase, lowercase, number, and symbol.</span>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Assigned plant</span>
              <select value={formData.plant_id} onChange={(e) => setFormData({ ...formData, plant_id: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2">
                {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <input type="checkbox" checked={formData.is_owner_all_plants} onChange={(e) => setFormData({ ...formData, is_owner_all_plants: e.target.checked })} className="mt-1" />
              <span><b className="text-slate-900">Global scope override</b><br />Use only for owner/admin users who need all-plant visibility.</span>
            </label>
          </div>
        </section>

        <section className="space-y-5 rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-900/5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-cyan-950 p-3 text-white">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Role matrix</h2>
                <p className="text-sm text-slate-500">Select one primary role, then add explicit overrides if needed.</p>
              </div>
            </div>
            <div className="hidden rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-900 md:block">
              {resolvedRoleNames.join(" + ")}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {BUSINESS_ROLES.map((role) => {
              const active = formData.business_role === role.key
              return (
                <button key={role.key} type="button" onClick={() => setFormData({ ...formData, business_role: role.key })} className={cn("rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg", active ? "border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-900/5" : "border-slate-200 bg-white")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{role.label}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{role.scope}</p>
                    </div>
                    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full border", active ? "border-cyan-300 bg-cyan-600 text-white" : "border-slate-200 bg-slate-50 text-slate-300")}>
                      {active ? <Check className="h-4 w-4" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{role.summary}</p>
                </button>
              )
            })}
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
            <p className="text-sm font-semibold text-slate-950">Permission overrides</p>
            <p className="mt-1 text-sm text-slate-500">Use these only for exceptions. Spec creation is intentionally restricted to Owner/Admin.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {OVERRIDE_RIGHTS.map((right) => {
                const active = formData.overrides.includes(right.key)
                return (
                  <button key={right.key} type="button" onClick={() => toggleOverride(right.key)} className={cn("rounded-2xl border px-4 py-3 text-left transition", active ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{right.label}</p>
                      {active ? <Check className="h-4 w-4" /> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 opacity-75">{right.detail}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <button disabled={isSubmitting} type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition hover:bg-cyan-950 disabled:opacity-70">
            {isSubmitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Save className="h-4 w-4" />}
            Create user account
          </button>
        </section>
      </form>
    </div>
  )
}
