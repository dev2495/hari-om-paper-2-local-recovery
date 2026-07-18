"use client"

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { getStoredPlant, setStoredPlant } from "@/lib/api"
import { canonicalPlantScopeValue } from "@/lib/plant-scope"

interface User {
  id: string
  email: string
  name: string
  role: string | null
  plant_id: string
  allowed_plants?: string[]
  allowed_plant_ids?: string[]
  roles: string[]
  permissions: string[]
  is_active?: boolean
  is_owner_all_plants?: boolean
}

interface AuthContextType {
  user: User | null
  activePlant: string | null
  activeRole: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  setActivePlant: (plantId: string) => void
  setActiveRole: (role: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const ACTIVE_ROLE_STORAGE_KEY = "hariom_active_role"
const SESSION_IDLE_MS = 15 * 60 * 1000
const SESSION_HEARTBEAT_MS = 60 * 1000

function normalizeAllowedPlants(user: Partial<User> | null | undefined) {
  const rawValues = [...(user?.allowed_plant_ids || []), ...(user?.allowed_plants || [])]
  return Array.from(new Set(rawValues.map((value) => String(value || "").trim()).filter(Boolean)))
}

function normalizeUser(rawUser: any): User {
  const allowedPlantIds = normalizeAllowedPlants(rawUser)
  return {
    ...rawUser,
    plant_id: String(rawUser?.plant_id || allowedPlantIds[0] || "PLANT_A"),
    roles: Array.isArray(rawUser?.roles) ? rawUser.roles : [],
    permissions: Array.isArray(rawUser?.permissions) ? rawUser.permissions : [],
    allowed_plants: allowedPlantIds,
    allowed_plant_ids: allowedPlantIds,
    is_owner_all_plants: Boolean(rawUser?.is_owner_all_plants),
  }
}

function userCanUseGlobalPlant(user: Partial<User> | null | undefined) {
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean).map((role) => String(role).toLowerCase()))
  return Boolean(user?.is_owner_all_plants || roles.has("owner") || roles.has("admin"))
}

function resolveActivePlant(user: User, preferredPlant: string | null) {
  if (preferredPlant) {
    const canonicalPreferredPlant = canonicalPlantScopeValue(preferredPlant)
    if (canonicalPreferredPlant.toUpperCase() === "ALL") {
      return userCanUseGlobalPlant(user) ? "ALL" : user.plant_id || null
    }
    return canonicalPreferredPlant
  }
  if (userCanUseGlobalPlant(user)) {
    return "ALL"
  }
  const allowedPlantIds = normalizeAllowedPlants(user)
  if (allowedPlantIds.length > 0) {
    return allowedPlantIds[0]
  }
  if (user.plant_id) {
    return user.plant_id
  }
  return null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [activePlant, setActivePlantState] = useState<string | null>(null)
  const [activeRole, setActiveRoleState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const lastActivityAt = useRef(Date.now())
  const lastSessionTouchAt = useRef(Date.now())

  const setActivePlant = (plantId: string) => {
    const canonicalPlant = canonicalPlantScopeValue(plantId)
    setActivePlantState(canonicalPlant)
    setStoredPlant(canonicalPlant)
  }

  const setActiveRole = (role: string) => {
    setActiveRoleState(role)
    try {
      window.localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role)
    } catch {
      // Ignore storage errors.
    }
  }

  const checkAuth = async () => {
    try {
      // One-time cleanup for browsers that used the former JS-readable bearer-token flow.
      window.localStorage.removeItem("hariom_access_token")
      const storedPlant = getStoredPlant()
      const storedRole = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY) : null
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
        headers: storedPlant ? { "X-Plant-ID": storedPlant } : undefined,
      })
      if (response.ok) {
        const data = normalizeUser(await response.json())
        const nextPlant = resolveActivePlant(data, storedPlant)
        const availableRoles = [data.role, ...(data.roles || [])].filter(Boolean).map((role) => String(role))
        const nextRole = storedRole && availableRoles.includes(storedRole) ? storedRole : availableRoles[0] || null
        setUser(data)
        setActivePlantState(nextPlant)
        setActiveRoleState(nextRole)
        setStoredPlant(nextPlant)
      } else {
        setUser(null)
        setActivePlantState(null)
        setActiveRoleState(null)
        setStoredPlant(null)
      }
    } catch {
      setUser(null)
      setActivePlantState(null)
      setActiveRoleState(null)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) {
      let detail = "Login failed"
      try {
        const payload = await response.json()
        detail = payload?.detail || detail
      } catch {
        // Keep fallback detail.
      }
      throw new Error(detail)
    }

    const data = await response.json()
    const normalizedUser = normalizeUser(data.user)
    const nextPlant = resolveActivePlant(normalizedUser, null)
    const availableRoles = [normalizedUser.role, ...(normalizedUser.roles || [])].filter(Boolean).map((role) => String(role))
    const nextRole = availableRoles[0] || null
    setUser(normalizedUser)
    setActivePlantState(nextPlant)
    setActiveRoleState(nextRole)
    setStoredPlant(nextPlant)
    return normalizedUser
  }

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    })
    setUser(null)
    setActivePlantState(null)
    setActiveRoleState(null)
    setStoredPlant(null)
    try {
      window.localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY)
    } catch {
      // Ignore storage errors.
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (!user) return

    const expireIdleSession = async () => {
      await logout()
      if (window.location.pathname !== "/login") {
        window.location.assign("/login?reason=inactive")
      }
    }

    const verifyAndRenew = async (renew: boolean) => {
      const idleFor = Date.now() - lastActivityAt.current
      if (idleFor >= SESSION_IDLE_MS) {
        await expireIdleSession()
        return
      }
      if (!renew || document.visibilityState !== "visible") return
      try {
        const response = await fetch("/api/auth/session/touch", {
          method: "POST",
          credentials: "include",
          headers: { "X-Requested-With": "HariOmERP" },
        })
        if (response.status === 401) await expireIdleSession()
        else if (response.ok) lastSessionTouchAt.current = Date.now()
      } catch {
        // A transient network outage must not erase the session; the server-side
        // cookie still expires at the hard inactivity boundary.
      }
    }

    const recordActivity = () => {
      const now = Date.now()
      lastActivityAt.current = now
      if (now - lastSessionTouchAt.current >= SESSION_HEARTBEAT_MS) void verifyAndRenew(true)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      const wasIdleFor = Date.now() - lastActivityAt.current
      if (wasIdleFor >= SESSION_IDLE_MS) void expireIdleSession()
      else {
        lastActivityAt.current = Date.now()
        void verifyAndRenew(true)
      }
    }
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"]
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }))
    document.addEventListener("visibilitychange", onVisibilityChange)
    const interval = window.setInterval(() => void verifyAndRenew(false), SESSION_HEARTBEAT_MS)

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.clearInterval(interval)
    }
  }, [user, logout])

  return (
    <AuthContext.Provider value={{ user, activePlant, activeRole, isLoading, login, logout, checkAuth, setActivePlant, setActiveRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
