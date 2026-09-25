const { test, expect } = require('@playwright/test')
const { getBrowserFixture, getRuntimeManifest, requireCredential, beginCriticalMonitoring } = require('./_runtime-data.cjs')

test('critical item criterion saves, approves, and keeps the approved snapshot when edited on mobile', async ({ page }) => {
  const fixture = getBrowserFixture(), bff = getRuntimeManifest().urls.bff
  if (!['localhost', '127.0.0.1'].includes(new URL(bff).hostname)) throw new Error('Isolated local acceptance only')
  const headers = { 'X-Plant-ID': fixture.plants.plant_a.id }, user = requireCredential('admin')
  const monitor = beginCriticalMonitoring(page)
  await page.goto('/login')
  const login = await page.request.post(`${bff}/api/auth/login`, { data: { email: user.email, password: user.password } })
  expect(login.ok()).toBeTruthy()
  await page.evaluate(id => localStorage.setItem('hariom_active_plant', id), fixture.plants.plant_a.id)
  const code = `CRITICAL-QC-${Date.now()}`
  const created = await page.request.post(`${bff}/api/inventory/items`, { headers, data: {
    item_code: code, name: 'Synthetic critical quality policy', type: 'OTHER', tracking_mode: 'BULK', uom: 'PCS',
  } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const item = await created.json()
  const endpoint = `/api/inventory/items/${item.id}/quality-profile`
  const seeded = await page.request.put(`${bff}${endpoint}`, { headers, data: { setup_status: 'draft', quality_profile: {
    status: 'draft', parameters: [{ code: 'length', label: 'Length', unit: 'mm', min: 90, max: 110, required: true }],
  } } })
  expect(seeded.ok(), await seeded.text()).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inventory/items')
  await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: 'Edit', exact: true }).click()
  const form = page.getByTestId('item-quality-profile-form')
  const critical = form.getByRole('checkbox', { name: 'Critical non-waivable check: Length', exact: true })
  await critical.check()
  const saveResponse = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT')
  await form.getByRole('button', { name: 'Save item QC profile', exact: true }).click()
  const saved = await saveResponse
  expect(saved.ok(), await saved.text()).toBeTruthy()
  expect((await saved.json()).quality_profile.parameters[0].non_waivable).toBe(true)
  const approvalResponse = page.waitForResponse(r => r.url().endsWith(`${endpoint}/approve`) && r.request().method() === 'POST')
  await form.getByRole('button', { name: 'Approve profile', exact: true }).click()
  const approval = await approvalResponse
  expect(approval.ok(), await approval.text()).toBeTruthy()
  expect((await approval.json()).quality_profile.approved_snapshot.parameters[0].non_waivable).toBe(true)
  // Ensure the invalidation reload has settled before editing the approved revision.
  await expect.poll(async () => {
    const response = await page.request.get(`${bff}/api/inventory/items`, { headers })
    return (await response.json()).find(row => row.id === item.id)?.quality_profile?.status
  }).toBe('approved')
  await page.reload()
  await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: 'Edit', exact: true }).click()
  await critical.uncheck()
  const revisedResponse = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT')
  await form.getByRole('button', { name: 'Save item QC profile', exact: true }).click()
  const revised = await revisedResponse
  expect(revised.ok(), await revised.text()).toBeTruthy()
  const profile = (await revised.json()).quality_profile
  expect(profile.status).toBe('draft')
  expect(profile.revision).toBe(2)
  expect(profile.parameters[0].non_waivable).toBe(false)
  expect(profile.approved_snapshot.parameters[0].non_waivable).toBe(true)
  await expect(form.getByText('Saved for review. Approval is a separate action.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy()
  await form.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR}/critical-quality-profile-mobile.png` })
  await monitor()
})
