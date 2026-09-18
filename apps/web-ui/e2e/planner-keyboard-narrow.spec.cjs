const { test, expect } = require("@playwright/test")
const { getRuntimeManifest, getBrowserFixture, beginCriticalMonitoring } = require("./_runtime-data.cjs")

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

test("plan09 keyboard schedule and 390px viewport keep the same planner rules", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await loginAdmin(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/planning/board?section=winder", { waitUntil: "domcontentloaded" })
  const form = page.getByTestId("planner-keyboard-schedule")
  await expect(form).toBeVisible()
  await expect(page.getByTestId("planner-keyboard-schedule:submit")).toBeVisible()
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThan(48)
  await page.keyboard.press("Tab")
  const keyboard = form.locator("select, button").first()
  await keyboard.focus()
  await expect(keyboard).toBeFocused()
  await page.keyboard.press("Escape")
  const jobSelect = page.getByTestId("planner-keyboard-schedule:job")
  const optionCount = await jobSelect.locator("option").count()
  if (optionCount > 1) {
    await jobSelect.selectOption({ index: 1 })
    await page.getByTestId("planner-keyboard-schedule:submit").click()
    await expect(form).toBeVisible()
  }
  assertCritical()
})
