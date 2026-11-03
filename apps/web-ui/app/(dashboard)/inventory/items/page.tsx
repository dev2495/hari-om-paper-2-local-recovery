"use client"

// Materials (review 3 Nov 2026): the list of every material the stores keep, with what is in stock and its
// reorder levels. It never changes stock. Papers, parchment, adhesive and packing come from Masters (they
// sync in on their own); only tools and other materials are added here. Reorder levels are set in one place,
// Stock alerts › Reorder rules (two-person check), and shown here read-only.
import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, CircleSlash, Layers, PackagePlus, Search } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { Chip, EmptyBlock, Field, Notice, Panel, PickPlant, Segmented, Sheet, Stat, fieldClass } from "@/components/inventory/stock-ui"
import { useCreateItem, useDeleteItem, useInventoryBalances, useInventoryItems } from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

const qty = (value: unknown) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })

const TYPE_WORD: Record<string, string> = {
  RAW_PAPER: "Paper", PARCHMENT: "Parchment", ADHESIVE: "Adhesive", PACKAGING: "Packing", TOOL: "Tool", OTHER: "Other", FINISHED_GOOD: "Finished good",
}
/** Where each synced material type is added (they reach this list on their own). */
const MASTER_FOR: Record<string, { label: string; href: string }> = {
  RAW_PAPER: { label: "Masters › Papers", href: "/masters/papers" },
  PARCHMENT: { label: "Masters › Parchments", href: "/masters/parchments" },
  ADHESIVE: { label: "Masters › Adhesives", href: "/masters/adhesives" },
  PACKAGING: { label: "Masters › Packaging", href: "/masters/packaging" },
}
const FILTERS = ["ALL", "RAW_PAPER", "PARCHMENT", "ADHESIVE", "PACKAGING", "OTHERS"] as const
type Filter = (typeof FILTERS)[number]
const FILTER_WORD: Record<Filter, string> = { ALL: "All", RAW_PAPER: "Paper", PARCHMENT: "Parchment", ADHESIVE: "Adhesive", PACKAGING: "Packing", OTHERS: "Tools & other" }
const unitWord = (uom: string) => ({ KG: "kg", L: "L", PCS: "pcs" } as Record<string, string>)[String(uom || "").toUpperCase()] || String(uom || "").toLowerCase()

/** A QC band in words: "5 to 9 %", "at least 24", "up to 9 %", or "no limit set". */
const bandText = (min: unknown, max: unknown, unit?: string) => {
  const has = (value: unknown) => value !== null && value !== undefined && value !== ""
  const tail = unit ? ` ${unit}` : ""
  if (has(min) && has(max)) return `${min} to ${max}${tail}`
  if (has(min)) return `at least ${min}${tail}`
  if (has(max)) return `up to ${max}${tail}`
  return "no limit set"
}

type Level = "LOW" | "OK" | "NONE"

export default function MaterialsPage() {
  const { activePlant, user } = useAuth()
  const single = Boolean(activePlant && activePlant !== "ALL")
  const roles = useMemo(() => new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[]), [user?.role, user?.roles])
  const isAdmin = roles.has("Owner") || roles.has("Admin")
  const canSwitchOff = isAdmin || roles.has("Store")
  const { data: items = [], isLoading } = useInventoryItems()
  const { data: balances = [] } = useInventoryBalances()
  const [filter, setFilter] = useState<Filter>("ALL")
  const [search, setSearch] = useState("")
  const [inStockOnly, setInStockOnly] = useState(false)
  const [showOff, setShowOff] = useState(false)
  const [openId, setOpenId] = useState("")
  const [adding, setAdding] = useState(false)

  const stockOf = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of Array.isArray(balances) ? balances : []) map.set(String(row.item_id), Number(row.balance ?? row.available_qty ?? 0))
    return map
  }, [balances])

  const rows = useMemo(() => (Array.isArray(items) ? items : []).filter((item: any) => String(item.type) !== "FINISHED_GOOD").map((item: any) => {
    const stock = stockOf.get(String(item.id)) || 0
    const reorder = Number(item.reorder_level || 0)
    const level: Level = reorder > 0 ? (stock <= reorder ? "LOW" : "OK") : "NONE"
    return { ...item, stock, reorder, safety: Number(item.safety_stock || 0), lead: Number(item.lead_time_days || 0), level, off: String(item.active) === "false" }
  }), [items, stockOf])

  const active = rows.filter((row) => !row.off)
  const visible = rows.filter((row) => {
    if (row.off && !showOff) return false
    if (filter === "OTHERS" ? !["TOOL", "OTHER"].includes(String(row.type)) : filter !== "ALL" && String(row.type) !== filter) return false
    if (inStockOnly && row.stock <= 0) return false
    const words = search.trim().toLowerCase()
    return !words || `${row.item_code} ${row.name}`.toLowerCase().includes(words)
  }).sort((a, b) => Number(a.off) - Number(b.off) || b.stock - a.stock || String(a.item_code).localeCompare(String(b.item_code)))
  const open = rows.find((row) => row.id === openId)
  const count = (filterValue: Filter) => active.filter((row) => filterValue === "ALL" || (filterValue === "OTHERS" ? ["TOOL", "OTHER"].includes(String(row.type)) : String(row.type) === filterValue)).length

  if (!single) return <PickPlant what="the materials list" />

  return (
    <div className="space-y-4" data-testid="inventory-items-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px]">Materials</h1>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-6 text-muted-foreground">
            Every material the stores keep, what is in stock now and its reorder level. Stock changes only through goods inward, issues and stock counts.
          </p>
        </div>
        {isAdmin ? (
          <button type="button" className="erp-btn-secondary !h-11" onClick={() => setAdding(true)} data-testid="materials-add">
            <PackagePlus className="h-4 w-4" aria-hidden="true" />Add tool or other material
          </button>
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Materials at a glance">
        <Stat label="Materials" value={active.length} detail={`${active.filter((row) => row.type === "RAW_PAPER").length} papers`} icon={Boxes} />
        <Stat label="In stock" value={active.filter((row) => row.stock > 0).length} detail="materials with stock now" icon={CheckCircle2} tone="emerald" />
        <Stat label="Low" value={active.filter((row) => row.level === "LOW").length} detail="at or below reorder level" icon={AlertTriangle} tone={active.some((row) => row.level === "LOW") ? "rose" : "slate"} />
        <Stat label="No reorder level" value={active.filter((row) => row.level === "NONE").length} detail={<Link href="/inventory/stock-alert-policies" className="font-semibold text-primary hover:underline">Set in Reorder rules</Link>} icon={CircleSlash} tone="amber" />
      </section>

      <Panel bodyClassName="!p-0">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <Segmented<Filter> label="Material type" value={filter} onChange={setFilter}
            options={FILTERS.map((value) => ({ value, label: <>{FILTER_WORD[value]}<span className="tabular-nums text-muted-foreground">{count(value)}</span></> }))} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block min-w-0 flex-1 sm:w-64 sm:flex-none">
              <span className="sr-only">Find a material</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input className={cn(fieldClass, "pl-9")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or name" data-testid="materials-search" />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-[13px] font-semibold text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)} />In stock only
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-[13px] font-semibold text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={showOff} onChange={(event) => setShowOff(event.target.checked)} />Switched off
            </label>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading materials">{[0, 1, 2, 3, 4].map((n) => <div key={n} className="skeleton h-12 rounded-lg" />)}</div>
        ) : !visible.length ? (
          <EmptyBlock icon={Boxes} title="No materials match" message="Change the type, the search words or the in-stock filter." className="m-4" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[13.5px]">
              <caption className="sr-only">Materials with stock and reorder level. Choose a material to see details.</caption>
              <thead className="bg-muted/60 text-[12px] font-semibold text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 sm:px-5">Material</th>
                  <th scope="col" className="px-3 py-2.5">Type</th>
                  <th scope="col" className="px-3 py-2.5 text-right">In stock</th>
                  <th scope="col" className="px-3 py-2.5">Reorder level</th>
                  <th scope="col" className="px-3 py-2.5"><span className="sr-only">Status</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => {
                  const unit = unitWord(row.uom)
                  return (
                    <tr key={row.id} className={cn("transition-colors hover:bg-muted/50", row.off && "opacity-60")}>
                      <td className="px-4 py-2.5 sm:px-5">
                        <button type="button" onClick={() => setOpenId(row.id)} className="group min-h-11 text-left" aria-label={`${row.item_code} ${row.name}: details`} data-testid="materials-row">
                          <span className="block font-semibold text-foreground group-hover:text-primary group-hover:underline">{row.item_code}</span>
                          <span className="block text-[12.5px] text-muted-foreground">{row.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {TYPE_WORD[row.type] || row.type}
                        {row.tracking_mode === "REEL" ? <span className="ml-1 inline-flex items-center gap-0.5 text-[12px]"><Layers className="h-3 w-3" aria-hidden="true" />reels</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{row.stock > 0 ? `${qty(row.stock)} ${unit}` : <span className="font-normal text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
                        {row.level === "NONE" ? "Not set" : <>Reorder at <span className="font-semibold tabular-nums text-foreground">{qty(row.reorder)} {unit}</span>{row.safety ? <> · safety {qty(row.safety)}</> : null}{row.lead ? <> · {qty(row.lead)} days</> : null}</>}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.off ? <Chip>Switched off</Chip> : row.level === "LOW" ? <Chip tone="rose" icon={AlertTriangle}>Low</Chip> : row.level === "OK" ? <Chip tone="emerald" icon={CheckCircle2}>OK</Chip> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
          Showing {visible.length} of {showOff ? rows.length : active.length}. Papers, parchment, adhesive and packing are added in Masters and appear here on their own.
        </p>
      </Panel>

      <MaterialSheet row={open} canSwitchOff={canSwitchOff} onClose={() => setOpenId("")} />
      <AddMaterialSheet open={adding} onOpenChange={setAdding} />
    </div>
  )
}

function MaterialSheet({ row, canSwitchOff, onClose }: { row: any; canSwitchOff: boolean; onClose: () => void }) {
  const switchOff = useDeleteItem()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")
  if (!row) return <Sheet open={false} onOpenChange={() => undefined} title="Material"><span /></Sheet>
  const unit = unitWord(row.uom)
  const master = MASTER_FOR[String(row.type)]
  const profile = row.quality_profile
  const close = () => { setConfirming(false); setError(""); onClose() }
  return (
    <Sheet open onOpenChange={(open) => { if (!open) close() }} title={`${row.item_code} · ${row.name}`} description={`${TYPE_WORD[row.type] || row.type}, kept as ${row.tracking_mode === "REEL" ? "reels / coils (weighed in kg)" : `a bulk quantity in ${unit}`}.`} testId="material-sheet" wide
      footer={<>
        {canSwitchOff && !row.off ? (confirming
          ? <><span className="mr-auto self-center text-[12.5px] text-muted-foreground">Switch off {row.item_code}? It can no longer be received or issued. History stays.</span>
              <button type="button" className="erp-btn-secondary !h-11" onClick={() => setConfirming(false)}>Keep it</button>
              <button type="button" className="erp-btn-secondary !h-11 !border-signal-rose-line !bg-signal-rose-soft !text-signal-rose-ink" disabled={switchOff.isPending} onClick={async () => {
                setError("")
                try { await switchOff.mutateAsync(row.id); close() } catch (failure: any) { setError(failure?.response?.data?.detail || failure?.message || "Could not switch it off.") }
              }}>{switchOff.isPending ? "Switching off…" : "Switch off"}</button></>
          : <button type="button" className="erp-btn-secondary !h-11 mr-auto" disabled={row.stock > 0} title={row.stock > 0 ? "Only a material with no stock can be switched off" : undefined} onClick={() => setConfirming(true)}>Switch off…</button>) : null}
        <button type="button" className="erp-btn-primary !h-11" onClick={close}>Done</button>
      </>}>
      <div className="space-y-4">
        {error ? <Notice tone="rose" icon={AlertTriangle}>{error}</Notice> : null}
        {canSwitchOff && !row.off && row.stock > 0 ? <p className="text-[12.5px] text-muted-foreground">It has stock, so it cannot be switched off. Issue or correct the stock first.</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="In stock" value={`${qty(row.stock)} ${unit}`} icon={Boxes} tone={row.stock > 0 ? "emerald" : "slate"} />
          <Stat label="Reorder at" value={row.level === "NONE" ? "Not set" : `${qty(row.reorder)} ${unit}`} detail={row.safety ? `Safety ${qty(row.safety)} ${unit}` : undefined} icon={AlertTriangle} tone={row.level === "LOW" ? "rose" : "slate"} />
          <Stat label="Lead time" value={row.lead ? `${qty(row.lead)} days` : "Not set"} />
        </div>
        <Notice tone="blue" title="Reorder level" action={<Link href={`/inventory/stock-alert-policies?item=${encodeURIComponent(row.id)}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">Change in Reorder rules <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>
          Set in Stock alerts › Reorder rules, where a second person switches each change on. It is shown here only.
        </Notice>
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">Incoming QC</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {profile ? `Revision ${profile.revision || 1}, ${String(profile.status || profile.setup_status || "draft").replace(/_/g, " ").toLowerCase()}` : "No incoming QC checks yet."}
          </p>
          {Array.isArray(profile?.parameters) && profile.parameters.length ? (
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-[13px]">
              {profile.parameters.map((check: any, index: number) => (
                <li key={`${check.code}-${index}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span className="font-medium text-foreground">{check.label || check.code}{check.non_waivable ? <Chip tone="rose" className="ml-2">critical</Chip> : null}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {check.applicable === false ? "not checked" : Array.isArray(check.options) && check.options.length ? check.options.join(" / ") : bandText(check.min, check.max, check.unit)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/quality/material-standards" className="mt-2 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary hover:underline">Open material standards <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
        {master ? <p className="text-[12.5px] text-muted-foreground">Name, code and specification are kept in <Link href={master.href} className="font-semibold text-primary hover:underline">{master.label}</Link>.</p> : null}
      </div>
    </Sheet>
  )
}

function AddMaterialSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateItem()
  const blank = { item_code: "", name: "", type: "TOOL", tracking_mode: "BULK", uom: "PCS" }
  const [form, setForm] = useState(blank)
  const [error, setError] = useState("")
  const ready = form.item_code.trim() && form.name.trim()
  const close = () => { setForm(blank); setError(""); onOpenChange(false) }
  return (
    <Sheet open={open} onOpenChange={(value) => { if (!value) close() }} title="Add a tool or other material" testId="materials-add-sheet"
      description="Papers, parchment, adhesive and packing are added in Masters and appear in Materials on their own."
      footer={<>
        <button type="button" className="erp-btn-secondary !h-11" onClick={close}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-11" disabled={!ready || create.isPending} onClick={async () => {
          setError("")
          try {
            await create.mutateAsync({ ...form, item_code: form.item_code.trim().toUpperCase(), name: form.name.trim(), reorder_level: 0, safety_stock: 0, lead_time_days: 0 })
            close()
          } catch (failure: any) { setError(failure?.response?.data?.detail || failure?.message || "Could not add it.") }
        }}>{create.isPending ? "Adding…" : "Add material"}</button>
      </>}>
      <div className="grid gap-3">
        {error ? <Notice tone="rose" icon={AlertTriangle}>{String(error)}</Notice> : null}
        <Field label="Code" hint="Short and unique, e.g. TOOL-CUTTER-12"><input className={fieldClass} value={form.item_code} maxLength={50} onChange={(event) => setForm({ ...form, item_code: event.target.value })} /></Field>
        <Field label="Name"><input className={fieldClass} value={form.name} maxLength={200} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className={fieldClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="TOOL">Tool</option><option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Counted in">
            <select className={fieldClass} value={form.uom} onChange={(event) => setForm({ ...form, uom: event.target.value })}>
              <option value="PCS">Pieces</option><option value="KG">Kilograms</option>
            </select>
          </Field>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Missing a paper, parchment, adhesive or box? Add it in {Object.values(MASTER_FOR).map((master, index, list) => <span key={master.href}><Link href={master.href} className="font-semibold text-primary hover:underline">{master.label.replace("Masters › ", "")}</Link>{index < list.length - 1 ? ", " : ""}</span>)} (Masters).</p>
      </div>
    </Sheet>
  )
}
