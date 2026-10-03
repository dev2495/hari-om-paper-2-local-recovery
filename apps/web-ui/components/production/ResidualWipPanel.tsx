"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ResidualWipPanel({ rows, print=false, canResolve=false, busy=false, onResolve }: { rows:any[]; print?:boolean; canResolve?:boolean; busy?:boolean; onResolve?:(row:any,disposition:string,reason:string)=>void }) {
  const [selected,setSelected]=useState("")
  const [disposition,setDisposition]=useState("RETURN")
  const [reason,setReason]=useState("")
  if(!rows?.length)return null
  return <section className={print?"space-y-2":"space-y-3 rounded-xl border border-border bg-card p-5"}>
    <h2 className="font-semibold">Unused input and disposition</h2>
    {!print && <p className="text-sm text-muted-foreground">These quantities are reserved from their source entry. Record a return or scrap only after the physical movement is complete. Held input cannot be used by another entry.</p>}
    {rows.map(row=><div key={row.id} className="break-inside-avoid border-t border-border pt-3 text-sm">
      <p className="font-medium">{row.stage} · {row.quantity} {row.unit} · {row.disposition} · {row.status}</p>
      <p>{row.reason} · recorded by {row.created_by}{row.resolved_by?` · resolved by ${row.resolved_by}`:""}</p>
      {!print && canResolve && row.status==="HOLD" && <Button size="sm" variant="outline" onClick={()=>{setSelected(row.id);setReason("")}}>Record physical disposition</Button>}
      {!print && selected===row.id && <div className="mt-3 flex flex-wrap gap-2"><select aria-label="Physical disposition" className="h-10 rounded-lg border border-border bg-background px-3" value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="RETURN">Returned</option><option value="SCRAP">Scrapped</option></select><Input className="min-w-48 flex-1" aria-label="Disposition reason" placeholder="Movement reference and reason" value={reason} onChange={e=>setReason(e.target.value)}/><Button disabled={busy || !reason.trim()} onClick={()=>{onResolve?.(row,disposition,reason);setSelected("")}}>Save disposition</Button></div>}
    </div>)}
  </section>
}
