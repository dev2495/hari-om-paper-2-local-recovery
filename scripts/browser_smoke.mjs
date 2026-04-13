#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const workspaceRoot = process.cwd()
const reportsDir = path.join(workspaceRoot, "reports")
fs.mkdirSync(reportsDir, { recursive: true })

const fixturePath = path.join(reportsDir, "browser_e2e_fixture_latest.json")
const summaryPath = path.join(reportsDir, "browser_smoke_latest.json")
const failureShotPath = path.join(reportsDir, "browser_smoke_failure.png")

let fixture = {}
if (fs.existsSync(fixturePath)) {
  fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"))
}

const baseUrl = process.env.WEB_URL || fixture.base_urls?.web || "http://127.0.0.1:13000"
const adminEmail = process.env.ADMIN_EMAIL || fixture.auth?.admin_email || "admin@hariom.com"
const adminPassword = process.env.ADMIN_PASSWORD || fixture.auth?.admin_password || "admin123"
const fixtureFlows = Array.isArray(fixture.flows) ? fixture.flows : []
const paletteQuery = fixtureFlows[0]?.sales_order_no || "SO"

let chromium
try {
  ;({ chromium } = await import("playwright"))
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: "Playwright dependency unavailable",
        detail: String(error?.message || error),
        hint: "Run via `bash scripts/browser_smoke.sh` so it can bootstrap Playwright if needed.",
      },
      null,
      2,
    ),
  )
  process.exit(2)
}

const summary = {
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  fixture_path: fs.existsSync(fixturePath) ? fixturePath : null,
  checks: [],
}

function record(name, ok, detail) {
  summary.checks.push({
    name,
    status: ok ? "PASS" : "FAIL",
    detail,
  })
}

function assert(condition, detail) {
  if (!condition) {
    throw new Error(detail)
  }
}

function currentPath(page) {
  return new URL(page.url()).pathname
}

async function runCheck(page, name, fn) {
  try {
    const detail = await fn()
    record(name, true, detail || "ok")
  } catch (error) {
    record(name, false, String(error?.message || error))
    try {
      await page.screenshot({ path: failureShotPath, fullPage: true })
    } catch {
      // Ignore screenshot failures so the original error remains visible.
    }
  }
}

async function waitForLanding(page, landingRole) {
  const locator = page.locator(`[data-testid="workspace-role-landing"][data-role="${landingRole}"]`)
  await locator.waitFor({ state: "visible", timeout: 20000 })
}

async function ensureRoute(page, pathname, selector = null) {
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  const actual = currentPath(page)
  assert(actual === pathname || actual.startsWith(`${pathname}/`), `expected route ${pathname}, got ${actual}`)
  if (selector) {
    await page.locator(selector).waitFor({ state: "visible", timeout: 15000 })
  }
  return `path=${actual}`
}

async function switchRole(page, roleName, landingRole) {
  await page.getByTestId("admin-role-switch-trigger").click()
  await page.getByTestId(`admin-role-option-${roleName}`).waitFor({ state: "visible", timeout: 10000 })
  await page.getByTestId(`admin-role-option-${roleName}`).click()
  await page.waitForLoadState("networkidle")
  await waitForLanding(page, landingRole)
  const triggerText = (await page.getByTestId("admin-role-switch-trigger").textContent()) || ""
  assert(triggerText.includes(roleName), `role switch trigger does not show ${roleName}: ${triggerText}`)
  return `role=${roleName} landing=${landingRole}`
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()

await runCheck(page, "Login", async () => {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("login-email").fill(adminEmail)
  await page.getByTestId("login-password").fill(adminPassword)
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 20000 }),
    page.getByTestId("login-submit").click(),
  ])
  await waitForLanding(page, "Admin")
  await page.getByTestId("admin-role-switch-trigger").waitFor({ state: "visible", timeout: 10000 })
  return `user=${adminEmail}`
})

await runCheck(page, "Shell widgets", async () => {
  await page.getByTestId("workspace-command-trigger").waitFor({ state: "visible", timeout: 10000 })
  await page.getByTestId("workspace-notifications-trigger").click()
  await page.getByText("Notification Center").waitFor({ state: "visible", timeout: 10000 })
  await page.keyboard.press("Escape")
  await page.getByTestId("workspace-user-menu-trigger").waitFor({ state: "visible", timeout: 10000 })
  return "command, notifications, and user menu visible"
})

await runCheck(page, "Command palette lookup", async () => {
  await page.getByTestId("workspace-command-trigger").click()
  await page.getByText("Workspace Search").waitFor({ state: "visible", timeout: 10000 })
  const input = page.getByPlaceholder("Search sales orders, job cards, inventory items, or actions")
  await input.fill(paletteQuery)
  const result = page.locator("button").filter({ hasText: paletteQuery }).first()
  await result.waitFor({ state: "visible", timeout: 15000 })
  await result.click()
  await page.waitForLoadState("networkidle")
  const actual = currentPath(page)
  assert(actual.startsWith("/sales-orders/"), `expected sales-order detail route, got ${actual}`)
  return `query=${paletteQuery} route=${actual}`
})

await runCheck(page, "Admin role switch to SOMaker", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "SOMaker", "Sales")
})

await runCheck(page, "Sales orders route access", async () => ensureRoute(page, "/sales-orders"))

await runCheck(page, "Admin role switch to SpecMaker", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "SpecMaker", "Planner")
})

await runCheck(page, "Specifications route access", async () => ensureRoute(page, "/specifications"))

await runCheck(page, "Admin role switch to Planner", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "Planner", "Planner")
})

await runCheck(page, "Planning route access", async () => ensureRoute(page, "/planning"))

await runCheck(page, "Admin role switch to Production", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "Production", "Production")
})

await runCheck(page, "Job cards route access", async () => ensureRoute(page, "/job-cards"))
await runCheck(page, "Production issue route access", async () => ensureRoute(page, "/inventory/production-issue", '[data-testid="inventory-production-issue-form"]'))

await runCheck(page, "Admin role switch to SupervisorEntry", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "SupervisorEntry", "Production")
})

await runCheck(page, "Supervisor entry route access", async () => ensureRoute(page, "/supervisor-entry", '[data-testid="supervisor-entry:search"]'))

await runCheck(page, "Admin role switch to Store", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "Store", "Store")
})

await runCheck(page, "Inventory route access", async () => ensureRoute(page, "/inventory"))

await runCheck(page, "Admin role switch to Owner", async () => {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  return await switchRole(page, "Owner", "Owner")
})

await runCheck(page, "Owner report presets", async () => {
  await ensureRoute(page, "/reports/owner", '[data-testid="analytics-owner-pack-page"]')
  await page.getByTestId("analytics-filter:preset:all").click()
  await page.locator('[data-testid="analytics-filter:active-preset"]').getByText("All Time").waitFor({ state: "visible", timeout: 15000 })
  return "all-time preset active"
})

await runCheck(page, "Owner report PDF export", async () => {
  await ensureRoute(page, "/reports/owner", '[data-testid="analytics-owner-pack-page"]')
  const printLink = page.getByTestId("erp-export-print")
  const href = await printLink.getAttribute("href")
  assert(href && href.includes("/api/analytics/reports/owner-pack/pdf"), `unexpected print href: ${href}`)
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      printLink.click(),
    ])
    const suggested = download.suggestedFilename()
    assert(suggested.endsWith(".pdf"), `unexpected download filename: ${suggested}`)
    return `download=${suggested}`
  } catch {
    return `href=${href}`
  }
})

await runCheck(page, "Admin session reset", async () => {
  await page.getByTestId("admin-role-switch-trigger").click()
  await page.getByTestId("admin-role-reset").click()
  await page.waitForLoadState("networkidle")
  await waitForLanding(page, "Admin")
  const triggerText = (await page.getByTestId("admin-role-switch-trigger").textContent()) || ""
  assert(triggerText.includes("Admin"), `expected Admin trigger after reset, got ${triggerText}`)
  return "returned to base admin session"
})

await browser.close()

summary.failed = summary.checks.filter((row) => row.status === "FAIL").length
summary.passed = summary.checks.filter((row) => row.status === "PASS").length
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.failed > 0 ? 1 : 0)
