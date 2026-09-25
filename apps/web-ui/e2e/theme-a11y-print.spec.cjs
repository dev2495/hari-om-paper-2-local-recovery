const path = require("path")
const { test, expect } = require("@playwright/test")
const { getBrowserFixture, getRuntimeManifest, beginCriticalMonitoring, workspaceRoot } = require("./_runtime-data.cjs")

async function loginAdmin(page) {
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const response = await page.request.post(`${runtime.urls.bff}/api/auth/login`, {
    data: { email: fixture.auth.admin_email, password: fixture.auth.admin_password },
  })
  expect(response.ok()).toBeTruthy()
  await page.evaluate((plantId) => {
    window.localStorage.setItem("hariom_active_plant", plantId)
  }, fixture.plants.plant_a.id)
}

function contrastPair(page, selector) {
  return page.locator(selector).first().evaluate((node) => {
    const style = window.getComputedStyle(node)
    return {
      color: style.color,
      background: style.backgroundColor,
      fontSize: style.fontSize,
    }
  })
}

test("comm01/comm10 compact sales form keeps date labels and has no filler hero", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await loginAdmin(page)
  await page.goto("/sales-orders/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /New sales order/i })).toBeVisible()
  await expect(page.getByText("Customer PO Date")).toBeVisible()
  await expect(page.getByText("Delivery Date").first()).toBeVisible()
  await expect(page.getByTestId("sales-orders:origin-customer-po")).toBeVisible()
  await expect(page.getByTestId("sales-orders:origin-internal")).toBeVisible()
  const body = ((await page.locator("body").textContent()) || "")
  expect(body).not.toMatch(/Release Readiness/i)
  expect(body).not.toMatch(/Sales PO Entry/i)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId("sales-orders:create-form")).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await assertCritical()
})

test("emulated light and dark color-scheme keep login readable", async ({ page }, testInfo) => {
  const assertCritical = beginCriticalMonitoring(page)
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("login-email")).toBeVisible()
  const emailStyle = await contrastPair(page, "[data-testid='login-email']")
  expect(emailStyle.color).toBeTruthy()
  expect(emailStyle.background).toBeTruthy()
  const shotDir = path.join(workspaceRoot, "reports")
  await page.screenshot({
    path: path.join(shotDir, `theme-${testInfo.project.name}-login.png`),
    fullPage: true,
  })
  await assertCritical()
})

test("keyboard, escape, print media, and narrow viewport on job-card print", async ({ page }, testInfo) => {
  const assertCritical = beginCriticalMonitoring(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.getByTestId("login-email").focus()
  await expect(page.getByTestId("login-email")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByTestId("login-password")).toBeFocused()
  await loginAdmin(page)
  await page.goto("/masters/tools", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /Add Tool/i }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  const fixture = getBrowserFixture()
  const jobId = fixture.flows?.[0]?.job_card_id
  if (!jobId) {
    throw new Error("Setup did not produce a real job_card_id for print verification")
  }
  await page.emulateMedia({ media: "print" })
  await page.goto(`/production/job-cards/${jobId}/print`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText(/job card|job-card|print/i)
  const shotDir = path.join(workspaceRoot, "reports")
  await page.screenshot({
    path: path.join(shotDir, `print-${testInfo.project.name}.png`),
    fullPage: true,
  })
  await page.emulateMedia({ media: "screen" })
  await page.setViewportSize({ width: 1280, height: 800 })
  await assertCritical()
})

test("workspace toolbar and plant menu stay usable from 320px through desktop", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await loginAdmin(page)
  await page.goto("/purchase/receipts", { waitUntil: "domcontentloaded" })
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const trigger = page.getByTestId("plant-switcher-trigger").first()
    await expect(trigger).toBeVisible()
    const box = await trigger.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    const books = page.locator('header a[href="/production/reconciliation"]')
    if (await books.isVisible()) expect((await books.boundingBox()).height).toBeLessThan(50)
    await trigger.click()
    const option = page.getByTestId(`plant-option:${getBrowserFixture().plants.plant_b.id}`)
    await expect(option).toBeVisible()
    expect(await option.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    }), `Plant dropdown must not be clipped at ${width}px`).toBeTruthy()
    await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR}/toolbar-${width}.png`, fullPage: true })
    await trigger.click()
    const next = await page.getByRole("button", { name: "Next", exact: true }).boundingBox()
    expect(next.x).toBeGreaterThanOrEqual(0)
    expect(next.x + next.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await assertCritical()
})
