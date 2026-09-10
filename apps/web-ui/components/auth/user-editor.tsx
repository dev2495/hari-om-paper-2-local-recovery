"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext"
import { authApi } from "@/lib/api"
import { PasswordInput } from "./password-input"

const inputClass = "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-slate-950"
export function UserEditor({ userId }: { userId?: string }) {
  const { user, checkAuth } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const canManage = [user?.role, ...(user?.roles || [])].some(r => r === "Owner" || r === "Admin")
  const [roles, setRoles] = useState<string[]>([])
  const [plants, setPlants] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState({ name: "", email: "", password: "", role_names: [] as string[], plant_id: "", allowed_plant_ids: [] as string[], is_owner_all_plants: false, is_active: true })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    Promise.all([authApi.getRoles(), authApi.getPlants(), userId ? authApi.user(userId) : Promise.resolve(null)])
      .then(([roleResult, plantResult, record]) => {
        if (cancelled) return
        const available = plantResult.data.filter((p: any) => p.is_active !== false && p.code !== "ALL")
        setRoles(roleResult.data.map((r: any) => r.name))
        setPlants(available)
        if (record) {
          const u = record.data
          setForm({ name: u.name.trim(), email: u.email, password: "", role_names: u.roles, plant_id: u.plant_id, allowed_plant_ids: u.allowed_plant_ids || [u.plant_id], is_owner_all_plants: u.is_owner_all_plants, is_active: u.is_active })
        } else setForm(f => ({ ...f, plant_id: available[0]?.id || "", allowed_plant_ids: available[0] ? [available[0].id] : [] }))
      }).catch(() => { if (!cancelled) setError("Could not load user access settings. Reload to retry.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [canManage, userId])
  const privileged = form.role_names.some(r => r === "Owner" || r === "Admin")
  function toggleRole(role: string) {
    setSaved(false)
    setForm(f => {
      const selected = f.role_names.includes(role) ? f.role_names.filter(r => r !== role) : [...f.role_names, role]
      return { ...f, role_names: selected, is_owner_all_plants: selected.some(r => r === "Owner" || r === "Admin") && f.is_owner_all_plants }
    })
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSaved(false)
    const { password, is_active, ...fields } = form
    const payload = { ...fields, name: form.name.trim(), email: form.email.trim().toLowerCase(), ...(password ? { password } : {}), ...(userId ? { is_active } : {}) }
    try {
      if (userId) await authApi.updateUser(userId, payload)
      else await authApi.createUser(payload)
      await queryClient.invalidateQueries({ queryKey: ["users"] })
      setForm(f => ({ ...f, password: "" })); setSaved(true)
      if (userId === user?.id) await checkAuth()
      if (!userId) router.push("/system/users")
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(". ") : "Changes could not be saved. Please retry.")
    } finally { setSaving(false) }
  }
  if (!canManage) return <p role="alert" className="p-8">Only Owner and Admin can manage users and access.</p>
  return <main className="mx-auto max-w-4xl space-y-6 p-4">
    <Link href="/system/users" className="text-teal-800 underline">← Back to users</Link>
    <header><h1 className="text-3xl font-semibold">{userId ? "Edit user and access" : "Create user"}</h1><p className="mt-2 text-slate-600">Owner and Admin control roles, plant access, activation, and password resets. Access changes sign the affected user out.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">{error}</p>}
    {saved && <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-900">Saved. The user should sign in again to use their current access.</p>}
    {loading ? <p>Loading access settings…</p> : <form onSubmit={save} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 md:grid-cols-2">
        <label>Full name<input className={inputClass} required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>{userId ? "Username / email" : "Email / login username"}<input className={inputClass} type={userId ? "text" : "email"} required autoCapitalize="none" spellCheck={false} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
      </div>
      <label className="block">{userId ? "Reset password (leave empty to keep current password)" : "Password"}<PasswordInput className={inputClass} autoComplete="new-password" required={!userId} minLength={12} maxLength={72} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /><span className="mt-2 block text-sm text-slate-500">At least 12 characters, with uppercase, lowercase, a number, and a symbol.</span></label>
      <fieldset><legend className="font-semibold">Assigned roles</legend><p className="my-2 text-sm text-slate-600">Owner and Admin include user administration. Selecting another role never silently grants either of these roles.</p><div className="grid gap-3 sm:grid-cols-3">{roles.map(role => <label key={role} className="flex items-center gap-3 rounded-xl border p-3"><input type="checkbox" checked={form.role_names.includes(role)} onChange={() => toggleRole(role)} />{role}</label>)}</div></fieldset>
      {privileged && <label className="flex items-center gap-3 rounded-xl bg-amber-50 p-4"><input type="checkbox" checked={form.is_owner_all_plants} onChange={e => setForm({ ...form, is_owner_all_plants: e.target.checked })} />Allow all plants</label>}
      <label className="block">Primary plant<select className={inputClass} required value={form.plant_id} onChange={e => setForm({ ...form, plant_id: e.target.value, allowed_plant_ids: Array.from(new Set([...form.allowed_plant_ids, e.target.value])) })}><option value="">Select a plant</option>{plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {!form.is_owner_all_plants && <fieldset><legend className="font-semibold">Allowed plants</legend><div className="mt-2 flex flex-wrap gap-4">{plants.map(p => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={form.allowed_plant_ids.includes(p.id)} disabled={p.id === form.plant_id} onChange={e => setForm({ ...form, allowed_plant_ids: e.target.checked ? [...form.allowed_plant_ids, p.id] : form.allowed_plant_ids.filter(id => id !== p.id) })} />{p.name}</label>)}</div></fieldset>}
      {userId && <label className="flex items-center gap-3"><input type="checkbox" checked={form.is_active} disabled={userId === user?.id} onChange={e => setForm({ ...form, is_active: e.target.checked })} />Account active <span className="text-sm text-slate-500">Inactive accounts retain their history and cannot sign in.</span></label>}
      <button type="submit" disabled={saving || !form.role_names.length || !plants.length} className="rounded-xl bg-slate-950 px-6 py-3 font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : userId ? "Save changes" : "Create user"}</button>
    </form>}
  </main>
}
