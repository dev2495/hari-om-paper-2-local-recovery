"use client"

import { useAuth } from "@/context/AuthContext"

export function UserMenu() {
  const { user, logout } = useAuth()
  return (
    <div className="flex items-center gap-3 rounded-full border border-border bg-card px-3 py-2 text-sm shadow-sm">
      <span className="max-w-[14rem] truncate font-bold text-foreground">{user?.name || user?.email || "User"}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground"
      >
        Logout
      </button>
    </div>
  )
}

export default UserMenu
