import assert from 'node:assert/strict'
import {
  classOfDemand, classOfItem, formatQty, fromDisplay, laneFigures, openPoBalances, paperGsm,
  varietyGroups, vehiclesPerDay, vendorPositions,
} from '../lib/material-schedule'

// Item classes follow the workbook blocks: paper RM, chemicals RM, packing PM
assert.equal(classOfItem({ type: 'RAW_PAPER' }), 'PAPER')
assert.equal(classOfItem({ type: 'ADHESIVE' }), 'CHEMICAL')
assert.equal(classOfItem({ type: 'PARCHMENT' }), 'CHEMICAL')
assert.equal(classOfItem({ type: 'PACKAGING' }), 'PACKING')
assert.equal(classOfItem({ type: 'FINISHED_GOOD' }), null)
assert.equal(classOfDemand({}), 'PAPER')
assert.equal(classOfDemand({ material_class: 'PARCHMENT' }), 'CHEMICAL')
assert.equal(classOfDemand({ material_class: 'PACKING' }), 'PACKING')

// GSM from codes and names
assert.equal(paperGsm({ item_code: 'KRAFT-230-18BF' }), 230)
assert.equal(paperGsm({ item_code: 'VP 351' }), 351)
assert.equal(paperGsm({ item_code: 'RM01', name: 'Kraft 18 BF 301 gsm' }), 301)
assert.equal(paperGsm({ item_code: 'LILAC' }), null)

// Workbook SEP 2026, 351 GSM variety: VP 351 + AP 351 (op 58 + 26 MT), 84 + 240 MT scheduled, 315 MT required
const figures = laneFigures({
  itemIds: ['vp351', 'ap351', 'vp230'],
  scheduledByItem: { vp351: 84000, ap351: 240000, vp230: 84000 },
  openingByItem: { vp351: 58000, ap351: 26000, vp230: 20000 },
  bomByItem: { vp351: 200000, ap351: 115000, vp230: 50000 },
  manualByItem: { vp230: 99000 },
})
assert.equal(figures.vp351.closing, -58000)
assert.equal(figures.vp230.required, 99000)
assert.equal(figures.vp230.manual, true)
assert.equal(figures.vp230.bomRequired, 50000)
assert.equal(figures.vp230.closing, 5000)
const groups = varietyGroups([
  { id: 'vp351', item_code: 'VP 351' }, { id: 'vp230', item_code: 'VP 230' }, { id: 'ap351', item_code: 'AP 351' },
], figures)
assert.deepEqual(groups.map((group) => group.label), ['230 GSM', '351 GSM'])
const g351 = groups[1]
assert.deepEqual(g351.itemIds, ['vp351', 'ap351'])
assert.equal(g351.opening, 84000)
assert.equal(g351.scheduled, 324000)
assert.equal(g351.required, 315000)
assert.equal(g351.closing, 93000)

// Pending PO: only open statuses, only this class's items, net of received and short-closed
const orders = [
  { supplier_id: 'akhsat', supplier_name: 'AKHSAT', status: 'APPROVED', po_no: 'PO-1', lines: [
    { item_id: 'ap351', qty_ordered: 300000, qty_received: 20000, qty_short_closed: 0 },
    { item_id: 'glue', qty_ordered: 5000, qty_received: 0 },
  ] },
  { supplier_id: 'akhsat', supplier_name: 'AKHSAT', status: 'PARTIALLY_RECEIVED', po_no: 'PO-2', lines: [{ item_id: 'ap351', qty_ordered: 50000, qty_received: 40000, qty_short_closed: 10000 }] },
  { supplier_id: 'vatsalya', supplier_name: 'VATSALYA', status: 'DRAFT', po_no: 'PO-3', lines: [{ item_id: 'vp351', qty_ordered: 999 }] },
  { supplier_id: 'bn', supplier_name: 'BN', status: 'CANCELLED', po_no: 'PO-4', lines: [{ item_id: 'vp351', qty_ordered: 999 }] },
]
const pending = openPoBalances(orders, new Set(['vp351', 'ap351', 'vp230']))
assert.deepEqual(Object.keys(pending), ['akhsat'])
assert.equal(pending.akhsat.qty, 280000)
assert.deepEqual(pending.akhsat.poNos, ['PO-1'])

// Vendor block: scheduled vs pending -> PO to raise
const vendors = vendorPositions({
  laneIds: ['vp351', 'ap351', 'vp230'],
  laneVendors: { vp351: 'vatsalya', ap351: 'akhsat', vp230: 'vatsalya' },
  scheduledByItem: { vp351: 84000, ap351: 240000, vp230: 84000 },
  openPo: pending,
  vendorName: (id) => id.toUpperCase(),
})
const byVendor = Object.fromEntries(vendors.map((row) => [row.vendorId, row]))
assert.equal(byVendor.vatsalya.scheduled, 168000)
assert.equal(byVendor.vatsalya.pendingPo, 0)
// Workbook sign: SHORT PO = PENDING - scheduled
assert.equal(byVendor.vatsalya.shortPo, -168000) // nothing on order: raise a PO for 168 MT
assert.equal(byVendor.vatsalya.toRaise, 168000)
assert.equal(byVendor.akhsat.shortPo, 40000) // 40 MT on order not yet scheduled
assert.equal(byVendor.akhsat.toRaise, 0)

// Vehicles per day = lanes with an arrival that day
const cells: Record<string, number> = { '2026-09-05:vp351': 12000, '2026-09-05:ap351': 12000, '2026-09-06:vp230': 0 }
assert.deepEqual(vehiclesPerDay(['2026-09-05', '2026-09-06'], ['vp351', 'ap351', 'vp230'], (day, id) => cells[`${day}:${id}`] || 0), { '2026-09-05': 2, '2026-09-06': 0 })

// MT display round-trips to exact kg
assert.equal(fromDisplay(12.345, 'MT'), 12345)
assert.equal(formatQty(12345, 'MT'), '12.345')
assert.equal(formatQty(2500, 'PCS'), '2,500')

console.log('material-schedule: ok')
