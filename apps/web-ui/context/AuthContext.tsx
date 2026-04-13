"use client"

import React, { createContext, useContext, useState, useEffect } from "react"
import { getStoredPlant, setStoredPlant } from "@/lib/api"

interface User {
  id: string
  email: string
  name: string
  role: string | null
  plant_id: string
  roles: string[]
  permissions: string[]
  is_active?: boolean
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
      const response = await fetch("/api/auth/me", {
        headers: {
          "X-Plant-ID": getStoredPlant() || "",
        },
      })
      if (response.ok) {
        const data = await response.json()
        setUser(data)
        // If no active plant set, use user's default
        if (!getStoredPlant() && data.plant_id) {
          setActivePlant(data.plant_id)
        } else if (getStoredPlant()) {
          setActivePlantState(getStoredPlant())
        }
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) {
      throw new Error("Invalid credentials")
    }

    const data = await response.json()
    setUser(data.user)
    setStoredPlant(null) // Reset plant override on login
    if (data.user.plant_id) {
      setActivePlant(data.user.plant_id)
    }
  }

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
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
