"use client"

// Reorder rules (review 3 Nov 2026): the one place where a material's safety, reorder and fill-up levels
// are set. A new rule is saved as waiting; a second person switches it on (the server refuses the same
// person), which also copies the levels onto the material shown in Materials. Plain words only.
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, CircleSlash, Clock3, Plus, Save } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { Chip, EmptyBlock, Field, Notice, Panel, PickPlant, Sheet, Stat, fieldClass } from "@/components/inventory/stock-ui"
import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { RoleGate } from "@/components/workspace/role-gate"
import { useInventoryItems } from "@/hooks/use-inventory"
import { purchaseApi } from "@/lib/api"
import type { StockPolicy } from "@/lib/procurement-types"
import { cn } from "@/lib/utils"

const qty = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })
const unitWord = (uom: string) => ({ KG: "kg", L: "L", PCS: "pcs" } as Record<string, string>)[String(uom || "").toUpperCase()] || "kg"
const TOLD = [{ role: "Owner", word: "Owner" }, { role: "PlantManager", word: "Plant head" }, { role: "Planner", word: "Planner" }, { role: "Store", word: "Store" }, { role: "Admin", word: "Admin" }]
const detailOf = (error: any) => { const detail = error?.response?.data?.detail; return typeof detail === "string" ? detail : detail?.message || error?.message || "" }

export default function ReorderRulesPage() {
  const { activePlant, user } = useAuth()
  const single = Boolean(activePlant && activePlant !== "ALL")
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const canSwitchOn = roles.has("Owner") || roles.has("Admin") || roles.has("PlantManager")
  const me = String(user?.email || "").toLowerCase()
  const client = useQueryClient()
  const itemsQuery = useInventoryItems()
  const items: any[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data : []).filter((row: any) => String(row.type) !== "FINISHED_GOOD" && String(row.active) !== "false"), [itemsQuery.data])
  const query = useQuery({ queryKey: ["purchase-v2", "policies", activePlant], enabled: single, queryFn: () => purchaseApi.getStockPolicies() })
  const policies: StockPolicy[] = query.data?.data?.items || []
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "emerald" | "rose"; text: string } | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["purchase-v2"] })
  const switchOn = useMutation({
    mutationFn: (policy: StockPolicy) => purchaseApi.activateStockPolicy(policy.id, { expected_version: policy.version, reason: "Levels reviewed by a second person" }),
    onSuccess: () => { setNotice({ tone: "emerald", text: "Rule switched on. The material's reorder level now shows it." }); refresh(); client.invalidateQueries({ queryKey: ["inventory-items"] }) },
    onError: (error: any) => setNotice({ tone: "rose", text: detailOf(error) || "Could not switch it on." }),
  })
  const check = useMutation({
    mutationFn: () => purchaseApi.evaluateStockAlerts(),
    onSuccess: ({ data }) => { setNotice({ tone: "emerald", text: `${data.evaluated_policies} materials checked; ${data.changed.length} alerts raised or cleared.` }); refresh() },
    onError: (error: any) => setNotice({ tone: "rose", text: detailOf(error) || "Could not check now." }),
  })

  // From Materials › Change in Reorder rules: open the form on that material.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("item")
    if (wanted) setEditing(wanted)
  }, [])

  const activeByItem = new Map(policies.filter((row) => row.status === "ACTIVE").map((row) => [row.item_id, row]))
  const waiting = policies.filter((row) => row.status === "DRAFT")
  const itemById = new Map(items.map((item) => [String(item.id), item]))
  const withoutRule = items.filter((item) => !activeByItem.has(String(item.id)))

  if (!single) return <PickPlant what="reorder rules" />

  return (
    <RoleGate allow={["PlantManager", "Store"]}>
      <div className="space-y-4" data-testid="reorder-rules-page">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">Reorder rules</h1>
            <p className="mt-1 max-w-3xl text-[13.5px] leading-6 text-muted-foreground">
              When a material counts as low. Below <strong className="font-semibold text-foreground">reorder</strong> it shows in Stock alerts; below <strong className="font-semibold text-foreground">safety</strong> it is critical. A second person switches each new rule on.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="erp-btn-secondary !h-11" disabled={check.isPending || !activeByItem.size} onClick={() => check.mutate()} data-testid="reorder-check-now">
              <BellRing className="h-4 w-4" aria-hidden="true" />{check.isPending ? "Checking…" : "Check all materials now"}
            </button>
            <button type="button" className="erp-btn-primary !h-11" onClick={() => setEditing("")} data-testid="reorder-new">
              <Plus className="h-4 w-4" aria-hidden="true" />New rule
            </button>
          </div>
        </header>

        {notice ? <Notice tone={notice.tone} icon={notice.tone === "rose" ? AlertTriangle : CheckCircle2} mirror>{notice.text}</Notice> : null}

        <section className="grid grid-cols-3 gap-2" aria-label="Reorder rules at a glance">
          <Stat label="Rules on" value={activeByItem.size} detail="materials watched" icon={CheckCircle2} tone="emerald" />
          <Stat label="Waiting" value={waiting.length} detail="for a second person" icon={Clock3} tone={waiting.length ? "amber" : "slate"} />
          <Stat label="Without a rule" value={withoutRule.length} detail="never raise an alert" icon={CircleSlash} tone={withoutRule.length ? "amber" : "slate"} />
        </section>

        {waiting.length ? (
          <Panel title="Waiting for a second person" description={canSwitchOn ? "Check the levels, then switch the rule on. You cannot switch on a rule you saved yourself." : "The plant head, Owner or Admin switches these on."} icon={Clock3}>
            <ul className="divide-y divide-border">
              {waiting.map((policy) => {
                const item = itemById.get(String(policy.item_id))
                const mine = String(policy.created_by || "").toLowerCase() === me
                return (
                  <li key={policy.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <RuleSummary policy={policy} unit={unitWord(item?.uom)} current={activeByItem.get(policy.item_id)} />
                    {canSwitchOn ? (
                      <button type="button" className="erp-btn-primary !h-11 shrink-0" disabled={mine || switchOn.isPending} title={mine ? "Saved by you: another person switches it on" : undefined}
                        onClick={() => switchOn.mutate(policy)} aria-label={`Switch on the rule for ${policy.item_code || ""}`}>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{mine ? "Saved by you" : "Switch on"}
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Materials" description="Every material and its rule. Choose one to set or change its levels." bodyClassName="!p-0">
          {query.isLoading || itemsQuery.isLoading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Loading rules">{[0, 1, 2, 3].map((n) => <div key={n} className="skeleton h-12 rounded-lg" />)}</div>
          ) : !items.length ? (
            <EmptyBlock title="No materials yet" message="Materials come from Masters." className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-[13.5px]">
                <caption className="sr-only">Reorder rule of each material</caption>
                <thead className="bg-muted/60 text-[12px] font-semibold text-muted-foreground">
                  <tr><th scope="col" className="px-4 py-2.5 sm:px-5">Material</th><th scope="col" className="px-3 py-2.5 text-right">Safety</th><th scope="col" className="px-3 py-2.5 text-right">Reorder at</th><th scope="col" className="px-3 py-2.5 text-right">Fill up to</th><th scope="col" className="px-3 py-2.5 text-right">Lead time</th><th scope="col" className="px-3 py-2.5"><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...items].sort((a, b) => Number(activeByItem.has(String(b.id))) - Number(activeByItem.has(String(a.id))) || String(a.item_code).localeCompare(String(b.item_code))).map((item) => {
                    const rule = activeByItem.get(String(item.id))
                    const unit = unitWord(item.uom)
                    return (
                      <tr key={item.id} className="hover:bg-muted/50">
                        <td className="px-4 py-2.5 sm:px-5"><span className="block font-semibold text-foreground">{item.item_code}</span><span className="block text-[12.5px] text-muted-foreground">{item.name}</span></td>
                        {rule ? <>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{qty(rule.safety_stock_kg)} {unit}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{qty(rule.reorder_point_kg)} {unit}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{qty(rule.target_stock_kg)} {unit}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{rule.lead_time_days ? `${qty(rule.lead_time_days)} days` : "—"}</td>
                        </> : <td colSpan={4} className="px-3 py-2.5 text-right"><Chip tone="amber">No rule</Chip></td>}
                        <td className="px-3 py-2.5 text-right">
                          <button type="button" className="erp-btn-secondary !h-11" onClick={() => setEditing(String(item.id))} aria-label={`${rule ? "Change" : "Set"} the rule for ${item.item_code}`}>{rule ? "Change" : "Set rule"}</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <RuleSheet itemId={editing} items={items} current={editing ? activeByItem.get(editing) : undefined}
          onClose={() => setEditing(null)} onSaved={(text) => { setNotice({ tone: "emerald", text }); refresh() }} />
      </div>
    </RoleGate>
  )
}

function RuleSummary({ policy, unit, current }: { policy: StockPolicy; unit: string; current?: StockPolicy }) {
  return (
    <div className="min-w-0">
      <p className="font-semibold text-foreground">{policy.item_code} <span className="font-normal text-muted-foreground">· {policy.item_name}</span></p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        Safety {qty(policy.safety_stock_kg)} · reorder at {qty(policy.reorder_point_kg)} · fill up to {qty(policy.target_stock_kg)} {unit}
        {policy.lead_time_days ? ` · ${qty(policy.lead_time_days)} days lead` : ""}
        {current ? ` (now: reorder at ${qty(current.reorder_point_kg)})` : " (new)"} · saved by {policy.created_by}
      </p>
    </div>
  )
}

function RuleSheet({ itemId, items, current, onClose, onSaved }: { itemId: string | null; items: any[]; current?: StockPolicy; onClose: () => void; onSaved: (text: string) => void }) {
  const open = itemId !== null
  const blank = { item_id: "", safety: "", reorder: "", target: "", lead: "", moq: "", multiple: "", recovery: "", cooldown: "24", told: ["Owner", "Planner"] as string[] }
  const [form, setForm] = useState(blank)
  const [more, setMore] = useState(false)
  const [error, setError] = useState("")
  const why = useReasonChoice("STOCK_POLICY")
  useEffect(() => {
    if (!open) return
    setError(""); setMore(false); why.reset()
    setForm(current ? {
      item_id: itemId || "", safety: String(current.safety_stock_kg || ""), reorder: String(current.reorder_point_kg || ""), target: String(current.target_stock_kg || ""),
      lead: String(current.lead_time_days || ""), moq: String(current.minimum_order_kg || ""), multiple: String(current.order_multiple_kg || ""),
      recovery: String(current.recovery_margin_kg || ""), cooldown: String(current.cooldown_hours || 24), told: current.recipients?.length ? current.recipients : ["Owner", "Planner"],
    } : { ...blank, item_id: itemId || "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId])
  const item = items.find((row) => String(row.id) === form.item_id)
  const unit = unitWord(item?.uom)
  const n = (value: string) => Number(value || 0)
  const problems = [
    !form.item_id && "Choose the material.",
    n(form.reorder) <= 0 && "Enter the reorder level.",
    n(form.safety) > n(form.reorder) && "Safety must not be above the reorder level.",
    form.target && n(form.target) < n(form.reorder) && "Fill up to must be at least the reorder level.",
    !form.told.length && "Choose at least one person to tell.",
  ].filter(Boolean) as string[]
  const save = useMutation({
    mutationFn: () => purchaseApi.createStockPolicy({
      request_id: crypto.randomUUID(), item_id: form.item_id, stock_basis: "FREE_STOCK",
      safety_stock_kg: n(form.safety), reorder_point_kg: n(form.reorder), target_stock_kg: n(form.target) || n(form.reorder),
      recovery_margin_kg: n(form.recovery), lead_time_days: n(form.lead), minimum_order_kg: n(form.moq), order_multiple_kg: n(form.multiple),
      recipients: form.told, cooldown_hours: Math.max(1, n(form.cooldown)), change_reason_code: why.value.code, change_reason_note: why.value.note.trim() || undefined,
    }),
    onSuccess: () => { onSaved(`Rule for ${item?.item_code || "the material"} saved. It works once a second person switches it on.`); onClose() },
    onError: (failure: any) => setError(detailOf(failure) || "Could not save the rule."),
  })
  const num = (key: keyof typeof form, label: string, hint?: string, suffix = unit) => (
    <Field label={label} hint={hint}>
      <span className="relative block">
        <input className={cn(fieldClass, "pr-14 tabular-nums")} inputMode="decimal" value={form[key] as string} onChange={(event) => setForm({ ...form, [key]: event.target.value.replace(/[^\d.]/g, "") })} />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12.5px] text-muted-foreground">{suffix}</span>
      </span>
    </Field>
  )
  return (
    <Sheet open={open} onOpenChange={(value) => { if (!value) onClose() }} wide testId="reorder-rule-sheet"
      title={item ? `Reorder rule · ${item.item_code}` : "New reorder rule"}
      description={current ? "Saving makes a new version; the rule now in use stays until a second person switches the new one on." : "Saved as waiting; a second person switches it on."}
      footer={<>
        <button type="button" className="erp-btn-secondary !h-11" onClick={onClose}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-11" disabled={save.isPending || problems.length > 0} onClick={() => { if (why.validate()) save.mutate() }}>
          <Save className="h-4 w-4" aria-hidden="true" />{save.isPending ? "Saving…" : "Save for a second person"}
        </button>
      </>}>
      <div className="grid gap-3">
        {error ? <Notice tone="rose" icon={AlertTriangle}>{error}</Notice> : null}
        <Field label="Material">
          <select className={fieldClass} value={form.item_id} onChange={(event) => setForm({ ...form, item_id: event.target.value })} disabled={Boolean(itemId)}>
            <option value="">Choose the material</option>
            {items.map((row) => <option key={row.id} value={row.id}>{row.item_code} · {row.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {num("reorder", "Reorder at", "Shows in Stock alerts at or below this")}
          {num("safety", "Safety", "Critical at or below this")}
          {num("target", "Fill up to", "Blank = the reorder level")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {num("lead", "Lead time", "Days from order to arrival", "days")}
          {num("moq", "Minimum order", "Blank = none")}
          {num("multiple", "Order in multiples of", "Blank = any amount")}
        </div>
        <fieldset>
          <legend className="text-[12.5px] font-semibold text-foreground">Who is told</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TOLD.map((person) => {
              const on = form.told.includes(person.role)
              return (
                <label key={person.role} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold", on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={on} onChange={() => setForm({ ...form, told: on ? form.told.filter((role) => role !== person.role) : [...form.told, person.role] })} />{person.word}
                </label>
              )
            })}
          </div>
        </fieldset>
        <button type="button" className="w-fit text-[13px] font-semibold text-primary hover:underline" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Fewer settings" : "More settings"}</button>
        {more ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {num("recovery", "Clear the alert above reorder by", "So it does not flicker on and off")}
            {num("cooldown", "Remind again after", "Hours between reminders", "hours")}
          </div>
        ) : null}
        <ReasonPicker category="STOCK_POLICY" label="Why these levels" value={why.value} onChange={why.setValue} showErrors={why.touched} compact testIdPrefix="stock-policy-reason" />
        {problems.length && (form.item_id || form.reorder) ? <ul className="space-y-1 text-[12.5px] text-signal-rose-ink">{problems.map((text) => <li key={text} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{text}</li>)}</ul> : null}
        {form.reorder ? (
          <p className="rounded-xl border border-border bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
            Low at {qty(form.reorder)} {unit} or less · critical at {qty(form.safety || 0)} {unit} or less · back to normal above {qty(n(form.reorder) + n(form.recovery))} {unit}.
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
