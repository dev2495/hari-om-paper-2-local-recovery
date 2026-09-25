"use client"

import { useAuth } from "@/context/AuthContext"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, FileSpreadsheet, Printer } from "lucide-react"

import { EmptyState } from "@/components/erp/shell"
import { ProcurementShell, StateBadge, WorkPanel, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { purchaseApi } from "@/lib/api"

const registers = [
  { key: "receipts", title: "GRN receipt register", grain: "One received material line", fields: "Manual or PO source, vendor, invoice, received quantity, approved and invoice rates, QC and commercial hold" },
  { key: "po-lines", title: "PO line register", grain: "One current saved PO line", fields: "Series, revision, vendor, material/spec, ordered/received/open kg, expected and actual units, rate, amount, approval and fulfillment" },
  { key: "inward-lots", title: "Inward and lot register", grain: "One physical AT reel or coil", fields: "PO/revision/GRN/invoice, vendor reel, AT, form, width, original/current kg, PO and invoice rates, QC and commercial state" },
  { key: "discrepancies", title: "Invoice difference register", grain: "One receipt-invoice allocation", fields: "Vendor, PO, invoice, item, kg, both rates, signed delta, claimable value, owner and resolution" },
  { key: "debit-notes", title: "Debit note register", grain: "One commercial claim document", fields: "Document, vendor, status, total, settled and open amount with immutable source lines" },
  { key: "schedule", title: "Monthly schedule", grain: "One dated material/vendor entry", fields: "Plan, date/day, material, vendor, form, kg, expected units, converted quantity and state" },
  { key: "stock-policies", title: "Stock policy register", grain: "One material policy version", fields: "Safety, reorder, target, recovery, lead time, MOQ, multiple, recipients, creator and activation" },
  { key: "rm-costing", title: "RM cost register", grain: "One material current posture", fields: "Base and landed planning cost, currency, active/latest version, effective date and missing-state visibility" },
]

export default function ProcurementRegistersPage() {
  const { activePlant } = useAuth()
  const [selectedKey, setSelectedKey] = useState(registers[0].key)
  const selected = registers.find((row) => row.key === selectedKey) || registers[0]
  const registerQuery = useQuery({ queryKey: ["purchase-v2", "register", selectedKey, activePlant], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => purchaseApi.getRegister(selectedKey) })
  const payload = registerQuery.data?.data || { items: [], columns: [], row_count: 0 }
  const show = (value: unknown) => value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)

  return <ProcurementShell eyebrow="Complete records" title="Export every filtered procurement row, not only the visible page."
    description="The server owns each register's row grain and returns a row-count header. Print profiles keep identity on continuation rows; full Excel and CSV retain the wide detail that cannot remain legible on one A4 line.">
    <WorkPanel title="Registers and print profiles" description="Use A4 landscape for compact registers, A3 landscape for wide operational review, Excel for daily work and CSV for integrations.">
      <div className="grid gap-3 md:grid-cols-2">{registers.map((register) => <article key={register.key} className={`rounded-xl border p-5 transition ${selectedKey === register.key ? "border-signal-cyan-ink/40 bg-signal-cyan-soft/50 shadow-sm" : "border-border"}`}><FileSpreadsheet className="h-5 w-5 text-signal-cyan-ink" /><h2 className="mt-3 font-semibold text-foreground">{register.title}</h2><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{register.grain}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{register.fields}</p><div className="mt-4 flex flex-wrap gap-2"><button className={selectedKey === register.key ? primaryButton : secondaryButton} onClick={() => setSelectedKey(register.key)}>Preview rows</button><a className={secondaryButton} href={purchaseApi.registerExportUrl(register.key, "xlsx")}><Download className="h-4 w-4" /> Full Excel</a><a className={secondaryButton} href={purchaseApi.registerExportUrl(register.key, "csv")}><Download className="h-4 w-4" /> CSV</a></div></article>)}</div>
    </WorkPanel>
    <section className="register-print overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-foreground">{selected.title}</h2><StateBadge value={`${payload.row_count} ROWS`} /></div><p className="mt-1 text-sm text-muted-foreground">{selected.grain}. All source fields print in column sections with document identity repeated.</p></div><div className="flex flex-wrap gap-2 no-print"><a className={secondaryButton} href={purchaseApi.registerPdfUrl(selectedKey, "A3")} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Print A3 · all rows</a><a className={secondaryButton} href={purchaseApi.registerPdfUrl(selectedKey, "A4")} target="_blank" rel="noreferrer">Print A4 · all rows</a></div></header>
      {registerQuery.isLoading ? <div className="p-8"><EmptyState label="Loading the complete register…" /></div> : registerQuery.isError ? <div className="p-8"><EmptyState label="The register could not be loaded. Check your access and try again." /></div> : !payload.items.length ? <div className="p-8"><EmptyState label="No rows exist in this register for the active plant." /></div> : <div className="overflow-auto"><table className="w-full min-w-max border-collapse text-xs"><thead className="bg-[hsl(var(--surface-2))] text-muted-foreground"><tr>{payload.columns.map((column: string) => <th key={column} className="border-r border-foreground/80 px-3 py-2 text-left font-semibold uppercase tracking-wide">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{payload.items.map((row: Record<string, unknown>, index: number) => <tr key={index} className="border-b border-border even:bg-muted/60">{payload.columns.map((column: string) => <td key={column} className="whitespace-nowrap border-r border-border px-3 py-2 tabular-nums text-muted-foreground">{show(row[column])}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </ProcurementShell>
}
