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
  await expect
    .poll(async () => await page.getByTestId("spec-sheet-tube-size").locator("option").count())
    .toBeGreaterThan(1)
  await expect
    .poll(async () => await page.getByTestId("spec-sheet-mandrel").locator("option").count())
    .toBeGreaterThan(1)

  await page.getByRole("button", { name: /110 × 122 × 149\.9/i }).click()

  await expect
    .poll(async () => {
      const text = await page.locator("body").textContent()
      return text || ""
    })
    .toContain("Live paper total")

  await expect
    .poll(async () => {
      const text = await page.locator("body").textContent()
      return text || ""
    })
    .toMatch(/Live paper total[\s\S]*[1-9]\d*(\.\d+)? g/)

  const recipeTable = page.locator("section").filter({ has: page.getByText("Recipe to follow") }).first()
  await expect(recipeTable).toContainText(/Weight \/ Tube/i)
  await expect(recipeTable).not.toContainText(/\b0 g glue\s+250 g dry\s+0\/0 g\b/i)

  const previewRail = page.getByTestId("spec-sheet-preview-rail")
  await expect(previewRail).toContainText(/One bamboo yield/i)
  await expect(previewRail).toContainText(/10 pcs/i)

  const activeSuggestion = page.locator('[data-testid^="spec-sheet-suggestion-"]').first()
  const activeSuggestionText = (await activeSuggestion.textContent()) || ""
  const suggestionDry = activeSuggestionText.match(/Dry\s+([0-9.]+)\s*g/i)?.[1]
  const suggestionWet = activeSuggestionText.match(/Wet\s+([0-9.]+)\s*g/i)?.[1]
  const suggestionDelta = activeSuggestionText.match(/Δ\s+([0-9.]+)\s*g/i)?.[1]
  if (suggestionDry && suggestionWet && suggestionDelta) {
    await expect
      .poll(async () => ((await previewRail.textContent()) || "").replace(/\s+/g, " "))
      .toContain(`${suggestionWet} / ${suggestionDry} g`)
    await expect
      .poll(async () => ((await previewRail.textContent()) || "").replace(/\s+/g, " "))
      .toContain(`${suggestionDelta} g dry delta`)
  }

  const clientTable = page.locator("div").filter({ has: page.getByText("Client specification") }).first()
  await expect(clientTable).toContainText("Asked")
  await expect(clientTable).not.toContainText(/\bMin\b/)
  await expect(clientTable).not.toContainText(/\bMax\b/)

  const manufacturingTable = page.locator("div").filter({ has: page.getByText("Manufacturing specification") }).first()
  await expect(manufacturingTable).toContainText("Bamboo LT")
  await expect(manufacturingTable).toContainText(/1530|1540|1550/)
  await expect(manufacturingTable).toContainText("110.75 mm")

  await expect(page.getByText("Recipe").first()).toBeVisible()

  const initialPreviewText = (await previewRail.textContent()) || ""
  await page.getByTestId("spec-sheet-recipe-ply-1").fill("3")
  await expect
    .poll(async () => ((await previewRail.textContent()) || "").replace(/\s+/g, " "))
    .not.toEqual(initialPreviewText.replace(/\s+/g, " "))

  await page.getByTestId("spec-sheet-target-weight").fill("300")
  await expect(recipeTable).toContainText(/No recipe applied yet/i)
  await expect(page.getByTestId("spec-sheet-live-builder")).toContainText(/Apply a suggestion or build a fresh recipe here/i)
})
