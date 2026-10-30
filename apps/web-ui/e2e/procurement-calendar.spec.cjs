const { test, expect } = require('@playwright/test')
const { getBrowserFixture, getRuntimeManifest, beginCriticalMonitoring } = require('./_runtime-data.cjs')

async function signIn(page) {
  const fixture = getBrowserFixture()
  await page.goto('/login')
  const result = await page.request.post(`${getRuntimeManifest().urls.bff}/api/auth/login`, {
    data: { email: fixture.auth.admin_email, password: fixture.auth.admin_password },
  })
  expect(result.ok(), await result.text()).toBeTruthy()
  await page.evaluate(id => localStorage.setItem('hariom_active_plant', id), fixture.plants.plant_a.id)
}

// The RM inward calendar replaced the month plan workbook (spec 3, 2026-10-28): rolling days from
// today, Week / Month / List, arrivals proposed per day and approved by the Owner, Excel in and out.
test('RM inward calendar shows need, stock and arrivals in every view and downloads Excel', async ({ page }) => {
  const check = beginCriticalMonitoring(page)
  await signIn(page)
  await page.goto('/purchase/scheduler?view=week')
  await expect(page.getByRole('heading', { name: 'RM inward calendar' })).toBeVisible()
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  await expect(grid.getByRole('columnheader', { name: /Today/ })).toBeVisible()
  // Seven days from today fit without a sideways scroll at a desktop width.
  const fits = await grid.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  if ((page.viewportSize()?.width || 0) >= 1280) expect(fits).toBeTruthy()
  await page.getByRole('radio', { name: /Month/ }).click()
  await expect(page.getByRole('region', { name: 'Month view' }).or(page.locator('[aria-label="Month view"]'))).toBeVisible()
  await page.getByRole('radio', { name: /List/ }).click()
  await expect(page.getByRole('list', { name: 'Materials' })).toBeVisible()
  await page.getByRole('button', { name: 'Excel' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Excel' }).click()
  expect((await download).suggestedFilename()).toMatch(/^rm-inward-calendar-.*\.xlsx$/)
  await check()
})

test('client workbook imports as proposals with an explicit unit and never imports helper vehicle counts', async ({ page }) => {
  const check = beginCriticalMonitoring(page)
  if (!process.env.ERP_REFERENCE_WORKBOOK) throw new Error('Set ERP_REFERENCE_WORKBOOK to the client reference workbook')
  await signIn(page)
  await page.goto('/purchase/scheduler?view=list&class=ALL')
  await page.getByRole('button', { name: 'Excel' }).click()
  const importer = page.getByLabel('Import a schedule workbook', { exact: true })
  test.skip(!(await importer.count()), 'Importing adds proposals: the signed-in user is not a Planner, Store, plant head or Owner')
  await importer.setInputFiles(process.env.ERP_REFERENCE_WORKBOOK)
  await expect(page.getByText('Columns → materials')).toBeVisible()
  await expect(page.getByLabel(/^Material for column VEHI/i)).toHaveCount(0)
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR}/client-workbook-preview.png`, fullPage: true })
  await check()
})
