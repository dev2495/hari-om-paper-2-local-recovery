export function resolveSpecTitle(spec: any) {
  const customer = String(spec?.customer_name_snapshot || spec?.customer_name || "").trim()
  const reference = String(spec?.spec_reference || "").trim()
  if (reference) return reference
  if (customer) return customer
  return `Specification ${String(spec?.id || "").slice(0, 8).toUpperCase()}`
}
