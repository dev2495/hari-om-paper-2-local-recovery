import type { Metadata, Viewport } from "next"

/** Pages a visitor opens without signing in (gate QR, 6 Nov 2026): no workspace shell, no login. */
export const metadata: Metadata = { title: "Visitor check-in · Hari Om", robots: { index: false, follow: false } }
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" }

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[hsl(var(--surface-2))] text-foreground">
      <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">{children}</div>
    </div>
  )
}
