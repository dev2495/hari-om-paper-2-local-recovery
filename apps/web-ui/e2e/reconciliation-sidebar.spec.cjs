const path = require("path")
const { test, expect } = require("@playwright/test")
const { getRuntimeManifest, getBrowserFixture, workspaceRoot } = require("./_runtime-data.cjs")

async function loginAsAdmin(page) {
  const runtimeManifest = getRuntimeManifest()
  const browserFixture = getBrowserFixture()
  const bffUrl = runtimeManifest?.urls?.bff || "http://127.0.0.1:14000"
  const plantA = browserFixture?.plants?.plant_a?.id
  if (!plantA) throw new Error("Browser fixture missing real plants.plant_a.id")

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(() => {
    window.localStorage.removeItem("hariom_access_token")
    window.localStorage.removeItem("hariom_active_plant")
    window.localStorage.removeItem("hariom_active_role")
  })

  const response = await page.request.post(`${bffUrl}/api/auth/login`, {
    data: {
      email: browserFixture.auth.admin_email,
      password: browserFixture.auth.admin_password,
    },
  })
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token).toBeUndefined()
  await page.evaluate(
    ({ plant }) => {
      window.localStorage.setItem("hariom_active_plant", plant)
      window.localStorage.setItem("hariom_active_role", "Owner")
    },
    { plant: plantA },
  )
}

test("sidebar approval card is removed and month-end close replaces the old reconciliation pages", async ({ page }) => {
  await loginAsAdmin(page)

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/approval inbox/i)).toHaveCount(0)
  await expect(page.getByText(/Track pending specs/i)).toHaveCount(0)

  // Month-end close (client 2026-10-28): one page; Usage limits is its only sub-page.
  await page.goto("/production/reconciliation", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("month-end-close-page")).toBeVisible()
  await expect(page.getByRole("link", { name: "Actual entry", exact: true })).toHaveCount(0)
  await page.locator(".tube-subnav").getByRole("link", { name: "Usage limits", exact: true }).click()
  await expect(page).toHaveURL(/\/production\/reconciliation\/limits/)
  await expect(page.getByTestId("usage-limits-page")).toBeVisible()

  // Old bookmarks still land on the right tab.
  await page.goto("/production/reconciliation/actuals?month=2026-09", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/production\/reconciliation\?tab=month&month=2026-09/)
  await page.goto("/production/reconciliation/history", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/production\/reconciliation\?tab=past/)
  await page.goto("/system/tolerances", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/production\/reconciliation\/limits/)
})
