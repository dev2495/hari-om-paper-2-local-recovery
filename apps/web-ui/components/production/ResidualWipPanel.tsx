"use client"

import { useState } from "react"
import { ReasonPicker, useReasonChoice, type ReasonPayload } from "@/components/reasons"
import { Button } from "@/components/ui/button"

// Held leftover input: its physical return or scrap is recorded with a "Leftover input" code (Masters › Reason
// codes, owner decision 4, 1 Nov 2026); the note carries the movement reference.
export function ResidualWipPanel({ rows, print=false, canResolve=false, busy=false, plantId, onResolve }: { rows:any[]; print?:boolean; canResolve?:boolean; busy?:boolean; plantId?:string; onResolve?:(row:any,disposition:string,reason:ReasonPayload)=>void }) {
  const [selected,setSelected]=useState("")
  const [disposition,setDisposition]=useState("RETURN")
  const reason=useReasonChoice("LEFTOVER_INPUT",plantId,{enabled:Boolean(selected)})
  if(!rows?.length)return null
  return <section className={print?"space-y-2":"space-y-3 rounded-xl border border-border bg-card p-5"}>
    <h2 className="font-semibold">Unused input and disposition</h2>
    {!print && <p className="text-sm text-muted-foreground">These quantities are reserved from their source entry. Record a return or scrap only after the physical movement is complete. Held input cannot be used by another entry.</p>}
    {rows.map(row=><div key={row.id} className="break-inside-avoid border-t border-border pt-3 text-sm">
      <p className="font-medium">{row.stage} · {row.quantity} {row.unit} · {row.disposition} · {row.status}</p>
      <p>{row.reason || row.reason_label} · recorded by {row.created_by}{row.resolved_by?` · resolved by ${row.resolved_by}`:""}</p>
      {!print && canResolve && row.status==="HOLD" && <Button size="sm" variant="outline" onClick={()=>{setSelected(row.id);reason.reset()}}>Record physical disposition</Button>}
      {!print && selected===row.id && <div className="mt-3 flex flex-wrap gap-2"><select aria-label="Physical disposition" className="h-10 rounded-lg border border-border bg-background px-3" value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="RETURN">Returned</option><option value="SCRAP">Scrapped</option></select><ReasonPicker className="min-w-48 flex-1" category="LEFTOVER_INPUT" plantId={plantId} rows={reason.rows} value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact label="Why" notePlaceholder="Movement reference (optional)" testIdPrefix="residual-resolve"/><Button disabled={busy} onClick={()=>{if(!reason.validate())return;onResolve?.(row,disposition,reason.payload("reason") as ReasonPayload);setSelected("")}} data-testid="residual-resolve-save">Save disposition</Button></div>}
    </div>)}
  </section>
}
