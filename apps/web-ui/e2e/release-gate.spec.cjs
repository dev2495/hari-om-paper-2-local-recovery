const fs = require("fs")
const path = require("path")
const { test, expect } = require("@playwright/test")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")
function resolveRuntimeManifestPath() {
  if (process.env.ERP_RUNTIME_MANIFEST) return process.env.ERP_RUNTIME_MANIFEST
  const preferred = path.join(workspaceRoot, "hariom-erp", "runtime", "runtime_manifest.json")
  if (fs.existsSync(preferred)) return preferred
  return path.join(workspaceRoot, "hariom-erp", ".runtime", "runtime_manifest.json")
}

const manifestPath = resolveRuntimeManifestPath()
const fixturePath =
  process.env.ERP_BROWSER_FIXTURE || path.join(workspaceRoot, "reports", "browser_e2e_fixture_latest.json")

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    throw new Error(`Unable to read JSON fixture ${filePath}: ${String(error.message || error)}`)
  }
}

const runtimeManifest = readJson(manifestPath)
const browserFixture = readJson(fixturePath)

function requireCredential(key) {
  if (key === "admin") {
    const email = browserFixture?.auth?.admin_email
    const password = browserFixture?.auth?.admin_password
    if (!email || !password) {
      throw new Error("Missing browser credential fixture for admin")
    }
    return { email, password }
  }
  const user = browserFixture?.users?.[key]
  if (!user?.email || !user?.password) {
    throw new Error(`Missing browser credential fixture for ${key}`)
  }
  return user
}

async function waitForClientHydration(page, testId) {
  const locator = page.getByTestId(testId)
  await expect(locator).toBeVisible()
  await expect(locator).toBeEnabled()
}

function beginCriticalMonitoring(page) {
  const critical = []

  page.on("console", (msg) => {
    if (msg.text().includes("401") && page.url().includes("/login")) {
      return
    }
    if (msg.text().includes("Failed to fetch RSC payload")) {
      return
    }
    if (msg.text().includes("403 (Forbidden)")) {
      return
    }
    if (msg.text().includes("Failed to load resource") && msg.text().includes("400 (Bad Request)")) {
      return
    }
    if (msg.text().includes("Failed to load resource") && msg.text().includes("404 (Not Found)")) {
      return
    }
    if (msg.type() === "error") {
      critical.push({ kind: "console", text: msg.text() })
    }
  })

  page.on("pageerror", (error) => {
    critical.push({ kind: "pageerror", text: String(error?.message || error) })
  })

  page.on("response", (response) => {
    const url = response.url()
    const status = response.status()
    if (status === 401 && url.includes("/api/auth/me") && page.url().includes("/login")) {
      return
    }
    if (url.includes("/_next/static/") && status >= 400) {
      critical.push({ kind: "asset", text: `${status} ${url}` })
      return
    }
    if (status >= 500) {
      critical.push({ kind: "response", text: `${status} ${url}` })
    }
  })

  return async () => {
    expect(
      critical,
      critical.length
        ? `Critical browser/runtime errors detected:\n${critical.map((item) => `${item.kind}: ${item.text}`).join("\n")}`
        : "No critical browser/runtime errors detected.",
    ).toEqual([])
  }
}

async function login(page, key) {
  const user = requireCredential(key)
  await page.context().clearCookies()
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" })
  } catch (error) {
    if (!String(error?.message || error).includes("ERR_ABORTED")) {
      throw error
    }
    await page.waitForTimeout(500)
    await page.goto("/login", { waitUntil: "domcontentloaded" })
  }
  await page.evaluate(() => {
    window.localStorage.removeItem("hariom_access_token")
    window.localStorage.removeItem("hariom_active_plant")
  })

  const bffBaseUrl = runtimeManifest?.urls?.bff || browserFixture?.base_urls?.bff || "http://127.0.0.1:14000"
  const response = await page.request.post(`${bffBaseUrl}/api/auth/login`, {
    data: {
      email: user.email,
      password: user.password,
    },
  })
  expect(response.ok(), `Unable to authenticate ${user.email} through BFF login`).toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token, `Missing access token for ${user.email}`).toBeTruthy()

  await page.context().addCookies([
    {
      name: "token",
      value: payload.access_token,
      url: runtimeManifest?.urls?.web || "http://127.0.0.1:13000",
      httpOnly: false,
      sameSite: "Lax",
    },
  ])
  await page.evaluate((token) => {
    window.localStorage.setItem("hariom_access_token", token)
  }, payload.access_token)

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/dashboard$/)
  const userMenuTrigger = page.getByTestId("workspace-user-menu-trigger")
  if (await userMenuTrigger.count()) {
    await expect(userMenuTrigger).toBeVisible()
  } else {
    await expect(page.getByRole("button", { name: /logout/i })).toBeVisible()
  }
  return user
}

async function logout(page) {
  const trigger = page.getByTestId("workspace-user-menu-trigger")
  if (await trigger.count()) {
    await trigger.click()
    await page.getByRole("button", { name: /logout/i }).click()
  } else {
    await page.getByRole("button", { name: /logout/i }).click()
  }
  try {
    await page.waitForURL("**/login", { timeout: 5_000 })
  } catch {
    await page.goto("/login", { waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(/\/login$/)
  }
}

async function pickFirstSelectOption(page, testId) {
  const locator = page.getByTestId(testId)
  await expect(locator).toBeVisible()
  await expect
    .poll(
      async () =>
        locator.locator("option").evaluateAll((nodes) =>
          nodes
            .map((node) => ({ value: node.value, text: node.textContent || "" }))
            .filter((entry) => entry.value).length,
        ),
      {
        timeout: 20_000,
        message: `Waiting for selectable options in ${testId}`,
      },
    )
    .toBeGreaterThan(0)
  const options = await locator.locator("option").evaluateAll((nodes) =>
    nodes
      .map((node) => ({ value: node.value, text: node.textContent || "" }))
      .filter((entry) => entry.value),
  )
  if (!options.length) {
    throw new Error(`No selectable options found for ${testId}`)
  }
  await locator.selectOption(options[0].value)
  return options[0]
}

function plantOptionId(plantKey) {
  return browserFixture?.plants?.[plantKey]?.id
}

async function assertPageLoads(page, route, matcher) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" })
  expect(response, `No response received for ${route}`).toBeTruthy()
  expect(response.status(), `Unexpected status for ${route}`).toBeLessThan(400)
  if (matcher instanceof RegExp) {
    await expect(page).toHaveURL(matcher)
  } else {
    await expect(page).toHaveURL(new RegExp(`${matcher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  }
  await expect(page.locator("main")).toBeVisible()
  await expect(page.locator("body")).not.toContainText(/not found|application error|unexpected application error/i)
}

test("login page keeps credentials private and contextual guide pages work", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await page.context().clearCookies()
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("login-email")).toHaveValue("")
  await expect(page.getByTestId("login-password")).toHaveValue("")
  await expect(page.locator("body")).not.toContainText(/devarsh123|yash123|demo admin credentials|prefilled/i)

  await login(page, "admin")
  await page.goto("/help?route=/inventory/production-issue", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("guide-page")).toBeVisible()
  await expect(page.getByRole("heading", { name: /production issue and wip movement guide/i })).toBeVisible()
  await expect(page.getByTestId("guide-flow-svg")).toBeVisible()
  await expect(page.getByText(/issue movement must reference a job card/i)).toBeVisible()

  await page.goto("/purchase", { waitUntil: "domcontentloaded" })
  await page.getByRole("link", { name: /^guide$/i }).click()
  await expect(page).toHaveURL(/\/help\?route=%2Fpurchase$/)
  await expect(page.getByRole("heading", { name: /purchase and vendor guide/i })).toBeVisible()
  await expect(page.getByText(/batch price belongs to inward stock/i)).toBeVisible()

  await assertCritical()
})

test("admin shell, plant switching, and reports load cleanly", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await login(page, "admin")
  await expect(page.getByRole("heading", { name: /board-level manufacturing pulse/i })).toBeVisible()
  await expect(page.getByTestId("plant-switcher-trigger").first()).toContainText("All Visible Plants")

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto("/planning", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/planning\/board$/)
  await expect(page.getByTestId("plant-switcher-trigger").first()).toContainText("All Visible Plants")
  await expect(page.getByRole("heading", { name: /select one plant before scheduling/i })).toBeVisible()
  await page.goto("/inventory", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /inventory stock/i })).toBeVisible()
  await page.goto("/planning/board?section=winder", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("plant-switcher-trigger").first()).toContainText("All Visible Plants")
  await expect(page.getByRole("heading", { name: /select one plant before scheduling/i })).toBeVisible()

  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/pick one plant.*before creating/i)).toBeVisible()

  const plantBId = plantOptionId("plant_b")
  if (plantBId) {
    await page.getByTestId("plant-switcher-trigger").first().click()
    await page.getByTestId(`plant-option:${plantBId}`).click()
    await expect(page.getByTestId("plant-switcher-trigger").first()).toContainText(/Plant B|PLANT_B/)
  }

  await page.goto("/reports/owner", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("analytics-owner-pack-page")).toBeVisible()
  await expect(page.getByRole("heading", { name: /live company health, wip, variance, and exceptions/i })).toBeVisible()
  await expect(page.getByText(/owner\/admin can use global analytics/i)).toBeVisible()

  await page.goto("/sales-orders", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /long-horizon pos, partial releases, and planner handoff/i })).toBeVisible()

  await assertCritical()
})

test("admin can load all critical ERP workspaces without route errors", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  await login(page, "admin")

  const routes = [
    ["/dashboard", /\/dashboard$/],
    ["/sales-orders", /\/sales-orders$/],
    ["/sales-orders/new", /\/sales-orders\/new$/],
    ["/production/job-cards", /\/(production\/job-cards|job-cards)(\?.*)?$/],
    ["/production/planner", /\/planning\/board(\?.*)?$/],
    ["/production/supervisor-entry", /\/(production\/supervisor-entry|supervisor-entry)(\?.*)?$/],
    ["/production/reconciliation", /\/production\/reconciliation(\?.*)?$/],
    ["/quality", /\/quality(\?.*)?$/],
    ["/dispatch", /\/logistics\/dispatch(\?.*)?$/],
    ["/reports/owner", /\/reports\/owner(\?.*)?$/],
    ["/reports/production", /\/reports\/production(\?.*)?$/],
    ["/reports/sales", /\/reports\/sales(\?.*)?$/],
    ["/reports/inventory", /\/reports\/inventory(\?.*)?$/],
    ["/reports/plants", /\/reports\/plants(\?.*)?$/],
    ["/inventory", /\/inventory(\?.*)?$/],
    ["/purchase", /\/purchase(\?.*)?$/],
    ["/inventory/raw-material-inward", /\/inventory\/raw-material-inward(\?.*)?$/],
    ["/inventory/reels/inward", /\/inventory\/reels\/inward(\?.*)?$/],
    ["/inventory/production-issue", /\/inventory\/production-issue(\?.*)?$/],
    ["/inventory/stock-control", /\/inventory\/stock-control(\?.*)?$/],
    ["/inventory/genealogy", /\/inventory\/genealogy(\?.*)?$/],
    ["/specs", /\/specifications(\?.*)?$/],
    ["/master", /\/masters\/papers(\?.*)?$/],
    ["/master/items", /\/inventory\/items(\?.*)?$/],
    ["/system/users", /\/system\/users(\?.*)?$/],
  ]

  for (const [route, matcher] of routes) {
    await assertPageLoads(page, route, matcher)
  }

  await assertCritical()
})

test("sales queue, approval, release, planning, and dispatch workspace are operable with real role users", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)

  await login(page, "sales_maker_a")
  await page.goto("/sales-orders/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("sales-orders:create-form")).toBeVisible()
  await pickFirstSelectOption(page, "sales-orders:customer")
  await pickFirstSelectOption(page, "sales-orders:spec")
  const parchment = await page.getByTestId("sales-orders:parchment").locator("option").evaluateAll((nodes) =>
    nodes.map((node) => node.value).filter(Boolean),
  )
  const parchmentSelect = page.getByTestId("sales-orders:parchment")
  if (parchment.length && await parchmentSelect.isEnabled()) {
    await parchmentSelect.selectOption(parchment[0])
  }
  await page.getByTestId("sales-orders:qty").fill("64")
  await page.getByTestId("sales-orders:due-date").fill(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  await page.getByTestId("sales-orders:notes").fill("Release gate browser validation order")
  await Promise.all([
    page.waitForURL(/\/sales-orders\/(?!new$)[^/]+(\/tracking)?$/, { timeout: 20_000 }),
    page.getByTestId("sales-orders:create-submit").click(),
  ])
  await expect(page.getByTestId("sales-orders:tracking-page")).toBeVisible({ timeout: 20_000 })
  const createdUrl = new URL(page.url())
  const createdOrderId = createdUrl.pathname.split("/")[2]
  expect(createdOrderId).toBeTruthy()

  await page.goto(`/sales-orders/${createdOrderId}/audit`, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /sales order audit timeline/i })).toBeVisible()

  await logout(page)

  await login(page, "sales_approver_a")
  await page.goto("/sales-orders", { waitUntil: "domcontentloaded" })
  const orderRow = page.locator(`[data-order-id="${createdOrderId}"]`)
  await expect(orderRow).toBeVisible({ timeout: 20_000 })
  await orderRow.getByRole("button", { name: /approve/i }).click()
  const releaseCheckbox = orderRow.getByRole("checkbox").first()
  await expect(releaseCheckbox).toBeEnabled({ timeout: 20_000 })
  await releaseCheckbox.check()
  const releaseButton = orderRow.getByRole("button", { name: /release selected/i })
  await expect(releaseButton).toBeEnabled()
  await releaseButton.click()
  const targetWinder = page.getByTestId("sales-orders:release-winder").first()
  await expect(targetWinder).toBeVisible({ timeout: 20_000 })
  const winderOptions = await targetWinder.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, text: node.textContent || "" })).filter((entry) => entry.value),
  )
  expect(winderOptions.length, "Release dialog should have at least one target winder").toBeGreaterThan(0)
  await expect(targetWinder).toHaveValue(winderOptions[0].value)
  await targetWinder.evaluate((element) => element.blur())
  const confirmRelease = page.getByTestId("sales-orders:confirm-release")
  await confirmRelease.scrollIntoViewIfNeeded()
  await expect(confirmRelease).toBeEnabled({ timeout: 20_000 })
  await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/production/sales-orders/${createdOrderId}/release-sync`) && response.status() < 400, { timeout: 60_000 }),
    confirmRelease.click(),
  ])
  await expect(page).toHaveURL(new RegExp(`/planning/board\\?section=winder&order_id=${createdOrderId}`), { timeout: 20_000 })

  await logout(page)

  await login(page, "planner_a")
  await page.goto(`/planning/board?section=winder&order_id=${createdOrderId}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("planner-page")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("planner-page")).toContainText(/winder planner/i)
  await expect(page.getByTestId("planner-page")).toContainText(/schedule canvas/i)

  const plannerCard = page.locator('[data-testid^="planner-card:"]').first()
  await expect(plannerCard).toBeVisible({ timeout: 20_000 })

  const jobLink = page.locator('[data-testid^="planner-job-link:"]').first()
  await expect(jobLink).toBeVisible({ timeout: 20_000 })
  const jobLinkId = await jobLink.getAttribute("data-testid")
  const scheduledJobCardId = String(jobLinkId || "").split(":").pop()
  expect(scheduledJobCardId).toBeTruthy()

  await logout(page)

  await login(page, "supervisor_a")
  await page.goto(`/production/supervisor-entry?job_card_id=${scheduledJobCardId}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("supervisor-entry:job-card-input")).toHaveValue(scheduledJobCardId)

  await logout(page)

  await login(page, "dispatch_a")
  const completedJobCardId = browserFixture?.flows?.[0]?.job_card_id
  if (!completedJobCardId) {
    throw new Error("Missing completed job card fixture for dispatch print validation")
  }
  await page.goto("/dispatch", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/logistics\/dispatch$/)
  await expect(page.getByRole("heading", { name: /dispatch selection/i })).toBeVisible({ timeout: 20_000 })
  await page.goto(`/dispatch/${completedJobCardId}/print`, { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/dispatch/i).first()).toBeVisible()

  await assertCritical()
})

test("real seeded users enforce route separation and role guards", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)

  await login(page, "owner")
  await page.goto("/reports/plants", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /cross-plant comparison/i })).toBeVisible()
  await page.goto("/dispatch", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(/\/logistics\/dispatch$/)
  await expect(page.getByRole("heading", { name: /dispatch selection/i })).toBeVisible()
  await expect(page.locator("body")).not.toContainText(/forbidden|access denied|not authorized/i)
  await logout(page)

  await login(page, "store_b")
  await page.goto("/reports/owner", { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/forbidden|access denied|not authorized/i).first()).toBeVisible({ timeout: 20_000 })

  await page.goto("/inventory", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /inventory/i }).first()).toBeVisible()

  await assertCritical()
})
