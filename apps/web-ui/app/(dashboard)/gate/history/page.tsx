"use client"

/** Gate register (6 Nov 2026): every visitor, bill in and goods out by date, gate, type and status; CSV. */
import { useQuery } from "@tanstack/react-query"
import { Download, Search } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"

import { Chip } from "@/components/inventory/stock-ui"
import { Field, MessageBar, fieldClass, secondaryButton } from "@/components/procurement/procurement-shell"
import { PageHeader } from "@/components/workspace/page-header"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type HistoryFilters } from "@/lib/api-gate"
import { businessDate } from "@/lib/business-date"
import { errorText, rupees, timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const STATUSES: Record<string, Array<{ value: string; label: string }>> = {
  VISITOR: [{ value: "ARRIVED", label: "Waiting at gate" }, { value: "IN", label: "Inside" }, { value: "OUT", label: "Out" }, { value: "DENIED", label: "Denied" }, { value: "NO_SHOW", label: "Did not come in" }],
  BILL_IN: [{ value: "WITH_STORES", label: "With Stores" }, { value: "WITH_ACCOUNTS", label: "With Accounts" }, { value: "LINKED", label: "Linked to GRN" }, { value: "FILED", label: "Filed" }],
  GOODS_OUT: [{ value: "WITH_STORES", label: "With Stores (to link)" }, { value: "LINKED", label: "Linked to challan" }],
}
const daysAgo = (days: number) => { const d = new Date(`${businessDate()}T00:00:00`); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10) }
const PAGE = 100

export default function GateHistoryPage() {
  return <RoleGate allow={["PlantManager"]}><Suspense fallback={null}><GateHistory /></Suspense></RoleGate>
}

function GateHistory() {
  const { activePlant } = useAuth()
  const params = useSearchParams()
  const [filters, setFilters] = useState<HistoryFilters>({ date_from: daysAgo(6), date_to: businessDate(), type: params.get("type") || "", status: params.get("status") || "", gate_id: "", q: "" })
  const [offset, setOffset] = useState(0)
  const concrete = Boolean(activePlant && activePlant !== "ALL")
  const gates = useQuery({ queryKey: ["gate", "gates", activePlant, "all"], enabled: concrete, queryFn: () => gateApi.gates(true) })
  const query = useMemo(() => ({ ...filters, limit: PAGE, offset }), [filters, offset])
  const history = useQuery({ queryKey: ["gate", "history", activePlant, query], enabled: concrete, queryFn: () => gateApi.history(query) })
  const set = (patch: Partial<HistoryFilters>) => { setFilters({ ...filters, ...patch }); setOffset(0) }
  const rows = history.data?.items || []
  return (
    <div className="min-w-0 space-y-5" data-testid="gate-history">
      <PageHeader title="Gate register" description="Visitors, bills in and goods out at every gate of the plant. Phone numbers are shown to the plant head, the Owner and the Admin only."
        actions={concrete ? <a className={secondaryButton} href={gateApi.historyCsvUrl(filters)} data-testid="gate-history-csv"><Download className="h-4 w-4" /> CSV</a> : null} />
      {!concrete ? <MessageBar tone="info">Pick one plant at the top to see its gate register.</MessageBar> : <>
        <div className="erp-panel grid gap-3 rounded-xl p-4 sm:grid-cols-2 xl:grid-cols-6">
          <Field label="From"><input type="date" className={cn(fieldClass, "max-sm:h-11")} value={filters.date_from} onChange={(event) => set({ date_from: event.target.value })} /></Field>
          <Field label="To"><input type="date" className={cn(fieldClass, "max-sm:h-11")} value={filters.date_to} onChange={(event) => set({ date_to: event.target.value })} /></Field>
          <Field label="Gate"><select className={cn(fieldClass, "max-sm:h-11")} value={filters.gate_id} onChange={(event) => set({ gate_id: event.target.value })}><option value="">All gates</option>{(gates.data || []).map((gate) => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</select></Field>
          <Field label="Type"><select className={cn(fieldClass, "max-sm:h-11")} value={filters.type} onChange={(event) => set({ type: event.target.value, status: "" })}><option value="">Everything</option><option value="VISITOR">Visitors</option><option value="BILL_IN">Bills in</option><option value="GOODS_OUT">Goods out</option></select></Field>
          <Field label="Status"><select className={cn(fieldClass, "max-sm:h-11")} value={filters.status} onChange={(event) => set({ status: event.target.value })} disabled={!filters.type}><option value="">{filters.type ? "Any status" : "Pick a type first"}</option>{(STATUSES[filters.type || ""] || []).map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></Field>
          <Field label="Search"><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className={cn(fieldClass, "pl-9 max-sm:h-11")} value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Name, phone, vehicle, bill, challan" /></span></Field>
        </div>
        {history.isError ? <MessageBar tone="error">The register could not load: {errorText(history.error)}</MessageBar> : null}
        {history.data ? <p className="text-[13px] text-muted-foreground">{history.data.total.toLocaleString("en-IN")} rows · {history.data.counts.VISITOR || 0} visitors · {history.data.counts.BILL_IN || 0} bills in · {history.data.counts.GOODS_OUT || 0} goods out{history.data.truncated ? " · showing the newest 5,000; narrow the dates" : ""}</p> : null}
        <div className="erp-panel overflow-x-auto rounded-xl">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead className="bg-muted text-left text-[12px] text-muted-foreground"><tr>{["When", "Type", "No.", "Gate", "Who / party", "Detail", "Vehicle", "Reference", "Status"].map((head) => <th key={head} className="px-3 py-2.5 font-semibold">{head}</th>)}</tr></thead>
            <tbody>
              {history.isLoading ? <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr> : null}
              {!history.isLoading && !rows.length ? <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Nothing at the gate for these filters. Widen the dates or clear the search.</td></tr> : null}
              {rows.map((row) => (
                <tr key={`${row.type}:${row.id}`} className="border-t border-border align-top" data-testid="gate-history-row">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{timeText(row.at)}</td>
                  <td className="px-3 py-2.5">{row.type_label}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px]">{row.no}</td>
                  <td className="px-3 py-2.5">{row.gate || "—"}</td>
                  <td className="px-3 py-2.5"><p className="font-medium text-foreground">{row.name || "—"}</p>{row.company ? <p className="text-muted-foreground">{row.company}</p> : null}{row.mobile ? <p className="tabular-nums text-muted-foreground">{row.mobile}</p> : null}</td>
                  <td className="px-3 py-2.5">{row.detail}{row.host ? <p className="text-muted-foreground">For {row.host}{row.people && row.people > 1 ? ` · ${row.people} people` : ""}</p> : null}{row.type === "VISITOR" && row.in_at ? <p className="text-muted-foreground">In {timeText(row.in_at)}{row.out_at ? ` · out ${timeText(row.out_at)}` : ""}</p> : null}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{row.vehicle_no || "—"}</td>
                  <td className="px-3 py-2.5">{row.reference || "—"}{row.amount != null ? <p className="text-muted-foreground">{rupees(row.amount)}</p> : null}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex flex-wrap gap-1"><Chip tone={["IN", "ARRIVED", "WITH_STORES", "WITH_ACCOUNTS"].includes(row.status) ? "amber" : row.status === "DENIED" ? "rose" : "emerald"}>{row.status_label}</Chip>{row.photos_missing?.length ? <Chip tone="amber" testId="gate-history-photos-missing">Photos missing</Chip> : null}</span>{row.photos_missing?.length ? <p className="mt-1 text-[12px] text-muted-foreground">No {row.photos_missing.join(" or ").toLowerCase()} photo yet</p> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.data && history.data.total > PAGE ? (
          <div className="flex items-center justify-end gap-2">
            <button className={secondaryButton} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span className="text-[13px] tabular-nums text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, history.data.total)} of {history.data.total.toLocaleString("en-IN")}</span>
            <button className={secondaryButton} disabled={offset + PAGE >= history.data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        ) : null}
      </>}
    </div>
  )
}
