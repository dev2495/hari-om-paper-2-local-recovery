"use client"

/**
 * The gate photo of a GRN (6 Nov 2026): a chip on the GRN register ("Gate GE-… ✓" / "No gate photo") and,
 * on one GRN, "Link gate entry" for a bill that was photographed at the gate before or after the GRN was posted.
 * A GRN without a gate entry is still allowed (no rule change); the chip only says so.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera, DoorOpen, Link2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Chip } from "@/components/inventory/stock-ui"
import { useAuth } from "@/context/AuthContext"
import { gateApi } from "@/lib/api-gate"
import { errorText, timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

import { AT_THE_GATE_KEY, useAtTheGate } from "./at-the-gate-strip"

const LINK_ROLES = ["Store", "GRN", "PlantManager", "Owner", "Admin"]

export function useReceiptGateEntries(receiptIds: string[]) {
  const { activePlant } = useAuth()
  const ids = receiptIds.filter(Boolean)
  return useQuery({
    queryKey: ["gate", "receipt-entries", activePlant, ids.join(",")],
    enabled: Boolean(ids.length && activePlant && activePlant !== "ALL"),
    staleTime: 30_000,
    queryFn: () => gateApi.receiptEntries(ids),
  })
}

export function GateChip({ entries, loading }: { entries?: Array<{ id: string; entry_no: string }>; loading?: boolean }) {
  if (loading) return null
  if (entries?.length) return <Chip tone="emerald" icon={DoorOpen} testId="grn-gate-chip">{entries.map((row) => row.entry_no).join(", ")}</Chip>
  return <Chip tone="slate" icon={Camera} testId="grn-no-gate-photo">No gate photo</Chip>
}

export function GrnGatePanel({ receiptId }: { receiptId: string }) {
  const { user, activeRole } = useAuth()
  const client = useQueryClient()
  const canLink = [user?.role, activeRole, ...(user?.roles || [])].some((role) => LINK_ROLES.includes(String(role || "")))
  const linked = useReceiptGateEntries([receiptId])
  const waiting = useAtTheGate(canLink)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState("")
  const entries = linked.data?.[receiptId] || []
  const link = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => gateApi.linkReceipt(id, { receipt_id: receiptId, expected_version: version }),
    onSuccess: () => { setPicking(false); setError(""); client.invalidateQueries({ queryKey: ["gate"] }); client.invalidateQueries({ queryKey: AT_THE_GATE_KEY }); client.invalidateQueries({ queryKey: ["documents"] }) },
    onError: (err) => setError(errorText(err)),
  })
  return (
    <section className="erp-panel min-w-0 rounded-xl p-4" data-testid="grn-gate-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-[14px] font-semibold text-foreground">Gate entry</p>
          <GateChip entries={entries} loading={linked.isLoading} />
        </div>
        {canLink && !picking ? <button className="erp-btn-secondary max-sm:h-11" onClick={() => setPicking(true)} data-testid="grn-link-gate"><Link2 className="h-4 w-4" /> Link gate entry</button> : null}
      </div>
      {entries.length ? <p className="mt-1 text-[12.5px] text-muted-foreground">The bill photographed at the gate is linked to this GRN and to each of its reels and lots (see the documents below).</p>
        : <p className="mt-1 text-[12.5px] text-muted-foreground">This GRN was posted without a gate photo. If the watchman photographed its bill, link it here.</p>}
      {picking ? (
        <div className="mt-3 space-y-2">
          {waiting.isLoading ? <p className="text-[13px] text-muted-foreground">Loading bills at the gate…</p> : null}
          {!waiting.isLoading && !(waiting.data || []).length ? <p className="text-[13px] text-muted-foreground">No material bill is waiting at the gate.</p> : null}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(waiting.data || []).map((entry) => (
              <button key={entry.id} disabled={link.isPending} onClick={() => link.mutate({ id: entry.id, version: entry.version })}
                className={cn("w-60 shrink-0 rounded-xl border border-border bg-card p-2.5 text-left transition hover:border-primary")}>
                <span className="block truncate text-[13.5px] font-semibold">{entry.party_text || "Vendor not given"}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{entry.entry_no}{entry.vehicle_no ? ` · ${entry.vehicle_no}` : ""} · {timeText(entry.created_at)}</span>
                <span className="block text-[11.5px] text-muted-foreground">{entry.document_count} photo{entry.document_count === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Link className="text-[12.5px] underline" href="/purchase/inward">Goods inward › At the gate</Link>
            <button className="erp-btn-secondary max-sm:h-11" onClick={() => { setPicking(false); setError("") }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-[13px] text-signal-rose-ink">{error}</p> : null}
    </section>
  )
}
