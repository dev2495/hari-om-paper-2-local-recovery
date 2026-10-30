import assert from "node:assert/strict"

import {
  challanGaps,
  challanNotes,
  customerChallanParty,
  customerDispatchAddress,
  gapsFromServerMessage,
  hasNetWeight,
  hasSeparateShipTo,
  netWeightKg,
  placeLine,
  plantChallanParty,
  tubeWeightFromSpec,
} from "../lib/dispatch-challan"

// Net weight = shipment pcs × finished tube weight per piece from the spec sheet (client 2026-10-28).
assert.deepEqual(tubeWeightFromSpec({ weight_avg_g: 33.7762, target_tube_weight: 30 }), { grams: 33.7762, source: "spec average tube weight" })
assert.equal(tubeWeightFromSpec({ target_tube_weight: "295" })?.grams, 295)
assert.equal(tubeWeightFromSpec({ weight_min_g: 290, weight_max_g: 300 })?.grams, 295)
assert.equal(tubeWeightFromSpec({ qc_profile: { refs: { CUSTOMER_WEIGHT: 33.7762 } } })?.source, "customer tube weight on the spec")
assert.equal(tubeWeightFromSpec({ weight_avg_g: null, target_tube_weight: 0, weight_min_g: 290 }), null)
assert.equal(tubeWeightFromSpec(null), null)
assert.equal(netWeightKg(95, 33.7762), 3.209)
assert.equal(netWeightKg(50004, 33.7762), 1688.945)
assert.equal(netWeightKg(0, 33.7762), 0)

// Plant block from the plant master: the GSTIN gives the state.
const plant = plantChallanParty({ id: "p1", code: "PLANT_A", name: "Plant A", legal_name: "AMIGO UNIT - II", address: "Plot 4, GIDC\nVapi 396195", gstin: "24aaaaa0000a1z5" })
assert.equal(plant.gstin, "24AAAAA0000A1Z5")
assert.equal(plant.state, "Gujarat")
assert.equal(plant.state_code, "24")

// Customer block: billing address with state and PIN; dispatch (ship-to) address falls back to billing.
const sameAddress = { id: "c1", name: "Reliance [Silvassa]", gst_no: "26AAACR5055K1ZS", address: "Survey 342", billing_address: "Survey 342", shipping_address: "Survey 342", billing_city: "Silvassa", billing_state_code: "26", billing_pin_code: "396230" }
assert.equal(hasSeparateShipTo(sameAddress), false)
const same = customerChallanParty(sameAddress)
assert.equal(same.billing_address, "Survey 342, Silvassa - 396230")
assert.equal(same.address, same.billing_address)
assert.equal(same.state_code, "26")
assert.equal(same.state, "Dadra and Nagar Haveli and Daman and Diu")
const shipTo = customerChallanParty({ ...sameAddress, shipping_address: "Gate 3\nKhadoli", shipping_city: "Silvassa", shipping_state: "Dadra and Nagar Haveli and Daman and Diu", shipping_pin_code: "396230", dispatch_contact_name: "Stores", dispatch_contact_phone: "0260 2640000" })
assert.equal(shipTo.address, "Gate 3, Khadoli, Silvassa, Dadra and Nagar Haveli and Daman and Diu - 396230")
assert.equal(shipTo.contact_name, "Stores")
// The service's one-line addresses win when present.
assert.equal(customerChallanParty({ name: "X", billing_address: "B", shipping_address: "S", billing_full_address: "B line", shipping_full_address: "S line" }).address, "S line")
// Goods cannot be sent to "Gujarat": a GSTIN alone (it fills the billing state) or a city alone is no dispatch address.
const gstOnly = { id: "c9", name: "Chokshi Texelin", gst_no: "24AAACC4175D1Z4", billing_state: "Gujarat", billing_state_code: "24", billing_full_address: "Gujarat", shipping_full_address: "Gujarat" }
assert.equal(customerDispatchAddress(gstOnly), "")
assert.equal(customerChallanParty(gstOnly).address, undefined)
assert.equal(customerChallanParty(gstOnly).state, "Gujarat")
assert.equal(customerDispatchAddress({ name: "City Only", billing_city: "Surat" }), "")
assert.equal(customerDispatchAddress({ name: "Lines", billing_address: " \n ", billing_city: "Surat" }), "")
// A separate ship-to place without a street does not borrow the billing street.
assert.equal(customerDispatchAddress({ name: "Y", billing_address: "Ring Road", billing_city: "Surat", shipping_city: "Vapi" }), "")
assert.deepEqual(challanGaps({ company: plantChallanParty({ legal_name: "P", address: "A", gstin: "24AAAAA0000A1Z5" }), customer: customerChallanParty(gstOnly), transporter: { vehicle_no: "x", name: "y" }, items: [{ total_pcs: 1, net_weight: 1 }] }, { customerId: "c9" }).map((gap) => [gap.key, gap.href]), [["customer_address", "/masters/customers?edit=c9"]])
assert.equal(placeLine("A\n\nB", "", "Gujarat", "380015"), "A, B, Gujarat - 380015")

// Seal refusals name what is missing, in plain words, and where it is fixed.
const ready = { company: plant, customer: same, transporter: { vehicle_no: "GJ15AB1234", name: "VRL" }, items: [{ total_pcs: 95, net_weight: 3.209 }] }
assert.deepEqual(challanGaps(ready, { plantId: "p1", customerId: "c1" }), [])
const gaps = challanGaps({ company: { name: "Plant A" }, customer: { name: "Reliance [Silvassa]", id: "c1" }, transporter: {}, items: [{ total_pcs: 0 }] }, { plantId: "p1" })
assert.deepEqual(gaps.map((gap) => gap.key), ["plant_address", "plant_gstin", "customer_address", "vehicle_no", "transporter", "qty", "net_weight"])
assert.equal(gaps[0].href, "/system/plants?edit=p1")
assert.equal(gaps[0].text, "The address of Plant A is not in the plant master.")
assert.equal(gaps[2].href, "/masters/customers?edit=c1")
assert.equal(gaps[2].text, "The dispatch (ship-to) street address of Reliance [Silvassa] is not in the customer master.")
assert.equal(gaps[3].place, "challan")
assert.equal(challanGaps({ company: plant, customer: {}, transporter: { vehicle_no: "x", name: "y" }, items: [{ total_pcs: 1 }] })[0].key, "customer_name")
// An empty or 0 kg net weight stops sealing (an empty field is not 0 kg) and links to the weight field.
for (const blank of ["", null, undefined, 0, "0", "  ", -1, "abc"]) {
  assert.equal(hasNetWeight(blank), false, String(blank))
  const weightGap = challanGaps({ ...ready, items: [{ total_pcs: 95, net_weight: blank }] }).find((gap) => gap.key === "net_weight")
  assert.equal(weightGap?.href, "#challan-weight", String(blank))
  assert.equal(weightGap?.text, "The net weight is empty or 0 kg.")
}
assert.equal(hasNetWeight("0.001"), true)
// Ship-to prints its state code like the billing block does.
assert.equal(shipTo.ship_state_code, "26")
assert.equal(same.ship_state_code, "26")
// A missing customer GSTIN does not stop sealing; it is pointed out.
assert.deepEqual(challanNotes({ customer: { name: "Plain Co" } }), ["The GSTIN of Plain Co is not in the customer master, so the challan prints without it."])
assert.deepEqual(challanNotes(ready), [])

// A server refusal (the page's copy of the masters was stale) becomes gaps that link to the master page.
const server = gapsFromServerMessage(
  "The challan cannot be sealed yet: the GSTIN of AMIGO UNIT - II is not in the plant master (System › Plants); the dispatch (ship-to) street address of Chokshi is not in the customer master (Masters › Customers); the vehicle number is empty; the net weight is empty or 0 kg (type it on the challan).",
  { plantId: "p1", customerId: "c9" },
)
assert.deepEqual(server.map((gap) => [gap.place, gap.href]), [["plant", "/system/plants?edit=p1"], ["customer", "/masters/customers?edit=c9"], ["challan", "#challan-vehicle"], ["challan", "#challan-weight"]])
assert.equal(server[0].text, "The GSTIN of AMIGO UNIT - II is not in the plant master.")
assert.equal(server[1].text, "The dispatch (ship-to) street address of Chokshi is not in the customer master.")
assert.equal(server[3].text, "The net weight is empty or 0 kg.")
assert.deepEqual(gapsFromServerMessage("Final QC has not passed for this card."), [])

console.log("dispatch-challan tests passed")
