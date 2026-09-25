"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { ArrowRight, CircleDot, LoaderCircle } from "lucide-react"

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

  const inputClass = "h-11 w-full rounded-lg border border-input bg-card px-3.5 text-[14px] text-foreground shadow-[var(--shadow-xs)] outline-none transition placeholder:text-muted-foreground/70 hover:border-foreground/20 focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15"
  return (
    <main className="login-shell relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="login-glow" aria-hidden="true" />
      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:px-10">
        <section className="order-2 hidden lg:order-none lg:block">
          <div className="flex items-center gap-2.5">
            <span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span>
            <span className="text-[15px] font-semibold tracking-tight">Hari Om <span className="text-primary">TubeOS</span></span>
          </div>
          <h1 className="mt-8 max-w-xl text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
            Every order. Every stage.<br />
            <span className="bg-gradient-to-r from-primary to-[hsl(var(--chart-2))] bg-clip-text text-transparent">One clear workspace.</span>
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-7 text-muted-foreground">Sales, planning, production, quality, stores and dispatch for paper tube manufacturing — with every handoff tracked.</p>
          <div className="login-flow mt-10" aria-hidden="true">
            {[
              ["Order", "PO in, lines released"],
              ["Plan", "Winder, oven, process"],
              ["Make", "Stage output & QC"],
              ["Ship", "Packed, challan, dispatched"],
            ].map(([label, detail], index) => (
              <div key={label} className="login-flow-step" style={{ animationDelay: `${200 + index * 140}ms` }}>
                <span className="login-flow-dot">{index + 1}</span>
                <span className="block text-[13px] font-semibold">{label}</span>
                <span className="block text-[12px] text-muted-foreground">{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="order-1 mx-auto w-full max-w-[420px] animate-enter-up lg:order-none">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="tube-mark"><CircleDot size={18} strokeWidth={1.75} /></span>
            <span className="text-[15px] font-semibold tracking-tight">Hari Om <span className="text-primary">TubeOS</span></span>
          </div>
          <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-[var(--shadow-pop)] backdrop-blur-xl sm:p-8">
            <h2 className="text-[22px] font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-1.5 text-[13.5px] leading-6 text-muted-foreground">Sign in with the username and password assigned to your ERP account.</p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              {sessionReason === "access_changed" && !error && !submitting ? <p role="status" className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3.5 py-2.5 text-[13px] text-signal-amber-ink">Your session expired or your access was updated. Please sign in again.</p> : null}
              {sessionReason === "inactive" && !error && !submitting ? (
                <div className="rounded-lg border border-signal-amber-line bg-signal-amber-soft px-3.5 py-2.5 text-[13px] text-signal-amber-ink" role="status">
                  Your secure session ended after 15 minutes without activity. Sign in again to continue.
                </div>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-foreground/80">Username</span>
                <input
                  data-testid="login-email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  spellCheck={false}
                  className={inputClass}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="text"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-foreground/80">Password</span>
                <PasswordInput
                  data-testid="login-password"
                  autoComplete="current-password"
                  className={inputClass}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                />
              </label>

              {error ? (
                <div role="alert" className="animate-fade-in rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3.5 py-2.5 text-[13px] text-signal-rose-ink">{error}</div>
              ) : null}

              <button
                data-testid="login-submit"
                className="relative inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-4 text-[14px] font-semibold text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/.15),var(--shadow-sm)] transition hover:bg-primary/90 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={submitting || isLoading}
              >
                {submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />Signing in…</> : <>Open ERP<ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          </div>
          <p className="mt-5 text-center text-[12px] text-muted-foreground">Sessions end after 15 minutes of inactivity. Access is scoped to your role and plants.</p>
        </section>
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
