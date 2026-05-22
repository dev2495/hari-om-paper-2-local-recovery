"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  PackageCheck,
  RotateCcw,
} from "lucide-react"

import { ExecutiveHero, Panel } from "@/components/erp/shell"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems, useInventoryTransactions, useManualFgInward } from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

const REASONS = [
  { value: "REWORK", label: "Rework yield (re-introduce into stock)" },
  { value: "RETURN", label: "Customer return" },
  { value: "ADJUSTMENT", label: "Manual adjustment (positive)" },
  { value: "OPENING", label: "Opening / go-live adjustment" },
  { value: "OTHER", label: "Other reason" },
] as const

const STATUS_OPTIONS = ["UNRESTRICTED", "WIP", "QC_HOLD", "DISPATCH_STAGING", "BLOCKED"]

const fmtKg = (value: unknown) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`

export default function ManualFgInwardPage() {
  const { activePlant } = useAuth()
  const writeBlocked = !activePlant || activePlant === "ALL"

  const itemsQuery = useInventoryItems()
  const items = (Array.isArray(itemsQuery.data) ? itemsQuery.data : []).filter(
    (it: any) => String(it.type || "").toUpperCase() === "FINISHED_GOOD",
  )
  const recentTxns = useInventoryTransactions({ transaction_type: "FG_INWARD" })
  const recent = (Array.isArray(recentTxns.data) ? recentTxns.data : []).slice(0, 10)
  const manualInward = useManualFgInward()

  const [form, setForm] = useState({
    item_id: "",
    qty: "",
    reason_code: "REWORK",
    notes: "",
    reference: "",
    batch_no: "",
    location_id: "",
    stock_status: "UNRESTRICTED",
  })

  const selectedItem = useMemo(() => items.find((it: any) => String(it.id) === form.item_id) || null, [items, form.item_id])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.item_id || !form.qty || writeBlocked) return
    manualInward.mutate(
      {
        data: {
          item_id: form.item_id,
          qty: Number(form.qty),
          reason_code: form.reason_code,
          notes: form.notes || undefined,
          reference: form.reference || undefined,
          batch_no: form.batch_no || undefined,
          location_id: form.location_id || undefined,
          stock_status: form.stock_status,
        },
        plantId: activePlant || "",
      },
      {
        onSuccess: () => {
          setForm((prev) => ({ ...prev, qty: "", notes: "", reference: "", batch_no: "" }))
        },
      },
    )
  }

  const errResponse = manualInward.error as any
  const errMessage = errResponse?.response?.data?.detail || errResponse?.message

  return (
    <div className="space-y-6 animate-enter-up">
      <ExecutiveHero
        testId="manual-fg-hero"
        badge="Manual FG inward"
        title="Post finished goods that didn't come from a job close"
        description="Rework yield, customer returns, manual adjustments — anything that lands FG in stock without a production job behind it. Every post is audit-logged and idempotent on the optional reference."
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">
              <PackageCheck className="h-3.5 w-3.5" /> {items.length} FG items
            </span>
            <Link
              href="/inventory/ledger"
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-cyan-300 hover:text-cyan-900"
            >
              View ledger <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </>
        }
      />

      {writeBlocked && (
        <section className="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Select one concrete plant before posting manual FG. Global scope is read-only.
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Post manual FG" subtitle="Form requires item, qty, and reason. Reference is optional but makes the post idempotent.">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="FG item *">
              <select
                required
                value={form.item_id}
                onChange={(e) => setForm({ ...form, item_id: e.target.value })}
                disabled={writeBlocked}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm focus:border-cyan-400 focus:outline-none"
              >
                <option value="">Select a finished-goods item…</option>
                {items.map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.item_code} — {it.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Qty (${selectedItem?.uom || "PCS"}) *`}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  disabled={writeBlocked}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
                />
              </Field>
              <Field label="Reason *">
                <select
                  value={form.reason_code}
                  onChange={(e) => setForm({ ...form, reason_code: e.target.value })}
                  disabled={writeBlocked}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Reference (idempotency key)">
              <input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="e.g. RMA-2024-1023 or REWORK-2024-09-15"
                disabled={writeBlocked}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
              />
            </Field>

            <Field label="Batch no (auto if blank)">
              <input
                value={form.batch_no}
                onChange={(e) => setForm({ ...form, batch_no: e.target.value })}
                placeholder="optional"
                disabled={writeBlocked}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
              />
            </Field>

            <Field label="Stock status">
              <select
                value={form.stock_status}
                onChange={(e) => setForm({ ...form, stock_status: e.target.value })}
                disabled={writeBlocked}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
                ))}
              </select>
            </Field>

            <Field label="Notes">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Why is this FG being posted? (audit trail)"
                disabled={writeBlocked}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
              />
            </Field>

            <button
              type="submit"
              disabled={writeBlocked || manualInward.isPending || !form.item_id || !form.qty}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold uppercase tracking-[0.1em] shadow-md transition",
                writeBlocked || manualInward.isPending || !form.item_id || !form.qty
                  ? "cursor-not-allowed bg-slate-200 text-slate-500"
                  : "bg-gradient-to-br from-cyan-700 via-cyan-600 to-emerald-500 text-white hover:-translate-y-0.5",
              )}
            >
              <FilePlus2 className="h-4 w-4" />
              {manualInward.isPending ? "Posting…" : "Post manual FG"}
            </button>

            {errMessage && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-900">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {typeof errMessage === "string" ? errMessage : JSON.stringify(errMessage)}
              </div>
            )}
            {manualInward.isSuccess && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-900">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />
                FG inward posted. Stock ledger updated, balance reflected immediately.
              </div>
            )}
          </form>
        </Panel>

        <Panel title="Reason guidance" subtitle="When to use which reason — keep the audit trail clean.">
          <ul className="space-y-3">
            <ReasonHelp
              icon={<RotateCcw className="h-4 w-4" />}
              title="REWORK"
              detail="When a batch was reworked and the resulting yield re-enters FG stock. Use the original FG item code; reference the rework slip."
            />
            <ReasonHelp
              icon={<ArrowRight className="h-4 w-4 rotate-180" />}
              title="RETURN"
              detail="Customer return. Reference the customer return memo or RMA number. Stock status usually QC_HOLD until inspection."
            />
            <ReasonHelp
              icon={<FilePlus2 className="h-4 w-4" />}
              title="ADJUSTMENT"
              detail="Positive cycle-count adjustment, scrap reversal, or one-off correction. Always include a note."
            />
            <ReasonHelp
              icon={<PackageCheck className="h-4 w-4" />}
              title="OPENING"
              detail="One-time go-live or year carry-forward FG opening. Prefer the Stock Control 'Post opening from CF' flow for cert-driven openings."
            />
          </ul>
        </Panel>
      </div>

      <Panel title="Recent FG inward (latest 10)" subtitle="Both job-driven and manual FG appear here. Posted manually = movement_metadata.manual=true.">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-[0.16em] text-white">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-3 py-3 text-left">Item</th>
                <th className="px-3 py-3 text-right">Qty</th>
                <th className="px-3 py-3 text-left">Source</th>
                <th className="px-3 py-3 text-left">Ref</th>
                <th className="px-3 py-3 text-left">Stock status</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    No FG inward in the recent ledger window.
                  </td>
                </tr>
              ) : (
                recent.map((row: any) => (
                  <tr key={row.transaction_id || row.id} className="border-t border-slate-100 hover:bg-cyan-50/30">
                    <td className="px-4 py-2.5 text-slate-700">{row.date ? new Date(row.date).toLocaleString("en-GB") : "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className="block font-mono text-[12px] font-bold text-cyan-800">{row.item_code || "—"}</span>
                      <span className="block text-[11px] text-slate-500">{row.item_name || ""}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtKg(row.qty_change || row.quantity)}</td>
                    <td className="px-3 py-2.5">
                      {row.movement_metadata?.manual ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-800">
                          Manual · {row.movement_metadata.reason_code || ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-800">
                          Job close
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-slate-600">{row.external_ref || row.reference || "—"}</td>
                    <td className="px-3 py-2.5 text-[11px] uppercase tracking-[0.1em] text-slate-600">{row.stock_status || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function ReasonHelp({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-800">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-slate-700">{detail}</p>
      </div>
    </li>
  )
}
