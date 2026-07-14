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
  await expect(page.getByPlaceholder(/Search QR \/ asset no/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /Scan QR/i })).toBeVisible()
  await expect(page.getByText(/QR asset ledger/i)).toBeVisible()
  await expect(page.getByText(/notch_distance_mm/i)).toHaveCount(0)
  await expect(page.getByText(/notch_depth_mm/i)).toHaveCount(0)

  await page.getByRole("button", { name: /Add Tool/i }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(/Add Tooling Master/i)).toBeVisible()
  await expect(dialog.getByText(/^Code$/i)).toHaveCount(0)
  await expect(dialog.getByText(/maintenance due/i)).toHaveCount(0)
  await expect(dialog.getByText(/^Location$/i)).toHaveCount(0)
  const category = dialog.locator("select").first()
  await dialog.getByTestId("tool-option-manage-degree").click()
  await expect(dialog.getByTestId("tool-option-panel-degree")).toBeVisible()
  await expect(dialog.getByPlaceholder(/Add degree value/i)).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Discontinue/i }).first()).toBeVisible()
  await page.screenshot({ path: path.join(workspaceRoot, "reports", "tooling-dropdown-manager-browser.png"), fullPage: true })
  await dialog.getByTestId("tool-option-manage-degree").click()
  await category.selectOption("BLADE")
  for (const label of ["Type", "Thickness", "Height", "Length"]) {
    await expect(dialog.getByText(new RegExp(`^${label}$`, "i"))).toBeVisible()
  }
  await category.selectOption("PUNCH")
  await expect(dialog.locator("label").filter({ hasText: /^Punch$/i })).toBeVisible()
  await dialog.getByRole("button", { name: /Cancel/i }).click()

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
  await expect(page.getByTestId("spec-field-notch_distance_mm")).toHaveAttribute("type", "number")
  await expect(page.getByTestId("spec-field-notch_depth_mm")).toHaveAttribute("type", "number")
  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await page.screenshot({ path: path.join(workspaceRoot, "reports", "spec-sheet-browser.png"), fullPage: true })
})

test("supervisor job card uses physical tool assignment controls", async ({ page }) => {
  await loginThroughUi(page)
  await page.goto("/production/supervisor-entry", { waitUntil: "domcontentloaded" })
  const firstJobCard = page.locator('[data-testid^="supervisor-entry:select:"]').first()
  await expect(firstJobCard).toBeVisible()
  await firstJobCard.click()

  await expect(page.getByText(/Physical Tool Issue|Physical Tools/i).first()).toBeVisible()
  await expect(page.getByText(/Tool QR asset IDs/i)).toHaveCount(0)
  await page.screenshot({ path: path.join(workspaceRoot, "reports", "job-card-tooling-browser.png"), fullPage: true })
})
