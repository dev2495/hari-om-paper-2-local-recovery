"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { RoleLanding } from "@/components/workspace/role-landing"
import { useAuth } from "@/context/AuthContext"
import { landingPathForRole, resolveLandingRole } from "@/lib/workspace"

export default function DashboardPage() {
  const router = useRouter()
  const { user, activeRole } = useAuth()
  const landingRole = resolveLandingRole(activeRole ? [activeRole] : user?.roles || (user?.role ? [user.role] : []))

  useEffect(() => {
    if (landingRole === "Owner" || landingRole === "Admin") {
      router.replace(landingPathForRole(landingRole))
    }
  }, [landingRole, router])

  return <RoleLanding landingRole={landingRole} />
}
