"use client"

import Link from "next/link"
import { ArrowLeft, ShieldAlert } from "lucide-react"

import { LoadingState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { rolePlainLabel, rolesSentence } from "@/lib/role-matrix"

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
  fallbackTitle = "This page is not open to your role",
  fallbackMessage,
}: {
  allow: string[]
  omitOwnerAdmin?: boolean
  children: React.ReactNode
  fallbackTitle?: string
  fallbackMessage?: string
}) {
  const { user, activeRole, isLoading } = useAuth()

  if (isLoading) {
    return <LoadingState label="Checking access…" />
  }

  const roles = new Set(
    [user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[],
  )

  const universalOk = !omitOwnerAdmin && (roles.has("Owner") || roles.has("Admin"))
  const allowed = universalOk || allow.some((r) => roles.has(r))

  if (allowed) return <>{children}</>

  // Plain words, each role once (pages may list Owner/Admin themselves too).
  const who = rolesSentence(omitOwnerAdmin ? allow : ["Owner", "Admin", ...allow])
  const workingAs = activeRole || user?.role
  return (
    <div className="mx-auto w-full max-w-2xl animate-enter-up" data-testid="role-gate-denied" role="alert">
      <section className="rounded-2xl border border-signal-amber-line bg-signal-amber-soft p-5 shadow-[var(--shadow-premium)] sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-amber-line bg-card px-3 py-1 text-[12px] font-semibold text-signal-amber-ink">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Not open to you
        </span>
        <h1 className="mt-4 text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{fallbackTitle}</h1>
        <p className="mt-3 text-[14.5px] leading-6 text-foreground/80">
          {fallbackMessage || (who ? `This page is for ${who}. Ask the Owner for access if your work needs it.` : "Ask the Owner for access if your work needs it.")}
        </p>
        {fallbackMessage && who ? <p className="mt-2 text-[13px] leading-5 text-muted-foreground">It is open to {who}.</p> : null}
        {workingAs ? <p className="mt-2 text-[13px] leading-5 text-muted-foreground">You are working as {rolePlainLabel(workingAs)}.</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard" className="erp-btn-primary !h-11 px-4" data-testid="role-gate-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to my work
          </Link>
        </div>
      </section>
    </div>
  )
}
