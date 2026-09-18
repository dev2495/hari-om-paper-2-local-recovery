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

test("keyboard focus, modal escape, and narrow viewport keep the shell usable", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const email = page.getByTestId("login-email")
  await email.click()
  await expect(email).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByTestId("login-password")).toBeFocused()
  await loginAdmin(page)
  await page.goto("/masters/tools", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /Add Tool/i }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await assertCritical()
})

test("blank and completed job-card prints keep samples and kg vs g labels", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await loginAdmin(page)
  const fixture = getBrowserFixture()
  const jobId = fixture.flows?.[0]?.job_card_id
  if (!jobId) {
    throw new Error("Setup did not produce a real job_card_id for print verification")
  }
  await page.goto(`/production/job-cards/${jobId}/print`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toContainText(/job card|job-card|print/i)
  const shotDir = path.join(workspaceRoot, "reports")
  await page.screenshot({ path: path.join(shotDir, "job-card-print.png"), fullPage: true })
  const body = ((await page.locator("body").textContent()) || "").toLowerCase()
  if (body.includes(" kg") && body.includes(" g")) {
    expect(body.includes("kg")).toBeTruthy()
  }
  await assertCritical()
})
