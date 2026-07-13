const fs = require("fs")
const path = require("path")
const { test, expect } = require("@playwright/test")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")
const manifestPath =
  process.env.ERP_RUNTIME_MANIFEST || path.join(workspaceRoot, "hariom-erp", ".runtime", "runtime_manifest.json")
const fixturePath =
  process.env.ERP_BROWSER_FIXTURE || path.join(workspaceRoot, "reports", "browser_e2e_fixture_latest.json")

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

const runtimeManifest = readJson(manifestPath)
const browserFixture = readJson(fixturePath)

async function login(page) {
  const email = browserFixture?.auth?.admin_email || "admin@hariom.com"
  const password = browserFixture?.auth?.admin_password || "admin123"
  const webUrl = runtimeManifest?.urls?.web || "http://127.0.0.1:13000"
  const bffBaseUrl = runtimeManifest?.urls?.bff || browserFixture?.base_urls?.bff || "http://127.0.0.1:14000"

  const response = await page.request.post(`${bffBaseUrl}/api/auth/login`, {
    data: { email, password },
  })
  expect(response.ok(), "admin login through BFF should succeed").toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token, "admin access token should be present").toBeTruthy()

  await page.context().addCookies([
    {
      name: "token",
      value: payload.access_token,
      url: webUrl,
      httpOnly: false,
      sameSite: "Lax",
    },
  ])

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(({ token, plantId }) => {
    window.localStorage.setItem("hariom_access_token", token)
    window.localStorage.setItem("hariom_active_plant", plantId)
  }, {
    token: payload.access_token,
    plantId: browserFixture?.plants?.plant_a?.id || "00000000-0000-0000-0000-0000000000a1",
  })
}

test("spec sheet keeps recipe, totals, and matrices in sync", async ({ page }) => {
  await login(page)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()

  const mandrelSelect = page.getByTestId("spec-sheet-mandrel")
  await expect
    .poll(async () => ((await mandrelSelect.textContent()) || "").trim())
    .not.toBe("Select mandrel")

  await expect(mandrelSelect).toBeVisible()
  await mandrelSelect.click()
  await expect(page.getByRole("button", { name: /OD 110\.65/i }).last()).toBeVisible()
  await page.getByRole("button", { name: /OD 110\.65/i }).last().click()

  const tubeSizeSelect = page.getByTestId("spec-sheet-tube-size")
  await expect(tubeSizeSelect).toBeVisible()
  await tubeSizeSelect.click()
  await expect(page.getByRole("button", { name: /110\s*x\s*122\s*x\s*149\.9/i }).last()).toBeVisible()
  await page.getByRole("button", { name: /110\s*x\s*122\s*x\s*149\.9/i }).last().click()

  const liveBuilder = page.getByTestId("spec-sheet-live-builder")
  await expect(liveBuilder).toContainText(/Paper total/i)
  await expect(liveBuilder).toContainText(/Current recipe wet \/ dry/i)

  const previewRail = page.getByTestId("spec-sheet-preview-rail")
  await expect(previewRail).toContainText(/One bamboo yield/i)
  await expect(previewRail).toContainText(/10 pcs/i)

  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await expect
    .poll(async () => ((await liveBuilder.textContent()) || "").replace(/\s+/g, " "))
    .toMatch(/Paper total/i)

  const manufacturingTable = page.locator("div").filter({ has: page.getByText("Manufacturing specification") }).first()
  await expect(manufacturingTable).toContainText("Bamboo LT")
  await expect(manufacturingTable).toContainText(/1530|1540|1550/)
  await expect(manufacturingTable).toContainText("110.75 mm")

  await expect(page.getByText("Recipe").first()).toBeVisible()

  const initialPreviewText = (await previewRail.textContent()) || ""
  const firstPlyInput = page.getByTestId("spec-sheet-recipe-ply-1")
  const firstPlyValue = await firstPlyInput.inputValue()
  await firstPlyInput.fill(firstPlyValue === "3" ? "4" : "3")
  await expect
    .poll(async () => ((await previewRail.textContent()) || "").replace(/\s+/g, " "))
    .not.toEqual(initialPreviewText.replace(/\s+/g, " "))

  const targetWeightInput = page.getByTestId("spec-sheet-target-weight")
  const startedAt = Date.now()
  await targetWeightInput.fill("300")
  expect(Date.now() - startedAt).toBeLessThan(2500)
  await expect(targetWeightInput).toHaveValue("300")
  await expect(page.locator('[data-testid^="spec-sheet-suggestion-"]')).toHaveCount(0)
  await expect(liveBuilder).toContainText(/Target wet/i)
})
