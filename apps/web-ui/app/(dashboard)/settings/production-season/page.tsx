"use client"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CloudRain, Sun } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/workspace/page-header"
import { command, errorText, seasonApi, seasonLabel, type Season } from "@/lib/season-api"

export default function ProductionSeasonPage() {
  const { user } = useAuth()
  const owner = user?.role === "Owner" || user?.roles?.includes("Owner")
  const cache = useQueryClient()
  const [preview, setPreview] = useState<any>(null)
  const [note, setNote] = useState("")
  const [acknowledge,setAcknowledge]=useState(false)
  const [error, setError] = useState("")
  const state = useQuery({ queryKey: ["production-season"], queryFn: async () => (await seasonApi.state()).data })
  const history = useQuery({ queryKey: ["production-season-history"], queryFn: async () => (await seasonApi.history()).data, enabled: Boolean(owner) })
  const action = useMutation({ mutationFn: async (run: () => Promise<any>) => run(), onError: e => setError(errorText(e)), onSuccess: () => setError("") })
  return <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6"><PageHeader title="Production season" description="The active recipe and QC standard for new releases in both plants." />
    {state.isLoading ? <p>Loading production season…</p> : state.isError ? <Button onClick={() => state.refetch()}>Retry</Button> : <section className="rounded-2xl border border-border bg-card p-6"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active across both plants</p><h2 className="mt-2 text-3xl font-semibold">{seasonLabel(state.data?.active_season)}</h2><p className="mt-2 text-sm text-muted-foreground">Released job cards keep their recorded season and tolerances.</p><div className="mt-6 flex flex-wrap gap-3">{(["ROY", "MONSOON"] as Season[]).map(s => <Button key={s} variant={state.data?.active_season === s ? "default" : "outline"} disabled={!owner || action.isPending || state.data?.active_season === s} onClick={() => action.mutate(async () => { const r = await seasonApi.previewSwitch(s); setPreview(r.data); setAcknowledge(false); return r })}>{s === "ROY" ? <Sun className="mr-2 h-4 w-4" /> : <CloudRain className="mr-2 h-4 w-4" />}{seasonLabel(s)}</Button>)}</div>{!owner && <p className="mt-3 text-sm text-muted-foreground">The Owner changes the production season.</p>}</section>}
    {error && <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    {preview && <section className="space-y-4 rounded-xl border border-border bg-card p-5"><h2 className="text-xl font-semibold">Switch to {seasonLabel(preview.to)}</h2><p>{preview.ready} specifications ready · {preview.blocked_count} require attention</p><p className="text-sm text-muted-foreground">{preview.released_cards} released cards retain their frozen contracts. {preview.pending_authorizations} authorized releases retain their recorded season while synchronization completes. Unreleased demand will use the new seasonal recipe.</p>{preview.blocked.map((s: any) => <a key={s.spec_id} href={`/specifications/${s.spec_id}`} className="block rounded-lg bg-muted p-3 text-sm"><strong>{s.customer} · {s.plant_id}</strong><p>{s.blockers.join(" · ")}</p></a>)}<p className="text-sm text-muted-foreground">New releases using a blocked specification will be refused until its recipe and QC setup are ready.</p>{preview.blocked_count>0 && <label className="block text-sm"><input type="checkbox" checked={acknowledge} onChange={e=>setAcknowledge(e.target.checked)}/> I understand the listed specifications cannot release until their seasonal setup is ready.</label>}<Input value={note} onChange={e => setNote(e.target.value)} aria-label="Season switch reason" placeholder="Reason for switching season" /><div className="flex gap-2"><Button disabled={!note.trim() || action.isPending || preview.blocked_count>0 && !acknowledge} onClick={() => action.mutate(async () => { const r = await seasonApi.switch(command({ to: preview.to, expected_version: preview.epoch, preview_fingerprint: preview.fingerprint, acknowledge_blocked:acknowledge, note })); setPreview(null); setNote(""); await cache.invalidateQueries({ queryKey: ["production-season"] }); await cache.invalidateQueries({ queryKey: ["production-season-history"] }); await cache.invalidateQueries({queryKey:["procurement-material-demand"]}); await cache.invalidateQueries({queryKey:["specs-summary"]}); return r })}>Confirm global switch</Button><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button></div></section>}
    {owner && <section className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Season history</h2>{history.isLoading ? <p className="mt-3">Loading history…</p> : !history.data?.length ? <p className="mt-3 text-sm text-muted-foreground">No season changes yet.</p> : history.data.map((v: any, index: number) => <div key={index} className="mt-3 border-t border-border pt-3 text-sm"><p className="font-medium">{v.payload.active_season ? seasonLabel(v.payload.active_season) : "Initialized"} · {v.actor}</p><p className="text-muted-foreground">{v.note} · {new Date(v.created_at).toLocaleString("en-IN")}</p></div>)}</section>}
  </main>
}
