"use client"

import Link from "next/link"
import { FormEvent, useMemo, useState } from "react"
import { ArrowUpRight, Barcode, ClipboardList, PackageCheck, Scissors } from "lucide-react"

import { QrScanner } from "@/components/common/qr-scanner"
import { Field, MessageBar, ProcurementShell, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { IssueDeskTabs } from "@/components/procurement/issue-desk-tabs"
import { RoleGate } from "@/components/workspace/role-gate"
import { useCloseReelIssue, useCreateReelIssue, useRecordSlittingCard, useReelIssues, useReels } from "@/hooks/use-inventory"
import { businessDate } from "@/lib/business-date"
import { cn } from "@/lib/utils"

const ISSUABLE = "UNRESTRICTED,WIP"
const SHIFTS = [{ value: "A", label: "Shift A" }, { value: "B", label: "Shift B" }, { value: "GENERAL", label: "General" }]
const clockShift = () => { const hour = new Date().getHours(); return hour >= 8 && hour < 20 ? "A" : "B" }
const kg = (value: any) => `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
const day = (value?: string) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"
const errorText = (error: any) => {
  const detail = error?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) return detail.map((row: any) => row?.msg || String(row)).join("; ")
  return error?.message || "Action failed"
}
const isCoil = (row: any) => String(row?.physical_form || "REEL").toUpperCase() === "COIL"
// Why an in-stock reel or coil cannot go to the floor yet (client 2026-10-25: "issue in item issue to
// floor" — the list was empty while every reel still waited for incoming QC, with no reason shown).
function waitingReason(row: any): { text: string; href: string; action: string } {
  const status = String(row?.stock_status || "").toUpperCase()
  if (status === "QC_HOLD") return { text: "on QC hold — decide release, concession or return", href: "/quality/results", action: "Holds & inspections" }
  if (status === "BLOCKED" || status === "PENDING") return { text: "waiting for incoming QC", href: "/quality/incoming", action: "Incoming QC" }
  return { text: `not cleared (${status.toLowerCase().replace(/_/g, " ") || "unknown"})`, href: "/quality/results", action: "Holds & inspections" }
}

function parseInventoryQr(raw: string) {
  const parts = raw.trim().split("|")
  if (parts.length >= 5 && parts[0].toUpperCase() === "HARIOM") return { entityType: parts[1].toUpperCase(), entityId: parts[3], code: parts[4] }
  return { entityType: "", entityId: "", code: raw.trim() }
}

const EMPTY_CARD = { coils_made: "", wastage_kg: "", coil_width_mm: "", operator_name: "", notes: "" }

export default function ReelAndCoilIssuePage() {
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null)
  const [scanCode, setScanCode] = useState("")
  const [reelId, setReelId] = useState("")
  const [shift, setShift] = useState(clockShift())
  const [issueDate, setIssueDate] = useState(businessDate())
  const [cardFor, setCardFor] = useState<string | null>(null)
  const [card, setCard] = useState(EMPTY_CARD)
  const [legacyWeights, setLegacyWeights] = useState<Record<string, string>>({})

  const reelsQuery = useReels({ status: "IN_STOCK", stock_status: ISSUABLE, limit: 500 })
  const stockQuery = useReels({ status: "IN_STOCK", limit: 500 })
  const openQuery = useReelIssues({ status: "OPEN", limit: 300 })
  const todayQuery = useReelIssues({ date_from: businessDate(), date_to: businessDate(), limit: 300 })
  const createIssue = useCreateReelIssue()
  const recordCard = useRecordSlittingCard()
  const closeLegacy = useCloseReelIssue()

  const reels: any[] = useMemo(() => (Array.isArray(reelsQuery.data) ? reelsQuery.data : []).filter((row: any) => Number(row.current_weight_kg || 0) > 0), [reelsQuery.data])
  const waiting: any[] = useMemo(() => {
    const issuable = new Set(reels.map((row) => String(row.id)))
    return (Array.isArray(stockQuery.data) ? stockQuery.data : []).filter((row: any) => Number(row.current_weight_kg || 0) > 0 && !issuable.has(String(row.id)) && !ISSUABLE.split(",").includes(String(row.stock_status || "").toUpperCase()))
  }, [stockQuery.data, reels])
  const waitingQc = waiting.filter((row) => ["BLOCKED", "PENDING"].includes(String(row.stock_status || "").toUpperCase())).length
  const waitingHold = waiting.length - waitingQc
  const openIssues: any[] = Array.isArray(openQuery.data) ? openQuery.data : []
  const cardsDue = openIssues.filter((row) => row.issue_mode === "FLOOR" && row.issue_section === "SLITTING_SECTION")
  const legacyOpen = openIssues.filter((row) => row.issue_mode !== "FLOOR")
  const today: any[] = Array.isArray(todayQuery.data) ? todayQuery.data : []
  const selected = reels.find((row) => String(row.id) === reelId)
  const busy = createIssue.isPending || recordCard.isPending || closeLegacy.isPending

  function resolveScan(value: string = scanCode) {
    const parsed = parseInventoryQr(value)
    if (parsed.entityType && parsed.entityType !== "REEL") return setNotice({ tone: "error", text: "Scan a reel or coil QR label." })
    const id = parsed.entityId.trim().toUpperCase()
    const code = parsed.code.trim().toUpperCase()
    const matched = reels.find((row) => String(row.id).toUpperCase() === id || String(row.reel_code || "").toUpperCase() === code)
    if (!matched) {
      const held = waiting.find((row) => String(row.id).toUpperCase() === id || String(row.reel_code || "").toUpperCase() === code)
      if (held) return setNotice({ tone: "error", text: `${held.reel_code} cannot go to the floor yet: it is ${waitingReason(held).text}. Clear it in ${waitingReason(held).action}.` })
      return setNotice({ tone: "error", text: `${code || "That label"} is not in stock.` })
    }
    setReelId(String(matched.id)); setScanCode("")
    setNotice({ tone: "info", text: `${matched.reel_code} selected · ${isCoil(matched) ? "coil → winders" : "reel → slitter"}.` })
  }

  async function issue(event: FormEvent) {
    event.preventDefault()
    if (!selected) return setNotice({ tone: "error", text: "Scan or choose a reel or coil." })
    try {
      await createIssue.mutateAsync({ reel_id: selected.id, shift, issue_date: issueDate, issued_weight_kg: Number(selected.current_weight_kg) })
      setNotice({ tone: "success", text: isCoil(selected)
        ? `${selected.reel_code} (${kg(selected.current_weight_kg)}) issued to the winders for shift ${shift}.`
        : `${selected.reel_code} (${kg(selected.current_weight_kg)}) issued to the slitter for shift ${shift}. Write its slitting card when it is slit.` })
      setReelId("")
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  async function saveCard(row: any) {
    const coils = Number(card.coils_made)
    const wastage = Number(card.wastage_kg)
    if (!Number.isInteger(coils) || coils <= 0) return setNotice({ tone: "error", text: "Enter how many coils came out of the reel." })
    if (card.wastage_kg === "" || !(wastage >= 0) || wastage > Number(row.issued_weight_kg)) return setNotice({ tone: "error", text: `Wastage must be between 0 and ${kg(row.issued_weight_kg)}.` })
    try {
      await recordCard.mutateAsync({ id: row.id, data: {
        coils_made: coils, wastage_kg: wastage, coil_width_mm: card.coil_width_mm ? Number(card.coil_width_mm) : undefined,
        operator_name: card.operator_name.trim() || undefined, notes: card.notes.trim() || undefined, shift: row.shift,
      } })
      setNotice({ tone: "success", text: `Slitting card saved for ${row.reel_code}: ${coils} coils, ${kg(wastage)} wastage.` })
      setCardFor(null); setCard(EMPTY_CARD)
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  async function closeOld(row: any, override?: number) {
    const consumed = override ?? Number(legacyWeights[row.id] ?? row.issued_weight_kg)
    if (!Number.isFinite(consumed) || consumed < 0 || consumed > Number(row.issued_weight_kg)) return setNotice({ tone: "error", text: `Consumed must be between 0 and ${kg(row.issued_weight_kg)}.` })
    try {
      await closeLegacy.mutateAsync({ id: row.id, data: { consumed_weight_kg: consumed } })
      setNotice({ tone: "success", text: `${row.reel_code} older issue closed.` })
    } catch (error) { setNotice({ tone: "error", text: errorText(error) }) }
  }

  return (
    <RoleGate allow={["Store", "PlantManager", "RMIssue"]}>
      <ProcurementShell eyebrow="Stores" title="Reel & coil issue to floor" description="Issue is done every day to the floor, by shift — never to a machine. A reel always goes to the slitter and gets a slitting card (coils made + wastage); a coil goes straight to the winders. What goes to the floor is consumed in full; nothing comes back." actions={<IssueDeskTabs />}>
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        {reelsQuery.isError || openQuery.isError ? <MessageBar tone="error">Stock could not load. Refresh before issuing.</MessageBar> : null}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <WorkPanel title="Issue to floor" description="Only in-stock, QC-cleared reels and coils are listed. The whole reel goes out.">
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2"><Barcode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Scan reel or coil label" className={fieldClass} value={scanCode} placeholder="Scan QR or type AT number" onChange={(e) => setScanCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolveScan() } }} /></label>
              <button type="button" className={secondaryButton} onClick={() => resolveScan()}><PackageCheck className="h-4 w-4" />Select</button>
              <QrScanner onScan={(value) => { setScanCode(value); resolveScan(value) }} label="Camera" title="Scan reel label" hint="Point the camera at the reel or coil QR label." />
            </div>
            <form onSubmit={issue} className="mt-4 space-y-3">
              <Field label="Reel / coil">
                <select className={fieldClass} value={reelId} onChange={(e) => setReelId(e.target.value)}>
                  <option value="">{reels.length ? "Select from stock" : "Nothing cleared for issue yet"}</option>
                  {reels.map((row) => <option key={row.id} value={row.id}>{row.reel_code} · {isCoil(row) ? "Coil" : "Reel"}{row.width_mm ? ` ${row.width_mm} mm` : ""}{row.gsm ? ` · ${row.gsm} GSM` : ""} · {kg(row.current_weight_kg)}</option>)}
                  {waiting.length ? (
                    <optgroup label="Not cleared yet — cannot be issued">
                      {waiting.map((row) => <option key={row.id} value="" disabled>{row.reel_code} · {isCoil(row) ? "Coil" : "Reel"} · {kg(row.current_weight_kg)} — {waitingReason(row).text}</option>)}
                    </optgroup>
                  ) : null}
                </select>
              </Field>
              {waiting.length ? (
                <p className={cn("rounded-lg border px-3 py-2 text-[12.5px]", reels.length ? "border-border bg-muted/60 text-muted-foreground" : "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink")} data-testid="floor-issue-waiting">
                  {reels.length ? "Also in stock but not cleared: " : "Nothing is cleared for the floor yet. In stock but waiting: "}
                  {waitingQc ? <><strong>{waitingQc}</strong> for incoming QC (<Link className="font-semibold underline" href="/quality/incoming">Incoming QC</Link>)</> : null}
                  {waitingQc && waitingHold ? " · " : ""}
                  {waitingHold ? <><strong>{waitingHold}</strong> on QC hold (<Link className="font-semibold underline" href="/quality/results">Holds & inspections</Link>)</> : null}
                  . A reel or coil can go to the floor once QC passes it.
                </p>
              ) : !reels.length && !reelsQuery.isLoading ? (
                <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground">No reels or coils are in stock. Receive them in Goods inward first.</p>
              ) : null}
              {selected ? (
                <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px]", isCoil(selected) ? "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" : "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink")}>
                  {isCoil(selected) ? <PackageCheck className="h-4 w-4" aria-hidden="true" /> : <Scissors className="h-4 w-4" aria-hidden="true" />}
                  <span className="font-semibold">{isCoil(selected) ? "Coil → production winders" : "Reel → slitter (slitting card follows)"}</span>
                  <span>{kg(selected.current_weight_kg)} · whole {isCoil(selected) ? "coil" : "reel"}</span>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Shift">
                  <div role="radiogroup" aria-label="Shift" className="flex gap-1 rounded-lg bg-muted p-1">
                    {SHIFTS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={shift === item.value} onClick={() => setShift(item.value)} className={cn("min-h-8 flex-1 rounded-md text-[13px] font-semibold", shift === item.value ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{item.label}</button>)}
                  </div>
                </Field>
                <Field label="Issue date"><input className={fieldClass} type="date" value={issueDate} max={businessDate()} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              </div>
              <button type="submit" className={cn(primaryButton, "w-full justify-center")} disabled={busy || !selected}><PackageCheck className="h-4 w-4" />{selected ? `Issue ${isCoil(selected) ? "coil" : "reel"} to floor · ${kg(selected.current_weight_kg)}` : "Issue to floor"}</button>
            </form>
          </WorkPanel>

          <WorkPanel title={`Slitting cards to write · ${cardsDue.length}`} description="Every reel sent to the slitter: write how many coils came out and the wastage, like a job card. These feed the slitting reports.">
            {cardsDue.length ? (
              <ul className="space-y-2" data-testid="slitting-cards-due">
                {cardsDue.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-semibold">{row.reel_code} <span className="font-normal text-muted-foreground">· {row.paper_code || "paper"}{row.gsm ? ` · ${row.gsm} GSM` : ""}</span></p>
                        <p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · issued {day(row.issue_date)} · shift {row.shift}</p>
                      </div>
                      <button type="button" className={cardFor === row.id ? secondaryButton : primaryButton} onClick={() => { setCardFor(cardFor === row.id ? null : row.id); setCard(EMPTY_CARD) }}>{cardFor === row.id ? "Cancel" : <><ClipboardList className="h-4 w-4" />Write card</>}</button>
                    </div>
                    {cardFor === row.id ? (
                      <div className="grid gap-3 border-t border-border bg-muted/30 p-3 sm:grid-cols-2" data-testid="slitting-card-form">
                        <Field label="Coils made"><input autoFocus className={fieldClass} type="number" min="1" step="1" inputMode="numeric" value={card.coils_made} onChange={(e) => setCard({ ...card, coils_made: e.target.value })} /></Field>
                        <Field label="Wastage kg" hint={`of ${kg(row.issued_weight_kg)}`}><input className={fieldClass} type="number" min="0" step="0.001" inputMode="decimal" value={card.wastage_kg} onChange={(e) => setCard({ ...card, wastage_kg: e.target.value })} /></Field>
                        <Field label="Coil width mm" hint="optional"><input className={fieldClass} type="number" min="0" step="0.1" value={card.coil_width_mm} onChange={(e) => setCard({ ...card, coil_width_mm: e.target.value })} /></Field>
                        <Field label="Slitter operator" hint="optional"><input className={fieldClass} value={card.operator_name} onChange={(e) => setCard({ ...card, operator_name: e.target.value })} /></Field>
                        <div className="sm:col-span-2"><Field label="Notes" hint="optional"><input className={fieldClass} value={card.notes} onChange={(e) => setCard({ ...card, notes: e.target.value })} /></Field></div>
                        {card.coils_made && card.wastage_kg !== "" ? <p className="text-[12.5px] text-muted-foreground sm:col-span-2">Good paper {kg(Number(row.issued_weight_kg) - Number(card.wastage_kg))} · wastage {((100 * Number(card.wastage_kg)) / Number(row.issued_weight_kg || 1)).toFixed(1)}% · about {kg((Number(row.issued_weight_kg) - Number(card.wastage_kg)) / Math.max(1, Number(card.coils_made)))} per coil</p> : null}
                        <button type="button" className={cn(primaryButton, "sm:col-span-2 justify-center")} disabled={busy} onClick={() => void saveCard(row)}>Save slitting card</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No reel is waiting for its slitting card.</p>}
            <Link href="/reports/slitting" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">Slitting report<ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </WorkPanel>
        </div>

        <WorkPanel title={`Issued today · ${today.length}`} description="Reels and coils that went to the floor on today's business date.">
          {today.length ? (
            <div className="overflow-x-auto">
              <table className="tube-grid w-full min-w-[640px]">
                <thead><tr><th>Reel / coil</th><th>Went to</th><th>Shift</th><th className="text-right">Weight</th><th>Slitting card</th></tr></thead>
                <tbody>
                  {today.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">{row.reel_code}<span className="block text-[12px] font-normal text-muted-foreground">{row.paper_code || ""}</span></td>
                      <td>{row.issue_section === "SLITTING_SECTION" ? "Slitter" : "Winders"}</td>
                      <td>{row.shift}</td>
                      <td className="text-right tabular-nums">{kg(row.issued_weight_kg)}</td>
                      <td>{row.issue_section !== "SLITTING_SECTION" ? <span className="text-muted-foreground">—</span> : row.slitting_card ? `${row.slitting_card.coils_made} coils · ${kg(row.slitting_card.wastage_kg)} wastage` : <span className="font-semibold text-signal-amber-ink">To write</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">Nothing issued yet today.</p>}
        </WorkPanel>

        {legacyOpen.length ? (
          <WorkPanel title={`Older open issues · ${legacyOpen.length}`} description="Issued before floor issue started, to a machine with a return expected. Close each once with what was used; from now on nothing comes back.">
            <ul className="divide-y divide-border">
              {legacyOpen.map((row) => (
                <li key={row.id} className="flex flex-wrap items-end justify-between gap-3 py-2.5">
                  <div><p className="font-medium">{row.reel_code}</p><p className="text-[12.5px] text-muted-foreground">{kg(row.issued_weight_kg)} · {row.issue_section === "SLITTING_SECTION" ? "slitting" : "winder"} · {day(row.issue_date)} · shift {row.shift}</p></div>
                  {row.issue_section === "SLITTING_SECTION" ? (
                    <button type="button" className={secondaryButton} disabled={busy} onClick={() => void closeOld(row, 0)} title="The reel comes back into stock unchanged; issue it to the floor again from above">Back to stock, then issue to floor</button>
                  ) : (
                    <div className="flex items-end gap-2">
                      <Field label="Used kg"><input className={cn(fieldClass, "w-28")} type="number" min="0" step="0.001" value={legacyWeights[row.id] ?? String(row.issued_weight_kg)} onChange={(e) => setLegacyWeights({ ...legacyWeights, [row.id]: e.target.value })} /></Field>
                      <button type="button" className={secondaryButton} disabled={busy} onClick={() => void closeOld(row)}>Close</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </WorkPanel>
        ) : null}
      </ProcurementShell>
    </RoleGate>
  )
}
