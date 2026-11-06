"use client"

/**
 * Dispatch register chips (6 Nov 2026): "Tally T-1189 ✓" once the Tally bill number is known, "Out of gate"
 * once the watchman recorded it leaving, else "Not out of gate". The dispatch desk types the Tally number here
 * (the watchman's goods-out form is then prefilled).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, DoorOpen, Pencil } from "lucide-react"
import { useState } from "react"

import { Chip } from "@/components/inventory/stock-ui"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type DispatchGateStatus } from "@/lib/api-gate"
import { errorText } from "@/lib/stock-format"

const TALLY_ROLES = ["Dispatch", "PlantManager", "Owner", "Admin"]
const READ_ROLES = [...TALLY_ROLES, "Sales", "Store"]

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

export function DispatchGateChips({ dispatchRef, status }: { dispatchRef?: string | null; status?: DispatchGateStatus | null }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const canEdit = [user?.role, ...(user?.roles || [])].some((role) => TALLY_ROLES.includes(String(role || "")))
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const save = useMutation({
    mutationFn: () => gateApi.setTally({ dispatch_ref: dispatchRef!, tally_bill_no: value.trim(), expected_version: status?.version }),
    onSuccess: () => { setOpen(false); setError(""); client.invalidateQueries({ queryKey: ["gate", "dispatch-status"] }) },
    onError: (err) => setError(errorText(err)),
  })
  if (!dispatchRef) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="dispatch-gate-chips">
      {status?.tally_bill_no ? <Chip tone="emerald" icon={CheckCircle2} testId="dispatch-tally-chip">Tally {status.tally_bill_no}</Chip> : null}
      {status?.out ? <Chip tone="emerald" icon={DoorOpen}>Out of gate</Chip> : <Chip tone="amber" testId="dispatch-not-out">Not out of gate</Chip>}
      {status?.out && status.photos_missing?.length ? <Chip tone="amber" testId="dispatch-photos-missing">Photos missing: {status.photos_missing.join(", ").toLowerCase()}</Chip> : null}
      {canEdit ? (
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold text-signal-teal-ink underline max-sm:h-11" onClick={() => { setValue(status?.tally_bill_no || ""); setOpen(true) }} data-testid="dispatch-tally-edit">
          <Pencil className="h-3 w-3" aria-hidden="true" />{status?.tally_bill_no ? "Tally no." : "Add Tally no."}
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Tally bill number</DialogTitle>
          <DialogDescription>For challan {dispatchRef}. The watchman sees it filled in when the truck leaves.</DialogDescription>
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
    </span>
  )
}
