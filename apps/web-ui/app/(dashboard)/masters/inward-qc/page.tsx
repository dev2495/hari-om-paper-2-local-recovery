"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CheckCircle2, ChevronRight, ClipboardCheck, Hourglass, Search, ShieldCheck } from "lucide-react"

import { Field, MessageBar, ProcurementShell, SummaryCard, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { useAuth } from "@/context/AuthContext"
import { useAdjustItemQualityTolerances, useApproveItemQualityProfile, useCopyItemQualityTemplate, useInventoryItems } from "@/hooks/use-inventory"
import { cn } from "@/lib/utils"

type Band = { min: string; max: string }

const TYPE_LABELS: Record<string, string> = {
  RAW_PAPER: "Paper",
  PARCHMENT: "Parchment",
  ADHESIVE: "Adhesive",
  PACKAGING: "Packaging",
  PACKING: "Packaging",
  CHEMICAL: "Chemical",
  CONSUMABLE: "Consumable",
}

const NUMERIC_INPUTS = new Set(["number", "numeric", "measured", ""])

function errorText(error: any) {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (detail && typeof detail.message === "string") return detail.message
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg).filter(Boolean).join("; ")
  return error?.message || "The change could not be saved."
}

function profileOf(item: any) {
  return item?.quality_profile && typeof item.quality_profile === "object" ? item.quality_profile : null
}

function parametersOf(profile: any): any[] {
  return (Array.isArray(profile?.parameters) ? profile.parameters : []).filter((row: any) => row && row.applicable !== false)
}

function isNumeric(row: any) {
  return NUMERIC_INPUTS.has(String(row?.input_type ?? "number").trim().toLowerCase())
}

/** Values receipts are checked against right now: the approved revision (or its frozen snapshot). */
function governingParameters(profile: any): any[] {
  const status = String(profile?.status || profile?.setup_status || "").toLowerCase()
  if (status === "approved") return parametersOf(profile)
  return parametersOf(profile?.approved_snapshot)
}

function savedBy(profile: any): string | null {
  const history = Array.isArray(profile?.history) ? profile.history : []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && ["SAVED", "TEMPLATE_COPIED"].includes(entry.action) && entry.revision === profile?.revision) return entry.actor ? String(entry.actor) : null
  }
  return null
}

function stateOf(item: any) {
  const profile = profileOf(item)
  const parameters = parametersOf(profile)
  const status = String(profile?.status || profile?.setup_status || "").toLowerCase()
  if (!parameters.length) return { key: "missing", label: "No checks yet", tone: "amber" as const }
  if (status === "approved") return { key: "approved", label: `Approved · rev ${profile?.revision || 1}`, tone: "emerald" as const }
  if (status === "pending_review" || status === "complete") return { key: "pending", label: `Awaiting approval · rev ${profile?.revision || 1}`, tone: "cyan" as const }
  return { key: "draft", label: `QC draft · rev ${profile?.revision || 1}`, tone: "slate" as const }
}

const bandText = (row: any) => {
  if (!row) return "—"
  const min = row.min ?? row.lower
  const max = row.max ?? row.upper
  if ((min === null || min === undefined || min === "") && (max === null || max === undefined || max === "")) return "—"
  return `${min ?? "—"} to ${max ?? "—"}${row.unit ? ` ${row.unit}` : ""}`
}

export default function InwardQcTolerancesPage() {
  const { user } = useAuth()
  const items = useInventoryItems()
  const adjust = useAdjustItemQualityTolerances()
  const approve = useApproveItemQualityProfile()
  const copyTemplate = useCopyItemQualityTemplate()
  async function startFromChecklist(item: any) {
    try {
      const saved: any = await copyTemplate.mutateAsync({ id: item.id })
      const profile = profileOf(saved?.data || saved) || profileOf(item)
      const initial: Record<string, Band> = {}
      parametersOf(profile).forEach((row: any) => { initial[String(row.code)] = { min: row.min == null ? "" : String(row.min), max: row.max == null ? "" : String(row.max) } })
      setBands(initial)
      setMessage({ tone: "success", text: `${item.item_code}: standard ${TYPE_LABELS[String(item.type)] || item.type} checks added. Enter the min/max below and save; an Owner/Admin then approves.` })
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) })
    }
  }
  const [type, setType] = useState("ALL")
  const [stateFilter, setStateFilter] = useState("ALL")
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState("")
  const [bands, setBands] = useState<Record<string, Band>>({})
  const [note, setNote] = useState("")
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const roles = new Set([user?.role, ...(user?.roles || [])].filter(Boolean) as string[])
  const canApprove = roles.has("Owner") || roles.has("Admin")

  const rows = useMemo(
    () =>
      (Array.isArray(items.data) ? items.data : [])
        .filter((item: any) => item && item.type !== "FINISHED_GOOD" && String(item.active ?? "true") !== "false")
        .sort((a: any, b: any) => String(a.item_code || "").localeCompare(String(b.item_code || ""))),
    [items.data],
  )
  const types = useMemo(() => Array.from(new Set(rows.map((row: any) => String(row.type || "OTHER")))).sort(), [rows])
  const counts = useMemo(() => {
    const result = { missing: 0, pending: 0, approved: 0, draft: 0 }
    rows.forEach((row: any) => { result[stateOf(row).key as keyof typeof result] += 1 })
    return result
  }, [rows])
  const visible = rows.filter((row: any) => {
    if (type !== "ALL" && String(row.type) !== type) return false
    if (stateFilter !== "ALL" && stateOf(row).key !== stateFilter) return false
    const needle = search.trim().toLowerCase()
    return !needle || `${row.item_code} ${row.name}`.toLowerCase().includes(needle)
  })

  function toggle(item: any) {
    setMessage(null)
    setNote("")
    if (openId === item.id) { setOpenId(""); return }
    const initial: Record<string, Band> = {}
    parametersOf(profileOf(item)).forEach((row: any) => {
      initial[String(row.code)] = { min: row.min == null ? "" : String(row.min), max: row.max == null ? "" : String(row.max) }
    })
    setBands(initial)
    setOpenId(item.id)
  }

  async function save(item: any) {
    const profile = profileOf(item)
    const changes = parametersOf(profile)
      .filter((row: any) => isNumeric(row))
      .map((row: any) => ({ row, band: bands[String(row.code)] }))
      .filter(({ row, band }) => band && (String(row.min ?? "") !== band.min || String(row.max ?? "") !== band.max))
      .map(({ row, band }) => ({ code: String(row.code), min: band.min.trim() === "" ? null : Number(band.min), max: band.max.trim() === "" ? null : Number(band.max) }))
    if (!changes.length) { setMessage({ tone: "error", text: "Change at least one min or max first." }); return }
    try {
      await adjust.mutateAsync({ id: item.id, data: { expected_revision: Number(profile?.revision || 1), adjustments: changes, note: note.trim() || undefined } })
      setMessage({ tone: "success", text: `${item.item_code}: new tolerances saved as revision ${Number(profile?.revision || 1) + 1}. ${canApprove ? "Another Owner/Admin approves it below" : "Owner/Admin approves it"}; until then the approved values keep applying to new receipts.` })
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) })
    }
  }

  async function approveRevision(item: any) {
    const profile = profileOf(item)
    try {
      await approve.mutateAsync({ id: item.id, data: { expected_revision: Number(profile?.revision || 1), exemption: false } })
      setMessage({ tone: "success", text: `${item.item_code}: revision ${profile?.revision} approved. New receipts are checked against these tolerances.` })
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) })
    }
  }

  return (
    <ProcurementShell
      eyebrow="Masters"
      title="Inward QC tolerances"
      description="QC decides which checks each material needs. Here, Masters can adjust the min/max of those checks; every change is a new revision that an Owner/Admin approves before it applies to new receipts."
      actions={<Link className={secondaryButton} href="/quality/material-standards">QC material standards <ChevronRight className="h-4 w-4" /></Link>}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Approved" value={counts.approved} detail="Materials whose inward checks are live." icon={ShieldCheck} tone="emerald" />
        <SummaryCard label="Awaiting approval" value={counts.pending} detail="Adjusted tolerances waiting for Owner/Admin." icon={Hourglass} tone="cyan" />
        <SummaryCard label="QC drafting" value={counts.draft} detail="QC is still preparing the checks." icon={ClipboardCheck} tone="slate" />
        <SummaryCard label="No checks yet" value={counts.missing} detail="Start these from the standard checklist below." icon={CheckCircle2} tone="amber" />
      </div>

      <WorkPanel title="Materials" description="Open a material to see QC's parameters, the tolerances in force, and adjust them.">
        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-2.5">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input aria-label="Search materials" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item code or name" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          </label>
          <select aria-label="Material type" className={fieldClass} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="ALL">All material types</option>
            {types.map((value) => <option key={value} value={value}>{TYPE_LABELS[value] || value.replaceAll("_", " ")}</option>)}
          </select>
          <select aria-label="QC state" className={fieldClass} value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
            <option value="ALL">Every state</option>
            <option value="approved">Approved</option>
            <option value="pending">Awaiting approval</option>
            <option value="draft">QC drafting</option>
            <option value="missing">Waiting for QC</option>
          </select>
        </div>

        {items.isLoading ? <p className="text-sm text-muted-foreground">Loading materials…</p> : null}
        {items.isError ? <MessageBar tone="error">Materials could not be loaded. Refresh to retry.</MessageBar> : null}
        {!items.isLoading && !items.isError && !visible.length ? <p className="text-sm text-muted-foreground">No material matches these filters.</p> : null}

        <ul className="divide-y divide-border rounded-xl border border-border">
          {visible.map((item: any) => {
            const profile = profileOf(item)
            const parameters = parametersOf(profile)
            const governing = governingParameters(profile)
            const state = stateOf(item)
            const open = openId === item.id
            const maker = savedBy(profile)
            const isMaker = Boolean(maker && user?.email && maker === user.email)
            return (
              <li key={item.id}>
                <button type="button" onClick={() => toggle(item)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/[.03]">
                  <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{item.item_code} · {item.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground">{TYPE_LABELS[String(item.type)] || String(item.type || "").replaceAll("_", " ")} · {parameters.length ? `${parameters.length} QC check${parameters.length === 1 ? "" : "s"}` : "no QC checks yet"}</span>
                  </span>
                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold",
                    state.tone === "emerald" ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink"
                      : state.tone === "cyan" ? "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink"
                        : state.tone === "amber" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink"
                          : "border-border bg-muted text-muted-foreground")}>{state.label}</span>
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-border bg-[hsl(var(--surface-2))] px-3 py-3">
                    {!parameters.length ? (
                      <div className="space-y-2">
                        <MessageBar tone="info">No inward checks on this material yet. Start from the standard {TYPE_LABELS[String(item.type)] || String(item.type || "").replaceAll("_", " ")} checklist (the checks QC agreed: {String(item.type) === "RAW_PAPER" ? "GSM, width, reel weight, moisture, thickness, BF, polybond, remark" : String(item.type) === "ADHESIVE" ? "viscosity, solid %, pH, remark" : String(item.type) === "PARCHMENT" ? "GSM, colour, weight, remark" : "as per QC template"}), set the min/max here, and an Owner/Admin approves. QC can change the list of checks in <Link className="font-semibold underline" href="/quality/material-standards">Quality → Material standards</Link>.</MessageBar>
                        <button type="button" className={primaryButton} disabled={copyTemplate.isPending} data-testid={`inward-qc-start-${item.item_code}`} onClick={() => void startFromChecklist(item)}>{copyTemplate.isPending ? "Adding…" : "Use the standard checklist"}</button>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto rounded-lg border border-border bg-card">
                          <table className="tube-grid">
                            <thead>
                              <tr><th>Check (set by QC)</th><th>Method</th><th>In force now</th><th className="num">New min</th><th className="num">New max</th></tr>
                            </thead>
                            <tbody>
                              {parameters.map((row: any) => {
                                const code = String(row.code)
                                const live = governing.find((entry: any) => String(entry.code) === code)
                                const band = bands[code] || { min: "", max: "" }
                                const numeric = isNumeric(row)
                                return (
                                  <tr key={code}>
                                    <td><span className="font-medium text-foreground">{row.label || code}</span>{row.unit ? <span className="text-muted-foreground"> · {row.unit}</span> : null}{row.required === false ? <span className="text-muted-foreground"> · optional</span> : null}</td>
                                    <td className="text-muted-foreground">{row.method || (numeric ? "Measured" : "Pass / not OK")}</td>
                                    <td className="tabular-nums">{numeric ? bandText(live) : (live?.options || row.options || []).join(" / ") || "—"}</td>
                                    {numeric ? (
                                      <>
                                        <td className="num"><input type="number" step="any" aria-label={`${row.label || code} new minimum`} value={band.min} onChange={(event) => setBands((current) => ({ ...current, [code]: { ...band, min: event.target.value } }))} className={cn(fieldClass, "!h-8 w-28 text-right")} /></td>
                                        <td className="num"><input type="number" step="any" aria-label={`${row.label || code} new maximum`} value={band.max} onChange={(event) => setBands((current) => ({ ...current, [code]: { ...band, max: event.target.value } }))} className={cn(fieldClass, "!h-8 w-28 text-right")} /></td>
                                      </>
                                    ) : <td colSpan={2} className="text-[12px] text-muted-foreground">No tolerance — QC records the outcome.</td>}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        <Field label="Reason for the change" hint="Shown in the approval history">
                          <input className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Supplier B paper runs 2 GSM heavier; agreed with QC" />
                        </Field>
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" className={primaryButton} disabled={adjust.isPending} onClick={() => void save(item)}>{adjust.isPending ? "Saving…" : "Save new tolerances"}</button>
                          {canApprove && state.key === "pending" ? (
                            <button type="button" className={secondaryButton} disabled={approve.isPending || isMaker} title={isMaker ? "You saved this revision; another Owner/Admin approves it." : undefined} onClick={() => void approveRevision(item)}>
                              <ShieldCheck className="h-4 w-4" />{isMaker ? "Waiting for another approver" : `Approve revision ${profile?.revision}`}
                            </button>
                          ) : null}
                          <span className="text-[12px] text-muted-foreground">Only QC can add or remove checks. A saved change applies to new receipts after approval.</span>
                        </div>
                      </>
                    )}
                    {message ? <MessageBar tone={message.tone}>{message.text}</MessageBar> : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </WorkPanel>
    </ProcurementShell>
  )
}
