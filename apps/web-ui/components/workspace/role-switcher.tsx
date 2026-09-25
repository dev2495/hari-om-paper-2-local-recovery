"use client"

import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { LANDING_LABELS, landingPathForRole, rolesForSwitcher } from "@/lib/workspace"
import { cn } from "@/lib/utils"

export function RoleSwitcher({ compact = false, mobile = false }: { compact?: boolean; mobile?: boolean }) {
  const router = useRouter()
  const { user, activeRole, setActiveRole } = useAuth()
  const available = rolesForSwitcher([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])

  if (available.length <= 1) {
    const role = available[0]
    return role ? (
      <div className={cn("rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm", !mobile && "hidden lg:block")}>
        {LANDING_LABELS[role]}
      </div>
    ) : null
  }

  return (
    <div className={cn("relative items-center", mobile ? "flex" : "hidden lg:flex", compact && "max-w-[12.5rem]")}>
      <select
        aria-label="Switch active role"
        value={activeRole && available.includes(activeRole as any) ? activeRole : available[0]}
        onChange={(event) => {
          const role = event.target.value
          setActiveRole(role)
          router.push(landingPathForRole(role))
        }}
        className="h-10 appearance-none rounded-lg border border-border bg-card py-0 pl-4 pr-9 text-xs font-medium text-muted-foreground shadow-sm outline-none transition hover:border-signal-cyan-line focus:border-signal-cyan-line focus:ring-2 focus:ring-ring/15"
      >
        {available.map((role) => (
          <option key={role} value={role}>
            {LANDING_LABELS[role]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}
