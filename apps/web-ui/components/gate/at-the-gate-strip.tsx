"use client"

/**
 * "At the gate (n)" on Purchase › Goods inward (6 Nov 2026): material bills the watchman photographed that
 * have no GRN yet. Picking one docks its photo beside the GRN form and fills the vendor; posting the GRN
 * links the entry and its photos to the GRN and every reel and lot.
 */
import { useQuery } from "@tanstack/react-query"
import { Camera, Clock3, DoorOpen, X } from "lucide-react"

import { DocumentThumb } from "@/components/documents/DocumentsPanel"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type GateEntry } from "@/lib/api-gate"
import { timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

export const AT_THE_GATE_KEY = ["gate", "at-the-gate"] as const

export function useAtTheGate(enabled = true) {
  const { activePlant } = useAuth()
  return useQuery({ queryKey: [...AT_THE_GATE_KEY, activePlant], enabled: enabled && Boolean(activePlant && activePlant !== "ALL"), queryFn: () => gateApi.atTheGate(), refetchInterval: 60_000 })
}

export function AtTheGateStrip({ picked, onPick }: { picked: GateEntry | null; onPick: (entry: GateEntry | null) => void }) {
  const query = useAtTheGate()
  const items = query.data || []
  if (query.isError) return null
  if (!items.length && !picked) return null
  return (
    <section className="erp-panel min-w-0 rounded-xl p-3" data-testid="at-the-gate">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-foreground"><DoorOpen className="h-4 w-4 text-primary" aria-hidden="true" /> At the gate ({items.length})</p>
        <p className="text-[12px] text-muted-foreground">{picked ? `Making the GRN for ${picked.entry_no}. Its photo is beside the form.` : "Material bills photographed at the gate. Pick one to make its GRN."}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((entry) => {
          const chosen = picked?.id === entry.id
          const old = (entry.waiting_hours || 0) >= 24
          return (
            <button key={entry.id} type="button" onClick={() => onPick(chosen ? null : entry)} data-testid="at-the-gate-entry" aria-pressed={chosen}
              className={cn("flex w-64 shrink-0 gap-2.5 rounded-xl border bg-card p-2 text-left transition", chosen ? "border-primary ring-2 ring-primary/20" : old ? "border-signal-amber-line" : "border-border hover:border-foreground/20")}>
              <span className="h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                {entry.documents[0] ? <DocumentThumb document={entry.documents[0]} /> : <span className="flex h-full items-center justify-center"><Camera className="h-4 w-4 text-muted-foreground" /></span>}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-foreground">{entry.party_text || "Vendor not given"}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{entry.entry_no}{entry.vehicle_no ? ` · ${entry.vehicle_no}` : ""}</span>
                <span className={cn("mt-0.5 flex items-center gap-1 text-[11.5px]", old ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}><Clock3 className="h-3 w-3" />{timeText(entry.created_at)}{old ? " · over 24 h" : ""}{entry.document_count ? ` · ${entry.document_count} photo${entry.document_count === 1 ? "" : "s"}` : " · photo uploading"}</span>
              </span>
              {chosen ? <X className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-label="Unpick" /> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
