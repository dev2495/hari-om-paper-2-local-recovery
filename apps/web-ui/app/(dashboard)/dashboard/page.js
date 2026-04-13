"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login")
          return
        }
        setUser(await response.json())
        setLoading(false)
      })
      .catch(() => {
        router.replace("/login")
      })
  }, [router])

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    router.replace("/login")
  }

  if (loading) {
    return <main className="page-shell"><div className="panel card">Loading workspace...</div></main>
  }

  return (
    <main className="page-shell">
      <div className="panel dashboard">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow">Workspace</div>
            <h1 style={{ marginTop: 12, fontSize: 36, lineHeight: 1.1 }}>Runtime restored</h1>
            <p className="copy">
              This workspace copy had filesystem corruption. The boot-critical app and services are rebuilt so you can start and verify the system again.
            </p>
          </div>
          <button className="button secondary" onClick={logout} type="button">Logout</button>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <div className="label">User</div>
            <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{user?.name || user?.email}</div>
          </div>
          <div className="dashboard-card">
            <div className="label">Email</div>
            <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{user?.email}</div>
          </div>
          <div className="dashboard-card">
            <div className="label">Active role</div>
            <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{user?.active_role || "Owner"}</div>
          </div>
        </div>
      </div>
    </main>
  )
}
