const fs = require("fs")
const path = require("path")
const { test, expect } = require("@playwright/test")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")
const fixturePath = process.env.ERP_BROWSER_FIXTURE || path.join(workspaceRoot, "reports", "browser_e2e_fixture_latest.json")

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

const browserFixture = readJson(fixturePath)

async function loginThroughUi(page) {
  const email = browserFixture?.auth?.admin_email || "admin@hariom.com"
  const password = browserFixture?.auth?.admin_password || "admin123"
  const bffBaseUrl = browserFixture?.base_urls?.bff || "http://127.0.0.1:14000"
  const response = await page.request.post(`${bffBaseUrl}/api/auth/login`, { data: { email, password } })
  expect(response.ok(), "admin login through BFF should succeed").toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token, "admin access token should be present").toBeTruthy()

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(({ token, plantId }) => {
    window.localStorage.setItem("hariom_access_token", token)
    window.localStorage.setItem("hariom_active_plant", plantId)
  }, {
    token: payload.access_token,
    plantId: browserFixture?.plants?.plant_a?.id || "00000000-0000-0000-0000-0000000000a1",
  })
}

test("tooling master and physical ledger expose the production workflow", async ({ page }) => {
  await loginThroughUi(page)
  await page.goto("/masters/tools", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: "Tooling Master" })).toBeVisible()
  await expect(page.getByText(/Five fixed tooling categories define the spec-sheet dropdowns/i)).toBeVisible()
  for (const label of ["Notch", "Blade", "Holder", "V + Flat", "Punch"]) {
    await expect(page.locator("option").filter({ hasText: label }).first()).toHaveCount(1)
  }
  await expect(page.getByText(/Editable dropdown registry/i)).toBeVisible()
  await expect(page.getByPlaceholder(/Scan or search QR \/ asset no/i)).toBeVisible()
  await expect(page.getByText(/QR asset ledger/i)).toBeVisible()

  await page.screenshot({ path: path.join(workspaceRoot, "reports", "tooling-master-browser.png"), fullPage: true })
})

test("spec sheet uses searchable mandrel and tube controls and has no suggestions", async ({ page }) => {
  await loginThroughUi(page)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  const mandrel = page.getByTestId("spec-sheet-mandrel")
  await expect(mandrel).toBeVisible()
  await mandrel.click()
  await expect(page.getByRole("button", { name: /OD\s+110\.65/i }).last()).toBeVisible()
  await page.getByRole("button", { name: /OD\s+110\.65/i }).last().click()

  const tube = page.getByTestId("spec-sheet-tube-size")
  await expect(tube).toBeEnabled()
  await tube.click()
  await expect(page.getByRole("button", { name: /110\s*x\s*122\s*x\s*149\.9/i }).last()).toBeVisible()
  await page.getByRole("button", { name: /110\s*x\s*122\s*x\s*149\.9/i }).last().click()
  await expect(page.getByTestId("spec-sheet-live-builder")).toContainText(/Paper total/i)
  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await page.screenshot({ path: path.join(workspaceRoot, "reports", "spec-sheet-browser.png"), fullPage: true })
})
