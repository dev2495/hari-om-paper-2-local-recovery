const { test, expect } = require("@playwright/test")
const { getRuntimeManifest, getBrowserFixture, pickFirstSmartSelectOption } = require("./_runtime-data.cjs")

async function login(page) {
  const browserFixture = getBrowserFixture()
  const runtimeManifest = getRuntimeManifest()
  const email = browserFixture.auth.admin_email
  const password = browserFixture.auth.admin_password
  const bffBaseUrl = runtimeManifest?.urls?.bff || browserFixture?.base_urls?.bff
  if (!bffBaseUrl) throw new Error("Runtime manifest missing BFF URL")
  const plantId = browserFixture.plants.plant_a.id

  const response = await page.request.post(`${bffBaseUrl}/api/auth/login`, {
    data: { email, password },
  })
  expect(response.ok(), "admin login through BFF should succeed").toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token).toBeUndefined()

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(({ plantId }) => {
    window.localStorage.setItem("hariom_active_plant", plantId)
  }, { plantId })
}

test("spec sheet keeps recipe, totals, and matrices in sync", async ({ page }) => {
  await login(page)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  const plantA = getBrowserFixture().plants.plant_a.id
  if (await page.getByText(/Pick one plant in the top switcher/i).isVisible()) {
    await page.getByTestId("plant-switcher-trigger").click()
    await page.getByTestId(`plant-option:${plantA}`).click()
  }

  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")

  const liveBuilder = page.getByTestId("spec-sheet-live-builder")
  await expect(liveBuilder).toContainText(/Paper total/i)
  await expect(liveBuilder).toContainText(/Winding mass \/ modeled finished dry/i)

  const previewRail = page.getByTestId("spec-sheet-preview-rail")
  await expect(previewRail).toContainText(/One bamboo yield/i)
  await expect(previewRail).toContainText(/\d+\s*pcs/i)
  await expect.poll(async () => Number(((await previewRail.textContent()) || "").match(/(\d+)\s*pcs/i)?.[1] || 0)).toBeGreaterThan(0)

  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await expect
    .poll(async () => ((await liveBuilder.textContent()) || "").replace(/\s+/g, " "))
    .toMatch(/Paper total/i)

  const manufacturingTable = page.locator("div").filter({ has: page.getByText("Manufacturing specification") }).first()
  await expect(manufacturingTable).toContainText(/Bamboo|mm|g/i)

  await expect(page.getByText("Recipe").first()).toBeVisible()

  const firstPlyInput = page.getByTestId("spec-sheet-recipe-ply-1")
  const firstPlyValue = await firstPlyInput.inputValue()
  const nextPly = firstPlyValue === "3" ? "4" : "3"
  await firstPlyInput.fill(nextPly)
  await expect(firstPlyInput).toHaveValue(nextPly)

  const targetWeightInput = page.getByTestId("spec-sheet-target-weight")
  const startedAt = Date.now()
  await targetWeightInput.fill("300")
  expect(Date.now() - startedAt).toBeLessThan(2500)
  await expect(targetWeightInput).toHaveValue("300")
  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await expect(liveBuilder).toContainText(/Target 300\.00 g/i)
})

test("spec sheet keeps target weight explicit and applies the combined 15 percent rule", async ({ page }) => {
  await login(page)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()

  const plantA = getBrowserFixture().plants.plant_a.id
  if (await page.getByText(/Pick one plant in the top switcher/i).isVisible()) {
    await page.getByTestId("plant-switcher-trigger").click()
    await page.getByTestId(`plant-option:${plantA}`).click()
  }

  await page.getByTestId("spec-sheet-mandrel").click()
  const mandrel125 = page.getByRole("button", { name: /125\.55/ }).first()
  await expect(mandrel125, "Isolated Plant A must expose live mandrel 125.55 for the 15% rule proof").toBeVisible()
  await mandrel125.click()
  await page.getByTestId("spec-sheet-tube-size").click()
  const tube125 = page.getByRole("button", { name: /125\s*x\s*137\s*x\s*120/i }).first()
  await expect(tube125, "Isolated Plant A must expose live tube 125 x 137 x 120 for the 15% rule proof").toBeVisible()
  await tube125.click()

  const targetWeightInput = page.getByTestId("spec-sheet-target-weight")
  await expect(targetWeightInput).toHaveValue("")
  await targetWeightInput.fill("230")
  await page.locator("details#sheet-validation").evaluate((node) => {
    node.open = true
  })
  const glueBaseInput = page.getByTestId("spec-sheet-glue-base-percent")
  await glueBaseInput.fill("15")
  await expect(glueBaseInput).toHaveValue("15")

  const assumptions = page.locator("details").filter({ hasText: "Fixed material assumptions" })
  await assumptions.evaluate((node) => {
    node.open = true
  })
  await expect(assumptions.getByText("252.75 / 230.00 g", { exact: true })).toBeVisible()
  await expect(assumptions.getByText("34.50 g total", { exact: true })).toBeVisible()
  await expect(assumptions.getByText(/31\.05 g adhesive \+ 3\.45 g parchment · 218\.25 g wet paper target/)).toBeVisible()
  const appliedRows = page.getByText("Applied live").locator("..")
  await expect(appliedRows.nth(0)).toContainText("9.32 g")
  await expect(appliedRows.nth(1)).toContainText("21.73 g")
})
