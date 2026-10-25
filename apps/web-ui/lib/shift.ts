/** SHIFT_A / SHIFT_B from how a shift is written ("A", "Shift A", "shift-b"); "" when blank or unknown. */
export function canonicalShift(value: unknown): "SHIFT_A" | "SHIFT_B" | "" {
  const key = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/^SHIFT_?/, "")
  if (key === "A") return "SHIFT_A"
  if (key === "B") return "SHIFT_B"
  return ""
}
