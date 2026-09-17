"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"
import { PasswordInput } from "./password-input"

const inputClass = "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950"

const PRIVILEGED_ROLES = ["Owner", "Admin"]
const FRIENDLY_ROLE_LABELS: Record<string, string> = {
  Owner: "Owner",
  Admin: "Admin",
  PlantManager: "Plant Manager",
  Planner: "Planner",
  Store: "Store",
  Dispatch: "Dispatch",
  Sales: "Sales",
  Operator: "Operator",
}

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

  if (!canManage) return <p role="alert" className="p-8">Only Owner and Admin can manage users and access.</p>

  const submitDisabled = saving || !form.role_names.length || !plants.length

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4">
      <Link href="/system/users" className="text-teal-800 underline">
        ← Back to users
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">{userId ? "Edit user and access" : "Create user"}</h1>
        <p className="mt-2 text-slate-600">
          Owner and Admin control roles, plant access, activation, and password resets.{" "}
          {userId ? "Saving replaces this user's roles with the selection below. " : ""}Access changes sign the
          affected user out.
        </p>
      </header>
      {loadError && (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      )}
      {warning && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          {warning}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-900">
          Saved. The user should sign in again to use their current access.
        </p>
      )}
      {loading ? (
        <p>Loading access settings…</p>
      ) : (
        <form onSubmit={save} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-5 md:grid-cols-2">
            <label>
              Full name
              <input
                className={inputClass}
                required
                maxLength={160}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              {userId ? "Username / email" : "Email / login username"}
              <input
                className={inputClass}
                type={userId ? "text" : "email"}
                required
                autoCapitalize="none"
                spellCheck={false}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            {userId ? "Reset password (leave empty to keep current password)" : "Password"}
            <PasswordInput
              className={inputClass}
              autoComplete="new-password"
              required={!userId}
              minLength={12}
              maxLength={72}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <span className="mt-2 block text-sm text-slate-500">
              At least 12 characters, with uppercase, lowercase, a number, and a symbol.
            </span>
          </label>
          <fieldset>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-semibold">Assigned roles</legend>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={selectAllRoles}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearRoles}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
            <p className="my-2 text-sm text-slate-600">
              Assign one or more roles. Saving replaces the user&apos;s current roles. Owner and Admin include user
              administration and all-plant access — selecting another role never silently grants either of these.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {roles.map((role) => {
                const active = form.role_names.includes(role)
                const rolePrivileged = PRIVILEGED_ROLES.includes(role)
                return (
                  <label
                    key={role}
                    title={roleMeta[role]?.summary || undefined}
                    className={`flex items-start gap-3 rounded-xl border p-3 transition ${
                      active ? "border-teal-500 bg-teal-50/60" : "border-slate-200"
                    }`}
                  >
                    <input type="checkbox" className="mt-1" checked={active} onChange={() => toggleRole(role)} />
                    <span>
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        {roleLabel(role)}
                        {rolePrivileged && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                            Admin
                          </span>
                        )}
                      </span>
                      {roleMeta[role]?.summary && (
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{roleMeta[role].summary}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
            {!form.role_names.length && (
              <p className="mt-2 text-sm text-rose-700">Select at least one role before saving.</p>
            )}
            {form.role_names.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">
                  Effective access ({form.role_names.length} role{form.role_names.length > 1 ? "s" : ""})
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {privileged
                    ? "Includes user administration and all-plant access (Owner/Admin)."
                    : "Plant-scoped access. No user administration."}
                </p>
                {effectivePermissions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {effectivePermissions.map((permission) => (
                      <span
                        key={permission}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                      >
                        {permission}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </fieldset>
          {privileged && (
            <label className="flex items-center gap-3 rounded-xl bg-amber-50 p-4">
              <input
                type="checkbox"
                checked={form.is_owner_all_plants}
                onChange={(e) => setForm({ ...form, is_owner_all_plants: e.target.checked })}
              />
              Allow all plants
            </label>
          )}
          <label className="block">
            Primary plant
            <select
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
          </label>
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
              <span className="text-sm text-slate-500">
                Inactive accounts retain their history and cannot sign in.
              </span>
            </label>
          )}
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-xl bg-slate-950 px-6 py-3 font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : userId ? "Save changes" : "Create user"}
          </button>
        </form>
      )}
    </main>
  )
}
