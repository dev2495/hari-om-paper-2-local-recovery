"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { useAuth } from "@/context/AuthContext"
import { landingPathForRole, resolveLandingRole } from "@/lib/workspace"

const defaultLoginEmail = process.env.NEXT_PUBLIC_DEFAULT_LOGIN_EMAIL || "devarsh"
const defaultLoginPassword = process.env.NEXT_PUBLIC_DEFAULT_LOGIN_PASSWORD || "devarsh123"

function landingPathFor(user: { role?: string | null; roles?: string[] }, fallback: string) {
  const landingRole = resolveLandingRole([user.role, ...(user.roles || [])].filter(Boolean) as string[])
  return landingPathForRole(landingRole) || fallback
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const explicitNextPath = searchParams?.get("next")
  const nextPath = explicitNextPath || "/dashboard"
  const { login, user, isLoading } = useAuth()
  const [email, setEmail] = useState(defaultLoginEmail)
  const [password, setPassword] = useState(defaultLoginPassword)
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
      const loggedInUser = await login(email.trim(), password)
      router.replace(explicitNextPath || landingPathFor(loggedInUser, nextPath))
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto mt-24 max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">
          Checking secure session...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,83,107,0.24),_transparent_38%),linear-gradient(180deg,_#edf4f7_0%,_#dce7eb_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-16">
        <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[32px] border border-white/50 bg-slate-950 px-8 py-10 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-teal-200/80">
              Hari Om Paper
            </div>
            <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              TubeOS control room for paper-tube manufacturing.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Sales, planning, production, reconciliation, and dispatch now run from one verified workspace. Sign in to test the live end-to-end flow.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ["Scope", "Owner/Admin ALL reads with plant-safe writes"],
                ["Planning", "Machine and shift driven execution"],
                ["Accounting", "Recipe theory plus month-end actuals"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-100">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200/80 bg-white/90 p-8 shadow-[0_20px_70px_rgba(15,23,42,0.12)] backdrop-blur">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">Sign in</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Access the live ERP</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use your existing account. The demo admin credentials are prefilled for validation runs.
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                <input
                  data-testid="login-email"
                  autoComplete="email"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-950 outline-none transition focus:border-teal-600 focus:bg-white"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                <input
                  data-testid="login-password"
                  autoComplete="current-password"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-950 outline-none transition focus:border-teal-600 focus:bg-white"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                />
              </label>

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              <button
                data-testid="login-submit"
                className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
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
        <main className="min-h-screen bg-slate-950 p-6 text-white">
          <div className="mx-auto mt-24 max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">
            Loading login...
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
