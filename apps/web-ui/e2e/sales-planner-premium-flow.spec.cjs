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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

const runtimeManifest = readJson(resolveRuntimeManifestPath())
const browserFixture = readJson(
  process.env.ERP_BROWSER_FIXTURE || path.join(workspaceRoot, "reports", "browser_e2e_fixture_latest.json"),
)

async function login(page) {
  const email = browserFixture?.auth?.admin_email
  const password = browserFixture?.auth?.admin_password
  if (!email || !password) throw new Error("Missing admin browser fixture")

  await page.goto("/login", { waitUntil: "domcontentloaded" })
  await page.evaluate(() => {
    window.localStorage.removeItem("hariom_access_token")
    window.localStorage.removeItem("hariom_active_plant")
    window.localStorage.removeItem("hariom_sidebar_pinned_v2")
  })

  const bffBaseUrl = runtimeManifest?.urls?.bff || "http://127.0.0.1:14000"
  const response = await page.request.post(`${bffBaseUrl}/api/auth/login`, {
    data: { email, password },
  })
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  expect(payload?.access_token).toBeTruthy()

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
}

async function expectTransition(locator) {
  const duration = await locator.evaluate((node) => {
    const style = window.getComputedStyle(node)
    return style.transitionDuration || ""
  })
  const hasTransition = String(duration)
    .split(",")
    .map((value) => value.trim())
    .some((value) => value !== "0s" && value !== "0ms" && value !== "")
  expect(hasTransition).toBeTruthy()
}

async function expectPlannerMoveHonorsSelectedPlant(page) {
  const token = await page.evaluate(() => window.localStorage.getItem("hariom_access_token"))
  expect(token).toBeTruthy()

  const bffBaseUrl = runtimeManifest?.urls?.bff || "http://127.0.0.1:14000"
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Plant-ID": "PLANT_A",
  }
  const boardResponse = await page.request.get(`${bffBaseUrl}/api/production/planning/board`, {
    headers,
    params: {
      stage: "WINDER",
      plan_date: "2026-04-19",
      include_unscheduled: "true",
      plant_id: "PLANT_A",
    },
  })
  expect(boardResponse.ok()).toBeTruthy()
  const board = await boardResponse.json()
  const winderStage = (board.stages || []).find((entry) => entry.stage === "WINDER")
  expect(winderStage).toBeTruthy()
  const openLane = (winderStage.lanes || []).find((lane) => !lane.machine_id && !lane.shift_code && (lane.jobs || []).length > 0)
  const targetLane = (winderStage.lanes || []).find(
    (lane) => lane.machine_id && lane.shift_code === "SHIFT_A" && String(lane.machine_code || "").includes("WINDER_01"),
  )
  expect(openLane).toBeTruthy()
  expect(targetLane).toBeTruthy()

  const job = openLane.jobs[0]
  const moveResponse = await page.request.post(`${bffBaseUrl}/api/production/planning/board/move`, {
    headers,
    data: {
      segment_id: job.segment_id,
      stage: "WINDER",
      machine_id: targetLane.machine_id,
      plan_date: targetLane.plan_date || "2026-04-19",
      shift_code: targetLane.shift_code,
      sequence_no: 1,
    },
  })
  const moveText = await moveResponse.text()
  expect(moveResponse.ok(), moveText).toBeTruthy()
  expect(moveText).not.toMatch(/another plant/i)

  const undoResponse = await page.request.post(`${bffBaseUrl}/api/production/planning/board/move`, {
    headers,
    data: {
      segment_id: job.segment_id,
      stage: "WINDER",
      machine_id: null,
      plan_date: null,
      shift_code: null,
      sequence_no: 1,
    },
  })
  const undoText = await undoResponse.text()
  expect(undoResponse.ok(), undoText).toBeTruthy()
}

test("premium sales and planner surfaces load with animated interactive elements", async ({ page }) => {
  await login(page)

  await page.goto("/sales-orders", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("sales-orders:page")).toBeVisible()
  await expect(page.getByText(/long-horizon pos, partial releases, and planner handoff/i)).toBeVisible()
  await expectTransition(page.getByRole("button", { name: /release selected/i }).first())

  await page.goto("/sales-orders/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("sales-orders:create-form")).toBeVisible()
  await expect(page.getByText(/enter one long-horizon po, then release exact line buckets later/i)).toBeVisible()
  await expectTransition(page.getByRole("button", { name: /create sales po/i }))

  await page.goto("/sales-orders", { waitUntil: "domcontentloaded" })
  const detailLink = page.getByTestId("sales-orders:detail-link").first()
  await expect(detailLink).toBeVisible()
  await detailLink.click()
  await expect(page.getByTestId("sales-orders:tracking-page")).toBeVisible()
  await expect(page.getByText(/one po, many release moments/i)).toBeVisible()
  await expectTransition(page.getByRole("link", { name: /open planner handoff/i }))

  await page.evaluate(() => window.localStorage.setItem("hariom_active_plant", "PLANT_A"))
  await page.goto("/planning/board?section=winder&plan_date=2026-04-19", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("planner-page")).toBeVisible()
  const shellSidebar = page.locator("aside[data-expanded]").first()
  await expect(shellSidebar).toHaveAttribute("data-expanded", "false")
  await shellSidebar.hover()
  await expect(shellSidebar).toHaveAttribute("data-expanded", "true")
  await page.getByTestId("planner-page").hover()
  await expect(shellSidebar).toHaveAttribute("data-expanded", "false")
  await expect(page.getByText(/machine scheduling across 3 days/i)).toBeVisible()
  await expect(page.getByText(/schedule canvas/i)).toBeVisible()
  await expect(page.getByText(/previous day/i)).toHaveCount(0)
  await expect(page.getByText(/^today$/i)).toHaveCount(0)
  await expect(page.getByText(/next day/i)).toHaveCount(0)
  await expect(page.getByText(/released to this winder/i).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /all ·/i }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /winder_01 ·/i }).first()).toBeVisible()
  await expect(page.getByText("WINDER_01").first()).toBeVisible()
  await expect(page.getByText("WINDER_02").first()).toBeVisible()
  await expect(page.getByText("WINDER_03").first()).toBeVisible()
  await expect.poll(async () => page.locator("[data-testid='planner-page'] article[draggable='true']").count()).toBeGreaterThanOrEqual(10)
  await expect(page.getByText(/kg/i).first()).toBeVisible()
  await expect(page.getByText(/bamboo/i).first()).toBeVisible()
  const firstTab = page.locator("a[href*='/planning/board?section=']").first()
  await expectTransition(firstTab)
  await expect(page.getByText(/machine lane/i)).toBeVisible()
  const queueCard = page.locator("[data-testid='planner-page'] article").first()
  if (await queueCard.count()) {
    await expectTransition(queueCard)
  }
  await expectPlannerMoveHonorsSelectedPlant(page)

  await page.evaluate(() => window.localStorage.setItem("hariom_active_plant", "ALL"))
  await page.goto("/planning/board?section=winder", { waitUntil: "domcontentloaded" })
  await expect(page.getByText(/select one plant before scheduling/i)).toBeVisible()
  await expect(page.getByRole("main").getByTestId("plant-switcher-trigger")).toBeVisible()
})
