function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function buildDispatchDocumentData({
  jobCard,
  dispatchRecord,
  customers,
  plants,
}: {
  jobCard: any
  dispatchRecord?: any
  customers?: any[]
  plants?: any[]
}) {
  const customerRows = Array.isArray(customers) ? customers : []
  const plantRows = Array.isArray(plants) ? plants : []
  const customer =
    customerRows.find((row) => String(row.id) === String(jobCard?.customer_id || dispatchRecord?.customer_id || "")) ||
    dispatchRecord?.customer ||
    jobCard?.customer ||
    null
  const plant =
    plantRows.find((row) => String(row.id) === String(jobCard?.plant_id || dispatchRecord?.plant_id || "")) ||
    dispatchRecord?.plant ||
    null

  const packing = jobCard?.packing_record || {}
  const summary = {
    total_units: toNumber(dispatchRecord?.dispatch_snapshot?.summary?.total_units || packing?.bundle_count || 0),
    total_pcs: toNumber(dispatchRecord?.dispatch_snapshot?.summary?.total_pcs || packing?.total_pcs || jobCard?.released_qty || 0),
    total_weight: toNumber(
      dispatchRecord?.dispatch_snapshot?.summary?.total_weight ||
        packing?.packed_weight_kg ||
        packing?.net_weight_kg ||
        0,
    ),
  }

  const itemDescription =
    dispatchRecord?.dispatch_snapshot?.items?.[0]?.description ||
    [jobCard?.product_code, jobCard?.size_label, jobCard?.parchment_color].filter(Boolean).join(" · ") ||
    jobCard?.job_card_ref ||
    jobCard?.job_card_no ||
    "Dispatch line"

  const items = dispatchRecord?.dispatch_snapshot?.items || [
    {
      description: itemDescription,
      qty_units: summary.total_units,
      total_pcs: summary.total_pcs,
      net_weight: summary.total_weight,
    },
  ]

  return {
    dispatch_request_id: dispatchRecord?.dispatch_request_id || dispatchRecord?.dispatch_snapshot?.dispatch_request_id || null,
    fg_item_id: dispatchRecord?.fg_item_id || packing?.fg_item_id || null,
    fg_batch_id: dispatchRecord?.fg_batch_id || dispatchRecord?.dispatch_snapshot?.fg_batch_id || null,
    job_card_id: jobCard?.id,
    job_card_no: jobCard?.job_card_no || jobCard?.job_card_ref || jobCard?.id,
    customer,
    plant,
    summary,
    sales_order_line_id: jobCard?.sales_order_line_id || null,
    items,
    dispatch_snapshot: dispatchRecord?.dispatch_snapshot || null,
  }
}
