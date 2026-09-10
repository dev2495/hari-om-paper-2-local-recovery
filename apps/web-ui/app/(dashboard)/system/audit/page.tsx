"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"

export default function AuditPage() {
  const { user, activePlant } = useAuth()
  const canAccess = [user?.role, ...(user?.roles || [])].some(r => r === "Owner" || r === "Admin")
  const [hours, setHours] = useState(168)
  const [offset, setOffset] = useState(0)
  const [eventType, setEventType] = useState("")
  const [live, setLive] = useState(false)
  const events = useQuery({ queryKey: ["audit-events", hours, offset, eventType, activePlant], enabled: canAccess,
    queryFn: async () => (await api.get("/api/auth/audit-events", { params: { since_hours: hours, limit: 100, offset, ...(eventType ? { event_type: eventType } : {}), ...(activePlant && activePlant !== "ALL" ? { plant_id: activePlant } : {}) } })).data,
    refetchInterval: live ? 30000 : false })
  if (!canAccess) return <p role="alert" className="p-8">Only Owner and Admin can view the system audit workspace.</p>
  return <main className="space-y-6">
    <header className="rounded-2xl bg-slate-950 p-7 text-white"><p className="text-sm uppercase tracking-widest text-teal-200">Governance</p><h1 className="mt-2 text-3xl font-semibold">System audit history</h1><p className="mt-3 max-w-3xl text-slate-300">Recorded events from the central audit log. Each row shows the actor, time, source, and saved event details. Historical activity that was never recorded cannot be reconstructed here.</p></header>
    <section className="flex flex-wrap items-end gap-4 rounded-2xl border bg-white p-5">
      <label>Period<select className="ml-3 rounded-lg border p-2" value={hours} onChange={e => { setHours(Number(e.target.value)); setOffset(0) }}><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label>
      <label>Event type<input className="ml-3 rounded-lg border p-2" placeholder="All event types" value={eventType} onChange={e => { setEventType(e.target.value); setOffset(0) }} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />Refresh every 30 seconds</label>
      <button className="rounded-lg bg-slate-900 px-4 py-2 text-white" onClick={() => events.refetch()} disabled={events.isFetching}>{events.isFetching ? "Refreshing…" : "Refresh"}</button>
    </section>
    <p className="text-sm text-slate-600">{events.data?.total_count ?? "—"} recorded events in this period · Last fetched: {events.dataUpdatedAt ? new Date(events.dataUpdatedAt).toLocaleString() : "Not yet fetched"}</p>
    {events.isError && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900">The audit log could not be loaded. Refresh to retry. Previously displayed rows may be stale.</p>}
    {events.isLoading && <p>Loading audit records…</p>}
    {!events.isLoading && events.isSuccess && !events.data?.items?.length && <p className="rounded-2xl border border-dashed p-8 text-slate-600">No recorded events match these filters.</p>}
    <div className="space-y-3">{(events.data?.items || []).map((event: any) => <details key={event.id} className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer"><span className="font-semibold">{event.summary || event.event_type}</span><span className="mt-2 block text-sm text-slate-600">{new Date(event.occurred_at + (/Z$|[+-]\d\d:\d\d$/.test(event.occurred_at) ? "" : "Z")).toLocaleString()} · {event.actor_email || "System"} · {event.actor_role || "—"} · {event.source_service || "Unknown source"}</span></summary>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Event</dt><dd>{event.event_type}</dd></div><div><dt className="text-slate-500">Entity</dt><dd>{event.entity_type} {event.entity_id}</dd></div><div><dt className="text-slate-500">Record ID</dt><dd>{event.id}</dd></div><div><dt className="text-slate-500">Plant</dt><dd>{event.plant_id || "Account / global"}</dd></div></dl>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
    </details>)}</div>
    <nav className="flex items-center gap-4" aria-label="Audit pages"><button className="rounded-lg border px-4 py-2 disabled:opacity-40" disabled={!offset} onClick={() => setOffset(Math.max(0, offset-100))}>Previous</button><span>Page {offset/100+1}</span><button className="rounded-lg border px-4 py-2 disabled:opacity-40" disabled={!events.data?.has_more} onClick={() => setOffset(offset+100)}>Next</button></nav>
  </main>
}
