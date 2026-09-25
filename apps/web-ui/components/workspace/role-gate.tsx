"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LoadingState } from "@/components/workspace/query-state"
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
    return <LoadingState label="Checking access…" />
  }

  const roles = new Set(
    [user?.role, activeRole, ...(user?.roles || [])].filter(Boolean) as string[],
  )

  const universalOk = !omitOwnerAdmin && (roles.has("Owner") || roles.has("Admin"))
  const allowed = universalOk || allow.some((r) => roles.has(r))

  if (allowed) return <>{children}</>

  return (
    <div className="max-w-2xl space-y-6 animate-enter-up" data-testid="role-gate-denied" role="alert">
      <section className="rounded-[2rem] border border-signal-amber-line bg-signal-amber-soft p-8 shadow-premium">
        <div className="inline-flex items-center gap-2 rounded-full border border-signal-amber-line bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-signal-amber-ink">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Restricted
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{fallbackTitle}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">{fallbackMessage}</p>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Required roles:{" "}
          <strong className="font-mono text-foreground">
            {(omitOwnerAdmin ? allow : ["Owner", "Admin", ...allow]).join(", ")}
          </strong>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
