export type PurchaseLine = {
  id: string
  logical_line_id: string
  item_id: string
  item_code?: string
  item_name?: string
  qty_ordered: number
  qty_received: number
  qty_short_closed: number
  uom: "KG" | "PCS"
  expected_unit_count?: number | null
  received_unit_count?: number | null
  count_basis?: "ESTIMATED" | "CONTRACTUAL" | null
  unit_cost: number
  line_status: string
  description?: string
  width_mm?: number | null
  gsm?: number | null
  plybond?: number | null
  bulk?: number | null
  cobb?: string | null
}

export type PurchaseOrder = {
  id: string
  po_no: string
  category: "RM_PM" | "OT"
  current_revision_no: number
  version: number
  po_date?: string
  supplier_id: string
  supplier_name: string
  expected_date?: string | null
  status: string
  notes?: string | null
  lines: PurchaseLine[]
}

export type ReceivableLine = {
  po_id: string
  po_no: string
  revision_no: number
  supplier_id: string
  supplier_name: string
  po_line_id: string
  item_id: string
  item_code: string
  item_name: string
  tracking_mode: "REEL" | "BULK"
  uom: string
  ordered_qty: number
  received_qty: number
  open_qty: number
  approved_rate: number
  expected_unit_count?: number | null
  received_unit_count?: number | null
  count_variance?: number | null
  count_basis?: string | null
  specification?: Record<string, unknown>
}

export type Discrepancy = {
  id: string
  type: "RATE" | "QUANTITY" | string
  status: string
  version: number
  po_no: string
  revision_no: number
  grn_no: string
  invoice_no: string
  invoice_date: string
  supplier_id: string
  supplier_name: string
  item_code: string
  item_name: string
  quantity_kg: number
  invoice_quantity_kg?: number | null
  quantity_delta_kg?: number
  po_rate: number
  invoice_rate: number
  delta: number
  signed_amount: number
  claimable_amount: number
  assignee?: string | null
}

export type ProcurementPlanEntry = {
  id?: string
  entry_date: string
  item_id: string
  item_code?: string
  item_name?: string
  supplier_id?: string | null
  supplier_name?: string | null
  material_form: "REEL" | "COIL" | "BULK"
  qty_kg: number
  expected_unit_count?: number | null
  converted_qty_kg?: number
  status?: string
  notes?: string | null
}

export type ProcurementPlan = {
  id: string
  month: string
  name: string
  status: string
  target_mode: string
  version: number
  working_calendar: Record<string, unknown>
  entries: ProcurementPlanEntry[]
}

export type StockPolicy = {
  id: string
  item_id: string
  item_code?: string
  item_name?: string
  status: string
  stock_basis: string
  safety_stock_kg: number
  reorder_point_kg: number
  target_stock_kg: number
  recovery_margin_kg: number
  lead_time_days: number
  minimum_order_kg: number
  order_multiple_kg: number
  recipients: string[]
  cooldown_hours: number
  change_reason: string
  activation_reason?: string | null
  version: number
  created_by: string
  activated_by?: string | null
  activated_at?: string | null
}

export type RmCostRow = {
  item_id: string
  item_code: string
  item_name: string
  uom: string
  sheet_id?: string | null
  sheet_version?: number | null
  currency: string
  base_cost?: number | null
  landed_cost?: number | null
  active_version?: number | null
  latest_version?: number | null
  latest_status: string
  effective_from?: string | null
}
