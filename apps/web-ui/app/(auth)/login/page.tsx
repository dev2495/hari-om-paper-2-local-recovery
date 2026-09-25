"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { PasswordInput } from "@/components/auth/password-input"
import { useAuth } from "@/context/AuthContext"
import { landingPathForRole, resolveLandingRole } from "@/lib/workspace"

function landingPathFor(user: { role?: string | null; roles?: string[] }, fallback: string) {
  const landingRole = resolveLandingRole([user.role, ...(user.roles || [])].filter(Boolean) as string[])
  return landingPathForRole(landingRole) || fallback
}

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null
  return value
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const explicitNextPath = safeNextPath(searchParams?.get("next") || null)
  const sessionReason = searchParams?.get("reason")
  const nextPath = explicitNextPath || "/dashboard"
  const { login, user, isLoading } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(explicitNextPath || landingPathFor(user, nextPath))
    }
  }, [explicitNextPath, isLoading, nextPath, router, user])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const loggedInUser = await login(email.trim().toLowerCase(), password)
      router.replace(explicitNextPath || landingPathFor(loggedInUser, nextPath))
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
          Checking secure session...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-8 sm:px-8 sm:py-16">
        <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="order-2 flex flex-col justify-center px-2 py-8 lg:order-none lg:pr-12">
            <div className="inline-flex items-center text-sm font-semibold text-primary">
              Hari Om Paper
            </div>
            <h1 className="mt-6 max-w-xl text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
              Every order. Every stage. One clear workspace.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Sales, planning, production, reconciliation, and dispatch in one workspace.
            </p>
            <div className="mt-8 grid gap-4">
              {[
                ["Plan with clarity", "Customer demand, materials and machine schedules."],
                ["Keep quality in view", "Inspections, measurements and stock disposition."],
                ["Follow the handoff", "Production, packing and customer dispatch."],
              ].map(([label, value]) => (
                <div key={label} className="border-l-2 border-primary/30 pl-4 py-1">
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="order-1 self-center rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 lg:order-none">
            <div>
              <p className="text-sm font-semibold text-primary">Sign in</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Welcome to TubeOS</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Use the username and password assigned to your ERP account.
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              {sessionReason === "access_changed" && !error && !submitting ? <p role="status" className="rounded-xl bg-signal-amber-soft p-4 text-signal-amber-ink">Your session expired or your access was updated. Please sign in again.</p> : null}
              {sessionReason === "inactive" && !error && !submitting ? (
                <div className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft px-4 py-3 text-sm text-signal-amber-ink" role="status">
                  Your secure session ended after 15 minutes without activity. Sign in again to continue.
                </div>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-muted-foreground">Username</span>
                <input
                  data-testid="login-email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  spellCheck={false}
                  className="h-12 w-full rounded-lg border border-border bg-background px-4 text-base text-foreground outline-none transition focus:border-teal-600 focus:bg-card"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="text"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-muted-foreground">Password</span>
                <PasswordInput
                  data-testid="login-password"
                  autoComplete="current-password"
                  className="h-12 w-full rounded-lg border border-border bg-background px-4 text-base text-foreground outline-none transition focus:border-teal-600 focus:bg-card"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                />
              </label>

              {error ? (
                <div role="alert" className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft px-4 py-3 text-sm text-signal-rose-ink">{error}</div>
              ) : null}

              <button
                data-testid="login-submit"
                className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={submitting || isLoading}
              >
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
    <Suspense
      fallback={
        <main className="min-h-screen bg-background p-6 text-foreground">
          <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
            Loading login...
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
