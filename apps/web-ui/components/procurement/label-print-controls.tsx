"use client"
import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { purchaseApi } from "@/lib/api"
import { Field, RequestErrors, fieldClass, primaryButton, secondaryButton } from "./procurement-shell"
export function LabelPrintControls({ lots }: { lots: any[] }) {
  const [copies, setCopies] = useState(1); const [reason, setReason] = useState("")
  const request = useRef({ body: "", id: "" })
  const job = useMutation({ mutationFn: () => {
    const body = { lot_ids: lots.map((lot) => lot.id), copies, profile: "PAPER_LOT_4X2", reprint_reason: reason.trim() || undefined }
    const key = JSON.stringify(body)
    if (key !== request.current.body) request.current = { body: key, id: crypto.randomUUID() }
    return purchaseApi.createLabelJob({ ...body, request_id: request.current.id })
  } })
  return <div className="no-print space-y-3"><div className="flex flex-wrap items-end gap-3"><div className="w-24"><Field label="Copies"><input className={fieldClass} type="number" min="1" max="20" value={copies} onChange={(event) => setCopies(Number(event.target.value))} /></Field></div><div className="min-w-48 flex-1"><Field label="Reprint reason" hint="if printed before"><input className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Damaged label, additional copy…" /></Field></div><button className={secondaryButton} disabled={job.isPending || !lots.length || copies < 1 || copies > 20} onClick={() => job.mutate()}><Printer className="h-4 w-4" />{job.isPending ? "Preparing…" : `Prepare ${lots.length * copies} labels`}</button></div><RequestErrors errors={[job.error]} />{job.data ? <a className={primaryButton} href={purchaseApi.labelJobPdfUrl(job.data.data.id)} target="_blank" rel="noreferrer">Open 4 × 2 inch label PDF · print at actual size</a> : null}</div>
}
