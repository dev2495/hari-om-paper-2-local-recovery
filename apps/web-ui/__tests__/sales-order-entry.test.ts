import assert from "node:assert/strict"
import {
  ORDER_ORIGIN_CUSTOMER_PO,
  ORDER_ORIGIN_INTERNAL,
  addCalendarDays,
  deliveryDateMustFollowCustomerPoDate,
  parchmentLineLabel,
  salesOrderOriginLabel,
  salesOrderReferenceLabel,
} from "../lib/sales-order-entry"

assert.equal(addCalendarDays("2026-09-24", 1), "2026-09-25")
assert.equal(
  deliveryDateMustFollowCustomerPoDate("2026-09-24", "2026-09-24", ORDER_ORIGIN_CUSTOMER_PO),
  "Delivery date must be after the Customer PO Date (24 Sep 2026).",
)
assert.equal(deliveryDateMustFollowCustomerPoDate("2026-09-25", "2026-09-24", ORDER_ORIGIN_CUSTOMER_PO), null)
assert.equal(deliveryDateMustFollowCustomerPoDate("2026-09-24", "2026-09-24", ORDER_ORIGIN_INTERNAL), null)
assert.equal(salesOrderOriginLabel(ORDER_ORIGIN_INTERNAL), "Internal sales order")
assert.equal(
  salesOrderReferenceLabel({ origin: ORDER_ORIGIN_INTERNAL, po_number: "should-not-win", order_no: "SO-20260917-0001" }),
  "SO-20260917-0001",
)
assert.equal(parchmentLineLabel({ parchment_required: false, parchment_color: "stale" }), "No parchment")
assert.equal(parchmentLineLabel({ parchment_required: true, parchment_color: "Natural" }), "Parchment Natural")

console.log("sales-order-entry tests passed")
