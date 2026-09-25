"use client"

import { QrScanner } from "@/components/common/qr-scanner"

import dayjs from "dayjs"
import { Barcode, PackageCheck, Plus, Scissors, Trash2, Undo2 } from "lucide-react"
import type { KeyboardEvent } from "react"
import { FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { LabelPrintControls } from "@/components/procurement/label-print-controls"
import { LotLabels } from "@/components/procurement/lot-labels"
import { RoleGate } from "@/components/workspace/role-gate"
import { useCloseReelIssue, useCreateReelIssue, useReelIssues, useReels, useSlitCoil } from "@/hooks/use-inventory"
import { useMachines } from "@/hooks/use-production"
import { businessDate } from "@/lib/business-date"

type Form = "REEL" | "COIL"
type SlitRow = { key: string; weight_kg: string; width_mm: string }

const ISSUABLE = "UNRESTRICTED,WIP"
const SHIFTS = ["A", "B", "C", "GENERAL", "DAY", "NIGHT"]
const newSlitRow = (previous?: SlitRow): SlitRow => ({ key: crypto.randomUUID(), weight_kg: "", width_mm: previous?.width_mm || "" })
const kg = (value: any) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  return typeof detail === "string" ? detail : error?.message || "Action failed"
}

function parseInventoryQr(raw: string) {
  const parts = raw.trim().split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") {
    return { entityType: parts[1].toUpperCase(), entityId: parts[3], code: parts[4] }
  }
  return { entityType: "", entityId: "", code: raw.trim() }
}

function formOf(row: any): Form {
  return String(row?.physical_form || "REEL").toUpperCase() === "COIL" ? "COIL" : "REEL"
}

export default function ReelIssuePage() {
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const [scanCode, setScanCode] = useState("")
  const [form, setForm] = useState({ reel_id: "", machine_id: "", shift: "A", issue_date: businessDate(), issued_weight_kg: "" })
  const [returnWeights, setReturnWeights] = useState<Record<string, string>>({})
  const [slitIssueId, setSlitIssueId] = useState("")
  const [slitRows, setSlitRows] = useState<SlitRow[]>([newSlitRow()])
  const [trimKg, setTrimKg] = useState("")
  const [slitResult, setSlitResult] = useState<any>(null)
  const pendingFocus = useRef<string | null>(null)

  const reelsQuery = useReels({ status: "IN_STOCK", stock_status: ISSUABLE, limit: 500 })
  const machinesQuery = useMachines()
  const issuesQuery = useReelIssues({ status: "OPEN", limit: 200 })
  const createIssue = useCreateReelIssue()
  const closeIssue = useCloseReelIssue()
  const slitCoil = useSlitCoil()

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(`slit-weight-${pendingFocus.current}`)?.focus()
      pendingFocus.current = null
    }
  }, [slitRows])

  const reels: any[] = useMemo(
    () => (Array.isArray(reelsQuery.data) ? reelsQuery.data : []).filter((row: any) => Number(row.current_weight_kg || 0) > 0),
    [reelsQuery.data],
  )
  const machines: any[] = useMemo(() => (Array.isArray(machinesQuery.data) ? machinesQuery.data : []), [machinesQuery.data])
  const machineLabel = useMemo(() => new Map(machines.map((row: any) => [String(row.id), `${row.code || ""} ${row.name ? `· ${row.name}` : ""}`.trim()])), [machines])
  const openIssues: any[] = Array.isArray(issuesQuery.data) ? issuesQuery.data : []
  const winderIssues = openIssues.filter((row) => row.issue_section !== "SLITTING_SECTION")
  const slittingIssues = openIssues.filter((row) => row.issue_section === "SLITTING_SECTION")

  const selected = reels.find((row) => String(row.id) === form.reel_id)
  const selectedForm = selected ? formOf(selected) : null
  const section = selectedForm === "COIL" ? "SLITTING_SECTION" : "WINDER_SECTION"
  const department = section === "SLITTING_SECTION" ? "SLITTING" : "WINDER"
  const sectionMachines = machines.filter(
    (row: any) => String(row.department || "").toUpperCase() === department && String(row.status || "UP").toUpperCase() === "UP",
  )

  const slitIssue = slittingIssues.find((row) => row.id === slitIssueId)
  const slitTotal = slitRows.reduce((sum, row) => sum + Number(row.weight_kg || 0), 0)
  const trim = Number(trimKg || 0)
  const slitConsumed = slitTotal + trim
  const slitIssued = Number(slitIssue?.issued_weight_kg || 0)
  const slitBalance = slitIssued - slitConsumed

  function chooseReel(reelId: string) {
    const reel = reels.find((row) => String(row.id) === reelId)
    setForm((current) => ({
      ...current,
      reel_id: reelId,
      machine_id: "",
      issued_weight_kg: reel ? String(Number(reel.current_weight_kg || 0)) : "",
    }))
  }

  function resolveScan(value: string = scanCode) {
    const parsed = parseInventoryQr(value)
    if (parsed.entityType && parsed.entityType !== "REEL") {
      setNotice({ tone: "error", text: "Scan a reel or coil QR label." })
      return
    }
    const id = parsed.entityId.trim().toUpperCase()
    const code = parsed.code.trim().toUpperCase()
    const matched = reels.find((row) => String(row.id).toUpperCase() === id || String(row.reel_code || "").toUpperCase() === code)
    if (!matched) {
      setNotice({ tone: "error", text: `${code || "That label"} is not in stock and QC-cleared for issue.` })
      return
    }
    chooseReel(String(matched.id))
    setScanCode("")
    setNotice({ tone: "info", text: `${matched.reel_code} selected · ${formOf(matched) === "COIL" ? "coil → slitting" : "reel → winder"}.` })
  }

  async function submitIssue(event: FormEvent) {
    event.preventDefault()
    if (!selected) return setNotice({ tone: "error", text: "Select a reel or coil." })
    if (section === "WINDER_SECTION" && !form.machine_id) return setNotice({ tone: "error", text: "Select the winder this reel is going to." })
    const weight = Number(form.issued_weight_kg)
    if (!(weight > 0) || weight > Number(selected.current_weight_kg || 0) + 1e-9) {
      return setNotice({ tone: "error", text: `Issue between 0 and ${kg(selected.current_weight_kg)}.` })
    }
    try {
      await createIssue.mutateAsync({
        reel_id: selected.id,
        issue_section: section,
        machine_id: form.machine_id || undefined,
        shift: form.shift,
        issue_date: form.issue_date,
        issued_weight_kg: weight,
      })
      setNotice({
        tone: "success",
        text: `${selected.reel_code} issued to ${section === "SLITTING_SECTION" ? "slitting" : machineLabel.get(form.machine_id) || "winder"} · ${kg(weight)}.`,
      })
      setForm((current) => ({ ...current, reel_id: "", machine_id: "", issued_weight_kg: "" }))
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    }
  }

  async function returnBalance(issue: any, consumedOverride?: number) {
    const consumed = consumedOverride ?? Number(returnWeights[issue.id] || "")
    if (!Number.isFinite(consumed) || consumed < 0 || consumed > Number(issue.issued_weight_kg || 0)) {
      return setNotice({ tone: "error", text: `Consumed must be between 0 and ${kg(issue.issued_weight_kg)}.` })
    }
    try {
      await closeIssue.mutateAsync({ id: issue.id, data: { consumed_weight_kg: consumed } })
      const back = Number(issue.issued_weight_kg || 0) - consumed
      setNotice({ tone: "success", text: `${issue.reel_code || "Reel"} closed · ${kg(consumed)} consumed · ${kg(back)} back in store.` })
      setReturnWeights((current) => ({ ...current, [issue.id]: "" }))
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    }
  }

  function slitKeys(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== "Enter" || event.shiftKey || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("input"))
    const index = fields.indexOf(event.target)
    if (index < fields.length - 1) fields[index + 1].focus()
    else addSlitRow()
  }

  function addSlitRow() {
    const row = newSlitRow(slitRows.at(-1))
    pendingFocus.current = row.key
    setSlitRows((current) => [...current, row])
  }

  async function submitSlit() {
    if (!slitIssue) return setNotice({ tone: "error", text: "Choose the coil on the slitter." })
    const rows = slitRows.filter((row) => row.weight_kg !== "")
    if (!rows.length || rows.some((row) => !(Number(row.weight_kg) > 0))) {
      return setNotice({ tone: "error", text: "Enter the weighed kg of every slit reel." })
    }
    if (trim < 0 || slitBalance < -1e-6) {
      return setNotice({ tone: "error", text: `Slit reels + trim (${kg(slitConsumed)}) exceed the ${kg(slitIssued)} issued.` })
    }
    try {
      const { data } = await slitCoil.mutateAsync({
        parent_reel_id: slitIssue.reel_id,
        children: rows.map((row) => ({ weight_kg: Number(row.weight_kg), width_mm: row.width_mm ? Number(row.width_mm) : undefined })),
        trim_wastage_kg: trim,
        slit_date: businessDate(),
      })
      setSlitResult(data)
      setSlitIssueId("")
      setSlitRows([newSlitRow()])
      setTrimKg("")
      setNotice({
        tone: "success",
        text: `${data.children.length} slit reels created from ${data.parent_reel_code}. ${kg(data.remaining_weight_kg)} stays on the coil.`,
      })
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error) })
    }
  }

  const slitLots = (slitResult?.children || []).map((child: any) => ({
    id: child.id,
    at_no: child.at_no,
    source_reel_no: child.label?.source_reel_no || `Slit from ${slitResult.parent_reel_code}`,
    physical_form: "REEL",
    net_weight_kg: child.weight_kg,
    width_mm: child.width_mm,
    label: child.label,
  }))
  const busy = createIssue.isPending || closeIssue.isPending || slitCoil.isPending

  return (
    <RoleGate allow={["Store", "PlantManager"]}>
      <ProcurementShell
        eyebrow="Stores / production issue"
        title="Issue paper to production"
        description="Reels go straight to a winder. Coils go to slitting first; the slit reels then get their own labels and are issued to the winder."
      >
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        {reelsQuery.isError || issuesQuery.isError ? <MessageBar tone="error">Stock could not load. Refresh before issuing.</MessageBar> : null}

        <WorkPanel title="Issue a reel or coil" description="Only in-stock, QC-cleared material is listed. The form on the label decides where it can go.">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Scan reel or coil label"
                className={fieldClass}
                value={scanCode}
                placeholder="Scan QR or type AT number"
                onChange={(event) => setScanCode(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); resolveScan() } }}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className={secondaryButton} onClick={() => resolveScan()}><PackageCheck className="h-4 w-4" /> Select</button>
              <QrScanner onScan={(value) => { setScanCode(value); resolveScan(value) }} label="Camera" title="Scan reel label" hint="Point the camera at the reel or coil QR label." />
            </div>
          </div>
          <form onSubmit={submitIssue} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Reel / coil">
              <select className={fieldClass} value={form.reel_id} onChange={(event) => chooseReel(event.target.value)}>
                <option value="">Select from stock</option>
                {reels.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.reel_code} · {formOf(row) === "COIL" ? "Coil" : "Reel"}{row.width_mm ? ` ${row.width_mm} mm` : ""} · {kg(row.current_weight_kg)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Goes to" hint={selectedForm === "COIL" ? "coils are slit first" : undefined}>
              <input className={fieldClass} readOnly value={!selected ? "" : section === "SLITTING_SECTION" ? "Slitting section" : "Winder section"} />
            </Field>
            <Field label={section === "SLITTING_SECTION" ? "Slitter · optional" : "Winder"}>
              <select className={fieldClass} value={form.machine_id} disabled={!selected} onChange={(event) => setForm({ ...form, machine_id: event.target.value })}>
                <option value="">{section === "SLITTING_SECTION" ? "Any slitter" : "Select winder"}</option>
                {sectionMachines.map((row: any) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select className={fieldClass} value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })}>
                {SHIFTS.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
              </select>
            </Field>
            <Field label="Issue kg" hint={selected ? `of ${kg(selected.current_weight_kg)}` : undefined}>
              <input className={fieldClass} type="number" min="0.001" step="0.001" value={form.issued_weight_kg} onChange={(event) => setForm({ ...form, issued_weight_kg: event.target.value })} />
            </Field>
            <div className="md:col-span-2 xl:col-span-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Issue date {dayjs(form.issue_date).format("DD MMM YYYY")} · each issue is logged as a scan on the reel&apos;s history.</p>
              <button type="submit" className={primaryButton} disabled={busy || !selected}>
                <PackageCheck className="h-4 w-4" /> {section === "SLITTING_SECTION" ? "Issue coil to slitting" : "Issue reel to winder"}
              </button>
            </div>
          </form>
        </WorkPanel>

        <WorkPanel title="Coils on the slitter" description="Weigh each slit reel as it comes off. Every slit reel gets its own AT number and label; unslit balance stays on the coil.">
          {slittingIssues.length === 0 ? <p className="text-sm text-muted-foreground">No coil is issued to slitting.</p> : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Coil">
                  <select className={fieldClass} value={slitIssueId} onChange={(event) => { setSlitIssueId(event.target.value); setSlitResult(null) }}>
                    <option value="">Select coil</option>
                    {slittingIssues.map((row) => <option key={row.id} value={row.id}>{row.reel_code || row.reel_id.slice(0, 8)} · {kg(row.issued_weight_kg)} issued · shift {row.shift}</option>)}
                  </select>
                </Field>
                <Field label="Trim / wastage kg">
                  <input className={fieldClass} type="number" min="0" step="0.001" value={trimKg} disabled={!slitIssue} onChange={(event) => setTrimKg(event.target.value)} />
                </Field>
                <div className="self-end rounded-lg bg-muted px-3 py-2 text-sm tabular-nums">
                  <p><strong>{slitRows.filter((row) => row.weight_kg).length}</strong> slit reels · {kg(slitTotal)} + trim {kg(trim)}</p>
                  <p className={slitBalance < -1e-6 ? "font-semibold text-signal-rose-ink" : "text-muted-foreground"}>
                    {slitIssue ? (slitBalance < -1e-6 ? `Over by ${kg(-slitBalance)}` : `${kg(slitBalance)} returns to the coil`) : "Select a coil"}
                  </p>
                </div>
              </div>
              {slitIssue ? (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-2 py-3">#</th><th className="px-2 py-3">Slit reel kg</th><th className="px-2 py-3">Width mm</th><th /></tr></thead>
                      <tbody onKeyDown={slitKeys}>
                        {slitRows.map((row, index) => (
                          <tr key={row.key} className="border-t border-border">
                            <td className="px-2 tabular-nums text-muted-foreground">{index + 1}</td>
                            <td className="p-1"><input id={`slit-weight-${row.key}`} aria-label={`Slit reel ${index + 1} kg`} className={fieldClass} type="number" min="0.001" step="0.001" value={row.weight_kg} onChange={(event) => setSlitRows((rows) => rows.map((candidate) => candidate.key === row.key ? { ...candidate, weight_kg: event.target.value } : candidate))} /></td>
                            <td className="p-1"><input aria-label={`Slit reel ${index + 1} width`} className={fieldClass} type="number" min="1" step="0.1" value={row.width_mm} onChange={(event) => setSlitRows((rows) => rows.map((candidate) => candidate.key === row.key ? { ...candidate, width_mm: event.target.value } : candidate))} /></td>
                            <td className="p-1"><button type="button" aria-label={`Remove slit reel ${index + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-signal-rose-soft disabled:opacity-30" disabled={slitRows.length === 1} onClick={() => setSlitRows((rows) => rows.filter((candidate) => candidate.key !== row.key))}><Trash2 className="h-4 w-4" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Enter moves to the next field; Enter on the last width adds the next slit reel.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={secondaryButton} onClick={addSlitRow}><Plus className="h-4 w-4" /> Add slit reel</button>
                      <button type="button" className={secondaryButton} disabled={busy} onClick={() => returnBalance(slitIssue, 0)}><Undo2 className="h-4 w-4" /> Return coil unslit</button>
                      <button type="button" className={primaryButton} disabled={busy || slitBalance < -1e-6 || slitTotal <= 0} onClick={submitSlit}><Scissors className="h-4 w-4" /> Save slit reels</button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
          {slitLots.length ? (
            <div className="mt-5 space-y-3">
              <LabelPrintControls lots={slitLots} />
              <LotLabels lots={slitLots} />
            </div>
          ) : null}
        </WorkPanel>

        <WorkPanel title="Reels on winders" description="When the reel comes off, enter the kg consumed. The balance goes back to store on the same AT number and label.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2">Reel</th><th className="py-2">Winder</th><th className="py-2">Shift · date</th><th className="py-2">Issued</th><th className="py-2">Close</th>
              </tr></thead>
              <tbody>
                {winderIssues.map((issue) => {
                  const consumed = returnWeights[issue.id]
                  const back = consumed === undefined || consumed === "" ? null : Number(issue.issued_weight_kg || 0) - Number(consumed)
                  return (
                    <tr key={issue.id} className="border-b border-border align-top">
                      <td className="py-2 font-mono text-xs">{issue.reel_code || issue.reel_id.slice(0, 8)}</td>
                      <td className="py-2">{issue.machine_id ? machineLabel.get(String(issue.machine_id)) || String(issue.machine_id).slice(0, 8) : <span className="text-signal-amber-ink">Not recorded</span>}</td>
                      <td className="py-2">{issue.shift} · {dayjs(issue.issue_date).format("DD MMM")}</td>
                      <td className="py-2 tabular-nums">{kg(issue.issued_weight_kg)}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input aria-label={`Consumed kg for ${issue.reel_code || issue.id}`} className={`${fieldClass} w-32`} type="number" min="0" step="0.001" placeholder="Consumed kg" value={consumed || ""} onChange={(event) => setReturnWeights((current) => ({ ...current, [issue.id]: event.target.value }))} />
                          <button type="button" className={secondaryButton} disabled={busy || consumed === undefined || consumed === ""} onClick={() => returnBalance(issue)}>Close</button>
                          {back !== null ? <span className={`text-xs ${back < 0 ? "text-signal-rose-ink" : "text-muted-foreground"}`}>{back < 0 ? "More than issued" : `${kg(back)} back to store`}</span> : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {winderIssues.length === 0 ? <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No reels open on winders.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </WorkPanel>
      </ProcurementShell>
    </RoleGate>
  )
}
