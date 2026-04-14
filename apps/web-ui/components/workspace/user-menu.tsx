"use client"

import { useAuth } from "@/context/AuthContext"

export function UserMenu() {
  const { user, logout } = useAuth()
  return (
    <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
      <span className="max-w-[14rem] truncate font-bold text-slate-800">{user?.name || user?.email || "User"}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded-full bg-slate-950 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-white"
      >
        Logout
      </button>
    </div>
  )
}

export default UserMenu
