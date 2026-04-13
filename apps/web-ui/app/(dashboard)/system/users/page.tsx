"use client"

import React, { useEffect, useState } from "react"
import { Plus, Shield, User as UserIcon } from "lucide-react"
import { authApi } from "@/lib/api"
import { useApp } from "@/context/AppContext"
import Link from "next/link"

export default function UsersPage() {
    const [users, setUsers] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const { showToast } = useApp()

    const fetchUsers = async () => {
        try {
            const response = await authApi.users()
            setUsers(response.data)
        } catch (err) {
            showToast("Failed to fetch users", "error")
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchUsers()
    }, [])

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">User Management</h1>
                    <p className="text-sm text-slate-500">Manage system users, roles and plant assignments</p>
                </div>
                <Link
                    href="/system/users/new"
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-cyan-900/20 transition hover:bg-cyan-800"
                >
                    <Plus className="h-4 w-4" />
                    Add New User
                </Link>
            </div>

            <div className="glass overflow-hidden rounded-2xl border border-white/60 bg-white/50 shadow-xl">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-slate-200/60 bg-slate-50/50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <th className="px-6 py-4">User</th>
                            <th className="px-6 py-4">Role</th>
                            <th className="px-6 py-4">Plant</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Created</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60">
                        {isLoading ? (
                            [...Array(3)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td colSpan={5} className="px-6 py-4 h-16 bg-slate-100/20"></td>
                                </tr>
                            ))
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                                    No users found
                                </td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id} className="transition hover:bg-white/40">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-900">
                                                <UserIcon className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                                                <p className="text-xs text-slate-500">{user.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-wrap gap-1">
                                            {user.roles.map((r: any) => (
                                                <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                                                    <Shield className="h-2.5 w-2.5" />
                                                    {r.name}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                                        {user.plant_id || "Global"}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
                                            Active
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-xs text-slate-500">
                                        {new Date(user.created_at).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
