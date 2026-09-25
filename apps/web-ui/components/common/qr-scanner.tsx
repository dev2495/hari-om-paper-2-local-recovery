"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, ScanLine } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

/**
 * Camera QR scanner (BarcodeDetector). Works on Android Chrome and modern desktop
 * Chrome/Edge; elsewhere it explains the fallback — handheld scanners type into the
 * page's own input and press Enter, which needs no camera at all.
 */
export function QrScanner({ onScan, label = "Scan QR", title = "Scan a QR code", hint = "Point the camera at the code. It will read automatically.", className }: {
  onScan: (value: string) => void; label?: string; title?: string; hint?: string; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const element = video.current
    const start = async () => {
      setError("")
      const Detector = (window as any).BarcodeDetector
      if (!Detector) { setError("This browser can't read QR codes with the camera. Use a handheld scanner or type the code into the box."); return }
      if (!navigator.mediaDevices?.getUserMedia) { setError("Camera isn't available here. Use a handheld scanner or type the code."); return }
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
            const found = await detector.detect(element)
            const value = String(found?.[0]?.rawValue || "").trim()
            if (value) {
              if (navigator.vibrate) navigator.vibrate(60)
              onScan(value)
              setOpen(false)
              return
            }
          } catch { /* frames can be unreadable while moving */ }
          window.requestAnimationFrame(poll)
        }
        window.requestAnimationFrame(poll)
      } catch (cause: any) {
        setError(cause?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in the browser, or use a handheld scanner." : cause?.message || "Camera could not start.")
      }
    }
    void start()
    return () => {
      cancelled = true
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = null
      if (element) element.srcObject = null
    }
  }, [open, onScan])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={className || "erp-btn-secondary"}><Camera className="h-4 w-4" />{label}</button>
      </DialogTrigger>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{hint}</DialogDescription>
        <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
          <video ref={video} className="h-full w-full object-cover" muted playsInline />
          {!error ? (
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.35)]">
              <span className="qr-scan-line absolute inset-x-3 h-0.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))]" />
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-white/85"><div><ScanLine className="mx-auto mb-2 h-8 w-8 opacity-70" />{error}</div></div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Pull a job-card id out of a scanned value: the printed QR is a /production/entry/<id> URL. */
export function jobCardIdFromScan(value: string) {
  const text = value.trim()
  const match = text.match(/\/production\/(?:entry|job-cards)\/([0-9a-f-]{16,})/i)
  return match ? match[1] : text
}
