"use client"

import { useEffect, useState } from "react"

import { Field, Notice, Sheet, fieldClass } from "@/components/inventory/stock-ui"
import { useCreateLocation, useUpdateLocation } from "@/hooks/use-stock"
import { PURPOSE_WORD, errorText, type LocationRow } from "@/lib/api-stock"

// The production floor is not a place to put stock (it reaches the floor only through the issue desks), so it
// is never offered for a new location; the seeded floor location keeps it, read-only.
const PURPOSES = ["STORAGE", "QC", "SCRAP", "DISPATCH"]
// The RM store (where goods inward puts stock) stays a store rack or QC bay, where counts look (the server refuses the rest).
const RECEIVING_PURPOSES = ["STORAGE", "QC"]

/** New or edit location (Store, plant head, Owner, Admin). The code is printed big on the rack label. */
export function LocationFormSheet({ open, onOpenChange, location, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; location?: LocationRow | null; onSaved?: (row: LocationRow) => void
}) {
  const create = useCreateLocation()
  const update = useUpdateLocation()
  const [form, setForm] = useState({ code: "", name: "", warehouse: "RAW MATERIAL STORE", zone: "", bin: "", purpose: "STORAGE" })
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open) return
    setError("")
    setForm(location
      ? { code: location.code, name: location.name || "", warehouse: location.warehouse || "", zone: location.zone || "", bin: location.bin || "", purpose: String(location.purpose || "STORAGE") }
      : { code: "", name: "", warehouse: "RAW MATERIAL STORE", zone: "", bin: "", purpose: "STORAGE" })
  }, [open, location])
  const busy = create.isPending || update.isPending
  const rmStore = Boolean(location?.is_receiving_default)
  const save = async () => {
    setError("")
    try {
      const body = { code: form.code.trim(), name: form.name.trim() || null, warehouse: form.warehouse.trim() || "RAW MATERIAL STORE", zone: form.zone.trim() || null, bin: form.bin.trim() || null, purpose: form.purpose }
      const row = location ? await update.mutateAsync({ id: location.id, body }) : await create.mutateAsync(body)
      onSaved?.(row)
      onOpenChange(false)
    } catch (cause) {
      setError(errorText(cause))
    }
  }
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value })
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={location ? `Edit ${location.code}` : "New location"} description={location ? "A changed code needs a new label printed." : "A rack, bay or area where stock sits. Print its label after saving."} testId="location-form"
      footer={<><button type="button" className="erp-btn-secondary !h-11" onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className="erp-btn-primary !h-11 min-w-28" disabled={!form.code.trim() || busy} onClick={save} data-testid="location-save">{busy ? "Saving…" : "Save"}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code (on the label)" hint="Short and unique, e.g. RM-A-01"><input className={`${fieldClass} font-mono uppercase`} value={form.code} onChange={set("code")} maxLength={80} autoCapitalize="characters" data-testid="location-code" /></Field>
        <Field label="Name" hint="Plain words, e.g. Paper rack A1"><input className={fieldClass} value={form.name} onChange={set("name")} maxLength={120} data-testid="location-name" /></Field>
        <Field label="What it is">
          <select className={fieldClass} value={form.purpose} onChange={set("purpose")} data-testid="location-purpose">
            {(form.purpose === "WIP" ? [...PURPOSES, "WIP"] : PURPOSES).map((value) => <option key={value} value={value} disabled={value === "WIP" || (rmStore && !RECEIVING_PURPOSES.includes(value))}>{PURPOSE_WORD[value]}{rmStore && !RECEIVING_PURPOSES.includes(value) ? " (not for the RM store)" : ""}</option>)}
          </select>
        </Field>
        <Field label="Store / area"><input className={fieldClass} value={form.warehouse} onChange={set("warehouse")} maxLength={80} /></Field>
        <Field label="Zone (optional)"><input className={fieldClass} value={form.zone} onChange={set("zone")} maxLength={80} placeholder="e.g. Paper" /></Field>
        <Field label="Bin (optional)"><input className={fieldClass} value={form.bin} onChange={set("bin")} maxLength={80} placeholder="e.g. A1" /></Field>
      </div>
      {form.purpose === "WIP" ? <Notice tone="amber" className="mt-3">The production floor is never a target for moves; stock reaches it only through the issue desks.</Notice> : null}
      {rmStore ? <Notice tone="slate" className="mt-3">This is the RM store, where goods inward puts stock. It stays a store rack or QC bay; to make it something else, make another rack the RM store first.</Notice> : null}
      {form.purpose === "DISPATCH" ? <Notice tone="blue" className="mt-3">A dispatch bay holds finished goods only. Material stays on store racks, where counts find it.</Notice> : null}
      {error ? <Notice tone="rose" className="mt-3">{error}</Notice> : null}
    </Sheet>
  )
}
