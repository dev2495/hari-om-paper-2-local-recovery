"use client"

import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { LANDING_LABELS, landingPathForRole, rolesForSwitcher } from "@/lib/workspace"
import { cn } from "@/lib/utils"

export function RoleSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const { user, activeRole, setActiveRole } = useAuth()
  const available = rolesForSwitcher([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])

  if (available.length <= 1) {
    const role = available[0]
    return role ? (
      <div className="hidden rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm lg:block">
        {LANDING_LABELS[role]}
      </div>
    ) : null
  }

  return (
    <div className={cn("relative hidden items-center lg:flex", compact && "max-w-[12.5rem]")}>
      <select
        aria-label="Switch active role"
        value={activeRole && available.includes(activeRole as any) ? activeRole : available[0]}
        onChange={(event) => {
          const role = event.target.value
          setActiveRole(role)
          router.push(landingPathForRole(role))
        }}
        className="h-10 appearance-none rounded-full border border-slate-200 bg-white py-0 pl-4 pr-9 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 shadow-sm outline-none transition hover:border-cyan-200 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
      >
        {available.map((role) => (
          <option key={role} value={role}>
            {LANDING_LABELS[role]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
    </div>
  )
}
