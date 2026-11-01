import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { byOperator, employeeCsv, type EmployeeRow } from "../lib/employee-report"
import { fitSize, isPlantReelFacts, labelHeading, millName, textEm } from "../lib/reel-label"

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8")

// Owner decision 6 (1 Nov 2026): reel / coil labels are the plant's own layout plus a QR.
assert.equal(labelHeading({ legal_name: "Amigo Industries Unit II" }), "AMIGO INDUSTRIES UNIT II")
assert.equal(labelHeading({ legal_name: "Amigo Industries Pvt Ltd", label_heading: "amigo  industries unit ii" }), "AMIGO INDUSTRIES UNIT II")
assert.equal(labelHeading({ name: "Plant A" }), "PLANT A")
assert.equal(labelHeading({ label_heading_effective: "AMIGO INDUSTRIES UNIT II", legal_name: "x" }), "AMIGO INDUSTRIES UNIT II")
assert.equal(labelHeading(null), "")

// MILL NAME: kept at inward, else the vendor master's short name, else the vendor name as received.
assert.equal(millName({ mill: "AKSHAT", supplier_id: "v1", vendor: "Akshat Paper Mills" }, [{ id: "v1", short_name: "OTHER" }]), "AKSHAT")
assert.equal(millName({ supplier_id: "v1", vendor: "Akshat Paper Mills" }, [{ id: "v1", short_name: "AKSHAT" }]), "AKSHAT")
assert.equal(millName({ supplier_id: "v2", vendor: "Vatsalya Paper" }, [{ id: "v1", short_name: "AKSHAT" }]), "VATSALYA PAPER")

assert.ok(isPlantReelFacts({ serial: "AIT 06243" }))
assert.ok(!isPlantReelFacts({ gsm: "230 (spec)" }), "an old-style fact list is not the plant layout")
assert.ok(!isPlantReelFacts(null))

// Text steps down to fit its cell, never above the base size.
assert.equal(fitSize("AIT 06243", 12.2, 72), 12.2)
assert.ok(fitSize("AIT 06243-12", 12.2, 72) < 12.2 + 1e-9)
assert.ok(fitSize("VPI/1686/2026-27", 4.4, 30) < 4.4)
assert.ok(textEm("VPI/1686/2026-27") * fitSize("VPI/1686/2026-27", 4.4, 30) <= 30)
assert.equal(fitSize("", 5, 10), 5)

// Every label page draws the plant layout; nothing of the old label lines is left on it.
const label = read("components/inventory/plant-reel-label.tsx")
for (const words of ["PLYBOND", "VARIETY", "GSM", "ROLL NO.", "WEIGHT"]) assert.match(label, new RegExp(words.replace(".", "\\.")))
for (const words of ["Vendor", "Received", "GRN", "QC status", "(spec)"]) assert.doesNotMatch(label, new RegExp(`>${words.replace(/[()]/g, "\\$&")}`))
assert.match(read("components/inventory/lot-label.tsx"), /PlantReelLabel/)
assert.match(read("components/procurement/lot-labels.tsx"), /PlantReelLabel/)
assert.match(read("components/opening-stock/label-sheet.tsx"), /LabelSheet/)
assert.match(read("app/(dashboard)/inventory/locations/lot-labels/page.tsx"), /LabelSheet/)
assert.match(read("components/inventory/label-sheet.css"), /repeat\(2, 92mm\)/)
assert.match(read("components/inventory/label-sheet.css"), /@page reel-label-single/)
assert.match(read("app/(dashboard)/system/plants/page.tsx"), /ReelSerialSetting/)
assert.match(read("app/(dashboard)/system/plants/page.tsx"), /plant-label-heading/)
assert.match(read("app/(dashboard)/masters/vendors/page.tsx"), /"short_name"/)
assert.match(read("app/(dashboard)/purchase/inward/page.tsx"), /mill_name: vendor\.short_name/)

// Owner decision 7: employee performance report.
const row = (over: Partial<EmployeeRow>): EmployeeRow => ({
  operator_key: "id:e1", operator_name: "Ramesh Patel", operator_code: "W01", department: "WINDER", stage: "WINDER", unit: "bamboo",
  runs: 3, made: 350, good: 325, rejected: 25, reject_pct: 7.142857, flagged_qc: 3, qc_readings: 9, shifts_worked: 3, days_worked: 2,
  hours: 7.5, last_activity: "2026-10-31T12:00:00", ...over,
})
const rows = [row({}), row({ stage: "OVEN", runs: 1, made: 80, good: 78, rejected: 2, reject_pct: 2.5 }), row({ operator_key: "name:SURESH, JR", operator_name: "Suresh, Jr", operator_code: null, department: null, runs: 9, reject_pct: null, hours: null })]
const csv = employeeCsv(rows, { from: "2026-10-01", to: "2026-10-31", shift: "SHIFT_A", stage: "", department: "WINDER" }).split("\n")
assert.equal(csv[0], "Operator,Code,Department,Stage,Unit,Runs,Made,Good,Rejected,Reject %,Flagged QC readings,QC readings,Shifts worked,Days worked,Hours on card,Last activity")
assert.equal(csv[1], "Ramesh Patel,W01,WINDER,Winding,bamboos,3,350,325,25,7.1,3,9,3,2,7.5,2026-10-31T12:00:00")
assert.ok(csv[3].startsWith('"Suresh, Jr",,,Winding'), "a comma in a name is quoted")
assert.ok(csv.includes("Shift,Shift A") && csv.includes("Department,Winder") && csv.includes("Stage,All stages"))
const groups = byOperator(rows)
assert.deepEqual(groups.map((group) => [group.name, group.rows.length, group.runs]), [["Suresh, Jr", 1, 9], ["Ramesh Patel", 2, 4]])

assert.ok(existsSync(resolve(process.cwd(), "app/(dashboard)/reports/employees/page.tsx")))
assert.match(read("app/(dashboard)/layout.tsx"), /href: "\/reports\/employees"/)
assert.match(read("app/(dashboard)/reports/employees/page.tsx"), /RoleGate allow=\{\["Owner", "Admin", "PlantManager", "Planner"\]\}/)

console.log("labels-people tests passed")
