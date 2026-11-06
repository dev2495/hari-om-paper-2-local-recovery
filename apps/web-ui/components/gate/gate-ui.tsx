"use client"

/**
 * Gate building blocks (6 Nov 2026): camera pages, the visitor form (gate QR page and the watchman's
 * walk-in form share it), host search, chips. Phone first: 44 px targets, Enter moves to the next field.
 */
import { Camera, Check, ImagePlus, Loader2, Search, Trash2, UserRound, Users, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { isMobile, mobileDigits, type Host, type HostList, type VisitForm } from "@/lib/api-gate"
import { cn } from "@/lib/utils"

export const input = "h-12 w-full rounded-xl border border-input bg-card px-3.5 text-[15px] text-foreground shadow-[var(--shadow-xs)] outline-none transition-[border-color,box-shadow] focus:border-ring/70 focus:ring-[3px] focus:ring-ring/15 disabled:bg-muted disabled:text-muted-foreground"
export const bigPrimary = "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground shadow-[var(--shadow-sm)] transition active:scale-[.98] disabled:opacity-50"
export const bigSecondary = "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[14.5px] font-semibold text-foreground shadow-[var(--shadow-xs)] transition hover:bg-muted active:scale-[.98] disabled:opacity-50"
export const smallButton = "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-semibold transition active:scale-[.98] disabled:opacity-50 sm:h-9"

/** Master codes in a friendly order: the main one first, "Other" / general last, the rest by label. */
export function orderCodes<T extends { code: string; label?: string }>(rows: T[] | undefined, first?: string): T[] {
  const rank = (row: T) => (row.code === first ? 0 : /(^|-)(OTHERS?|MISC)$/.test(row.code) ? 2 : 1)
  return [...(rows || [])].sort((a, b) => rank(a) - rank(b) || String(a.label || a.code).localeCompare(String(b.label || b.code)))
}

/** Enter moves to the next field of the form (spec: floor and gate forms). */
export function nextOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.shiftKey || !(event.target instanceof HTMLInputElement)) return
  const form = (event.target as HTMLElement).closest("form, [data-enter-scope]")
  if (!form) return
  const fields = Array.from(form.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled])"))
  const index = fields.indexOf(event.target)
  if (index >= 0 && index < fields.length - 1) {
    event.preventDefault()
    fields[index + 1].focus()
  }
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 flex items-end justify-between gap-2 text-[13px] font-semibold text-foreground/85">{children}{hint ? <span className="text-[12px] font-normal text-muted-foreground">{hint}</span> : null}</label>
}

export function Pill({ active, onClick, children, testId, tone = "primary" }: { active: boolean; onClick: () => void; children: ReactNode; testId?: string; tone?: "primary" | "amber" }) {
  return (
    <button type="button" data-testid={testId} aria-pressed={active} onClick={onClick}
      className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition active:scale-[.97]",
        active ? (tone === "amber" ? "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" : "border-primary bg-primary text-primary-foreground")
          : "border-border bg-card text-foreground hover:bg-muted")}>
      {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}{children}
    </button>
  )
}

export function CountTile({ label, value, tone = "slate", onClick }: { label: string; value: number | string; tone?: "slate" | "amber" | "rose" | "emerald" | "cyan"; onClick?: () => void }) {
  const tones = {
    slate: "border-border bg-card", amber: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink",
    rose: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink", emerald: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink",
    cyan: "border-signal-cyan-line bg-signal-cyan-soft text-signal-cyan-ink",
  }
  const Tag = onClick ? "button" : "div"
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("min-w-0 rounded-xl border px-3 py-2 text-left", tones[tone], onClick && "transition active:scale-[.98]")}>
      <p className="truncate text-[11.5px] font-semibold opacity-80">{label}</p>
      <p className="text-[22px] font-semibold leading-7 tabular-nums">{value}</p>
    </Tag>
  )
}

// ── Camera pages ───────────────────────────────────────────────────────────────────────────────
export type PhotoGroup = { key: string; files: File[] }
export const newGroup = (): PhotoGroup => ({ key: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()), files: [] })

function Thumb({ file, onRemove, label }: { file: File; onRemove: () => void; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith("image/")) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return (
    <figure className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={label} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[11px] font-semibold text-muted-foreground">PDF</span>}
      <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10.5px] font-semibold text-white">{label}</figcaption>
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-3.5 w-3.5" /></button>
    </figure>
  )
}

/** One paper thing photographed page by page: Page 1 ✓, + Add page. */
export function PhotoPages({ title, files, onChange, required, testId, accept = "image/*" }: {
  title: string; files: File[]; onChange: (files: File[]) => void; required?: boolean; testId?: string; accept?: string
}) {
  const camera = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-xl border border-border bg-card p-3" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-semibold text-foreground">{title}{required ? <span className="text-signal-rose-ink"> *</span> : null}</p>
        <span className={cn("text-[12px] font-semibold", files.length ? "text-signal-emerald-ink" : "text-muted-foreground")}>{files.length ? `${files.length} page${files.length === 1 ? "" : "s"} ✓` : required ? "Photo needed" : "No photo yet"}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {files.map((file, index) => <Thumb key={`${file.name}-${index}-${file.size}`} file={file} label={`Page ${index + 1}`} onRemove={() => onChange(files.filter((_, i) => i !== index))} />)}
        <button type="button" onClick={() => camera.current?.click()} data-testid={testId ? `${testId}-add` : undefined}
          className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-[12px] font-semibold text-primary">
          {files.length ? <ImagePlus className="h-6 w-6" aria-hidden="true" /> : <Camera className="h-6 w-6" aria-hidden="true" />}
          {files.length ? "Add page" : "Take photo"}
        </button>
      </div>
      <input ref={camera} type="file" accept={accept} capture="environment" className="hidden" multiple={false}
        onChange={(event) => { const picked = Array.from(event.target.files || []); if (picked.length) onChange([...files, ...picked]); event.target.value = "" }} />
    </div>
  )
}

// ── Host search ────────────────────────────────────────────────────────────────────────────────
export type HostChoice = { kind: "user"; host: Host } | { kind: "department"; key: string; label: string } | null

export function HostPicker({ value, onChange, search, testId = "host" }: {
  value: HostChoice; onChange: (value: HostChoice) => void; search: (q: string) => Promise<HostList>; testId?: string
}) {
  const [q, setQ] = useState("")
  const [list, setList] = useState<HostList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const searchRef = useRef(search)
  searchRef.current = search
  useEffect(() => {
    let alive = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchRef.current(q.trim()).then((data) => { if (alive) { setList(data); setError("") } })
        .catch((err) => { if (alive) setError(err?.message || "The list could not load. Try again.") })
        .finally(() => { if (alive) setLoading(false) })
    }, q ? 250 : 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [q])
  if (value) {
    const words = value.kind === "user" ? `${value.host.name}${value.host.department ? ` · ${value.host.department}` : ""}` : `${value.label} (department)`
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-2.5" data-testid={`${testId}-chosen`}>
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">{value.kind === "user" ? <UserRound className="h-4 w-4 shrink-0 text-primary" /> : <Users className="h-4 w-4 shrink-0 text-primary" />}<span className="truncate">{words}</span></span>
        <button type="button" className={cn(smallButton, "text-primary hover:bg-primary/10")} onClick={() => onChange(null)}>Change</button>
      </div>
    )
  }
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input className={cn(input, "pl-10")} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Type a name or a department" aria-label="Whom to meet" data-testid={`${testId}-search`} />
      </div>
      {error ? <p role="alert" className="text-[13px] text-signal-rose-ink">{error}</p> : null}
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-1">
        {loading && !list ? <p className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading people…</p> : null}
        {(list?.items || []).map((host) => (
          <button key={host.id} type="button" onClick={() => onChange({ kind: "user", host })} data-testid={`${testId}-option`}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted">
            <span className="truncate text-[14.5px] font-semibold text-foreground">{host.name}</span>
            {host.department ? <span className="shrink-0 text-[12.5px] text-muted-foreground">{host.department}</span> : null}
          </button>
        ))}
        {list && !list.items.length ? <p className="px-3 py-2 text-[13px] text-muted-foreground">No one by that name. Pick a department below.</p> : null}
      </div>
      {list?.departments?.length ? (
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-muted-foreground">Or a department</p>
          <div className="flex flex-wrap gap-2">
            {list.departments.map((row) => <Pill key={row.key} active={false} onClick={() => onChange({ kind: "department", key: row.key, label: row.label })} testId={`${testId}-dept-${row.key}`}>{row.label}</Pill>)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Visitor form ───────────────────────────────────────────────────────────────────────────────
export type Purpose = { code: string; label: string }

export function VisitorFormFields({ purposes, searchHosts, lookup, submitLabel, busy, error, onSubmit, extra, photo, onPhoto, testId = "visit" }: {
  purposes: Purpose[]
  searchHosts: (q: string) => Promise<HostList>
  lookup?: (mobile: string) => Promise<{ known: boolean; name?: string | null; company?: string | null }>
  submitLabel: string
  busy?: boolean
  error?: string
  onSubmit: (form: Omit<VisitForm, "request_id">) => void
  extra?: ReactNode
  photo?: File | null
  onPhoto?: (file: File | null) => void
  testId?: string
}) {
  const [mobile, setMobile] = useState("")
  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const [purpose, setPurpose] = useState("")
  const [note, setNote] = useState("")
  const [people, setPeople] = useState(1)
  const [vehicle, setVehicle] = useState("")
  const [host, setHost] = useState<HostChoice>(null)
  const [known, setKnown] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const digits = mobileDigits(mobile)
  const lookupRef = useRef(lookup)
  lookupRef.current = lookup

  // A known number fills name and company only once all 10 digits are typed.
  useEffect(() => {
    if (!lookupRef.current || !isMobile(digits)) { setKnown(null); return }
    let alive = true
    lookupRef.current(digits).then((data) => {
      if (!alive || !data.known) return
      setKnown(data.name || "")
      setName((current) => current || data.name || "")
      setCompany((current) => current || data.company || "")
    }).catch(() => undefined)
    return () => { alive = false }
  }, [digits])

  const needsNote = /(^|[^A-Z0-9])OTHERS?($|[^A-Z0-9])/.test(purpose.toUpperCase())
  const problems = useMemo(() => {
    const list: string[] = []
    if (!isMobile(digits)) list.push("Enter a 10-digit mobile number.")
    if (name.trim().length < 2) list.push("Write the visitor's name.")
    if (!purpose) list.push("Pick the purpose of the visit.")
    if (needsNote && note.trim().length < 5) list.push("Write a few words about the purpose.")
    if (!host) list.push("Pick whom to meet.")
    return list
  }, [digits, name, purpose, needsNote, note, host])

  const submit = () => {
    setTouched(true)
    if (problems.length) return
    onSubmit({
      mobile: digits, name: name.trim(), company: company.trim() || undefined, purpose_code: purpose, purpose_note: note.trim() || undefined,
      people, vehicle_no: vehicle.trim() || undefined,
      host_user_id: host?.kind === "user" ? host.host.id : null, host_department_key: host?.kind === "department" ? host.key : null,
    })
  }

  return (
    <form className="space-y-4" data-testid={testId} onKeyDown={nextOnEnter} onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div>
        <Label htmlFor={`${testId}-mobile`} hint={known ? <span className="text-signal-emerald-ink">Welcome back</span> : "10 digits"}>Mobile</Label>
        <input id={`${testId}-mobile`} className={input} inputMode="numeric" autoComplete="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="98xxxxxxxx" data-testid={`${testId}-mobile`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor={`${testId}-name`}>Name</Label><input id={`${testId}-name`} className={input} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} data-testid={`${testId}-name`} /></div>
        <div><Label htmlFor={`${testId}-company`} hint="optional">From (company)</Label><input id={`${testId}-company`} className={input} autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} data-testid={`${testId}-company`} /></div>
      </div>
      <div>
        <Label>Purpose</Label>
        <div className="flex flex-wrap gap-2">
          {purposes.map((row) => <Pill key={row.code} active={purpose === row.code} onClick={() => setPurpose(row.code)} testId={`${testId}-purpose-${row.code}`}>{row.label.replace(/\s*\(write a note\)/i, "")}</Pill>)}
          {!purposes.length ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
        </div>
        {needsNote || purpose ? <input className={cn(input, "mt-2")} value={note} onChange={(event) => setNote(event.target.value)} placeholder={needsNote ? "What is the visit about? (required)" : "Note (optional)"} aria-label="Purpose note" data-testid={`${testId}-note`} /> : null}
      </div>
      <div>
        <Label>Whom to meet</Label>
        <HostPicker value={host} onChange={setHost} search={searchHosts} testId={`${testId}-host`} />
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <div>
          <Label>People</Label>
          <div className="flex h-12 items-center rounded-xl border border-input bg-card">
            <button type="button" aria-label="One less" className="h-12 w-12 text-xl font-semibold" onClick={() => setPeople(Math.max(1, people - 1))}>−</button>
            <span className="w-8 text-center text-[16px] font-semibold tabular-nums" data-testid={`${testId}-people`}>{people}</span>
            <button type="button" aria-label="One more" className="h-12 w-12 text-xl font-semibold" onClick={() => setPeople(Math.min(50, people + 1))}>+</button>
          </div>
        </div>
        <div><Label htmlFor={`${testId}-vehicle`} hint="optional">Vehicle no.</Label><input id={`${testId}-vehicle`} className={cn(input, "uppercase")} value={vehicle} onChange={(event) => setVehicle(event.target.value.toUpperCase())} placeholder="GJ 01 AB 1234" data-testid={`${testId}-vehicle`} /></div>
      </div>
      {onPhoto ? (
        <div>
          <Label hint="optional">Photo</Label>
          <div className="flex items-center gap-3">
            {photo ? <Thumb file={photo} label="Photo" onRemove={() => onPhoto(null)} /> : null}
            <button type="button" className={bigSecondary} onClick={() => camera.current?.click()}><Camera className="h-4 w-4" /> {photo ? "Take again" : "Take photo"}</button>
            <input ref={camera} type="file" accept="image/*" capture="user" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onPhoto(file); event.target.value = "" }} />
          </div>
        </div>
      ) : null}
      {extra}
      {touched && problems.length ? <div role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3.5 py-2.5 text-[13.5px] text-signal-rose-ink">{problems.join(" ")}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-signal-rose-line bg-signal-rose-soft px-3.5 py-2.5 text-[13.5px] text-signal-rose-ink">{error}</div> : null}
      <button type="submit" className={bigPrimary} disabled={busy} data-testid={`${testId}-submit`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{submitLabel}</button>
    </form>
  )
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" aria-label={label} onClick={onClick} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-signal-rose-soft hover:text-signal-rose-ink"><Trash2 className="h-4 w-4" /></button>
}

/** Shrink a phone photo before it goes up (longest edge 1280 px, JPEG): a selfie of ~150 KB. */
export async function shrinkPhoto(file: File, maxEdge = 1280, quality = 0.8): Promise<Blob> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", quality))
  } catch {
    return file
  }
}
