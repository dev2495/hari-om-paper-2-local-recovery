"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams?.get("next") || "/dashboard"
  const [email, setEmail] = useState("admin@hariom.com")
  const [password, setPassword] = useState("admin123")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!mounted) return
        if (response.ok) {
          router.replace(nextPath)
          return
        }
        setLoading(false)
      })
      .catch(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [nextPath, router])

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.detail || "Login failed")
      }
      router.replace(nextPath)
    } catch (err) {
      setError(err.message || "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <main className="page-shell"><div className="panel card">Checking session...</div></main>
  }

  return (
    <main className="page-shell">
      <div className="panel" style={{ padding: 24 }}>
        <div className="grid auth-grid">
          <section className="hero">
            <div className="eyebrow">Hari Om Paper</div>
            <h1 className="title">Recovered ERP runtime on the local SSD.</h1>
            <p className="copy">
              The previous startup failure came from unreadable source files on the mounted workspace. This login surface is restored first so the stack can boot and be verified again.
            </p>
            <div className="stats">
              <div className="stat">
                <div className="label">Mode</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>Direct runtime</div>
              </div>
              <div className="stat">
                <div className="label">Auth</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>Cookie session via BFF</div>
              </div>
              <div className="stat">
                <div className="label">Default user</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>admin@hariom.com</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="eyebrow">Sign in</div>
            <h2 style={{ marginTop: 12, fontSize: 34, lineHeight: 1.1 }}>Open the local control room</h2>
            <p className="copy">The default admin credentials are prefilled so you can verify the recovered stack immediately.</p>
            <form onSubmit={submit}>
              <label className="field">
                <span>Email</span>
                <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
              </label>
              <label className="field">
                <span>Password</span>
                <input className="input" value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
              </label>
              {error ? <div className="error">{error}</div> : null}
              <button className="button" disabled={submitting} type="submit">
                {submitting ? "Signing in..." : "Open ERP"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="panel card">Loading login...</div></main>}>
      <LoginPageContent />
    </Suspense>
  )
}
