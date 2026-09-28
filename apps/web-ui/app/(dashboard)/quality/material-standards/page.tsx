"use client"
import { useState } from "react"
import { RoleGate } from "@/components/workspace/role-gate"
import { QualityDeskNav } from "@/components/qc/QualityDeskNav"
import { ItemQualityProfileForm } from "@/components/qc/ItemQualityProfileForm"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems, useUpsertItemQualityProfile, useCopyItemQualityTemplate, useApproveItemQualityProfile } from "@/hooks/use-inventory"
import { Field, ProcurementShell, RequestErrors, WorkPanel, fieldClass } from "@/components/procurement/procurement-shell"
export default function MaterialStandards() {
  const { user } = useAuth()
  const [id,setId] = useState("")
  const items = useInventoryItems()
  const save = useUpsertItemQualityProfile(), copy = useCopyItemQualityTemplate(), approve = useApproveItemQualityProfile()
  const rows = (Array.isArray(items.data) ? items.data : []).filter((row:any) => row.type !== "FINISHED_GOOD")
  const item = rows.find((row:any) => row.id === id)
  const canApprove = (user?.roles || []).some((role:string) => ["Owner","Admin"].includes(role))
  return <RoleGate allow={["QC"]}><ProcurementShell eyebrow="Quality" title="Incoming material standards" description="Set checks and tolerance bands for each RM or PM. Approved revisions are frozen on receipt; later changes do not rewrite the lot's QC rules.">
    <QualityDeskNav /><RequestErrors errors={[items.error,save.error,copy.error,approve.error]} />
    <WorkPanel title="Material QC profile" description="QC prepares the parameters. Owner or Admin approves a revision before it governs new inward stock.">
      <Field label="Material"><select className={fieldClass} value={id} onChange={(event)=>setId(event.target.value)}><option value="">Select material</option>{rows.map((row:any)=><option key={row.id} value={row.id}>{row.item_code} · {row.name}</option>)}</select></Field>
      {item ? <div className="mt-4 space-y-4"><p className="text-sm text-muted-foreground">Revision {item.quality_profile?.revision || 0} · {item.quality_profile?.status || "Not configured"} · {item.uom}</p><ItemQualityProfileForm allowExemption={false} item={item} saving={save.isPending || copy.isPending || approve.isPending} onSave={async(profile)=>{await save.mutateAsync({id,data:{quality_profile:profile,setup_status:profile.setup_status || profile.status}})}} onCopyTemplate={async()=>{await copy.mutateAsync({id})}} onApprove={canApprove ? async()=>{await approve.mutateAsync({id,data:{expected_revision:Number(item.quality_profile?.revision || 1),exemption:false}})} : undefined} />
      <details><summary className="cursor-pointer text-sm font-semibold">Edit and approval history</summary><ol className="mt-3 space-y-3">{(item.quality_profile?.history || []).slice().reverse().map((entry:any,index:number)=><li key={index} className="rounded-lg border border-border p-3 text-sm"><p>{entry.action} · Revision {entry.revision} · {entry.actor}</p><p className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString("en-IN")}</p><details className="mt-2"><summary className="cursor-pointer">Saved tolerances</summary><ul className="mt-2 space-y-1">{entry.parameters.map((parameter:any)=><li key={parameter.code}>{parameter.label || parameter.code}: {parameter.min ?? "—"} to {parameter.max ?? "—"} {parameter.unit || ""}</li>)}</ul></details></li>)}</ol></details></div> : <p className="mt-4 text-sm text-muted-foreground">Select a material to review its controls.</p>}
    </WorkPanel>
  </ProcurementShell></RoleGate>
}
