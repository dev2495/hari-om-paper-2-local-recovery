"use client"

/** Visitor self check-in from the gate QR poster (6 Nov 2026). No login. */
import { CircleDot, Loader2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { orderCodes, shrinkPhoto, VisitorFormFields, type Purpose } from "@/components/gate/gate-ui"
import { publicVisitApi } from "@/lib/api-gate"

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`)

export default function VisitCheckInPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [form, setForm] = useState<{ gate_name: string; purposes: Purpose[] } | null>(null)
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const requestId = useRef(newKey())

  useEffect(() => {
    let alive = true
    publicVisitApi.form(token).then((data) => { if (alive) setForm(data) }).catch((err) => { if (alive) setLoadError(err.message) })
    return () => { alive = false }
  }, [token])

  const searchHosts = useCallback((q: string) => publicVisitApi.hosts(token, q), [token])

  const submit = async (values: any) => {
    setBusy(true)
    setError("")
    try {
      const result = await publicVisitApi.checkIn(token, { ...values, request_id: requestId.current })
      if (photo) {
        try { await publicVisitApi.photo(result.pass_token, await shrinkPhoto(photo)) } catch { /* the pass works without the photo */ }
      }
      try { window.localStorage.setItem("hariom_visit_pass", result.pass_token) } catch { /* optional */ }
      router.replace(`/visit/pass/${result.pass_token}`)
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Try again, or speak to the watchman at the gate.")
      setBusy(false)
    }
  }

  return (
    <main className="space-y-5" data-testid="visit-check-in">
      <header className="flex items-center gap-3 pt-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><CircleDot className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Hari Om · visitor check-in</p>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight" data-testid="visit-gate-name">{form?.gate_name || "Gate"}</h1>
        </div>
      </header>
      {loadError ? (
        <div role="alert" className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft p-4 text-[15px] leading-6 text-signal-rose-ink">{loadError}</div>
      ) : !form ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening the form…</p>
      ) : (
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <p className="mb-1 text-[15px] font-semibold">Welcome. Please tell us who you are.</p>
          <p lang="hi" className="mb-4 text-[13.5px] text-muted-foreground">कृपया अपना विवरण भरें। फिर अपना पास वॉचमैन को दिखाएँ।</p>
          <VisitorFormFields purposes={orderCodes(form.purposes)} searchHosts={searchHosts} submitLabel="Check in" busy={busy} error={error}
            onSubmit={submit} photo={photo} onPhoto={setPhoto} testId="visitor" />
          <p className="mt-4 text-[12px] leading-5 text-muted-foreground">Your number and photo are seen only by the gate and the plant management, and are kept for one year at most.</p>
        </section>
      )}
    </main>
  )
}
