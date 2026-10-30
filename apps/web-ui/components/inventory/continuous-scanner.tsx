"use client"

import { Camera, CameraOff, Keyboard, ScanLine } from "lucide-react"
import { FormEvent, useEffect, useRef, useState } from "react"

import type { Tone } from "@/lib/api-stock"
import { cn } from "@/lib/utils"

const NO_DETECTOR = "This phone's browser cannot read QR codes in the page (iPhone). Type the AT or lot number below, or use a handheld scanner."
const TYPE_ONLY_HINT = "Type the AT or lot number, or scan with a handheld scanner (it types and presses Enter). This browser cannot read QR codes with the camera."

/** Whether this browser can read codes from the camera in the page (Android Chrome, desktop Chrome / Edge; not iPhone). */
export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && typeof (window as any).BarcodeDetector === "function" && Boolean(navigator.mediaDevices?.getUserMedia)
}
/** The same label held in front of the camera is read once, not every frame. */
const REPEAT_MS = 2500

const FLASH: Record<Tone, string> = {
  emerald: "ring-signal-emerald-ink bg-signal-emerald-ink/20",
  amber: "ring-signal-amber-ink bg-signal-amber-ink/20",
  rose: "ring-signal-rose-ink bg-signal-rose-ink/25",
  blue: "ring-signal-blue-ink bg-signal-blue-ink/20",
  violet: "ring-signal-violet-ink bg-signal-violet-ink/20",
  slate: "ring-muted-foreground bg-muted-foreground/20",
}

/**
 * Camera that stays on and reads label after label (BarcodeDetector: Android Chrome, desktop Chrome / Edge),
 * plus a type-in box that also takes a handheld scanner (it types and presses Enter). Each read is handed
 * to ``onCode``; the parent answers with a colour through ``flash`` (found, wrong place, issued …), shown
 * as a silent flash over the picture and a short vibration where the phone has one.
 */
export function ContinuousScanner({ onCode, paused = false, flash, placeholder = "AT or lot number", testId = "continuous-scanner", autoStart = false, typeIn = true }: {
  onCode: (value: string) => void
  paused?: boolean
  flash?: { tone: Tone; key: number } | null
  placeholder?: string
  testId?: string
  autoStart?: boolean
  /** false when the page has its own field for typing (the correction sheet): only the camera shows. */
  typeIn?: boolean
}) {
  const [on, setOn] = useState(false)
  // null until mounted (server render): then the camera button shows only where it can work.
  const [camera, setCamera] = useState<boolean | null>(null)
  const [error, setError] = useState("")
  const input = useRef<HTMLInputElement | null>(null)
  const [typed, setTyped] = useState("")
  const [flashing, setFlashing] = useState<Tone | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const last = useRef<{ value: string; at: number }>({ value: "", at: 0 })
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const supported = cameraScanSupported()
    setCamera(supported)
    if (supported && autoStart) setOn(true)
    // Without a camera reader the typing box is the scanner: ready for the next label (or a handheld scanner).
    if (!supported) input.current?.focus({ preventScroll: true })
  }, [autoStart])

  useEffect(() => {
    if (!flash) return
    setFlashing(flash.tone)
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(flash.tone === "emerald" ? 35 : [40, 60, 40])
    const timer = window.setTimeout(() => setFlashing(null), 650)
    return () => window.clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    if (!on) return
    let cancelled = false
    let frame = 0
    const element = video.current
    const start = async () => {
      setError("")
      const Detector = (window as any).BarcodeDetector
      if (!Detector) { setError(NO_DETECTOR); setOn(false); return }
      if (!navigator.mediaDevices?.getUserMedia) { setError("The camera is not available here. Type the number or use a handheld scanner."); setOn(false); return }
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        if (cancelled || !element) { media.getTracks().forEach((track) => track.stop()); return }
        stream.current = media
        element.srcObject = media
        await element.play()
        const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13"] })
        const poll = async () => {
          if (cancelled) return
          try {
            if (!pausedRef.current) {
              const found = await detector.detect(element)
              const value = String(found?.[0]?.rawValue || "").trim()
              const now = Date.now()
              if (value && !(value === last.current.value && now - last.current.at < REPEAT_MS)) {
                last.current = { value, at: now }
                onCodeRef.current(value)
              }
            }
          } catch { /* a blurred frame is skipped */ }
          frame = window.setTimeout(() => window.requestAnimationFrame(poll), 120) as unknown as number
        }
        window.requestAnimationFrame(poll)
      } catch (cause: any) {
        if (cancelled) return
        setError(cause?.name === "NotAllowedError" ? "Camera permission was refused. Allow the camera in the browser, or type the number." : "The camera could not start. Type the number or use a handheld scanner.")
        setOn(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      window.clearTimeout(frame)
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = null
      if (element) element.srcObject = null
    }
  }, [on])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = typed.trim()
    if (!value || paused) return
    setTyped("")
    onCodeRef.current(value)
  }

  return (
    <div className="space-y-2.5" data-testid={testId}>
      {on ? (
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[hsl(224_30%_6%)] ring-1 ring-border sm:aspect-video">
          <video ref={video} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-[16%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.32)]">
            <span className="qr-scan-line absolute inset-x-3 h-0.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]" />
          </div>
          <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 rounded-2xl ring-8 ring-inset transition-opacity duration-300 motion-reduce:transition-none", flashing ? cn("opacity-100", FLASH[flashing]) : "opacity-0")} />
          {paused ? <p className="absolute inset-x-3 bottom-3 rounded-lg bg-card/90 px-3 py-2 text-center text-[12.5px] font-medium text-foreground backdrop-blur">Paused while you enter the count</p> : null}
          <button type="button" onClick={() => setOn(false)} className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-card/90 px-3 text-[13px] font-semibold text-foreground shadow-[var(--shadow-sm)] backdrop-blur" data-testid={`${testId}-stop`}>
            <CameraOff className="h-4 w-4" aria-hidden="true" /> Stop
          </button>
        </div>
      ) : camera ? (
        <button type="button" onClick={() => setOn(true)} className={cn("erp-btn-primary !h-14 w-full !rounded-2xl !text-[16px]", flashing && "ring-4 ring-offset-2 ring-offset-background", flashing && FLASH[flashing].split(" ")[0])} data-testid={`${testId}-start`}>
          <Camera className="h-5 w-5" aria-hidden="true" /> Scan with the camera
        </button>
      ) : null}
      {error ? <p role="status" className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-[12.5px] leading-5 text-foreground"><ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{error}</p> : null}
      {typeIn ? <form onSubmit={submit} className="flex items-center gap-2">
        <label className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-3 focus-within:border-ring/70 focus-within:ring-[3px] focus-within:ring-ring/15",
          camera === false ? cn("h-14 border-primary/50 ring-[3px] ring-primary/10", flashing && "ring-4", flashing && FLASH[flashing].split(" ")[0]) : "h-12 border-input",
        )}>
          {camera === false ? <ScanLine className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> : <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="sr-only">Type or scan a label</span>
          <input ref={input} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={placeholder} autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground shadow-none focus:shadow-none focus-visible:outline-none" data-testid={`${testId}-input`} />
        </label>
        <button type="submit" disabled={!typed.trim() || paused} className={cn(camera === false ? "erp-btn-primary !h-14" : "erp-btn-secondary !h-12", "shrink-0 !rounded-xl !px-4")} data-testid={`${testId}-add`}>Add</button>
      </form> : null}
      {camera === false && typeIn ? <p className="px-1 text-[12px] leading-4 text-muted-foreground" data-testid={`${testId}-type-hint`}>{TYPE_ONLY_HINT}</p> : null}
    </div>
  )
}
