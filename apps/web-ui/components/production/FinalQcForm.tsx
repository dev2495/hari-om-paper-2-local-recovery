"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { entryApiForPlant, errorText } from "@/lib/season-api"

const fields = [{code:"id",label:"I.D.",unit:"mm",lo:"id_min_mm",hi:"id_max_mm"},{code:"od",label:"O.D.",unit:"mm",lo:"od_min_mm",hi:"od_max_mm"},{code:"length",label:"Height / length",unit:"mm",lo:"length_min_mm",hi:"length_max_mm"},{code:"weight",label:"Weight",unit:"g",lo:"weight_min_g",hi:"weight_max_g"},{code:"cs",label:"C.S.",unit:"N",lo:"cs_min_n",hi:"cs_max_n"}]

export function FinalQcForm({card}:{card:any}) {
  const entryApi=entryApiForPlant(card.plant_id)
  const cache=useQueryClient()
  const [open,setOpen]=useState(false)
  const [samples,setSamples]=useState<any[]>([])
  const [reason,setReason]=useState("")
  const [error,setError]=useState("")
  const [instrument,setInstrument]=useState("")
  const [due,setDue]=useState("")
  const [evidence,setEvidence]=useState("")
  const template=useQuery({queryKey:["continuous-final-template",card.id],queryFn:async()=>(await entryApi.finalTemplate(card.id)).data,enabled:open})
  const save=useMutation({mutationFn:()=>entryApi.finalInspections({rows:samples.map(s=>({job_card_id:card.id,stage_type:"QC",sample_id:s.sample_id,readings:{...Object.fromEntries(fields.map(f=>[f.code,Number(s.readings[f.code])])),...(template.data?.requires_instrument?{instrument_id:instrument,calibration_due:due,calibration_status:"valid",instrument_evidence:evidence}:{})},reasons:reason?Object.fromEntries(fields.map(f=>[f.code,reason])):{},final_submission:true,expected_context_version:template.data?.quality_context_version,signed_profile_fingerprint:template.data?.signed_profile_context?.fingerprint}))}),onSuccess:async()=>{setOpen(false);setError("");await Promise.all([cache.invalidateQueries({queryKey:["continuous-flow",card.id]}),cache.invalidateQueries({queryKey:["quality-inspections"]}),cache.invalidateQueries({queryKey:["quality-workspace"]})])},onError:e=>setError(errorText(e))})
  const snapshot=card.spec_snapshot || {}
  if(!open)return <Button variant="outline" onClick={()=>{setSamples([1,2].map(()=>({sample_id:crypto.randomUUID(),readings:{}})));setOpen(true);setReason("");setError("")}}>Record final specification QC</Button>
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5"><div><h2 className="text-lg font-semibold">Final specification acceptance</h2><p className="text-sm text-muted-foreground">Record two distinct complete samples. Limits come from this released card. Any failed sample remains in the audit and may create a hold.</p></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{template.isError && <Button variant="outline" onClick={()=>template.refetch()}>Retry frozen QC context</Button>}{samples.map((s,i)=><div key={s.sample_id} className="rounded-lg border border-border p-3"><p className="mb-3 text-sm font-semibold">Final sample {i+1} · {s.sample_id.slice(0,8)}</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{fields.map(f=><label key={f.code} className="text-xs">{f.label} ({f.unit})<Input aria-label={`Final sample ${i+1} ${f.label}`} type="number" step="any" min="0" value={s.readings[f.code] || ""} onChange={e=>setSamples(current=>current.map((row,index)=>index===i?{...row,readings:{...row.readings,[f.code]:e.target.value}}:row))}/><span className="text-muted-foreground">{snapshot[f.lo] ?? (f.code==="cs"?snapshot.required_cs:"Record")} to {snapshot[f.hi] ?? "—"}</span></label>)}</div></div>)}{template.data?.requires_instrument && <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Instrument ID *<Input value={instrument} onChange={e=>setInstrument(e.target.value)}/></label><label className="text-sm">Calibration valid through *<Input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label className="text-sm">Calibration evidence *<Input value={evidence} onChange={e=>setEvidence(e.target.value)}/></label></div>}<Input aria-label="Final QC explanation" placeholder="Explanation / containment if a reading fails" value={reason} onChange={e=>setReason(e.target.value)}/><div className="flex gap-2"><Button disabled={save.isPending || !template.data || samples.some(s=>fields.some(f=>!s.readings[f.code] || !Number.isFinite(Number(s.readings[f.code])) || Number(s.readings[f.code])<=0))} onClick={()=>save.mutate()}>Submit final QC samples</Button><Button variant="ghost" onClick={()=>setOpen(false)}>Cancel</Button></div></section>
}
