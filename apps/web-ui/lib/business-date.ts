/** Plant business dates must not roll backwards before 05:30 IST. */
export function businessDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || ""
  return `${part("year")}-${part("month")}-${part("day")}`
}
