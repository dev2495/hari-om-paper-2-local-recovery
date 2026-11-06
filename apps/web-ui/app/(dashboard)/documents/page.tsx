"use client"

// Doc Vault (6 Nov 2026): every bill, challan and photo of the plant, searchable by number, party, GRN,
// AIT reel no. or challan, with thumbnails and the viewer. Nothing is deleted; Owner/Admin void.
// Query: ?doc=<id> opens one document; ?tab=UNLINKED opens material bills not yet tied to a GRN.

import { useSearchParams, useRouter } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"
import { FileText, LayoutGrid, List, Search } from "lucide-react"

import { AddDocumentButtons, DocumentCard, DocumentThumb, OutboxStrip } from "@/components/documents/DocumentsPanel"
import { DocumentDrawer, money } from "@/components/documents/DocumentDrawer"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { ErrorState } from "@/components/workspace/query-state"
import { useAuth } from "@/context/AuthContext"
import { useDocumentOutbox, useVaultDocuments } from "@/hooks/use-documents"
import { describeApiError } from "@/lib/api-error"
import type { VaultTab } from "@/lib/api-documents"
import type { DocKind } from "@/lib/doc-upload"
import { dayText, timeText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const VAULT_ROLES = ["PlantManager", "Accounts", "Store", "GRN", "InwardQC", "QC", "Dispatch", "Watchman"]
const TABS: Array<{ key: VaultTab; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "VENDOR", label: "Vendor bills" },
  { key: "EXPENSE", label: "Expense bills" },
  { key: "OUTWARD", label: "Outward" },
  { key: "UNLINKED", label: "Unlinked" },
]
const ADD_ORDER: DocKind[] = ["VENDOR_BILL", "VENDOR_CHALLAN", "EXPENSE_BILL", "TALLY_BILL", "OUR_CHALLAN", "VISITOR_PHOTO", "OTHER"]
const SOURCE_WORDS: Record<string, string> = { GATE: "Gate", STORE: "Stores", QC: "Quality", DISPATCH: "Dispatch", SYSTEM: "System copy" }
const PAGE = 60
const input = "h-9 rounded-lg border border-input bg-card px-3 text-[13px] text-foreground shadow-[var(--shadow-xs)] outline-none focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 max-sm:h-11"

function useDebounced<T>(value: T, ms = 300) {
  const [current, setCurrent] = useState(value)
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), ms); return () => window.clearTimeout(timer) }, [value, ms])
  return current
}

function VaultPage() {
  const params = useSearchParams()
  const router = useRouter()
  const { activePlant } = useAuth()
  const initialTab = (TABS.find((tab) => tab.key === (params.get("tab") || "").toUpperCase())?.key || "ALL") as VaultTab
  const [tab, setTab] = useState<VaultTab>(initialTab)
  const [q, setQ] = useState(params.get("q") || "")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [showVoid, setShowVoid] = useState(false)
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const [limit, setLimit] = useState(PAGE)
  const openId = params.get("doc")
  const search = useDebounced(q)
  const filters = useMemo(() => ({ tab, q: search.trim() || undefined, date_from: from || undefined, date_to: to || undefined, status: showVoid ? "ALL" as const : "ACTIVE" as const, limit }),
    [tab, search, from, to, showVoid, limit])
  const query = useVaultDocuments(filters)
  const outbox = useDocumentOutbox()
  const data = query.data
  const items = data?.items || []
  const addKinds = ADD_ORDER.filter((kind) => !data?.can_upload || data.can_upload.includes(kind))

  useEffect(() => { setLimit(PAGE) }, [tab, search, from, to, showVoid, activePlant])

  const open = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (id) next.set("doc", id)
    else next.delete("doc")
    router.replace(`/documents${next.toString() ? `?${next}` : ""}`, { scroll: false })
  }

  return (
    <div className="min-w-0 space-y-5" data-testid="doc-vault">
      <PageHeader title="Doc Vault" description="Every bill, challan and photo of the plant in one place. Search by number, party, GRN, AIT reel no. or challan. Documents are never deleted; the Owner or Admin can void one with a reason."
        actions={data && addKinds.length ? <AddDocumentButtons kinds={addKinds} testId="vault-add" /> : null} />
      <OutboxStrip items={outbox.items} />

      <section className="erp-panel space-y-3 rounded-xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-64">
            <span className="sr-only">Search documents</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="DV no., bill no., party, GRN, AIT no. or challan" data-testid="vault-search"
              className={cn(input, "w-full pl-9")} />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">From <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={input} aria-label="From date" /></label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">To <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={input} aria-label="To date" /></label>
          <label className="flex min-h-9 items-center gap-2 text-[12.5px] text-foreground max-sm:min-h-11">
            <input type="checkbox" checked={showVoid} onChange={(event) => setShowVoid(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Show void
          </label>
          <div className="ml-auto flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} className={cn("grid h-9 w-10 place-items-center max-sm:h-11 max-sm:w-11", layout === "grid" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")} aria-label="Grid with thumbnails"><LayoutGrid className="h-4 w-4" /></button>
            <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={cn("grid h-9 w-10 place-items-center border-l border-border max-sm:h-11 max-sm:w-11", layout === "list" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")} aria-label="List"><List className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Document groups">
          {TABS.map((row) => {
            const count = data?.counts?.[row.key]
            const selected = tab === row.key
            return (
              <button key={row.key} type="button" role="tab" aria-selected={selected} onClick={() => setTab(row.key)} data-testid={`vault-tab-${row.key.toLowerCase()}`}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold transition max-sm:h-11",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/40",
                  row.key === "UNLINKED" && !selected && count ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "")}>
                {row.label}{count !== undefined ? <span className={cn("tabular-nums", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{count}</span> : null}
              </button>
            )
          })}
        </div>
      </section>

      {!activePlant ? null : query.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton aspect-[4/3] rounded-xl" />)}
        </div>
      ) : query.isError ? (
        <ErrorState title="The Doc Vault could not be loaded" message={describeApiError(query.error, "Refresh to try again.")} onRetry={() => void query.refetch()} />
      ) : !items.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-[hsl(var(--surface-2))] px-4 py-12 text-center text-[13px] text-muted-foreground" data-testid="vault-empty">
          <FileText className="h-8 w-8" aria-hidden="true" />
          {search || from || to ? "No document matches. Clear the search or the dates." : tab === "UNLINKED" ? "Every vendor bill and challan is linked to a GRN." : "No documents yet. Take a photo of a bill or challan with the button above."}
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" data-testid="vault-grid">
          {items.map((document) => (
            <div key={document.id} className="min-w-0 space-y-1">
              <DocumentCard document={document} onOpen={() => open(document.id)} />
              {document.party_name || document.links.length ? (
                <p className="truncate px-1 text-[11.5px] text-muted-foreground">{document.party_name || ""}{document.party_name && document.links.length ? " · " : ""}{document.links.map((link) => link.label).join(", ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="vault-list">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-border bg-[hsl(var(--surface-2))] text-[11.5px] font-semibold text-muted-foreground">
              <tr>{["", "Doc", "Type", "Party", "No. · date", "Linked to", "From"].map((heading) => <th key={heading} className="px-3 py-2.5">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((document) => (
                <tr key={document.id} onClick={() => open(document.id)} className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted", document.status === "VOID" && "opacity-60")}>
                  <td className="w-14 px-3 py-2"><span className="block h-10 w-10 overflow-hidden rounded-md border border-border"><DocumentThumb document={document} /></span></td>
                  <td className="px-3 py-2 font-semibold"><button type="button" className="hover:underline" onClick={(event) => { event.stopPropagation(); open(document.id) }}>{document.doc_no}</button>{document.status === "VOID" ? <span className="ml-1.5 text-[11px] text-signal-rose-ink">Void</span> : null}</td>
                  <td className="px-3 py-2">{document.kind_label}{document.category ? <span className="block text-[11.5px] text-muted-foreground">{document.category}</span> : null}</td>
                  <td className="px-3 py-2">{document.party_name || "—"}</td>
                  <td className="px-3 py-2">{document.ref_no || "—"}{document.ref_date ? ` · ${dayText(document.ref_date)}` : ""}{document.amount != null ? <span className="block text-[11.5px] tabular-nums text-muted-foreground">{money(document.amount)}</span> : null}</td>
                  <td className="px-3 py-2">{document.links.length ? document.links.map((link) => link.label).join(", ") : <span className="text-signal-amber-ink">Not linked</span>}</td>
                  <td className="px-3 py-2">{SOURCE_WORDS[document.source] || document.source} · {who(document.uploaded_by)}<span className="block text-[11.5px] text-muted-foreground">{timeText(document.uploaded_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > items.length && limit >= 200 ? (
        <p className="text-center text-[12.5px] text-muted-foreground">Showing the newest 200 of {data.total}. Narrow the search or the dates to find older ones.</p>
      ) : data && data.total > items.length ? (
        <div className="flex justify-center">
          <button type="button" className="erp-btn-secondary max-sm:h-11" disabled={query.isFetching} onClick={() => setLimit((value) => Math.min(200, value + PAGE))}>
            Show more · {items.length} of {data.total}
          </button>
        </div>
      ) : null}
      <DocumentDrawer documentId={openId} onClose={() => open(null)} />
    </div>
  )
}

export default function DocumentsPage() {
  return (
    <RoleGate allow={VAULT_ROLES}>
      <Suspense fallback={null}>
        <VaultPage />
      </Suspense>
    </RoleGate>
  )
}
