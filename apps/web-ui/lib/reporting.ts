export function formatMetric(value: number | string | null | undefined, suffix = "", digits = 0) {
  const numeric = Number(value || 0)
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix ? ` ${suffix}` : ""}`
}

export function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  if (typeof window === "undefined" || rows.length === 0) return
  const headers = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key))
      return set
    }, new Set<string>()),
  )
  const body = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const raw = row[header]
          const value = raw == null ? "" : String(raw)
          return `"${value.replaceAll('"', '""')}"`
        })
        .join(","),
    ),
  ].join("\n")

  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}