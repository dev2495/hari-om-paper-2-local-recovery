"use client"

import React, { useEffect, useState } from "react"
import { ArrowLeft, Save, Shield, User as UserIcon } from "lucide-react"
import { authApi } from "@/lib/api"
import { useApp } from "@/context/AppContext"
import { useRouter } from "next/navigation"
import Link from "next/link"

const FALLBACK_PLANTS = [
    { id: "PLANT-1", name: "Plant 1 (Main)" },
    { id: "PLANT-2", name: "Plant 2 (Extension)" },
]

const FALLBACK_ROLES = [
    "Owner",
    "Admin",
    "PlantManager",
    "Planner",
    "SpecMaker",
    "SpecApprover",
    "Production",
    "Operator",
    "Store",
    "DispatchMaker",
    "DispatchApprover",
    "Sales",
    "SOMaker",
    "SOApprover",
    "QC",
].map((name) => ({ id: name, name }))

export default function NewUserPage() {
    const router = useRouter()
    const { showToast } = useApp()
    const [roles, setRoles] = useState<any[]>([])
    const [plants, setPlants] = useState(FALLBACK_PLANTS)
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        plant_id: "PLANT-1",
        role_names: [] as string[],
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        const loadAccessMetadata = async () => {
            const [rolesResult, plantsResult] = await Promise.allSettled([
                authApi.getRoles(),
                authApi.getPlants(),
            ])

            if (rolesResult.status === "fulfilled") {
                const nextRoles = Array.isArray(rolesResult.value.data) && rolesResult.value.data.length > 0
                    ? rolesResult.value.data
                    : FALLBACK_ROLES
                setRoles(nextRoles)
            } else {
                setRoles(FALLBACK_ROLES)
                showToast("Using fallback roles while auth metadata refreshes.", "error")
            }

            if (plantsResult.status === "fulfilled") {
                const nextPlants = (Array.isArray(plantsResult.value.data) ? plantsResult.value.data : [])
                    .filter((plant) => String(plant?.code || plant?.id || "").toUpperCase() !== "ALL" && plant?.is_active !== false)
                    .map((plant) => ({
                        id: String(plant.id || plant.code),
                        name: String(plant.name || plant.code || plant.id),
                    }))
                if (nextPlants.length > 0) {
                    setPlants(nextPlants)
                    setFormData((current) => ({ ...current, plant_id: current.plant_id || nextPlants[0].id }))
                }
            }
        }
        loadAccessMetadata()
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (formData.role_names.length === 0) {
            showToast("Please select at least one role", "error")
            return
        }

        setIsSubmitting(true)
        try {
            await authApi.createUser(formData)
            showToast("User created successfully", "success")
            router.push("/system/users")
        } catch (err: any) {
            showToast(err.response?.data?.detail || "Failed to create user", "error")
        } finally {
            setIsSubmitting(false)
        }
    }

    const toggleRole = (roleName: string) => {
        setFormData((prev) => ({
            ...prev,
            role_names: prev.role_names.includes(roleName)
                ? prev.role_names.filter((r) => r !== roleName)
                : [...prev.role_names, roleName],
        }))
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div className="flex items-center gap-4">
                <Link
                    href="/system/users"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">Add New User</h1>
                    <p className="text-sm text-slate-500">Create a new system user and assign permissions</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="glass space-y-8 rounded-2xl border border-white/60 bg-white/50 p-8 shadow-xl">
                <div className="space-y-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2 col-span-2">
                            <label className="text-sm font-medium text-slate-700">Full Name</label>
                            <input
                                required
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2"
                                placeholder="e.g. John Doe"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Email Address</label>
                            <input
                                required
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2"
                                placeholder="john@example.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Initial Password</label>
                            <input
                                required
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2"
                                placeholder="Min. 8 characters"
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Access Control</h3>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Assigned Plant</label>
                            <select
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-cyan-700 transition focus:ring-2"
                                value={formData.plant_id}
                                onChange={(e) => setFormData({ ...formData, plant_id: e.target.value })}
                            >
                                {plants.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium text-slate-700">Assign Roles</label>
                            <div className="grid grid-cols-2 gap-3">
                                {roles.map((role) => (
                                    <button
                                        key={role.id}
                                        type="button"
                                        onClick={() => toggleRole(role.name)}
                                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${formData.role_names.includes(role.name)
                                                ? "border-cyan-200 bg-cyan-50/50 text-cyan-900"
                                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                            }`}
                                    >
                                        <div className={`p-1.5 rounded-lg ${formData.role_names.includes(role.name) ? "bg-cyan-100" : "bg-slate-100"}`}>
                                            <Shield className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">{role.name}</p>
                                            <p className="text-[10px] text-slate-500">Standard system role</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex pt-4">
                    <button
                        disabled={isSubmitting}
                        type="submit"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-900 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-cyan-900/20 transition hover:bg-cyan-800 disabled:opacity-70"
                    >
                        {isSubmitting ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        Create User Account
                    </button>
                </div>
            </form>
        </div>
    )
}
