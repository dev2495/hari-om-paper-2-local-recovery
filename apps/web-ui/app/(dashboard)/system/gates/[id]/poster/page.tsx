"use client"

/** A4 visitor poster of one gate (6 Nov 2026): English and Hindi, QR to the public check-in page. */
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Printer } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"

import { useBreadcrumbLabel } from "@/components/workspace/breadcrumb-label"
import { useAuth } from "@/context/AuthContext"
import { gateApi } from "@/lib/api-gate"
import { resolveAppBaseUrl } from "@/lib/app-url"
import { errorText } from "@/lib/stock-format"

export default function GatePosterPage() {
  const { id } = useParams<{ id: string }>()
  const { activePlant } = useAuth()
  const gates = useQuery({ queryKey: ["gate", "gates", activePlant, "all"], enabled: Boolean(activePlant && activePlant !== "ALL"), queryFn: () => gateApi.gates(true) })
  const gate = gates.data?.find((row) => row.id === id)
  useBreadcrumbLabel(gate ? `${gate.name} poster` : "QR poster")
  if (gates.isLoading) return <p className="p-6 text-muted-foreground">Loading the poster…</p>
  if (gates.isError) return <p role="alert" className="p-6 text-signal-rose-ink">{errorText(gates.error)}</p>
  if (!gate || !gate.qr_token) return <p className="p-6 text-muted-foreground">This gate is not in the selected plant. <Link className="underline" href="/system/gates">Back to gates</Link></p>
  const url = `${resolveAppBaseUrl()}/visit/${gate.qr_token}`
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/system/gates" className="erp-btn-secondary max-sm:h-11"><ArrowLeft className="h-4 w-4" /> Gates</Link>
        <div className="flex items-center gap-2">
          {!gate.active ? <span className="text-sm font-semibold text-signal-amber-ink">This gate is switched off: the QR does not work until it is switched on.</span> : null}
          <button className="erp-btn-primary max-sm:h-11" onClick={() => window.print()} data-testid="gate-poster-print"><Printer className="h-4 w-4" /> Print A4</button>
        </div>
      </div>
      <article data-testid="gate-poster" className="tube-paper mx-auto flex aspect-[210/297] w-full max-w-[794px] flex-col items-center justify-between rounded-2xl border border-border bg-white p-[6%] text-center text-black shadow-lg print:max-w-none print:rounded-none print:border-0 print:p-[14mm] print:shadow-none">
        <style>{"@page { size: A4 portrait; margin: 0 } @media print { body { background: #fff !important } }"}</style>
        <header className="w-full">
          <p className="text-[clamp(14px,2.4vw,22px)] font-semibold uppercase tracking-[0.3em] text-neutral-500">{gate.code}</p>
          <h1 className="mt-2 text-[clamp(30px,6vw,60px)] font-bold leading-tight">{gate.name}</h1>
        </header>
        <div className="flex flex-col items-center gap-[4%]">
          <p className="text-[clamp(22px,4.4vw,44px)] font-bold leading-snug">Visitors: scan to check in</p>
          <p lang="hi" className="text-[clamp(20px,4vw,40px)] font-semibold leading-snug">आगंतुक: चेक-इन के लिए स्कैन करें</p>
          <div className="rounded-3xl border-[6px] border-black p-[3%]"><QRCodeSVG value={url} size={420} level="M" marginSize={0} bgColor="#ffffff" fgColor="#000000" style={{ width: "min(56vw, 420px)", height: "auto" }} /></div>
          <p className="max-w-[80%] text-[clamp(14px,2.2vw,20px)] leading-snug text-neutral-700">Open your phone camera and point it at the code. Fill in your name and whom you are meeting, then show your pass to the watchman.</p>
          <p lang="hi" className="max-w-[80%] text-[clamp(14px,2.2vw,20px)] leading-snug text-neutral-700">फ़ोन का कैमरा खोलें और कोड पर रखें। अपना नाम और किससे मिलना है भरें, फिर अपना पास वॉचमैन को दिखाएँ।</p>
        </div>
        <footer className="w-full text-[clamp(11px,1.6vw,14px)] text-neutral-500">
          <p>No smartphone? Please speak to the watchman. · स्मार्टफ़ोन नहीं है? कृपया वॉचमैन से बात करें।</p>
          <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">{url}</p>
        </footer>
      </article>
    </div>
  )
}
