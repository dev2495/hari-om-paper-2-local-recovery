"use client"
import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { purchaseApi } from "@/lib/api"
import { plural } from "@/lib/stock-format"
import { Field, RequestErrors, fieldClass, primaryButton, secondaryButton } from "./procurement-shell"
export function LabelPrintControls({ lots }: { lots: any[] }) {
  const [profile, setProfile] = useState("PAPER_LOT_A4")
  const [copies, setCopies] = useState(1)
  // Printing a label again picks a LABEL_REPRINT code from Masters › Reason codes (owner decision 4, 1 Nov 2026);
  // the first print needs none, and the server asks for it only when a lot was printed before.
  const reprint = useReasonChoice("LABEL_REPRINT", lots[0]?.plant_id, { required: false })
  const request = useRef({ body: "", id: "" })
  const job = useMutation({ mutationFn: () => {
    const body = { lot_ids: lots.map((lot) => lot.id), copies, profile, ...(reprint.value.code ? { reprint_reason_code: reprint.value.code, reprint_reason_note: reprint.value.note.trim() || undefined } : {}) }
    const key = JSON.stringify(body)
    if (key !== request.current.body) request.current = { body: key, id: crypto.randomUUID() }
    return purchaseApi.createLabelJob({ ...body, request_id: request.current.id })
  } })
  return <div className="no-print space-y-3"><div className="flex flex-wrap items-end gap-3"><div className="w-52"><Field label="Label sheet"><select className={`${fieldClass} max-sm:h-11`} value={profile} onChange={(event) => setProfile(event.target.value)}><option value="PAPER_LOT_A4">A4 · 8 labels per sheet</option><option value="PAPER_LOT_4X2">Thermal · 4 × 2 inch</option></select></Field></div><div className="w-24"><Field label="Copies"><input className={`${fieldClass} max-sm:h-11`} type="number" min="1" max="20" value={copies} onChange={(event) => setCopies(Number(event.target.value))} /></Field></div><div className="min-w-48 flex-1"><ReasonPicker category="LABEL_REPRINT" plantId={lots[0]?.plant_id} label="Reprint reason (if printed before)" required={false} value={reprint.value} onChange={reprint.setValue} showErrors={reprint.touched} compact testIdPrefix="label-reprint" /></div><button className={secondaryButton} disabled={job.isPending || !lots.length || copies < 1 || copies > 20} onClick={() => { if (reprint.validate()) job.mutate() }}><Printer className="h-4 w-4" />{job.isPending ? "Preparing…" : `Prepare ${plural(lots.length * copies, "label")}`}</button></div><RequestErrors errors={[job.error]} />{job.data ? <a className={primaryButton} href={purchaseApi.labelJobPdfUrl(job.data.data.id)} target="_blank" rel="noreferrer">Open {job.data.data.profile === "PAPER_LOT_A4" ? "A4 sheet" : "4 × 2 inch"} PDF · print at actual size</a> : null}</div>
}
