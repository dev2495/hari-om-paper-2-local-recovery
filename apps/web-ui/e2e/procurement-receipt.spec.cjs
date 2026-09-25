const { test, expect } = require('@playwright/test')
const { getBrowserFixture, getRuntimeManifest, requireCredential, beginCriticalMonitoring } = require('./_runtime-data.cjs')

test('manual paper inward saves distinct reel labels and separates commercial approval from QC', async ({ page }) => {
  const fixture = getBrowserFixture(), bff = getRuntimeManifest().urls.bff
  if (!['localhost', '127.0.0.1'].includes(new URL(bff).hostname)) throw new Error('Isolated local acceptance only')
  const headers = { 'X-Plant-ID': fixture.plants.plant_a.id }
  const check = beginCriticalMonitoring(page)
  async function login(key) {
    await page.context().clearCookies()
    const user = requireCredential(key)
    const response = await page.request.post(`${bff}/api/auth/login`, { data: { email: user.email, password: user.password } })
    expect(response.ok()).toBeTruthy()
    await page.evaluate(id => localStorage.setItem('hariom_active_plant', id), fixture.plants.plant_a.id)
  }
  await page.goto('/login')
  await login('admin')
  const response = await page.request.get(`${bff}/api/inventory/items`, { headers })
  expect(response.ok()).toBeTruthy()
  const itemResponse = await page.request.post(`${bff}/api/inventory/items`, { headers, data: {
    item_code: `BROWSER-PAPER-${Date.now()}`, name: 'Isolated browser paper inward fixture',
    type: 'RAW_PAPER', tracking_mode: 'REEL', uom: 'KG',
  } })
  expect(itemResponse.ok(), await itemResponse.text()).toBeTruthy()
  const paper = await itemResponse.json()
  await page.goto('/purchase/inward')
  await page.getByRole('combobox', { name: 'Receipt source', exact: true }).selectOption('MANUAL')
  const vendor = page.getByRole('combobox', { name: 'Vendor', exact: true })
  await expect.poll(async () => vendor.locator('option[value]:not([value=""])').count()).toBeGreaterThan(0)
  await vendor.selectOption(await vendor.locator('option[value]:not([value=""])').first().getAttribute('value'))
  await page.getByLabel('Reason for no PO', { exact: true }).fill('Isolated browser acceptance of urgent material inward')
  await page.getByLabel('Invoice number', { exact: true }).fill(`BROWSER-GRN-${Date.now()}`)
  await page.getByRole('combobox', { name: 'Material / variety', exact: true }).selectOption(paper.id)
  await page.getByLabel(/Invoice rate \//).fill('31')
  const unique = Date.now()
  await page.getByLabel('Material 1 lot 1 source_reel_no', { exact: true }).fill(`BROWSER-${unique}-1`)
  await page.getByLabel('Material 1 lot 1 net_weight_kg', { exact: true }).fill('60')
  await page.getByLabel('Material 1 lot 1 width_mm', { exact: true }).fill('850')
  await page.getByRole('button', { name: 'Add reel / coil', exact: true }).click()
  await page.getByLabel('Material 1 lot 2 source_reel_no', { exact: true }).fill(`BROWSER-${unique}-2`)
  await page.getByLabel('Material 1 lot 2 net_weight_kg', { exact: true }).fill('40')
  await expect(page.getByLabel('Material 1 lot 2 source_reel_no', { exact: true })).toHaveValue(`BROWSER-${unique}-2`)
  await expect(page.getByLabel('Material 1 lot 2 net_weight_kg', { exact: true })).toHaveValue('40')
  await page.getByRole('button', { name: 'Validate receipt', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Validation result', exact: true })).toBeVisible()
  const post = page.getByRole('button', { name: 'Post goods inward', exact: true })
  await expect(post).toBeEnabled()
  // Commercial edits also invalidate the reviewed receipt.
  await page.getByLabel('Invoice number', { exact: true }).fill(`BROWSER-GRN-${unique}-FINAL`)
  await expect(post).toBeDisabled()
  await page.getByRole('button', { name: 'Validate receipt', exact: true }).click()
  await expect(post).toBeEnabled()
  const postedResponse = page.waitForResponse(result => result.url().endsWith('/api/purchase/v2/manual-receipts') && result.request().method() === 'POST')
  await post.click()
  const posted = await postedResponse
  expect(posted.ok(), await posted.text()).toBeTruthy()
  const receipt = await posted.json()
  expect(receipt.receipt_kind).toBe('MANUAL')
  expect(receipt.purchase_order_id).toBeNull()
  expect(receipt.lot_count).toBe(2)
  expect(new Set(receipt.lots.map(lot => lot.label.qr_value)).size).toBe(2)
  expect(receipt.lots.map(lot => lot.stock_status)).toEqual(['BLOCKED', 'BLOCKED'])
  await page.getByRole('link', { name: 'Open saved receipt', exact: true }).click()
  await expect(page.getByText(receipt.grn_no).first()).toBeVisible()
  await login('owner')
  await page.goto(`/purchase/receipts/${receipt.id}`)
  await page.getByLabel('Commercial review reason', { exact: true }).fill('Independent check of invoice and measured quantities')
  await page.getByRole('button', { name: 'Approve manual purchase and invoice rates', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve manual purchase and invoice rates', exact: true })).toHaveCount(0)
  const savedResponse = await page.request.get(`${bff}/api/purchase/v2/receipts/${receipt.id}`, { headers })
  expect(savedResponse.ok()).toBeTruthy()
  const saved = await savedResponse.json()
  expect(saved.commercial_status).toBe('CLEAR')
  expect(saved.lots.map(lot => lot.stock_status)).toEqual(['QC_HOLD', 'QC_HOLD'])
  await expect(page.getByRole('link', { name: 'Inspect in Quality Control' })).toBeVisible()
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR}/manual-receipt-independent-qc.png`, fullPage: true })
  await check()
})

test('mixed-unit purchase order keeps kg and pieces separate in saved quantities', async ({ page }) => {
  const fixture = getBrowserFixture(), bff = getRuntimeManifest().urls.bff
  if (!['localhost', '127.0.0.1'].includes(new URL(bff).hostname)) throw new Error('Isolated local acceptance only')
  const headers = { 'X-Plant-ID': fixture.plants.plant_a.id }
  const check = beginCriticalMonitoring(page)
  await page.goto('/login')
  const admin = requireCredential('admin')
  const auth = await page.request.post(`${bff}/api/auth/login`, { data: { email: admin.email, password: admin.password } })
  expect(auth.ok()).toBeTruthy()
  await page.evaluate(id => localStorage.setItem('hariom_active_plant', id), fixture.plants.plant_a.id)
  const items = []
  for (const uom of ['KG', 'PCS']) {
    const response = await page.request.post(`${bff}/api/inventory/items`, { headers, data: {
      item_code: `MIXED-${uom}-${Date.now()}`, name: `Isolated purchase quantity ${uom}`, type: 'OTHER', tracking_mode: 'BULK', uom,
    } })
    expect(response.ok(), await response.text()).toBeTruthy()
    items.push(await response.json())
  }
  const vendors = await page.request.get(`${bff}/api/master/vendors`, { headers })
  expect(vendors.ok()).toBeTruthy()
  const vendor = (await vendors.json())[0]
  expect(vendor).toBeTruthy()
  const response = await page.request.post(`${bff}/api/purchase/orders`, { headers, data: {
    request_id: require('crypto').randomUUID(), category: 'OT', supplier_id: vendor.id, supplier_name: vendor.name,
    lines: items.map((item, index) => ({ item_id: item.id, uom: item.uom, qty_ordered: index ? 20 : 100, unit_cost: 5 })),
  } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const order = await response.json()
  await page.goto(`/purchase/${order.id}`)
  await expect(page.getByText('100 KG + 20 PCS', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('100 KG', { exact: true })).toBeVisible()
  await expect(page.getByText('20 PCS', { exact: true })).toBeVisible()
  await expect(page.getByText('120 kg', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR}/mixed-unit-purchase-order.png`, fullPage: true })
  await check()
})
