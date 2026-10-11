"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"
import { PasswordInput } from "./password-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { MATRIX_SCREENS, ROLE_BY_KEY, ROLE_DEFINITIONS, accessFor } from "@/lib/role-matrix"
import { resolveLandingRole } from "@/lib/workspace"

const inputClass = "mt-2 h-12 w-full rounded-xl border border-border bg-card px-4 text-foreground"

const PRIVILEGED_ROLES = ["Owner", "Admin"]
const FRIENDLY_ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_DEFINITIONS.map((role) => [role.key, role.label]))
const ROLE_GROUPS = ["Management", "Commercial", "Production", "Quality", "Stores"] as const

type RoleMeta = { label: string; summary: string; permissions: string[] }

function isPrivileged(roleNames: string[]) {
  return roleNames.some((role) => PRIVILEGED_ROLES.includes(role))
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function messageFromError(err: any, fallback: string) {
  const detail = err?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item: any) => (typeof item === "string" ? item : item?.msg || item?.detail || ""))
      .filter(Boolean)
      .join(". ")
    if (joined) return joined
  }
  if (detail && typeof detail === "object" && typeof detail.msg === "string") return detail.msg
  return fallback
}

export function UserEditor({ userId }: { userId?: string }) {
  const { user, checkAuth } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const canManage = [user?.role, ...(user?.roles || [])].some((r) => r === "Owner" || r === "Admin")
  const [roles, setRoles] = useState<string[]>([])
  const [roleMeta, setRoleMeta] = useState<Record<string, RoleMeta>>({})
  const [plants, setPlants] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role_names: [] as string[],
    plant_id: "",
    allowed_plant_ids: [] as string[],
    is_owner_all_plants: false,
    is_active: true,
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!canManage) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError("")
    Promise.all([
      authApi.getRoles(),
      authApi.getPlants(),
      authApi.getRoleMatrix().catch(() => null),
      userId ? authApi.user(userId) : Promise.resolve(null),
    ])
      .then(([roleResult, plantResult, matrixResult, record]) => {
        if (cancelled) return
        const availablePlants = asArray<any>(plantResult?.data).filter(
          (p) => p && p.is_active !== false && p.code !== "ALL",
        )
        const roleNames = asArray<any>(roleResult?.data)
          .map((r) => (r && typeof r.name === "string" ? r.name : null))
          .filter((name): name is string => Boolean(name))

        const meta: Record<string, RoleMeta> = {}
        const groups = asArray<any>(matrixResult?.data?.seeded_role_groups)
        for (const group of groups) {
          const key = group?.landing_role
          if (!key) continue
          meta[key] = {
            label: group?.landing_label || FRIENDLY_ROLE_LABELS[key] || key,
            summary: typeof group?.summary === "string" ? group.summary : "",
            permissions: asArray<string>(group?.permissions),
          }
        }
        const roleMatrix =
          matrixResult?.data?.role_matrix && typeof matrixResult.data.role_matrix === "object"
            ? matrixResult.data.role_matrix
            : {}
        for (const [name, info] of Object.entries<any>(roleMatrix)) {
          meta[name] = {
            label: meta[name]?.label || info?.label || FRIENDLY_ROLE_LABELS[name] || name,
            summary: (typeof info?.summary === "string" && info.summary) || meta[name]?.summary || "",
            permissions: asArray<string>(info?.permissions).length
              ? asArray<string>(info.permissions)
              : meta[name]?.permissions || [],
          }
        }

        setRoles(roleNames)
        setRoleMeta(meta)
        setPlants(availablePlants)

        if (record) {
          const u = (record as any).data || {}
          const recordAllowed = asArray<any>(u.allowed_plant_ids).map((id) => String(id)).filter(Boolean)
          const primaryPlant = u.plant_id ? String(u.plant_id) : ""
          setForm({
            name: (u.name ?? "").toString().trim(),
            email: (u.email ?? "").toString(),
            password: "",
            role_names: asArray<any>(u.roles).map((r) => String(r)).filter(Boolean),
            plant_id: primaryPlant,
            allowed_plant_ids: recordAllowed.length ? recordAllowed : primaryPlant ? [primaryPlant] : [],
            is_owner_all_plants: Boolean(u.is_owner_all_plants),
            is_active: u.is_active !== false,
          })
        } else {
          const first = availablePlants[0]?.id || ""
          setForm((f) => ({ ...f, plant_id: first, allowed_plant_ids: first ? [first] : [] }))
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load user access settings. Reload to retry.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManage, userId])

  const privileged = isPrivileged(form.role_names)

  const roleLabel = (role: string) => roleMeta[role]?.label || FRIENDLY_ROLE_LABELS[role] || role

  const landingRole = form.role_names.length ? resolveLandingRole(form.role_names) : null
  const landing = landingRole ? ROLE_BY_KEY[landingRole] : null
  const screens = useMemo(
    () => MATRIX_SCREENS.map((screen) => {
      const levels = form.role_names.map((role) => accessFor(screen, role))
      return { screen, level: levels.includes("work") ? "work" : levels.includes("view") ? "view" : null }
    }).filter((row) => row.level),
    [form.role_names],
  )

  const effectivePermissions = useMemo(() => {
    const union = new Set<string>()
    for (const role of form.role_names) {
      for (const permission of roleMeta[role]?.permissions || []) union.add(permission)
    }
    return Array.from(union).sort()
  }, [form.role_names, roleMeta])

  function toggleRole(role: string) {
    setSaved(false)
    setForm((f) => {
      const selected = f.role_names.includes(role)
        ? f.role_names.filter((r) => r !== role)
        : [...f.role_names, role]
      return {
        ...f,
        role_names: selected,
        // A non-privileged selection can never keep unrestricted plant access.
        is_owner_all_plants: isPrivileged(selected) && f.is_owner_all_plants,
      }
    })
  }

  function selectAllRoles() {
    setSaved(false)
    setForm((f) => ({ ...f, role_names: [...roles] }))
  }

  function clearRoles() {
    setSaved(false)
    setForm((f) => ({ ...f, role_names: [], is_owner_all_plants: false }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setWarning("")
    setSaved(false)
    const { password, is_active, ...fields } = form
    const payload = {
      ...fields,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      ...(password ? { password } : {}),
      ...(userId ? { is_active } : {}),
    }
    try {
      if (userId) await authApi.updateUser(userId, payload)
      else await authApi.createUser(payload)
      await queryClient.invalidateQueries({ queryKey: ["users"] })
      setForm((f) => ({ ...f, password: "" }))
      setSaved(true)
      if (userId === user?.id) await checkAuth()
      if (!userId) router.push("/system/users")
    } catch (err: any) {
      // A dropped connection leaves a create/edit in an unknown state. Never silently
      // retry a mutating create — that risks a duplicate identity. Keep the entered
      // values and steer the operator to verify before acting again.
      if (!err?.response) {
        setWarning(
          userId
            ? "The connection dropped before this save was confirmed. Reload this user to check whether the change was applied before saving again."
            : "The connection dropped before creation was confirmed. Open the users list to check whether this user already exists before creating again, so you do not add a duplicate.",
        )
        return
      }
      setError(messageFromError(err, "Changes could not be saved. Please retry."))
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <RoleGate allow={["Owner", "Admin"]}>
        <p role="alert">Only Owner and Admin can manage users and access.</p>
      </RoleGate>
    )
  }

  const submitDisabled = saving || !form.role_names.length || !plants.length

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="outline" className="rounded-xl">
        <Link href="/system/users">← Back to users</Link>
      </Button>
      <PageHeader
        eyebrow="System admin"
        title={userId ? "Edit user and access" : "Create user"}
        description={`Owner and Admin control roles, plant access, activation, and password resets. ${userId ? "Saving replaces this user's roles with the selection below. " : ""}Access changes sign the affected user out.`}
      />
      {loadError && (
        <ErrorState title="Could not load user access settings" message={loadError} />
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft p-4 text-signal-rose-ink">
          {error}
        </p>
      )}
      {warning && (
        <p role="alert" className="rounded-xl border border-signal-amber-line bg-signal-amber-soft p-4 text-signal-amber-ink">
          {warning}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-xl bg-signal-teal-soft p-4 text-signal-teal-ink">
          Saved. The user should sign in again to use their current access.
        </p>
      )}
      {loading ? (
        <LoadingState label="Loading access settings…" />
      ) : (
        <Card className="rounded-[1.6rem] border-border shadow-sm">
          <CardContent className="p-6">
        <form onSubmit={save} className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Label htmlFor="user-full-name">Full name</Label>
              <Input
                id="user-full-name"
                className={inputClass}
                required
                maxLength={160}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="user-email">{userId ? "Username / email" : "Email / login username"}</Label>
              <Input
                id="user-email"
                className={inputClass}
                type={userId ? "text" : "email"}
                required
                autoCapitalize="none"
                spellCheck={false}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="user-password">{userId ? "Reset password (leave empty to keep current password)" : "Password"}</Label>
            <PasswordInput
              id="user-password"
              className={inputClass}
              autoComplete="new-password"
              required={!userId}
              minLength={12}
              maxLength={72}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <span className="mt-2 block text-sm text-muted-foreground">
              At least 12 characters, with uppercase, lowercase, a number, and a symbol.
            </span>
          </div>
          <fieldset>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-semibold">Assigned roles</legend>
              <div className="flex items-center gap-2 text-sm">
                <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={selectAllRoles}>
                  Select all
                </Button>
                <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={clearRoles}>
                  Clear
                </Button>
              </div>
            </div>
            <p className="my-2 text-sm text-muted-foreground">
              Tick one or more roles — access adds up (for example Store + Inward QC). Saving replaces the user&apos;s current roles.
              Owner and Admin include user administration and all-plant access — selecting another role never grants either.{" "}
              <Link href="/system/roles" className="font-semibold text-primary hover:underline">See what each role can do</Link>
            </p>
            {ROLE_GROUPS.map((group) => {
              const groupRoles = roles.filter((role) => (ROLE_BY_KEY[role]?.group || "Production") === group)
              if (!groupRoles.length) return null
              return (
                <div key={group} className="mt-3">
                  <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {groupRoles.map((role) => {
                      const active = form.role_names.includes(role)
                      const rolePrivileged = PRIVILEGED_ROLES.includes(role)
                      return (
                        <label
                          key={role}
                          title={roleMeta[role]?.summary || undefined}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                            active ? "border-primary/50 bg-accent" : "border-border hover:border-foreground/20"
                          }`}
                        >
                          <input type="checkbox" className="mt-1" checked={active} onChange={() => toggleRole(role)} />
                          <span>
                            <span className="flex items-center gap-2 font-medium text-foreground">
                              {roleLabel(role)}
                              {rolePrivileged && (
                                <Badge variant="warning">All access</Badge>
                              )}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{ROLE_BY_KEY[role]?.summary || roleMeta[role]?.summary}</span>
                            {ROLE_BY_KEY[role] ? <span className="mt-1 block text-[11px] text-muted-foreground">Lands on: {ROLE_BY_KEY[role].landingLabel}</span> : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {!form.role_names.length && (
              <p className="mt-2 text-sm text-signal-rose-ink">Select at least one role before saving.</p>
            )}
            {form.role_names.length > 0 && (
              <div className="mt-3 rounded-xl border border-border bg-muted p-4">
                <p className="text-sm font-semibold text-foreground">
                  Effective access ({form.role_names.length} role{form.role_names.length > 1 ? "s" : ""})
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {privileged
                    ? "Includes user administration and all-plant access (Owner/Admin)."
                    : "Plant-scoped access. No user administration."}
                  {landing ? <> Lands on <strong className="text-foreground">{landing.landingLabel}</strong> after sign-in.</> : null}
                </p>
                {screens.length > 0 && (
                  <ul className="mt-2 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
                    {screens.map(({ screen, level }) => (
                      <li key={screen.href} className="flex items-center gap-2 text-foreground">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${level === "work" ? "bg-signal-emerald-ink" : "bg-signal-cyan-ink"}`} aria-hidden="true" />
                        {screen.screen}
                        <span className="text-[11px] text-muted-foreground">{level === "work" ? "works in" : "view"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {effectivePermissions.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Service permissions ({effectivePermissions.length})</summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {effectivePermissions.map((permission) => (
                        <Badge key={permission} variant="outline">
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </fieldset>
          {privileged && (
            <label className="flex items-center gap-3 rounded-xl bg-signal-amber-soft p-4">
              <input
                type="checkbox"
                checked={form.is_owner_all_plants}
                onChange={(e) => setForm({ ...form, is_owner_all_plants: e.target.checked })}
              />
              Allow all plants
            </label>
          )}
          <div>
            <Label htmlFor="user-primary-plant">Primary plant</Label>
            <select
              id="user-primary-plant"
              className={inputClass}
              required
              value={form.plant_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  plant_id: e.target.value,
                  allowed_plant_ids: Array.from(new Set([...form.allowed_plant_ids, e.target.value].filter(Boolean))),
                })
              }
            >
              <option value="">Select a plant</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {!form.is_owner_all_plants && (
            <fieldset>
              <legend className="font-semibold">Allowed plants</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {plants.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.allowed_plant_ids.includes(p.id)}
                      disabled={p.id === form.plant_id}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          allowed_plant_ids: e.target.checked
                            ? [...form.allowed_plant_ids, p.id]
                            : form.allowed_plant_ids.filter((id) => id !== p.id),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {userId && (
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.is_active}
                disabled={userId === user?.id}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Account active{" "}
              <span className="text-sm text-muted-foreground">
                Inactive accounts retain their history and cannot sign in.
              </span>
            </label>
          )}
          <Button
            type="submit"
            disabled={submitDisabled}
            className="h-12 rounded-xl bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Saving…" : userId ? "Save changes" : "Create user"}
          </Button>
        </form>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
