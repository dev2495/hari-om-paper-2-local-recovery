export function compactRef(value: unknown, prefix = "REF") {
  const text = String(value || "").trim()
  if (!text) return `${prefix}-DRAFT`
  if (/^[A-Z]+[-_]/i.test(text) && text.length <= 24) return text.toUpperCase()
  return `${prefix}-${text.replace(/-/g, "").slice(0, 8).toUpperCase()}`
}

export function jobCardRef(job: any) {
  return (
    job?.job_card_no ||
    job?.job_card_ref ||
    job?.job_card_number ||
    compactRef(job?.id || job?.job_card_id, "JC")
  )
}

export function jobCardSubtitle(job: any) {
  const customer = job?.customer_name || job?.sales_order?.customer_name || "Customer not mapped"
  const size = job?.product_size_label || job?.size_label || job?.spec_snapshot?.product_size_label || "Size pending"
  const product = job?.product_code || job?.spec_snapshot?.product_code || ""
  return [customer, product || size].filter(Boolean).join(" · ")
}

export function jobCardSearchText(job: any) {
  return [
    jobCardRef(job),
    job?.id,
    job?.job_card_id,
    job?.sales_order_id,
    job?.sales_order_ref,
    job?.customer_name,
    job?.product_code,
    job?.product_size_label,
    job?.current_stage,
    job?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}
