"use client"

import { useQuery } from "@tanstack/react-query"
import { Camera, Loader2, MapPin, PackageSearch, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ContinuousScanner, cameraScanSupported } from "@/components/inventory/continuous-scanner"
import { Chip, Field, Notice, Segmented, Sheet, fieldClass } from "@/components/inventory/stock-ui"
import { useAuth } from "@/context/AuthContext"
import { useInventoryItems } from "@/hooks/use-inventory"
import { useRaiseCorrection } from "@/hooks/use-stock"
import { dayText, errorCode, errorText, qtyText, signedQty, stockApi, unitWord, type Correction, type LocationBrief, type LotLookup } from "@/lib/api-stock"
import { parseScanCode } from "@/lib/scan-code"
import { cn } from "@/lib/utils"

const REASONS: Array<[string, string]> = [
  ["COUNT_SHORT", "Count short"],
  ["COUNT_EXTRA", "Count extra"],
  ["DAMAGED_IN_STORE", "Damaged in store"],
  ["WRONG_GRN_WEIGHT", "Wrong GRN weight"],
  ["LABEL_LOST_FOUND", "Label lost / found"],
  ["OTHER", "Other"],
]

/**
 * Raise a stock correction (spec 2.4): a lot or reel with the quantity really there (or "not here /
 * damaged"), or stock found without a label (material + quantity, added on QC hold). It waits for the
 * Owner; nothing changes in stock until the Owner approves.
 */
export function CorrectionSheet({ open, onOpenChange, location, initialCode, onDone }: {
  open: boolean; onOpenChange: (open: boolean) => void; location?: LocationBrief | null; initialCode?: string; onDone?: (row: Correction) => void
}) {
  const raise = useRaiseCorrection()
  const itemsQuery = useInventoryItems()
  const [mode, setMode] = useState<"LOT" | "FOUND">("LOT")
  const [code, setCode] = useState(initialCode || "")
  const [qty, setQty] = useState("")
  const [notHere, setNotHere] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [item, setItem] = useState("")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState<Correction | null>(null)
  // The phone camera reads one label and closes (same reader as Move here and the rack count).
  const [canCamera, setCanCamera] = useState(false)
  const [scanning, setScanning] = useState(false)
  useEffect(() => setCanCamera(cameraScanSupported()), [])
  const items: any[] = useMemo(() => (Array.isArray(itemsQuery.data) ? itemsQuery.data : []).filter((row: any) => !["FINISHED_GOOD", "TOOL"].includes(String(row.type))), [itemsQuery.data])
  const chosen = items.find((row) => String(row.id) === item)

  // Look the label up as it is typed (short pause first), so the person sees which lot it is before sending.
  const { activePlant } = useAuth()
  const [typed, setTyped] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setTyped(code.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [code])
  const lookupCode = (() => { const parsed = parseScanCode(typed); return parsed.kind === "REEL" || parsed.kind === "BATCH" ? parsed.raw : parsed.code || typed })()
  const lookup = useQuery({
    queryKey: ["stock", activePlant || "none", "lot-lookup", lookupCode],
    queryFn: () => stockApi.lookupLot(lookupCode),
    enabled: open && mode === "LOT" && lookupCode.length >= 3,
    retry: false,
    staleTime: 15000,
  })
  const lot: LotLookup | undefined = lookupCode.length >= 3 && code.trim() === typed ? lookup.data : undefined
  const blocked = lot ? (lot.returned ? "It was returned to the supplier. It is not in stock." : lot.waiting ? `${lot.waiting.voucher_no} is already waiting for the Owner on this lot. The Owner approves or rejects it first.` : lot.issued_on ? `It was issued to the floor on ${dayText(lot.issued_on)}. Nothing comes back from the floor; if it is in the store, record it in a stock count.` : "") : ""
  const newQty = notHere ? 0 : qty === "" ? null : Number(qty)
  const delta = lot && newQty !== null && Number.isFinite(newQty) ? Math.round((newQty - lot.qty) * 1000) / 1000 : null
  const unit = lot ? unitWord(lot.uom) : ""

  const reset = () => { setCode(initialCode || ""); setTyped(""); setQty(""); setNotHere(false); setReason(""); setNote(""); setItem(""); setError(""); setSaved(null); setScanning(false) }
  const close = (next: boolean) => { if (!next) reset(); onOpenChange(next) }
  // What is still needed, said in the sheet instead of a silently disabled button.
  const missing = mode === "LOT"
    ? [!code.trim() ? "the lot or reel" : "", !notHere && qty === "" ? "the quantity really there" : "", !reason ? "a reason" : "", reason === "OTHER" && note.trim().length < 3 ? "what happened" : ""].filter(Boolean)
    : [!item ? "the material" : "", !(Number(qty) > 0) ? "the quantity found" : "", !reason ? "a reason" : "", reason === "OTHER" && note.trim().length < 3 ? "what happened" : ""].filter(Boolean)
  const noChange = mode === "LOT" && delta !== null && Math.abs(delta) < 0.0005
  const tooHeavy = mode === "LOT" && lot?.entity_type === "REEL" && newQty !== null && lot.inward_qty !== null && newQty > lot.inward_qty + 0.0005
  const ready = !missing.length && !blocked && !noChange && !tooHeavy && (mode !== "LOT" || Boolean(lot))
  const submit = async () => {
    setError("")
    if (reason === "OTHER" && note.trim().length < 3) return setError("Write what happened when the reason is Other.")
    try {
      const parsed = parseScanCode(code)
      const body = mode === "LOT"
        ? { code: parsed.kind === "REEL" || parsed.kind === "BATCH" ? parsed.raw : parsed.code || code.trim(), new_qty: notHere ? undefined : Number(qty), not_here: notHere, reason, note: note.trim() || undefined }
        : { item_id: item, new_qty: Number(qty), location_id: location?.id, reason, note: note.trim() || undefined }
      const row = await raise.mutateAsync(body)
      setSaved(row)
      onDone?.(row)
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  return (
    <Sheet open={open} onOpenChange={close} title="Raise a stock correction" description="It waits for the Owner. Stock changes only when the Owner approves it." testId="correction-sheet"
      footer={saved ? <button type="button" className="erp-btn-primary !h-11" onClick={() => close(false)}>Done</button> : <>
        <button type="button" className="erp-btn-secondary !h-11" onClick={() => close(false)}>Cancel</button>
        <button type="button" className="erp-btn-primary !h-11 min-w-36" disabled={!ready || raise.isPending} onClick={submit} data-testid="correction-submit">{raise.isPending ? "Sending…" : "Send to the Owner"}</button>
      </>}>
      {saved ? (
        <Notice tone="emerald" title={`Sent to the Owner · ${saved.voucher_no}`} testId="correction-saved">
          {saved.lines.map((line) => <span key={line.id} className="block">{line.lot_code || line.item_name}: {signedQty(line.qty_delta, line.uom)}{line.new_lot ? " as a new lot on QC hold" : ""}</span>)}
        </Notice>
      ) : (
        <div className="space-y-3.5">
          <Segmented label="What to correct" value={mode} onChange={(value) => { setMode(value); setError("") }} options={[{ value: "LOT", label: "A lot or reel" }, { value: "FOUND", label: "Found without a label" }]} />
          {mode === "LOT" ? (
            <>
              <Field label="Lot or reel" hint={canCamera ? "Scan its label with the camera or a handheld scanner, or type the AT / lot number." : "Scan its label with a handheld scanner, or type the AT / lot number."}>
                <div className="flex gap-2">
                  <input className={cn(fieldClass, "min-w-0 flex-1")} value={code} onChange={(event) => setCode(event.target.value)} placeholder="AT-261027-026 or IN/26/005-5" autoCapitalize="characters" data-testid="correction-code" />
                  {canCamera ? (
                    <button type="button" className="erp-btn-secondary !h-11 shrink-0" onClick={() => setScanning((value) => !value)} aria-pressed={scanning} data-testid="correction-camera">
                      {scanning ? <X className="h-4 w-4" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}<span className="hidden sm:inline">{scanning ? "Close camera" : "Scan with the camera"}</span><span className="sm:hidden">{scanning ? "Close" : "Camera"}</span>
                    </button>
                  ) : null}
                </div>
              </Field>
              {scanning ? <ContinuousScanner autoStart typeIn={false} onCode={(value) => { setCode(value); setScanning(false) }} testId="correction-scanner" /> : null}
              {lookupCode.length >= 3 ? (
                <div aria-live="polite" data-testid="correction-lot">
                  {lookup.isFetching && !lot ? (
                    <p className="flex items-center gap-2 rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Looking up {lookupCode}…</p>
                  ) : lot ? (
                    <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5">
                      <p className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-[13.5px] font-semibold text-foreground">{lot.code}</span><Chip tone={lot.held ? "amber" : lot.stock_status === "UNRESTRICTED" ? "emerald" : "slate"}>{lot.qc_word}</Chip></p>
                      <p className="mt-0.5 text-[13px] font-medium text-foreground">{lot.item_name} <span className="font-mono text-[12px] text-muted-foreground">{lot.item_code}</span></p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{lot.location_code ? `${lot.location_name || lot.location_code}` : "No location yet"}</span>
                        <span>Book now <b className="tabular-nums text-foreground">{qtyText(lot.qty, lot.uom)}</b></span>
                      </p>
                    </div>
                  ) : lookup.isError ? (
                    <p className="flex items-start gap-2 rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3 py-2.5 text-[13px] text-signal-rose-ink" role="alert"><PackageSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{errorCode(lookup.error) === "UNKNOWN_LABEL" ? `${lookupCode} is not in the system. If the stock is here without a known label, use "Found without a label".` : errorText(lookup.error)}</p>
                  ) : null}
                </div>
              ) : null}
              {blocked ? <Notice tone="amber" testId="correction-blocked">{blocked}</Notice> : null}
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3">
                <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={notHere} onChange={(event) => setNotHere(event.target.checked)} data-testid="correction-not-here" />
                <span className="text-[13.5px] font-medium text-foreground">Not here / damaged (nothing usable left)</span>
              </label>
              {!notHere ? (
                <Field label="Quantity really there" hint={lot?.entity_type === "REEL" && lot.inward_qty ? `It came in at ${qtyText(lot.inward_qty, lot.uom)}; it cannot weigh more.` : "Count or weigh what is there now."}>
                  <div className="relative">
                    <input className={cn(fieldClass, "pr-14 tabular-nums")} inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" data-testid="correction-qty" />
                    {unit ? <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[13px] font-semibold text-muted-foreground">{unit}</span> : null}
                  </div>
                </Field>
              ) : null}
              {lot && delta !== null ? (
                <p className={cn("rounded-xl px-3 py-2 text-[13px] tabular-nums", noChange ? "bg-muted text-muted-foreground" : delta < 0 ? "bg-signal-rose-soft text-signal-rose-ink" : "bg-signal-emerald-soft text-signal-emerald-ink")} data-testid="correction-delta">
                  {noChange ? `The book already says ${qtyText(lot.qty, lot.uom)}: nothing to correct.` : <>Book {qtyText(lot.qty, lot.uom)} → {qtyText(newQty ?? 0, lot.uom)} = <b>{signedQty(delta, lot.uom)}</b></>}
                </p>
              ) : null}
              {tooHeavy ? <Notice tone="rose">A reel cannot weigh more than it came in at ({qtyText(lot?.inward_qty ?? 0, lot?.uom)}).</Notice> : null}
            </>
          ) : (
            <>
              <Field label="Material">
                <select className={fieldClass} value={item} onChange={(event) => setItem(event.target.value)} data-testid="correction-item">
                  <option value="">Choose the material</option>
                  {items.map((row: any) => <option key={row.id} value={row.id}>{row.name} · {row.item_code}</option>)}
                </select>
              </Field>
              <Field label={`Quantity found${chosen ? ` (${unitWord(chosen.uom)})` : ""}`} hint={`Added as a new lot on QC hold${location ? ` at ${location.code}` : " in the RM store"}; incoming QC clears it before use.`}>
                <input className={fieldClass} inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" data-testid="correction-found-qty" />
              </Field>
              {chosen && Number(qty) > 0 ? <p className="text-[12.5px] text-muted-foreground">Will add {qtyText(Number(qty), chosen.uom)} of {chosen.name}.</p> : null}
            </>
          )}
          <Field label="Reason">
            <select className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)} data-testid="correction-reason">
              <option value="" disabled>Choose a reason</option>
              {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label={reason === "OTHER" ? "What happened (needed)" : "Note (optional)"}>
            <textarea className={`${fieldClass} !h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} data-testid="correction-note" />
          </Field>
          {error ? <Notice tone="rose" testId="correction-error">{error}</Notice> : null}
          {missing.length && !error ? <p className="text-[12.5px] text-muted-foreground" data-testid="correction-needed">Still needed: {missing.join(", ")}.</p> : null}
        </div>
      )}
    </Sheet>
  )
}
