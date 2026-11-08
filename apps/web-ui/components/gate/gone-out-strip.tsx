"use client"

/**
 * "Gone out at the gate (n)" on the dispatch register (owner rule, 8 Nov 2026): the watchman only photographs
 * the Tally bill and our challan when a truck leaves. Store (or Dispatch / the plant head) picks the entry here,
 * sees the photos docked beside the form, chooses the challan(s) that went on that truck and types the Tally
 * bill no. of each. Same look and behaviour as "At the gate" on Goods inward.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera, Check, Clock3, Link2, Search, Truck, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { QrScanner } from "@/components/common/qr-scanner"
import { DocumentThumb } from "@/components/documents/DocumentsPanel"
import { Chip } from "@/components/inventory/stock-ui"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/context/AuthContext"
import { dispatchRefFromScan, gateApi, type ChallanToLink, type GateEntry } from "@/lib/api-gate"
import { errorText, timeText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

import { GateDocDock } from "./gate-dock"

export const GONE_OUT_KEY = ["gate", "gone-out"] as const
export const GOODS_OUT_LINK_ROLES = ["Store", "Dispatch", "PlantManager", "Owner", "Admin"]

export function useGoodsOutRoles() {
  const { user, activeRole } = useAuth()
  const roles = [user?.role, activeRole, ...(user?.roles || [])].map((role) => String(role || ""))
  return {
    canLink: roles.some((role) => GOODS_OUT_LINK_ROLES.includes(role)),
    canUnlink: roles.some((role) => ["PlantManager", "Owner", "Admin"].includes(role)),
  }
}

export function useGoneOut(enabled = true) {
  const { activePlant } = useAuth()
  return useQuery({ queryKey: [...GONE_OUT_KEY, activePlant], enabled: enabled && Boolean(activePlant && activePlant !== "ALL"), queryFn: () => gateApi.goneOut(), refetchInterval: 60_000 })
}

const uomWord = (uom: string) => (uom === "PCS" ? "pcs" : String(uom || "").toLowerCase())
const itemsText = (row: ChallanToLink) => row.items.map((item) => `${item.item_name} · ${Number(item.qty).toLocaleString("en-IN")} ${uomWord(item.uom)}`).join(" · ")
const localDay = (value: string | null) => {
  if (!value) return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
}
const dayWords = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""

function EntryCard({ entry, chosen, onClick, testId = "gone-out-entry" }: { entry: GateEntry; chosen?: boolean; onClick: () => void; testId?: string }) {
  const old = (entry.waiting_hours || 0) >= 12
  const thumb = entry.documents.find((document) => document.kind === "TALLY_BILL") || entry.documents[0]
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={chosen}
      className={cn("flex w-64 shrink-0 gap-2.5 rounded-xl border bg-card p-2 text-left transition", chosen ? "border-primary ring-2 ring-primary/20" : old ? "border-signal-amber-line" : "border-border hover:border-foreground/20")}>
      <span className="h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
        {thumb ? <DocumentThumb document={thumb} className="object-top" /> : <span className="flex h-full items-center justify-center"><Camera className="h-4 w-4 text-muted-foreground" /></span>}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-foreground"><Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{entry.vehicle_no || "No vehicle no."}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{entry.entry_no}{entry.gate_name ? ` · ${entry.gate_name}` : ""}</span>
        <span className={cn("mt-0.5 flex items-center gap-1 text-[11.5px]", old ? "font-semibold text-signal-amber-ink" : "text-muted-foreground")}>
          <Clock3 className="h-3 w-3" />Out {timeText(entry.created_at)}{entry.photo_count || entry.document_count ? ` · ${entry.photo_count || entry.document_count} photo${(entry.photo_count || entry.document_count) === 1 ? "" : "s"}` : " · photos uploading"}
        </span>
        {entry.photos_missing?.length && (entry.photo_count || entry.document_count) ? <span className="block text-[11.5px] font-semibold text-signal-amber-ink">No {entry.photos_missing.join(", ").toLowerCase()} photo yet</span> : null}
      </span>
      {chosen ? <X className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-label="Unpick" /> : null}
    </button>
  )
}

export function GoneOutStrip({ picked, onPick }: { picked: GateEntry | null; onPick: (entry: GateEntry | null) => void }) {
  const { canLink } = useGoodsOutRoles()
  const query = useGoneOut(canLink)
  const items = query.data || []
  if (!canLink || query.isError) return null
  if (!items.length && !picked) return null
  return (
    <section className="erp-panel min-w-0 rounded-xl p-3" data-testid="gone-out-strip">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-foreground"><Truck className="h-4 w-4 text-primary" aria-hidden="true" /> Gone out at the gate ({items.length})</p>
        <p className="text-[12px] text-muted-foreground">{picked ? `Linking ${picked.entry_no}. Its photos are beside the form.` : "Trucks the watchman photographed going out. Pick one to link its challan and Tally bill no."}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((entry) => <EntryCard key={entry.id} entry={entry} chosen={picked?.id === entry.id} onClick={() => onPick(picked?.id === entry.id ? null : entry)} />)}
      </div>
    </section>
  )
}

/** ``follows``: no Tally no. of its own yet, so it copies the first challan's until typed over. */
type Pick = { ref: string; tally: string; date: string; prefilled: boolean; follows: boolean; row?: ChallanToLink }

/** Photos docked on the left, challans and Tally numbers on the right (stacked on a phone). */
export function GoneOutLinkPanel({ entry, presetRef, onClose, onLinked }: { entry: GateEntry; presetRef?: string | null; onClose: () => void; onLinked: (entry: GateEntry) => void }) {
  const { activePlant } = useAuth()
  const client = useQueryClient()
  const entryDay = localDay(entry.created_at)
  const [search, setSearch] = useState("")
  const [picks, setPicks] = useState<Pick[]>([])
  const [error, setError] = useState("")
  const [touched, setTouched] = useState(false)
  const challans = useQuery({ queryKey: ["gate", "gone-out-challans", activePlant, entry.id, search.trim()], queryFn: () => gateApi.challansToLink({ entry_id: entry.id, q: search.trim() || undefined }), staleTime: 15_000 })
  const seeded = useRef<string | null>(null)

  const add = (row: ChallanToLink | { dispatch_ref: string; tally_bill_no?: string | null; tally_bill_date?: string | null }) => {
    setPicks((current) => {
      if (current.some((pick) => pick.ref === row.dispatch_ref)) return current
      const own = row.tally_bill_no || ""
      // A truck with two challans: each has its own Tally no.; the second starts from the first one typed.
      const fromFirst = !own && current[0]?.tally ? current[0].tally : ""
      return [...current, { ref: row.dispatch_ref, tally: own || fromFirst, date: row.tally_bill_date || entryDay, prefilled: Boolean(own), follows: !own && current.length > 0, row: "items" in row ? row : undefined }]
    })
    setError("")
  }
  const typeTally = (ref: string, value: string) => setPicks((current) => {
    const first = current[0]?.ref === ref
    return current.map((pick) => pick.ref === ref ? { ...pick, tally: value, prefilled: false, follows: false } : first && pick.follows ? { ...pick, tally: value } : pick)
  })
  const toggle = (row: ChallanToLink) => picks.some((pick) => pick.ref === row.dispatch_ref) ? setPicks(picks.filter((pick) => pick.ref !== row.dispatch_ref)) : add(row)

  // Opened from a dispatch row ("Link gate photo"): that challan starts picked.
  useEffect(() => {
    if (!presetRef || seeded.current === `${entry.id}:${presetRef}`) return
    const row = challans.data?.items.find((item) => item.dispatch_ref === presetRef)
    if (row || challans.isSuccess) {
      seeded.current = `${entry.id}:${presetRef}`
      add(row || { dispatch_ref: presetRef })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRef, entry.id, challans.data, challans.isSuccess])

  const problems = useMemo(() => [
    !picks.length ? "Pick the challan(s) that went out on this truck." : "",
    picks.some((pick) => !pick.tally.trim()) ? "Type the Tally bill no. of each challan." : "",
  ].filter(Boolean), [picks])

  const link = useMutation({
    mutationFn: () => gateApi.linkGoneOut(entry.id, { expected_version: entry.version, links: picks.map((pick) => ({ dispatch_ref: pick.ref, tally_bill_no: pick.tally.trim(), tally_bill_date: pick.date || undefined })) }),
    onSuccess: (saved) => {
      client.invalidateQueries({ queryKey: ["gate"] })
      client.invalidateQueries({ queryKey: ["documents"] })
      onLinked(saved)
    },
    onError: (err) => setError(errorText(err)),
  })

  const rows = challans.data?.items || []
  const sameDay = rows.filter((row) => row.same_day)
  const earlier = rows.filter((row) => !row.same_day)
  const scan = (value: string) => {
    const ref = dispatchRefFromScan(value)
    if (!ref) return
    const row = rows.find((item) => item.dispatch_ref === ref)
    if (row) add(row)
    else setSearch(ref)
  }

  return (
    <section className="grid items-start gap-4 xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]" data-testid="gone-out-link-panel">
      <GateDocDock key={entry.id} entry={entry} onClose={onClose} className="xl:sticky xl:top-4" viewerClassName="h-[min(62vh,560px)]" />
      <div className="erp-panel min-w-0 space-y-4 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground">Link {entry.entry_no} to its challan</h2>
            <p className="text-[13px] text-muted-foreground">Truck {entry.vehicle_no || "(no vehicle no.)"} went out {timeText(entry.created_at)}{entry.created_by ? ` · photographed by ${entry.created_by}` : ""}. Pick every challan on this truck and type its Tally bill no. from the photo.</p>
          </div>
          <QrScanner onScan={scan} label="Scan challan QR" title="Scan our challan" hint="Point the camera at the QR printed on the delivery challan." className="erp-btn-secondary max-sm:h-11" />
        </div>

        <div>
          <label className="mb-1 block text-[12.5px] font-semibold text-muted-foreground" htmlFor="gone-out-search">Challans not yet out of the gate</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input id="gone-out-search" className="h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-[14.5px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search challan no. or item" data-testid="gone-out-search" />
          </div>
          <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1" data-testid="gone-out-challans">
            {challans.isLoading ? <p className="py-2 text-[13px] text-muted-foreground">Loading challans…</p> : null}
            {challans.isError ? <p role="alert" className="py-2 text-[13px] text-signal-rose-ink">Challans could not load: {errorText(challans.error)} <button className="underline" onClick={() => challans.refetch()}>Try again</button></p> : null}
            {challans.isSuccess && !rows.length ? <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">{search.trim() ? "No challan matches. Check the number on the challan photo." : "Every challan of the last 30 days already has its gate photo."}</p> : null}
            {[{ title: `Sealed on ${dayWords(entryDay)} (the day it went out)`, list: sameDay }, { title: "Earlier challans", list: earlier }].map((group) => group.list.length ? (
              <div key={group.title} className="space-y-1.5">
                <p className="pt-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                {group.list.map((row) => {
                  const on = picks.some((pick) => pick.ref === row.dispatch_ref)
                  return (
                    <button key={row.dispatch_ref} type="button" onClick={() => toggle(row)} aria-pressed={on} data-testid="gone-out-challan"
                      className={cn("flex min-h-12 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition", on ? "border-primary bg-primary/5" : "border-border bg-card hover:border-foreground/20")}>
                      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{on ? <Check className="h-3.5 w-3.5" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold text-foreground">Challan {row.dispatch_ref}{row.tally_bill_no ? <Chip tone="blue">Tally {row.tally_bill_no}</Chip> : null}</span>
                        <span className="block text-[12.5px] text-muted-foreground">{itemsText(row)}</span>
                        <span className="block text-[11.5px] text-muted-foreground">Sealed {timeText(row.posted_at)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null)}
          </div>
        </div>

        {picks.length ? (
          <div className="space-y-2" data-testid="gone-out-picks">
            <p className="text-[12.5px] font-semibold text-muted-foreground">Tally bill no. for each challan</p>
            {picks.map((pick, index) => (
              <div key={pick.ref} className="grid gap-2 rounded-lg border border-border bg-[hsl(var(--surface-2))] p-2.5 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem_auto] sm:items-start">
                <div className="min-w-0 self-center"><p className="break-all text-[14px] font-semibold">Challan {pick.ref}</p>{pick.row ? <p className="break-words text-[12px] text-muted-foreground">{itemsText(pick.row)}</p> : null}</div>
                <label className="block text-[12px] font-semibold text-muted-foreground">Tally bill no. *
                  <input className={cn("mt-1 h-11 w-full rounded-lg border bg-card px-3 text-[15px] uppercase text-foreground", touched && !pick.tally.trim() ? "border-signal-rose-line" : "border-input")} value={pick.tally} placeholder="T-1189" aria-label={`Tally bill no. for challan ${pick.ref}`} data-testid={`gone-out-tally-${index}`}
                    onChange={(event) => typeTally(pick.ref, event.target.value.toUpperCase())} />
                  {pick.prefilled ? <span className="mt-0.5 block text-[11px] font-normal">From the dispatch desk</span> : index > 0 && pick.follows ? <span className="mt-0.5 block text-[11px] font-normal">Same as the first; type over if different</span> : null}
                </label>
                <label className="block text-[12px] font-semibold text-muted-foreground">Tally date
                  <input type="date" className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-[14px] text-foreground" value={pick.date} max={localDay(null)} aria-label={`Tally date for challan ${pick.ref}`}
                    onChange={(event) => setPicks(picks.map((row) => row.ref === pick.ref ? { ...row, date: event.target.value } : row))} />
                </label>
                <button type="button" className="h-11 rounded-lg px-3 text-[12.5px] font-semibold text-signal-rose-ink hover:bg-muted sm:mt-[1.15rem]" onClick={() => setPicks(picks.filter((row) => row.ref !== pick.ref))}>Remove</button>
              </div>
            ))}
          </div>
        ) : null}

        {touched && problems.length ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink">{problems.join(" ")}</p> : null}
        {error ? <p role="alert" className="rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-[13px] text-signal-rose-ink">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[12px] text-muted-foreground">Linking puts the photos on each challan. The out time stays the gate time.</p>
          <div className="flex gap-2">
            <button type="button" className="erp-btn-secondary max-sm:h-11" onClick={onClose}>Cancel</button>
            <button type="button" className="erp-btn-primary max-sm:h-11" disabled={link.isPending} data-testid="gone-out-link" onClick={() => { setTouched(true); if (!problems.length) link.mutate() }}>
              <Link2 className="h-4 w-4" />{link.isPending ? "Linking…" : picks.length > 1 ? `Link ${picks.length} challans` : "Link challan"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** "Link gate photo" from a dispatch row: pick which truck's photos belong to this challan. */
export function PickGoneOutDialog({ dispatchRef, onPick, onClose }: { dispatchRef: string | null; onPick: (entry: GateEntry) => void; onClose: () => void }) {
  const query = useGoneOut(Boolean(dispatchRef))
  const items = query.data || []
  return (
    <Dialog open={Boolean(dispatchRef)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Gate photo for challan {dispatchRef}</DialogTitle>
        <DialogDescription>Pick the truck the watchman photographed going out with this challan. You type the Tally bill no. next.</DialogDescription>
        {query.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
        {query.isError ? <p role="alert" className="text-[13px] text-signal-rose-ink">{errorText(query.error)}</p> : null}
        {query.isSuccess && !items.length ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[13.5px] text-muted-foreground">No goods-out photo is waiting. If the truck has left, ask the watchman to take the Tally bill and challan photos (Gate › Goods out).</p> : null}
        <div className="flex flex-wrap gap-2" data-testid="pick-gone-out">
          {items.map((entry) => <EntryCard key={entry.id} entry={entry} onClick={() => onPick(entry)} testId="pick-gone-out-entry" />)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
