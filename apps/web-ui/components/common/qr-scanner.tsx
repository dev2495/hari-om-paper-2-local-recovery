"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, ScanLine } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { jobCardIdOf } from "@/lib/scan-code"

const NO_DETECTOR = "This phone's browser cannot read QR codes here. Open the phone's Camera app and point it at the label — it opens the right page. Or type or paste the code into the box."

/**
 * Camera QR scanner (BarcodeDetector). Works on Android Chrome and modern desktop
 * Chrome/Edge. iPhone browsers have no BarcodeDetector: printed labels and job cards carry a
 * link, so the phone's own Camera app opens the right page instead. Handheld scanners type into
 * the page's own input and press Enter, which needs no camera at all.
 */
export function QrScanner({ onScan, label = "Scan QR", title = "Scan a QR code", hint = "Point the camera at the code. It will read automatically.", className }: {
  onScan: (value: string) => void; label?: string; title?: string; hint?: string; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  // The dialog mounts its content after it opens, so the <video> arrives through a callback ref and
  // the camera starts once it exists (reading a ref when `open` flips found nothing and stopped the camera).
  const [element, setElement] = useState<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  // A parent re-render passes a new onScan; keep the latest without restarting the camera.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!open || !element) return
    let cancelled = false
    const start = async () => {
      setError("")
      const Detector = (window as any).BarcodeDetector
      if (!Detector) { setError(NO_DETECTOR); return }
      if (!navigator.mediaDevices?.getUserMedia) { setError("Camera isn't available here. Use a handheld scanner or type the code."); return }
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        // Closed while the camera was starting: nothing to show, so just let the camera go.
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return }
        stream.current = media
        element.srcObject = media
        await element.play()
        const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13"] })
        const poll = async () => {
          if (cancelled) return
          try {
            const found = await detector.detect(element)
            const value = String(found?.[0]?.rawValue || "").trim()
            if (value) {
              if (navigator.vibrate) navigator.vibrate(60)
              onScanRef.current(value)
              setOpen(false)
              return
            }
          } catch { /* frames can be unreadable while moving */ }
          window.requestAnimationFrame(poll)
        }
        window.requestAnimationFrame(poll)
      } catch (cause: any) {
        if (cancelled) return
        setError(cause?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in the browser, or use a handheld scanner." : cause?.message || "Camera could not start.")
      }
    }
    void start()
    return () => {
      cancelled = true
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = null
      element.srcObject = null
    }
  }, [open, element])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={className || "erp-btn-secondary"}><Camera className="h-4 w-4" />{label}</button>
      </DialogTrigger>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hint}</DialogDescription>
        <div className={error ? "rounded-xl border border-border bg-muted" : "relative aspect-square overflow-hidden rounded-xl bg-black"}>
          <video ref={setElement} className={error ? "hidden" : "h-full w-full object-cover"} muted playsInline />
          {!error ? (
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.35)]">
              <span className="qr-scan-line absolute inset-x-3 h-0.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]" />
            </div>
          ) : (
            <p role="status" data-no-mirror className="flex items-start gap-3 p-4 text-[13.5px] leading-6 text-foreground"><ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Pull a job-card id out of a scanned value (absolute or bare /production/entry/<id>, /scan links,
 * old supervisor-entry?job_card_id= links); anything else comes back as the trimmed text. */
export function jobCardIdFromScan(value: string) {
  return jobCardIdOf(value)
}
