import assert from 'node:assert/strict'
import {
  addDays, chipState, chunkDays, compactQty, perUnitParts, coverDays, coverWord, dayCoverWord, istDay, longDate, perUnit, personName, qty, rateText, relativeDay, rupees, searchMatch, weekStart, weeksOf,
} from '../components/procurement/rm-calendar/format'
import { canDecideOrder, vendorMessage, deliveryRows } from '../components/procurement/rm-calendar/desk-text'

// Monday weeks (PO grouping is one PO per vendor per ISO week)
assert.equal(weekStart('2026-10-28'), '2026-10-26')
assert.equal(weekStart('2026-11-01'), '2026-10-26')
assert.equal(weekStart('2026-11-02'), '2026-11-02')
assert.equal(addDays('2026-10-31', 1), '2026-11-01')
assert.equal(addDays('2027-03-01', -1), '2027-02-28')
const weeks = weeksOf(Array.from({ length: 56 }, (_, i) => addDays('2026-10-28', i)))
assert.equal(weeks.length, 9)
assert.deepEqual([weeks[0][0], weeks[0][6], weeks[8][0]], ['2026-10-26', '2026-11-01', '2026-12-21'])

// Indian dates, IST days from naive-UTC server stamps, plain relative words
assert.equal(longDate('2026-10-27'), '27 Oct 2026')
assert.equal(istDay('2026-10-27T20:00:00'), '2026-10-28') // 01:30 IST next day
assert.equal(relativeDay('2026-10-28', '2026-10-28'), 'Today')
assert.equal(relativeDay('2026-10-29', '2026-10-28'), 'Tomorrow')

// en-IN quantities with the unit; pieces never get decimals; totals never mix units
assert.equal(qty(1234.5, 'KG'), '1,234.5 kg')
assert.equal(qty(40, 'PCS'), '40 pcs')
assert.equal(qty(-200, 'KG'), '−200 kg')
assert.equal(perUnit({ KG: 1240, PCS: 300 }), '1,240 kg · 300 pcs')
assert.equal(perUnit({}), '0')
assert.equal(personName('owner2.e2e@hariom.com'), 'Owner2 E2e')

// Chip words: received wins, then overdue (proposals stay proposals)
assert.equal(chipState({ state: 'SENT', overdue: true, open_qty: 10 }).label, 'Overdue')
assert.equal(chipState({ state: 'RECEIVED', overdue: true, open_qty: 0 }).label, 'Received')
assert.equal(chipState({ state: 'PROPOSED', overdue: true, open_qty: 5 }).label, 'Proposed · late')
assert.equal(chipState({ state: 'CONFIRMED', overdue: false, open_qty: 5 }).tone, 'confirmed')

// Cover in words
assert.equal(coverWord({ first_short: null, days_of_cover: null, uom: 'KG' }, 8, '2026-10-28').text, 'Covered for 8 weeks')
assert.equal(coverWord({ first_short: { date: '2026-11-11', qty: 39.4, kind: 'BELOW_ZERO', balance: -39.4 }, days_of_cover: 14, uom: 'KG' }, 8, '2026-10-28').text, 'Short from 11 Nov')
assert.equal(coverWord({ first_short: { date: '2026-10-28', qty: 20, kind: 'BELOW_MIN', balance: 30 }, days_of_cover: 0, uom: 'KG' }, 8, '2026-10-28').text, 'Below minimum today')
// The day sheet speaks for ITS day (checker r4: Kraft 300 on Sat 31 Oct said "Short today" with 375.2 kg left)
const kraft300 = { first_short: { date: '2026-10-30', qty: 74.8, kind: 'BELOW_ZERO' as const, balance: -74.8 }, balance: [-74.8, 375.2], min_stock: null, uom: 'KG' }
assert.equal(dayCoverWord(kraft300, 1, '2026-10-31', '2026-10-30').text, 'Covered this day · short today')
assert.equal(dayCoverWord(kraft300, 0, '2026-10-30', '2026-10-30').text, 'Short 74.8 kg today')
assert.equal(dayCoverWord({ ...kraft300, first_short: { ...kraft300.first_short, date: '2026-11-04' } }, 1, '2026-10-31', '2026-10-30').text, 'Covered this day · short from 4 Nov')
assert.equal(dayCoverWord({ ...kraft300, min_stock: 400 }, 1, '2026-10-31', '2026-10-30').tone, 'low')
assert.ok(searchMatch({ item_code: 'KR-230', item_name: 'Kraft 230 GSM' }, 'kraft'))

// Vendor message carries the PO number, quantities in their unit and the open delivery dates
const order: any = { id: 'po', po_no: 'RP-PM/08', current_revision_no: 1, supplier_name: 'Shree Kraft Mills', lines: [
  { id: 'l1', item_code: 'KR-230', item_name: 'Kraft 230', uom: 'KG', qty_ordered: 1200,
    schedules: [{ id: 's1', current_date: '2026-11-03', promised_date: '2026-11-03', scheduled_qty: 1200, cancelled_qty: 0, allocated_qty: 0, open_qty: 1200, confirmation_status: 'TENTATIVE', from_calendar: true }] }] }
assert.equal(deliveryRows(order).length, 1)
assert.match(vendorMessage(order), /RP-PM\/08 .*KR-230 1,200 kg\. Delivery: 3 Nov: KR-230 1,200 kg/)
console.log('rm-calendar ok')

// Rolling weeks from today (no past days in the week grid), units in dense cells, days of cover
const rolling = chunkDays(Array.from({ length: 56 }, (_, i) => addDays('2026-10-28', i)))
assert.equal(rolling.length, 8)
assert.deepEqual([rolling[0][0], rolling[0][6], rolling[7][6]], ['2026-10-28', '2026-11-03', '2026-12-22'])
// Dense cells keep en-IN figures with the unit (checker 2026-10-28: no "1.8k")
assert.equal(compactQty(1500, 'KG'), '1,500 kg')
assert.equal(compactQty(200, 'PCS'), '200 pcs')
assert.equal(compactQty(-1812.4, 'KG'), '−1,812 kg')
assert.equal(compactQty(125000, 'KG'), '1,25,000 kg')
assert.equal(compactQty(7.25, 'KG'), '7.25 kg')
assert.deepEqual(perUnitParts({ KG: 2415, PCS: 130, L: 0 }), ['2,415 kg', '130 pcs'])
// A rejected PO is its own state with a word, never "On PO"
assert.deepEqual(chipState({ state: 'REJECTED', overdue: false, open_qty: 40 }), { tone: 'rejected', label: 'PO rejected' })
// Maker-checker on the page matches the server: scheduled POs are the Owner's own decision
assert.equal(canDecideOrder({ revision_makers: ['owner@x.com'], owner_may_decide_own: false }, 'Owner@x.com'), false)
assert.equal(canDecideOrder({ revision_makers: ['owner@x.com'], owner_may_decide_own: true }, 'owner@x.com'), true)
assert.equal(canDecideOrder({ revision_makers: ['planner@x.com'], owner_may_decide_own: false }, 'owner@x.com'), true)
assert.equal(coverDays({ first_short: null, days_of_cover: null }, 8), 'Covers all 8 weeks')
assert.equal(coverDays({ first_short: { date: '2026-11-10', qty: 5, kind: 'BELOW_ZERO', balance: -5 }, days_of_cover: 13 }, 8), '13 days of cover')
assert.equal(coverDays({ first_short: { date: '2026-10-28', qty: 5, kind: 'BELOW_ZERO', balance: -5 }, days_of_cover: 0 }, 8), 'No cover left')
// Nothing needed before the short day (0 kg usable, Kraft 350 GSM, checker 2026-10-30): no "days of cover".
assert.equal(coverDays({ first_short: { date: '2026-11-11', qty: 63, kind: 'BELOW_ZERO', balance: -63 }, days_of_cover: 12, need: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63] }, 8), 'No need until 11 Nov')
assert.equal(coverDays({ first_short: { date: '2026-11-11', qty: 63, kind: 'BELOW_ZERO', balance: -63 }, days_of_cover: 12, need: [0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63] }, 8), '12 days of cover')
assert.equal(coverDays({ first_short: { date: '2026-10-29', qty: 5, kind: 'BELOW_MIN', balance: 1 }, days_of_cover: 1 }, 8), '1 day above minimum')
// What the Owner approves: the rate and value, or "Rate needed"
assert.equal(rateText(44.5, 'KG'), '₹44.50 / kg')
assert.equal(rateText(22, 'PCS'), '₹22.00 / piece')
assert.equal(rateText(0, 'KG'), 'Rate needed')
assert.equal(rupees(1780), '₹1,780')
