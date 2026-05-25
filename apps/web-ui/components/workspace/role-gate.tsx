"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"

import { useAuth } from "@/context/AuthContext"

/**
 * Page-level role gate.
 *
 * Wrap a page with <RoleGate allow={["Owner", "Admin"]}>...</RoleGate>
 * and the page renders only if the user holds at least one matching role.
 *
 * Owner / Admin are universal — they always see the page unless explicitly
 * excluded via `omitOwnerAdmin`.
 *
 * NOTE: this is defense-in-depth; the backend still enforces RBAC at the
 * service layer. The gate is here so that a UI bookmark of a sensitive
 * report does not render its skeleton to an unauthorized user.
 */
export function RoleGate({
  allow,
  omitOwnerAdmin = false,
  children,
  fallbackTitle = "Restricted area",
  fallbackMessage = "Your role doesn't include this view. Talk to your administrator if you need access.",
}: {
  allow: string[]
  omitOwnerAdmin?: boolean
  children: React.ReactNode
  fallbackTitle?: string
  fallbackMessage?: string
}) {
  const { user, activeRole, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <div className="text-sm font-semibold text-slate-500">Checking access…</div>
      </div>
    )
  }

  const roles = new Set(
    [user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[],
  )

  const universalOk = !omitOwnerAdmin && (roles.has("Owner") || roles.has("Admin"))
  const allowed = universalOk || allow.some((r) => roles.has(r))

  if (allowed) return <>{children}</>

  return (
    <div className="max-w-2xl space-y-6 animate-enter-up">
      <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-8 shadow-premium">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          <ShieldAlert className="h-3.5 w-3.5" />
          Restricted
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{fallbackTitle}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">{fallbackMessage}</p>
        <p className="mt-3 text-[12.5px] text-slate-600">
          Required roles:{" "}
          <strong className="font-mono text-slate-800">
            {(omitOwnerAdmin ? allow : ["Owner", "Admin", ...allow]).join(", ")}
          </strong>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  )
}
