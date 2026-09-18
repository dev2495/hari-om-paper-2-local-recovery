const fs = require("fs")
const path = require("path")
const { test, expect } = require("@playwright/test")
const {
  getRuntimeManifest,
  getBrowserFixture,
  beginCriticalMonitoring,
  pickFirstSmartSelectOption,
  workspaceRoot,
} = require("./_runtime-data.cjs")

const PLANT_A = "00000000-0000-0000-0000-0000000000a1"

async function setActivePlant(page, plantId) {
  await page.evaluate((id) => {
    window.localStorage.setItem("hariom_active_plant", id)
  }, plantId)
}

async function cookieLogin(page, email, password, plantId = PLANT_A) {
  const runtime = getRuntimeManifest()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const response = await page.request.post(`${runtime.urls.bff}/api/auth/login`, {
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  await setActivePlant(page, plantId)
}

async function loginWithPassword(page, email, password, plantId = PLANT_A) {
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const emailInput = page.getByTestId("login-email")
  await expect(emailInput).toBeVisible()
  await expect(emailInput).toBeEnabled()
  await emailInput.click()
  await emailInput.fill(email)
  await page.getByTestId("login-password").fill(password)
  await page.getByTestId("login-submit").click()
  await page.waitForURL((url) => !String(url).includes("/login"), { timeout: 20_000 })
  await setActivePlant(page, plantId)
}

async function createQcUser(page, suffix) {
  const runtime = getRuntimeManifest()
  const fixture = getBrowserFixture()
  const adminLogin = await page.request.post(`${runtime.urls.bff}/api/auth/login`, {
    data: { email: fixture.auth.admin_email, password: fixture.auth.admin_password },
  })
  expect(adminLogin.ok()).toBeTruthy()
  const email = `nverify.qc.${suffix}.${Date.now()}@example.com`
  const created = await page.request.post(`${runtime.urls.bff}/api/auth/users`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
    data: {
      name: `Nverify QC ${suffix}`,
      email,
      password: "Nverify_Qc1!",
      plant_id: fixture.plants.plant_a.id,
      role_names: ["QC"],
      allowed_plant_ids: [fixture.plants.plant_a.id],
      is_owner_all_plants: false,
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  return { email, password: "Nverify_Qc1!", plantId: fixture.plants.plant_a.id }
}

test("QC-01 QC sign-in lands on /landing/qc and is not Plant Manager", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page, {
    expected: [{ kind: "response", status: 403 }],
  })
  const qc = await createQcUser(page, "landing")
  await page.context().clearCookies()
  await loginWithPassword(page, qc.email, qc.password, qc.plantId)
  await expect(page).toHaveURL(/\/landing\/qc/)
  const landing = page.getByTestId("workspace-role-landing")
  await expect(landing).toBeVisible()
  await expect(landing).toHaveAttribute("data-role", "QC")
  await expect(page.getByTestId("page-header").getByText("Quality Control", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /Quality Desk/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /Winder Plan/i })).toHaveCount(0)
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/landing\/qc/)
  await page.goto("/planning/board", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("role-gate-denied")).toBeVisible()
  await page.goto("/system/users", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("role-gate-denied")).toBeVisible()
  await assertCritical()
})

test("COMM-08 job card shows parchment conflict without rewriting recipe", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const commPath = path.join(workspaceRoot, "reports", "comm08_job.json")
  if (!fs.existsSync(commPath)) {
    throw new Error("COMM-08 live job id missing at reports/comm08_job.json — run production live pytest first")
  }
  const job = JSON.parse(fs.readFileSync(commPath, "utf8"))
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto(`/production/job-cards/${job.job_card_id}`, { waitUntil: "domcontentloaded" })
  const banner = page.getByTestId("parchment-conflict-banner")
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/Natural/)
  await expect(banner).toContainText(/Blue/)
  await expect(banner).toContainText(/not rewritten/i)
  await assertCritical()
})

test("INC-02 browser 401/403/timeout do not blank-page or false-succeed", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page, {
    expected: [
      { kind: "response", status: 401 },
      { kind: "response", status: 403 },
      { kind: "console", textIncludes: "Failed" },
    ],
  })
  await page.goto("/sales-orders/new", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator("body")).not.toHaveText(/^\s*$/)
  const runtime = getRuntimeManifest()
  const unauth = await page.request.get(`${runtime.urls.bff}/api/sales/orders`)
  expect(unauth.status()).toBe(401)

  const qc = await createQcUser(page, "inc2")
  await page.context().clearCookies()
  const qcLogin = await page.request.post(`${runtime.urls.bff}/api/auth/login`, {
    data: { email: qc.email, password: qc.password },
  })
  expect(qcLogin.ok()).toBeTruthy()
  const forbidden = await page.request.get(`${runtime.urls.bff}/api/auth/users`, {
    headers: { "X-Plant-ID": qc.plantId },
  })
  expect([401, 403]).toContain(forbidden.status())
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await setActivePlant(page, qc.plantId)
  await page.goto("/system/users", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("role-gate-denied")).toBeVisible()
  await expect(page.locator("body")).not.toHaveText(/^\s*$/)

  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.route("**/api/sales/orders**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.abort("timedout")
  })
  await page.goto("/sales-orders", { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).not.toHaveText(/^\s*$/)
  await expect(page.getByText(/successfully (created|saved|released)/i)).toHaveCount(0)
  await page.unroute("**/api/sales/orders**")
  await assertCritical()
})

test("QCT-029 new spec Save Draft opens quality dialog with product context", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  if (await page.getByText(/Pick one plant in the top switcher/i).isVisible()) {
    await page.getByTestId("plant-switcher-trigger").click()
    await page.getByTestId(`plant-option:${fixture.plants.plant_a.id}`).click()
  }
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  const save = page.getByTestId("spec-sheet-save-draft")
  await expect(save).toBeEnabled()
  await save.click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute("role", "dialog")
  await expect(dialog).toContainText(/Stage QC setup before save/i)
  await expect(dialog).toContainText(/I\.D\.\/O\.D\.\/Height|mm/)
  await expect(dialog).toContainText(/Target weight|C\.S\.|Recipe|Ply|Parchment/i)
  await dialog.getByRole("button", { name: /Back to specification/i }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await assertCritical()
})

test("QCT-030 QC dialog keeps edits on back/reopen and discards only deliberately", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  const save = page.getByTestId("spec-sheet-save-draft")
  await expect(save).toBeEnabled()
  await save.click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  const idMin = dialog.locator("tr", { hasText: /^I\.D\./ }).getByRole("spinbutton").first()
  const odMin = dialog.locator("tr", { hasText: /^O\.D\./ }).getByRole("spinbutton").first()
  await idMin.fill("124.4")
  await odMin.fill("136.2")
  await dialog.getByRole("button", { name: /Back to specification/i }).click()
  await expect(dialog).toHaveCount(0)
  await save.click()
  await expect(dialog).toBeVisible()
  await expect(idMin).toHaveValue("124.4")
  await expect(odMin).toHaveValue("136.2")
  page.once("dialog", (prompt) => prompt.dismiss())
  await dialog.getByTestId("spec-qc-discard").click()
  await expect(dialog).toBeVisible()
  await expect(idMin).toHaveValue("124.4")
  page.once("dialog", (prompt) => prompt.accept())
  await dialog.getByTestId("spec-qc-discard").click()
  await expect(dialog).toHaveCount(0)
  await save.click()
  await expect(dialog).toBeVisible()
  await expect(idMin).toHaveValue("")
  await expect(odMin).toHaveValue("")
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await assertCritical()
})

test("QCT-031 Save draft without stage thresholds persists incomplete QC", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  if (await page.getByText(/Pick one plant in the top switcher/i).isVisible()) {
    await page.getByTestId("plant-switcher-trigger").click()
    await page.getByTestId(`plant-option:${fixture.plants.plant_a.id}`).click()
  }
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  const save = page.getByTestId("spec-sheet-save-draft")
  await expect(save).toBeEnabled()
  await save.click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const specId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  await expect(page.getByTestId("spec-qc-setup-status")).toHaveAttribute("data-qc-status", "draft")
  await expect(page.getByTestId("spec-qc-setup-status")).toContainText(/QC incomplete/i)
  await expect(page.getByTestId("spec-qc-missing-fields")).toContainText(/I\.D\./)
  await expect(page.getByTestId("spec-qc-setup-status")).not.toContainText(/QC ready|QC approved/i)
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const body = await saved.json()
  expect(String(body.status || "").toLowerCase()).toBe("draft")
  expect(["draft", "incomplete"]).toContain(String(body.qc_setup_status || "").toLowerCase())
  expect(["approved", "complete"]).not.toContain(String(body.qc_setup_status || "").toLowerCase())
  expect(["approved", "complete"]).not.toContain(String(body.qc_profile?.status || "").toLowerCase())
  const idRow = (body.qc_profile?.stages?.WINDER?.parameters || []).find((row) => row.code === "id")
  expect(idRow).toBeTruthy()
  expect(idRow.min ?? null).toBeNull()
  expect(idRow.max ?? null).toBeNull()
  await page.goto(`/specifications/${specId}/edit`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await page.getByTestId("spec-sheet-save-draft").click()
  await expect(dialog).toBeVisible()
  const idMin = dialog.locator("tr", { hasText: /^I\.D\./ }).getByRole("spinbutton").first()
  await expect(idMin).toHaveValue("")
  await expect(dialog).toContainText(/Winding 0\//)
  await assertCritical()
})
