import assert from "node:assert/strict"

import { dispatchRefFromScan, isMobile, mobileDigits, passTokenFromScan } from "../lib/gate-scan"

// Gate (6 Nov 2026): the visitor's mobile however it is typed, India only.
assert.equal(mobileDigits("+91 98765 43210"), "9876543210")
assert.equal(mobileDigits("098765-43210"), "9876543210")
assert.equal(isMobile("98765 43210"), true)
assert.equal(isMobile("1234567890"), false)
assert.equal(isMobile("98765"), false)

// The pass QR: the watchman's scanner reads the payload or the link; anything else is not a pass.
assert.equal(passTokenFromScan("HARIOM|VISIT|krbdvG7bgj-yB4KgGaU3rA"), "krbdvG7bgj-yB4KgGaU3rA")
assert.equal(passTokenFromScan("https://erp.example.com/visit/pass/krbdvG7bgj-yB4KgGaU3rA"), "krbdvG7bgj-yB4KgGaU3rA")
assert.equal(passTokenFromScan("HARIOM|REEL|plant|id|AT06281"), null)

// The challan QR opens /gate?out=<dispatch ref>; the raw payload form and a typed challan number work too.
assert.equal(dispatchRefFromScan("https://erp.example.com/gate?out=DC%2F26%2F0042"), "DC/26/0042")
assert.equal(dispatchRefFromScan("HARIOM|DISPATCH|plant-a|DC-20261101-1BFD0BB4"), "DC-20261101-1BFD0BB4")
assert.equal(dispatchRefFromScan(" DC-20261101-1BFD0BB4 "), "DC-20261101-1BFD0BB4")

console.log("gate tests passed")
