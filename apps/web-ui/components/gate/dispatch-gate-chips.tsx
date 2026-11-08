"use client"

/**
 * Dispatch register chips (6 Nov 2026; Store links since 8 Nov): "Not out of gate" until Store links a gate
 * photo to the challan, then "Out · Tally T-1189 ✓"; "Photos missing" while the Tally bill or challan photo is
 * not in the vault. Store / Dispatch / the plant head may type the Tally no. before the truck leaves (it prefills
 * the link screen) and link a waiting gate photo from the row. The plant head may undo a wrong link (reason).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Link2, Pencil, Unlink } from "lucide-react"
import { useState } from "react"

import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { Chip } from "@/components/inventory/stock-ui"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type DispatchGateStatus } from "@/lib/api-gate"
import { errorText, timeText } from "@/lib/stock-format"

import { useGoodsOutRoles } from "./gone-out-strip"

const READ_ROLES = ["Store", "Dispatch", "PlantManager", "Owner", "Admin", "Sales"]
const linkButton = "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold text-signal-teal-ink underline max-sm:h-11"

export function useDispatchGateStatus(refs: string[]) {
  const { activePlant, user } = useAuth()
  const roles = [user?.role, ...(user?.roles || [])].map(String)
  const wanted = Array.from(new Set(refs.filter(Boolean))).sort()
  return useQuery({
    queryKey: ["gate", "dispatch-status", activePlant, wanted.join(",")],
    enabled: Boolean(wanted.length && activePlant && activePlant !== "ALL" && roles.some((role) => READ_ROLES.includes(role))),
    staleTime: 30_000,
    queryFn: () => gateApi.dispatchStatus(wanted),
  })
}

export function DispatchGateChips({ dispatchRef, status, onLinkPhoto }: { dispatchRef?: string | null; status?: DispatchGateStatus | null; onLinkPhoto?: (dispatchRef: string) => void }) {
  const client = useQueryClient()
  const { canLink, canUnlink } = useGoodsOutRoles()
  const [open, setOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const save = useMutation({
    mutationFn: () => gateApi.setTally({ dispatch_ref: dispatchRef!, tally_bill_no: value.trim(), expected_version: status?.version }),
    onSuccess: () => { setOpen(false); setError(""); client.invalidateQueries({ queryKey: ["gate"] }) },
    onError: (err) => setError(errorText(err)),
  })
  if (!dispatchRef) return null
  const linked = Boolean(status?.linked || (status?.out && status?.gate_entry_id))
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1" data-testid="dispatch-gate-chips">
      {linked ? (
        <Chip tone="emerald" icon={CheckCircle2} testId="dispatch-out-chip">Out · Tally {status?.tally_bill_no} ✓</Chip>
      ) : (
        <>
          <Chip tone="amber" testId="dispatch-not-out">Not out of gate</Chip>
          {status?.tally_bill_no ? <Chip tone="slate" testId="dispatch-tally-chip">Tally {status.tally_bill_no}</Chip> : null}
        </>
      )}
      {linked && status?.photos_missing?.length ? <Chip tone="amber" testId="dispatch-photos-missing">Photos missing: {status.photos_missing.join(", ").toLowerCase()}</Chip> : null}
      {canLink && !linked && onLinkPhoto ? (
        <button type="button" className={linkButton} onClick={() => onLinkPhoto(dispatchRef)} data-testid="dispatch-link-gate-photo"><Link2 className="h-3 w-3" aria-hidden="true" />Link gate photo</button>
      ) : null}
      {canLink && !linked ? (
        <button type="button" className={linkButton} onClick={() => { setValue(status?.tally_bill_no || ""); setError(""); setOpen(true) }} data-testid="dispatch-tally-edit">
          <Pencil className="h-3 w-3" aria-hidden="true" />{status?.tally_bill_no ? "Tally no." : "Add Tally no."}
        </button>
      ) : null}
      {canUnlink && linked && status?.gate_entry_id ? (
        <button type="button" className={linkButton} onClick={() => setUnlinking(true)} title={`Linked ${status.gate_entry_no ? `to ${status.gate_entry_no} ` : ""}${status.linked_by ? `by ${status.linked_by}` : ""}`} data-testid="dispatch-unlink">
          <Unlink className="h-3 w-3" aria-hidden="true" />Unlink
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Tally bill number</DialogTitle>
          <DialogDescription>For challan {dispatchRef}. It is filled in for Stores when they link the gate photo.</DialogDescription>
          <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) save.mutate() }} className="space-y-3">
            <input autoFocus className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[15px] uppercase" value={value} onChange={(event) => setValue(event.target.value.toUpperCase())} placeholder="T-1189" aria-label="Tally bill number" data-testid="dispatch-tally-input" />
            {error ? <p role="alert" className="text-[13px] text-signal-rose-ink">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={() => setOpen(false)}>Cancel</button>
              <button className="erp-btn-primary max-sm:h-11" disabled={!value.trim() || save.isPending} data-testid="dispatch-tally-save">Save</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {unlinking && status?.gate_entry_id ? <UnlinkDialog dispatchRef={dispatchRef} status={status} onClose={() => setUnlinking(false)} /> : null}
    </span>
  )
}

function UnlinkDialog({ dispatchRef, status, onClose }: { dispatchRef: string; status: DispatchGateStatus; onClose: () => void }) {
  const client = useQueryClient()
  const reason = useReasonChoice("GATE_OUT_UNLINK")
  const [error, setError] = useState("")
  const unlink = useMutation({
    mutationFn: () => gateApi.unlinkGoneOut(status.gate_entry_id!, { expected_version: Number(status.gate_entry_version || 1), reason_code: reason.value.code, reason_note: reason.value.note || undefined, dispatch_ref: dispatchRef }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["gate"] }); client.invalidateQueries({ queryKey: ["documents"] }); onClose() },
    onError: (err) => setError(errorText(err)),
  })
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Unlink the gate photo from challan {dispatchRef}</DialogTitle>
        <DialogDescription>
          {status.gate_entry_no || "The gate entry"} (out {timeText(status.out_at)}, Tally {status.tally_bill_no}) goes back to Gone out at the gate for Stores to link again. The Tally no. stays on the challan. Logged with your reason.
        </DialogDescription>
        <ReasonPicker category="GATE_OUT_UNLINK" value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact testIdPrefix="gate:unlink" />
        {error ? <p role="alert" className="text-[13px] text-signal-rose-ink">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={onClose}>Back</button>
          <button type="button" className="erp-btn-primary max-sm:h-11" disabled={unlink.isPending} onClick={() => { if (reason.validate()) unlink.mutate() }} data-testid="dispatch-unlink-confirm">Unlink</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
