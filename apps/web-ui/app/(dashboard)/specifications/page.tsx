"use client"

import Link from "next/link"
import { useDeferredValue, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { PageHeader } from "@/components/workspace/page-header"
import { SeasonRecipeManager } from "@/components/specs/SeasonRecipeManager"
import { useAuth } from "@/context/AuthContext"
import { useCustomers } from "@/hooks/use-master-data"
import { api } from "@/lib/api"
import { command, errorText, seasonApi, seasonLabel, Season } from "@/lib/season-api"

const fieldClass="h-10 rounded-lg border border-border bg-background px-3 text-sm"
const measurement=(a:any,b:any)=>a==null && b==null?"—":a===b?String(a):`${a??"—"}–${b??"—"}`
export default function SpecificationsIndexPage() {
  const { user }=useAuth()
  const canEdit=[user?.role,...(user?.roles || [])].some(r=>r==="Owner" || r==="Admin")
  const cache=useQueryClient()
  const [search,setSearch]=useState("")
  const term=useDeferredValue(search)
  const [status,setStatus]=useState("all")
  const [view,setView]=useState("active")
  const [season,setSeason]=useState<Season>("ROY")
  const [readiness,setReadiness]=useState("all")
  const [customer,setCustomer]=useState("")
  const [page,setPage]=useState(0)
  const [selected,setSelected]=useState<any[]>([])
  const [drawer,setDrawer]=useState<any>(null)
  const [error,setError]=useState("")
  const customers=useCustomers()
  const query=useQuery({queryKey:["spec-summary",term,status,view,season,readiness,customer,page],queryFn:async()=>(await seasonApi.summary({search:term,status,view,season,readiness,customer_id:customer || undefined,offset:page*25,limit:25})).data})
  const bulk=useMutation({mutationFn:()=>api.post("/api/spec/season/confirm-monsoon",command({specifications:selected.map(s=>({id:s.id,expected_version:s.write_revision})),note:"Monsoon selections reviewed in specification register"})),onError:e=>setError(errorText(e)),onSuccess:()=>{setSelected([]);setError("");cache.invalidateQueries({queryKey:["spec-summary"]})}})
  const filter=(run:()=>void)=>{run();setPage(0);setSelected([])}
  const facets=query.data?.facets || {}
  return <div className="space-y-5">
    <PageHeader title="Specifications" description="Independent seasonal recipes, approvals and release readiness." actions={canEdit?<Button asChild><Link href="/specifications/new">Create specification</Link></Button>:undefined} />
    <div className="flex flex-wrap gap-2">{["all","draft","review","trial","approved","obsolete"].map(s=><Button variant={status===s?"default":"outline"} key={s} onClick={()=>filter(()=>setStatus(s))}>{s==="all"?"All statuses":s.charAt(0).toUpperCase()+s.slice(1)} <span className="ml-2 opacity-70">{s==="all"?Object.values(facets).reduce((a:number,b:any)=>a+Number(b),0):facets[s] || 0}</span></Button>)}</div>
    <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap gap-3"><Input aria-label="Search specifications" className="min-w-56 flex-1" placeholder="Search customer, size ID or specification ID" value={search} onChange={e=>filter(()=>setSearch(e.target.value))} /><select aria-label="Customer filter" className={fieldClass} value={customer} onChange={e=>filter(()=>setCustomer(e.target.value))}><option value="">All customers</option>{(customers.data || []).map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Recipe season filter" className={fieldClass} value={season} onChange={e=>filter(()=>setSeason(e.target.value as Season))}><option value="ROY">Rest of year</option><option value="MONSOON">Monsoon</option></select><select aria-label="Release readiness filter" className={fieldClass} value={readiness} onChange={e=>filter(()=>setReadiness(e.target.value))}><option value="all">All readiness</option><option value="ready">Ready to release</option><option value="blocked">Needs attention</option></select><select aria-label="Version filter" className={fieldClass} value={view} onChange={e=>filter(()=>setView(e.target.value))}><option value="active">Active versions</option><option value="disabled">Disabled versions</option></select></div><p className="mt-2 text-xs text-muted-foreground">Readiness is for {seasonLabel(season)}. Released job cards keep their frozen recipe and tolerances.</p></section>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {selected.length>0 && <div className="flex items-center gap-3 rounded-lg border border-border bg-muted p-3"><p className="text-sm">{selected.length} selected</p><Button disabled={bulk.isPending} onClick={()=>bulk.mutate()}>Confirm reviewed Monsoon selections</Button><Button variant="ghost" onClick={()=>setSelected([])}>Clear selection</Button></div>}
    {query.isLoading?<div role="status" className="rounded-xl border border-border bg-card p-10 text-center">Loading specifications…</div>:query.isError?<div className="rounded-xl border border-destructive p-8"><p>{errorText(query.error)}</p><Button onClick={()=>query.refetch()}>Retry</Button></div>:<section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex justify-between border-b border-border px-4 py-3 text-sm"><span>{query.data.total} specifications</span><span className="text-muted-foreground">Showing {query.data.total? page*25+1:0}–{Math.min((page+1)*25,query.data.total)}</span></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["","Customer / revision","ID · OD · height (mm)","Weight · C.S","Rest of year","Monsoon","Status / actions"].map((h,i)=><th key={i} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{query.data.items.map((s:any)=><tr key={s.id} className="border-t border-border hover:bg-muted/40"><td className="px-4">{canEdit && s.seasonal_model && <input aria-label={`Select ${s.customer_name} revision ${s.version}`} type="checkbox" checked={selected.some(v=>v.id===s.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,s]:current.filter(v=>v.id!==s.id))} />}</td><td className="px-4 py-4"><Link className="font-semibold hover:underline" href={`/specifications/${s.id}`}>{s.customer_name}</Link><p className="text-xs text-muted-foreground">Spec v{s.version} · {s.id.slice(0,8)}</p></td><td className="px-4 font-mono text-xs">{measurement(s.id_min_mm,s.id_max_mm)} · {measurement(s.od_min_mm,s.od_max_mm)} · {measurement(s.length_min_mm,s.length_max_mm)}</td><td className="px-4">{s.target_tube_weight} g<p className="text-xs text-muted-foreground">{s.required_cs} N</p></td>{(["ROY","MONSOON"] as Season[]).map(name=><td className="px-4" key={name}><span className={`inline-block rounded-md px-2 py-1 text-xs ${s.seasons[name]?.ready?"bg-signal-emerald-soft text-signal-emerald-ink":"bg-signal-amber-soft text-signal-amber-ink"}`}>{s.seasons[name]?.ready?"Ready":"Needs attention"}</span><p className="mt-1 text-xs text-muted-foreground">r{s.seasons[name]?.recipe_revision || "—"} · {s.seasons[name]?.recipe_approved?"Approved":s.seasons[name]?.confirmed?"Confirmed":"Draft"}{s.seasons[name]?.draft_pending?" · Revision open":""}</p></td>)}<td className="px-4"><span className="text-xs font-semibold uppercase">{s.status}</span><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={()=>setDrawer(s)}>Readiness</Button><Button size="sm" variant="ghost" asChild><Link href={`/specifications/${s.id}/print`}>Print</Link></Button></div></td></tr>)}</tbody></table></div>{query.data.total===0 && <div className="p-12 text-center"><p className="font-medium">No specifications match these filters</p><p className="mt-2 text-sm text-muted-foreground">Clear a filter or create the first specification with both seasonal recipes.</p></div>}<div className="flex justify-between border-t border-border p-4"><Button variant="outline" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Previous</Button><Button variant="outline" disabled={(page+1)*25>=query.data.total} onClick={()=>setPage(v=>v+1)}>Next</Button></div></section>}
    <Dialog open={!!drawer} onOpenChange={open=>!open && setDrawer(null)}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogTitle>{drawer?.customer_name} · specification v{drawer?.version}</DialogTitle><DialogDescription>Review both recipes and the blockers that affect future releases.</DialogDescription>{drawer && <><div className="grid gap-3 sm:grid-cols-2">{(["ROY","MONSOON"] as Season[]).map(s=><div key={s} className="rounded-lg border border-border p-3"><h3 className="font-semibold">{seasonLabel(s)}</h3>{drawer.seasons[s]?.blockers?.length?drawer.seasons[s].blockers.map((b:string)=><p key={b} className="mt-1 text-sm text-amber-700">{b}</p>):<p className="text-sm text-emerald-700">Ready for release</p>}</div>)}</div>{drawer.seasonal_model && <SeasonRecipeManager specId={drawer.id} plantId={drawer.plant_id} />}<Button asChild><Link href={`/specifications/${drawer.id}`}>Open full specification</Link></Button></>}</DialogContent></Dialog>
  </div>
}
