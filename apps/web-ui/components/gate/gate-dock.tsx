"use client"

/**
 * The gate photos of one entry, docked beside a form (Goods inward GRN form, Accounts bills inbox):
 * one tab per document, the vault viewer (zoom, rotate, pages) for the chosen one.
 */
import { FileText, Loader2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { DocumentViewer } from "@/components/documents/DocumentViewer"
import { useVaultDocument } from "@/hooks/use-documents"
import type { VaultDocument } from "@/lib/api-documents"
import type { GateEntry } from "@/lib/api-gate"
import { timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

export function GateDocDock({ entry, onClose, className, viewerClassName = "h-[min(70vh,640px)]" }: { entry: GateEntry; onClose?: () => void; className?: string; viewerClassName?: string }) {
  const documents: VaultDocument[] = useMemo(() => entry.documents || [], [entry.documents])
  const [chosen, setChosen] = useState<string | null>(documents[0]?.id || null)
  useEffect(() => { if (!chosen && documents[0]) setChosen(documents[0].id) }, [chosen, documents])
  const detail = useVaultDocument(chosen)
  const document = detail.data || documents.find((row) => row.id === chosen) || null
  return (
    <aside className={cn("erp-panel min-w-0 rounded-xl p-3", className)} data-testid="gate-doc-dock">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground">{entry.kind === "GOODS_OUT" ? "Gate photos" : "Gate photo"} · {entry.entry_no}</p>
          <p className="truncate text-[12px] text-muted-foreground">{[entry.gate_name, timeText(entry.created_at), entry.vehicle_no, entry.party_text].filter(Boolean).join(" · ")}</p>
        </div>
        {onClose ? <button aria-label="Close the gate photo" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted max-sm:h-11 max-sm:w-11"><X className="h-4 w-4" /></button> : null}
      </div>
      {documents.length > 1 ? (
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {documents.map((row, index) => (
            <button key={row.id} onClick={() => setChosen(row.id)} className={cn("h-9 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold max-sm:h-11", chosen === row.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
              {entry.kind === "GOODS_OUT" ? row.kind_label || "Photo" : `Bill ${index + 1}`}{row.pages > 1 ? ` · ${row.pages} pages` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {!documents.length ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg bg-muted text-center text-[13px] text-muted-foreground">
          <FileText className="h-6 w-6" aria-hidden="true" />The photos are still uploading from the gate phone. They appear here on their own.
        </div>
      ) : document ? (
        <div className="relative">
          {detail.isFetching && !detail.data ? <Loader2 className="absolute right-2 top-2 z-10 h-4 w-4 animate-spin text-muted-foreground" /> : null}
          <DocumentViewer key={document.id + (detail.data ? ":full" : "")} document={document} className={viewerClassName} />
        </div>
      ) : null}
    </aside>
  )
}
