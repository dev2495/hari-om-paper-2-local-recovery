"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Factory, ShieldCheck, Sparkles } from "lucide-react"

import { useAuth } from "@/context/AuthContext"

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams?.get("next") || "/dashboard"
  const { user, isLoading, login } = useAuth()
  const [email, setEmail] = useState("admin@hariom.com")
  const [password, setPassword] = useState("admin123")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(nextPath)
    }
  }, [isLoading, nextPath, router, user])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      await login(email, password)
      router.replace(nextPath)
    } catch (err: any) {
      setError(err?.message || "Login failed")
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
    <main className="min-h-screen overflow-hidden bg-[#e9ece8] text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(8,145,178,0.22),transparent_30%),radial-gradient(circle_at_84%_12%,rgba(180,83,9,0.18),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.86),rgba(226,232,240,0.48))]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-5 py-10 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-900/10 bg-white/70 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-950 shadow-sm">
            <Factory className="h-4 w-4" />
            Hari Om Paper
          </div>
          <div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-slate-950 md:text-7xl">
              TubeOS manufacturing control room.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Multi-plant sales, specification sheets, planning, production, inventory, dispatch, and owner analytics in one local ERP runtime.
            </p>
          </div>
          <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
            {[
              ["Stack", "Direct runtime"],
              ["Session", "BFF cookie"],
              ["Plant", "PLANT_A ready"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-3xl border border-white/70 bg-white/75 p-4 shadow-xl shadow-slate-900/5 backdrop-blur">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/70 bg-white/86 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-900">Sign in</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Open ERP</h2>
            </div>
            <div className="rounded-2xl bg-cyan-950 p-3 text-white shadow-lg">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="username"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-950 outline-none transition focus:border-cyan-800"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-950 outline-none transition focus:border-cyan-800"
              />
            </label>
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            <button
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Signing in..." : "Enter control room"}
              {submitting ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 p-6 text-white">
          <div className="mx-auto mt-24 max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">Loading login...</div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
