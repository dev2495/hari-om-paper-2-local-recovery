"use client"

import { InstrumentFields } from "./InstrumentFields"
import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { command, entryApiForPlant, errorText } from "@/lib/season-api"

const selectClass="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
const label=(s:string)=>s==="WINDER"?"Winding":s.charAt(0)+s.slice(1).toLowerCase()

export function WholeCardEntryForm({card,flow,onDone}:{card:any;flow:any;onDone:()=>void}) {
  const entryApi=entryApiForPlant(card.plant_id)
  const cache=useQueryClient()
  const employees=useQuery({queryKey:["continuous-employees",card.plant_id],queryFn:async()=>(await entryApi.employees()).data})
  const items=useQuery({queryKey:["continuous-items",card.plant_id],queryFn:async()=>(await entryApi.items()).data})
  const [businessDate,setDate]=useState(new Date().toLocaleDateString("en-CA"))
  const [shift,setShift]=useState("")
  const [operator,setOperator]=useState("")
  const [supervisor,setSupervisor]=useState("")
  const [reason,setReason]=useState("")
  const [fgItem,setFgItem]=useState("")
  const [error,setError]=useState("")
  const [rows,setRows]=useState<any[]>(()=>flow.stages.filter((s:any)=>s.status!=="COMPLETED" && !["SLITTING","DISPATCH"].includes(s.stage)).map((s:any)=>({...s,include:false,close:false,instrument:{},produced:"",accepted:"",input:"",loss:"",segment:s.segments?.filter((v:any)=>!["CANCELLED","COMPLETED"].includes(v.status))[0]?.id || "",samples:[1,2].map(()=>({sample_id:crypto.randomUUID(),readings:{}}))})))
  const pending=useRef<{fingerprint:string;body:any}|null>(null)
  const update=(index:number,key:string,value:any)=>setRows(current=>current.map((r,i)=>i===index?{...r,[key]:value}:r))
  const action=useMutation({mutationFn:(body:any)=>entryApi.batch(card.id,body),onError:e=>setError(errorText(e)),onSuccess:async()=>{await Promise.all([cache.invalidateQueries({queryKey:["continuous-flow",card.id]}),cache.invalidateQueries({queryKey:["continuous-entries",card.id]}),cache.invalidateQueries({queryKey:["planning-job-card",card.id]})]);onDone()}})
  const submit=()=>{
    const body={steps:rows.filter(r=>r.include).map(r=>({entry:{request_id:`whole-card-${r.stage}`,stage:r.stage,quantity_mode:"TOTAL",expected_version:r.row_version,submit:true,business_date:businessDate,shift_code:shift,operator_id:operator,segment_id:r.segment || null,produced:Number(r.produced),accepted:Number(r.accepted),input_quantity:Number(r.input),cutting_loss_pcs:Number(r.loss),samples:r.samples.filter((s:any)=>Object.values(s.readings).some(v=>v!=="" && v!=null)).map((s:any)=>({...s,readings:Object.fromEntries(Object.entries(s.readings).filter(([,v])=>v!=="" && v!=null))})),reason,details:{reject_reason:reason,overproduction_reason:reason,instrument:r.instrument}},close:r.close?{request_id:`whole-close-${r.stage}`,expected_version:r.row_version+1,supervisor_id:supervisor,short_close:Number(r.accepted)<r.target,residual_disposition:"HOLD",reason,fg_item_id:r.stage==="PACKING"?fgItem || null:null}:null}))}
    const fingerprint=JSON.stringify(body)
    if(!pending.current || pending.current.fingerprint!==fingerprint)pending.current={fingerprint,body:command(body)}
    action.mutate(pending.current.body)
  }
  const selected=rows.filter(r=>r.include)
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5"><div><h2 className="text-lg font-semibold">Enter whole card</h2><p className="text-sm text-muted-foreground">Enter cumulative totals for the stages you select. Only the difference is posted. Every selected entry and closure is saved together; a failed stage leaves the entire batch unsaved. Resolve any held Process carryover through individual entries first. Complete Slitting separately and record final customer acceptance in Final QC before closing QC.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm">Business date *<Input type="date" value={businessDate} onChange={e=>setDate(e.target.value)}/></label><label className="text-sm">Shift *<select className={selectClass} value={shift} onChange={e=>setShift(e.target.value)}><option value="">Choose shift</option><option value="SHIFT_A">Shift A</option><option value="SHIFT_B">Shift B</option></select></label><label className="text-sm">Operator name / ID *<select className={selectClass} value={operator} onChange={e=>setOperator(e.target.value)}><option value="">Choose operator</option>{(employees.data || []).filter((e:any)=>e.active && String(e.role).toLowerCase()==="operator").map((e:any)=><option key={e.id} value={e.id}>{e.name} · {e.employee_code}</option>)}</select></label><label className="text-sm">Supervisor for closures<select className={selectClass} value={supervisor} onChange={e=>setSupervisor(e.target.value)}><option value="">Choose supervisor</option>{(employees.data || []).filter((e:any)=>e.active && String(e.role).toLowerCase()==="supervisor").map((e:any)=><option key={e.id} value={e.id}>{e.name} · {e.employee_code}</option>)}</select></label></div>
    {rows.map((r,index)=><fieldset key={r.stage} className="space-y-3 rounded-lg border border-border p-4"><legend className="px-2 text-sm font-semibold"><label><input type="checkbox" checked={r.include} onChange={e=>update(index,"include",e.target.checked)}/> {label(r.stage)} · currently {r.accepted_total} / {r.target} {r.unit}</label></legend>{r.include && <><div className="grid gap-3 sm:grid-cols-4">{[["Produced total *","produced"],["Accepted total *","accepted"],[`Input total ${r.input_unit || ""}`,"input"],...(r.stage==="PROCESS"?[["Cutting loss total pcs","loss"]]:[])].map(([title,key])=><label key={key} className="text-sm">{title}<Input type="number" min="0" step="1" value={r[key]} onChange={e=>update(index,key,e.target.value)}/></label>)}<label className="text-sm">Scheduled segment<select className={selectClass} value={r.segment} onChange={e=>update(index,"segment",e.target.value)}><option value="">Choose segment</option>{(r.segments || []).filter((s:any)=>!["COMPLETED","CANCELLED"].includes(s.status)).map((s:any)=><option key={s.id} value={s.id}>{s.plan_date} · {s.shift_code?.replace("SHIFT_","Shift ")}</option>)}</select></label></div><p className="text-xs text-muted-foreground">Delta produced {Number(r.produced)-r.produced_total}, accepted {Number(r.accepted)-r.accepted_total}. Rejected total {Number(r.produced)-Number(r.accepted)}.</p>
      {(card.spec_snapshot?.qc_profile?.stages?.[r.stage]?.parameters || []).filter((p:any)=>p.applicable).length>0 && r.samples.map((s:any,si:number)=><div key={s.sample_id}><p className="mb-2 text-xs font-semibold">QC sample {si+1}</p><div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">{(card.spec_snapshot.qc_profile.stages[r.stage].parameters || []).filter((p:any)=>p.applicable).map((p:any)=><label key={p.code} className="text-xs">{p.label} ({p.unit})<Input type="number" step="any" value={s.readings[p.code] ?? ""} onChange={e=>update(index,"samples",r.samples.map((v:any,i:number)=>i===si?{...v,readings:{...v.readings,[p.code]:e.target.value}}:v))}/></label>)}</div></div>)}
      {(card.spec_snapshot?.qc_profile?.stages?.[r.stage]?.parameters || []).some((p:any)=>p.applicable && p.requires_instrument) && <InstrumentFields value={r.instrument} onChange={v=>update(index,"instrument",v)}/>}
      <label className="block text-sm"><input type="checkbox" checked={r.close} onChange={e=>update(index,"close",e.target.checked)}/> Close stage after this entry</label>{r.close && r.stage==="PACKING" && <label className="block text-sm">Finished-good item *<select className={selectClass} value={fgItem} onChange={e=>setFgItem(e.target.value)}><option value="">Choose finished good</option>{(items.data || []).filter((i:any)=>i.type==="FINISHED_GOOD").map((i:any)=><option key={i.id} value={i.id}>{i.item_code} · {i.name}</option>)}</select></label>}</>}</fieldset>)}
    <Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for rejects, short closure, unused input hold or material issue exception" aria-label="Whole-card entry reason"/>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2"><Button disabled={action.isPending || !selected.length || !operator || !shift || selected.some(r=>r.produced==="" || r.accepted==="" || r.close && (!supervisor || r.stage==="PACKING" && !fgItem))} onClick={submit}>{action.isPending?"Saving all stages…":"Save selected stages together"}</Button><Button variant="ghost" disabled={action.isPending} onClick={onDone}>Cancel</Button></div>
  </section>
}
