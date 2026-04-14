"use client"

function normalizeUrl(value?: string | null) {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, "")
}

export function resolveAppBaseUrl() {
  if (typeof window !== "undefined") {
    const stored = normalizeUrl(window.localStorage.getItem("hariom_public_app_url"))
    if (stored) return stored
  }
  const configured = normalizeUrl(process.env.NEXT_PUBLIC_APP_URL)
  if (configured) return configured
  if (typeof window !== "undefined") {
    return normalizeUrl(window.location.origin) || "http://127.0.0.1:13000"
  }
  return "http://127.0.0.1:13000"
}

export function buildProductionEntryUrl(jobCardId?: string | null) {
  const baseUrl = resolveAppBaseUrl()
  const encodedId = encodeURIComponent(String(jobCardId || ""))
  return `${baseUrl}/production/entry/${encodedId}`
}
