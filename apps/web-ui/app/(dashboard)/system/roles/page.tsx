"use client"

import Link from "next/link"
import { Fragment, useMemo, useState } from "react"
import { ArrowUpRight, Check, Eye, Plus, Users2 } from "lucide-react"

import { RoleGate } from "@/components/workspace/role-gate"
import { PageHeader } from "@/components/workspace/page-header"
import { useUsers } from "@/hooks/use-system"
import { MATRIX_SCREENS, ROLE_DEFINITIONS, accessFor } from "@/lib/role-matrix"
import { cn } from "@/lib/utils"

const GROUPS = ["Management", "Commercial", "Production", "Quality", "Stores"] as const

export default function RolesAndAccessPage() {
  const { data: users = [], isLoading, isError } = useUsers()
  const [focus, setFocus] = useState<string | null>(null)
  const holders = useMemo(() => {
    const map = new Map<string, any[]>()
    ;(Array.isArray(users) ? users : []).filter((user: any) => user?.is_active !== false).forEach((user: any) => {
      ;(Array.isArray(user?.roles) ? user.roles : []).forEach((role: string) => map.set(role, [...(map.get(role) || []), user]))
    })
    return map
  }, [users])
  const areas = Array.from(new Set(MATRIX_SCREENS.map((screen) => screen.area)))
  const columns = focus ? ROLE_DEFINITIONS.filter((role) => role.key === focus) : ROLE_DEFINITIONS

  return (
    <RoleGate allow={["Owner", "Admin"]}>
      <div className="space-y-5">
        <PageHeader
          title="Roles & access"
          description="What each role is for, where it lands after sign-in, and which screens it works in. Give a person more than one role to combine access (for example Store + Inward QC)."
          actions={<Link href="/system/users/new" className="erp-btn-primary"><Plus className="h-4 w-4" />Add user</Link>}
        />

        {GROUPS.map((group) => (
          <section key={group} className="space-y-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ROLE_DEFINITIONS.filter((role) => role.group === group).map((role) => {
                const people = holders.get(role.key) || []
                const active = focus === role.key
                return (
                  <article key={role.key} className={cn("erp-panel flex flex-col rounded-xl p-4 transition", active && "ring-2 ring-primary/40")}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-semibold text-foreground">{role.label}</h3>
                      {role.privileged ? <span className="rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-[11px] font-semibold text-signal-amber-ink">All access</span> : null}
                    </div>
                    <p className="mt-1 flex-1 text-[12.5px] leading-5 text-muted-foreground">{role.summary}</p>
                    <p className="mt-3 text-[12px] text-muted-foreground">Lands on <Link className="font-semibold text-primary hover:underline" href={role.landing}>{role.landingLabel} <ArrowUpRight className="inline h-3 w-3" /></Link></p>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-foreground">
                        <Users2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{isLoading ? "Loading…" : isError ? "Users unavailable" : people.length ? `${people.length} · ${people.slice(0, 3).map((person: any) => person.name).join(", ")}${people.length > 3 ? "…" : ""}` : "No one yet"}</span>
                      </span>
                      <button type="button" className="shrink-0 text-[12px] font-semibold text-primary hover:underline" onClick={() => setFocus(active ? null : role.key)}>{active ? "Show all roles" : "Show screens"}</button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        <section className="erp-panel overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Screen access matrix</h2>
              <p className="text-[12.5px] text-muted-foreground"><Check className="inline h-3.5 w-3.5 text-signal-emerald-ink" /> works in the screen · <Eye className="inline h-3.5 w-3.5 text-signal-cyan-ink" /> can view · blank = not shown. Services enforce the same rules.</p>
            </div>
            {focus ? <button type="button" className="erp-btn-secondary !h-8" onClick={() => setFocus(null)}>Show all roles</button> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="tube-grid">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[230px] bg-card">Screen</th>
                  {columns.map((role) => <th key={role.key} className="text-center whitespace-nowrap">{role.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {areas.map((area) => (
                  <Fragment key={area}>
                    <tr><td colSpan={columns.length + 1} className="bg-muted text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{area}</td></tr>
                    {MATRIX_SCREENS.filter((screen) => screen.area === area).map((screen) => (
                      <tr key={screen.href}>
                        <td className="sticky left-0 z-10 bg-card"><Link href={screen.href} className="font-medium text-foreground hover:text-primary">{screen.screen}</Link></td>
                        {columns.map((role) => {
                          const level = accessFor(screen, role.key)
                          return (
                            <td key={role.key} className="text-center" aria-label={`${role.label}: ${level === "work" ? "works in" : level === "view" ? "can view" : "no access"}`}>
                              {level === "work" ? <Check className="mx-auto h-4 w-4 text-signal-emerald-ink" /> : level === "view" ? <Eye className="mx-auto h-4 w-4 text-signal-cyan-ink" /> : null}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="erp-panel rounded-xl p-4 text-[13px] leading-6 text-muted-foreground">
          <h2 className="text-[15px] font-semibold text-foreground">Giving someone extra access</h2>
          <p className="mt-1">Open the person in <Link href="/system/users" className="font-semibold text-primary hover:underline">Users</Link> and tick more roles — access adds up. Their highest role decides the page they land on, and they can switch role from the top bar. Owner and Admin always include every screen and all-plant access, so give them only to managers.</p>
        </section>
      </div>
    </RoleGate>
  )
}
