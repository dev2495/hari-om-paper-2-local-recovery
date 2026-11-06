"use client"

/** The visitor's pass (6 Nov 2026): V-number, QR for the watchman, live status. No login. */
import { Camera, CheckCircle2, Clock3, DoorOpen, Loader2, LogOut, XCircle } from "lucide-react"
import { useParams } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useRef, useState } from "react"

import { shrinkPhoto } from "@/components/gate/gate-ui"
import { publicVisitApi, type PublicPass } from "@/lib/api-gate"
import { cn } from "@/lib/utils"

const POLL_MS = 8000
const FINAL = new Set(["OUT", "DENIED", "NO_SHOW"])
const clock = (value: string | null) => value ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : ""

export default function VisitPassPage() {
  const { passToken } = useParams<{ passToken: string }>()
  const [pass, setPass] = useState<PublicPass | null>(null)
  const [error, setError] = useState("")
  const [photoBusy, setPhotoBusy] = useState(false)
  const camera = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const load = async () => {
      try {
        const data = await publicVisitApi.pass(passToken)
        if (!alive) return
        setPass(data)
        setError("")
        if (FINAL.has(data.status)) return
      } catch (err: any) {
        if (!alive) return
        setError(err?.message || "The pass could not refresh.")
        if (err?.status === 404) return
      }
      timer = window.setTimeout(load, document.visibilityState === "visible" ? POLL_MS : POLL_MS * 3)
    }
    void load()
    return () => { alive = false; if (timer) window.clearTimeout(timer) }
  }, [passToken])

  const addPhoto = async (file: File) => {
    setPhotoBusy(true)
    try { setPass(await publicVisitApi.photo(passToken, await shrinkPhoto(file))) } catch (err: any) { setError(err?.message || "The photo was not saved.") } finally { setPhotoBusy(false) }
  }

  if (!pass) return <main className="pt-10">{error ? <p role="alert" className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft p-4 text-[15px] text-signal-rose-ink">{error}</p> : <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening your pass…</p>}</main>

  const status = {
    ARRIVED: { icon: Clock3, title: "Show this to the watchman", hint: "वॉचमैन को यह पास दिखाएँ", tone: "border-signal-amber-line bg-signal-amber-soft text-signal-amber-ink" },
    IN: { icon: DoorOpen, title: "You are checked in", hint: "आप अंदर जा सकते हैं", tone: "border-signal-emerald-line bg-signal-emerald-soft text-signal-emerald-ink" },
    OUT: { icon: LogOut, title: "Visit over · thank you", hint: "धन्यवाद", tone: "border-border bg-muted text-foreground" },
    DENIED: { icon: XCircle, title: "Entry not allowed today", hint: "आज प्रवेश की अनुमति नहीं है", tone: "border-signal-rose-line bg-signal-rose-soft text-signal-rose-ink" },
    NO_SHOW: { icon: XCircle, title: "This pass has expired", hint: "यह पास समाप्त हो गया है", tone: "border-border bg-muted text-foreground" },
  }[pass.status]
  const Icon = status.icon
  return (
    <main className="space-y-4 pt-2" data-testid="visit-pass">
      <section className={cn("rounded-3xl border p-4", status.tone)} role="status" data-testid="visit-pass-status">
        <p className="flex items-center gap-2 text-[18px] font-semibold"><Icon className="h-5 w-5" aria-hidden="true" /> {status.title}</p>
        <p lang="hi" className="text-[14px] opacity-80">{status.hint}</p>
        {pass.status === "DENIED" && pass.deny_label ? <p className="mt-1 text-[14px]">Reason: {pass.deny_label}</p> : null}
        {pass.host_reply_label && !FINAL.has(pass.status) ? <p className="mt-2 rounded-xl bg-card/70 px-3 py-2 text-[14.5px] font-semibold text-foreground" data-testid="visit-pass-reply">{pass.host_words.split(" · ")[0]}: {pass.host_reply === "SEND_IN" ? "please come in" : pass.host_reply === "WAIT" ? "please wait a little" : "not available right now"}</p> : null}
      </section>
      <section className="rounded-3xl border border-border bg-card p-5 text-center shadow-sm">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Visitor pass · {pass.gate_name}</p>
        <p className="mt-1 font-mono text-[28px] font-bold tracking-wide" data-testid="visit-pass-no">{pass.visit_no}</p>
        <div className={cn("mx-auto mt-3 w-fit rounded-2xl border border-border bg-white p-3", FINAL.has(pass.status) && "opacity-30")}>
          <QRCodeSVG value={pass.pass_code} size={220} level="M" marginSize={0} bgColor="#ffffff" fgColor="#000000" />
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-left text-[14.5px]">
          <dt className="text-muted-foreground">Name</dt><dd className="font-semibold">{pass.visitor_name}{pass.people > 1 ? ` + ${pass.people - 1}` : ""}</dd>
          {pass.company ? <><dt className="text-muted-foreground">From</dt><dd>{pass.company}</dd></> : null}
          <dt className="text-muted-foreground">To meet</dt><dd>{pass.host_words}</dd>
          <dt className="text-muted-foreground">Purpose</dt><dd>{pass.purpose_label}</dd>
          <dt className="text-muted-foreground">Arrived</dt><dd>{clock(pass.arrived_at)}{pass.in_at ? ` · in ${clock(pass.in_at)}` : ""}{pass.out_at ? ` · out ${clock(pass.out_at)}` : ""}</dd>
        </dl>
        {pass.status === "IN" ? <p className="mt-4 text-[13px] text-muted-foreground">Show this pass at the gate on your way out.</p> : null}
      </section>
      {pass.photo_allowed ? (
        <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14.5px] font-semibold" disabled={photoBusy} onClick={() => camera.current?.click()}>
          {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Add your photo (optional)
        </button>
      ) : pass.has_photo ? <p className="flex items-center justify-center gap-1.5 text-[13px] text-signal-emerald-ink"><CheckCircle2 className="h-4 w-4" /> Photo saved</p> : null}
      <input ref={camera} type="file" accept="image/*" capture="user" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addPhoto(file); event.target.value = "" }} />
      {error ? <p role="alert" className="text-center text-[13px] text-signal-rose-ink">{error}</p> : null}
      <p className="text-center text-[12px] text-muted-foreground">This page updates by itself. Keep it open until you leave.</p>
    </main>
  )
}
