const fs = require("fs")
const path = require("path")
const { test, expect } = require("@playwright/test")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")
const runtimeManifestPath = path.join(workspaceRoot, "hariom-erp", "runtime", "runtime_manifest.json")
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"))
const bffUrl = runtimeManifest?.urls?.bff || "http://127.0.0.1:14000"
const plantA = "00000000-0000-0000-0000-0000000000a1"

async function loginAsAdmin(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(() => {
    window.localStorage.removeItem("hariom_access_token")
    window.localStorage.removeItem("hariom_active_plant")
    window.localStorage.removeItem("hariom_active_role")
  })

  const response = await page.request.post(`${bffUrl}/api/auth/login`, {
    data: { email: "admin@hariom.com", password: "admin123" },
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

test("sidebar approval card is removed and reconciliation actual rows are live", async ({ page }) => {
  await loginAsAdmin(page)

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/approval inbox/i)).toHaveCount(0)
  await expect(page.getByText(/Track pending specs/i)).toHaveCount(0)

  await page.goto("/production/reconciliation", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("reconciliation-page")).toBeVisible()
  await page.getByRole("button", { name: "Actual entry" }).click()
  await expect(page.getByRole("heading", { name: "Monthly material actuals" })).toBeVisible()
  await expect(page.getByText("No material rows found for this month/filter.")).toHaveCount(0)
  await expect(page.getByText("20100-A").first()).toBeVisible()
})
