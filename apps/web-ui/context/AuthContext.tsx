"use client"

import React, { createContext, useContext, useState, useEffect } from "react"
import { getStoredPlant, setStoredPlant } from "@/lib/api"

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
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  setActivePlant: (plantId: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

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

function resolveActivePlant(user: User, preferredPlant: string | null) {
  if (preferredPlant) {
    return preferredPlant
  }
  if (user.is_owner_all_plants) {
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
  const [isLoading, setIsLoading] = useState(true)

  const setActivePlant = (plantId: string) => {
    setActivePlantState(plantId)
    setStoredPlant(plantId)
  }

  const checkAuth = async () => {
    try {
      const storedPlant = getStoredPlant()
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
        headers: storedPlant ? { "X-Plant-ID": storedPlant } : undefined,
      })
      if (response.ok) {
        const data = normalizeUser(await response.json())
        const nextPlant = resolveActivePlant(data, storedPlant)
        setUser(data)
        setActivePlantState(nextPlant)
        setStoredPlant(nextPlant)
      } else {
        setUser(null)
        setActivePlantState(null)
        setStoredPlant(null)
      }
    } catch {
      setUser(null)
      setActivePlantState(null)
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
    setUser(normalizedUser)
    setActivePlantState(nextPlant)
    setStoredPlant(nextPlant)
  }

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    })
    setUser(null)
    setActivePlantState(null)
    setStoredPlant(null)
  }

  useEffect(() => {
    checkAuth()
  }, [])

  return (
    <AuthContext.Provider value={{ user, activePlant, isLoading, login, logout, checkAuth, setActivePlant }}>
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
