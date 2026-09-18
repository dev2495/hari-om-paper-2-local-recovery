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

test("QCT-033 double-click save incomplete does not duplicate the spec", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  await page.getByTestId("spec-sheet-save-draft").click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  const createPosts = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const url = request.url()
    if (url.includes("/api/spec/specifications") && !url.includes("qc-profile") && !url.includes("recipes")) {
      createPosts.push(url)
    }
  })
  await dialog.getByTestId("spec-qc-save-incomplete").dblclick()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const specId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  expect(createPosts.length).toBeLessThanOrEqual(2)
  await assertCritical()
})

test("QCT-035 list Add quality parameters keeps spec and recipe on approved spec", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  const { spawnSync } = require("child_process")
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  await page.getByTestId("spec-sheet-save-draft").click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const specId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const recipesBefore = await page.request.get(`${runtime.urls.bff}/api/spec/recipes/spec/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(recipesBefore.ok(), await recipesBefore.text()).toBeTruthy()
  const recipeList = await recipesBefore.json()
  const recipeId = Array.isArray(recipeList) ? recipeList[0]?.id : recipeList?.items?.[0]?.id
  expect(recipeId).toBeTruthy()
  const py = path.join(workspaceRoot, "hariom-erp", "venv-verify", "bin", "python")
  const seeded = spawnSync(
    py,
    [
      "-c",
      "import os,sys\nfrom sqlalchemy import create_engine,text\ne=create_engine(os.environ['DATABASE_URL'])\nwith e.begin() as c:\n    c.execute(text('UPDATE specification_sheet SET status=:st, qc_profile=NULL WHERE id=:id'), {'st':'approved','id':sys.argv[1]})",
      specId,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_specdb",
      },
    },
  )
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  await page.goto("/specifications", { waitUntil: "domcontentloaded" })
  const addAction = page.getByTestId(`spec-qc-action-${specId}-add`)
  await expect(addAction).toBeVisible()
  await expect(addAction).toContainText("Add quality parameters")
  await addAction.click()
  await page.waitForURL(new RegExp(`/specifications/${specId}/edit\\?qc=add`), { timeout: 20_000 })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await expect(page.getByText(/Quality parameters for Spec/i)).toBeVisible()
  await page.getByTestId("spec-sheet-save-draft").click()
  await expect(dialog).toBeVisible()
  await dialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(new RegExp(`/specifications/${specId}(?:/)?(?:\\?.*)?$`), { timeout: 30_000 })
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const body = await saved.json()
  expect(String(body.id)).toBe(specId)
  expect(String(body.status || "").toLowerCase()).toBe("approved")
  expect(["draft", "incomplete"]).toContain(String(body.qc_setup_status || "").toLowerCase())
  expect(["approved", "complete"]).not.toContain(String(body.qc_profile?.status || "").toLowerCase())
  const recipesAfter = await page.request.get(`${runtime.urls.bff}/api/spec/recipes/spec/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(recipesAfter.ok(), await recipesAfter.text()).toBeTruthy()
  const afterList = await recipesAfter.json()
  const afterIds = (Array.isArray(afterList) ? afterList : afterList?.items || []).map((row) => String(row.id))
  expect(afterIds).toEqual([String(recipeId)])
  await assertCritical()
})

test("QCT-037 assign profile preview shows per-spec impact and apply stays draft", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  const { spawnSync } = require("child_process")
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const py = path.join(workspaceRoot, "hariom-erp", "venv-verify", "bin", "python")
  const seeded = spawnSync(
    py,
    [
      "-c",
      [
        "import json,os,sys,uuid",
        "os.environ['HARI_OM_LIVE_PG']='1'",
        "sys.path.insert(0, os.environ['HARI_OM_SPEC_SRC'])",
        "from src.main import ensure_runtime_schema",
        "from src.database import engine",
        "from sqlalchemy.orm import sessionmaker",
        "from src.models import SpecificationSheet",
        "from src.routers.specs import QcProfileUpdate,SpecCreate,create_spec,upsert_spec_qc_profile",
        "ensure_runtime_schema()",
        "Session=sessionmaker(bind=engine,autoflush=False,autocommit=False)",
        "PLANT='00000000-0000-0000-0000-0000000000a1'",
        "ADMIN={'sub':'nverify-qct037-ui','role':'Admin'}",
        "db=Session()",
        "marker=f'QCT037UI-{uuid.uuid4()}'",
        "def draft(name):",
        "    return SpecCreate(customer_name=name,customer_name_snapshot=name,tube_size_id=uuid.uuid4(),mandrel_id=uuid.uuid4(),required_cs=100.0,target_tube_weight=250.0)",
        "template=create_spec(draft(marker+'-template'),db=db,plant_id=PLANT,current_user=ADMIN)",
        "tid=template['id']",
        "upsert_spec_qc_profile(tid,QcProfileUpdate(qc_profile={'status':'complete','notching_applicable':True,'stages':{'PROCESS':{'parameters':[{'code':'notch_distance','min':10,'max':12,'applicable':True,'required':True}]}}},status='complete'),db=db,plant_id=PLANT,current_user=ADMIN)",
        "legacy=create_spec(draft(marker+'-legacy'),db=db,plant_id=PLANT,current_user=ADMIN)",
        "mismatch=create_spec(draft(marker+'-nonotch'),db=db,plant_id=PLANT,current_user=ADMIN)",
        "mid=mismatch['id']",
        "upsert_spec_qc_profile(mid,QcProfileUpdate(qc_profile={'status':'draft','notching_applicable':False}),db=db,plant_id=PLANT,current_user=ADMIN)",
        "retired=create_spec(draft(marker+'-obsolete'),db=db,plant_id=PLANT,current_user=ADMIN)",
        "rid=retired['id']",
        "row=db.query(SpecificationSheet).filter(SpecificationSheet.id==rid).one()",
        "row.status='obsolete'; row.active=False; db.commit()",
        "print(json.dumps({'template':str(tid),'legacy':str(legacy['id']),'mismatch':str(mid),'retired':str(rid),'marker':marker}))",
        "db.close()",
      ].join("\n"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_specdb",
        HARI_OM_LIVE_PG: "1",
        HARI_OM_SPEC_SRC: path.join(workspaceRoot, "hariom-erp", "services", "spec-service"),
      },
    },
  )
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const ids = JSON.parse(String(seeded.stdout || "").trim().split("\n").pop())
  await page.goto("/specifications", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-assign-panel")).toBeVisible()
  await expect(page.getByTestId("spec-assign-apply")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Publish$/i })).toHaveCount(0)
  await page.getByTestId("spec-assign-template").selectOption(ids.template)
  await page.getByTestId(`spec-assign-select-${ids.legacy}`).check()
  await page.getByTestId(`spec-assign-select-${ids.mismatch}`).check()
  await page.getByRole("button", { name: /Disabled Versions/i }).click()
  await page.getByTestId(`spec-assign-select-${ids.retired}`).check()
  await page.getByTestId("spec-assign-preview").click()
  await expect(page.getByTestId("spec-assign-results")).toBeVisible()
  await expect(page.getByTestId(`spec-assign-row-${ids.legacy}`)).toContainText("Yes")
  await expect(page.getByTestId(`spec-assign-row-${ids.mismatch}`)).toContainText("No")
  await expect(page.getByTestId(`spec-assign-row-${ids.retired}`)).toContainText("No")
  await page.getByTestId("spec-assign-apply").click()
  await expect(page.getByTestId(`spec-assign-row-${ids.legacy}`)).toContainText("Unchanged")
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${ids.legacy}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const body = await saved.json()
  expect(String(body.qc_profile?.status || "")).toBe("draft")
  expect(body.qc_profile?.approved_by == null || body.qc_profile?.approved_by === "").toBeTruthy()
  await assertCritical()
})

async function openNewSpecQcDialog(page) {
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  await page.getByTestId("spec-sheet-save-draft").click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test("QCT-040 load all three stage templates keeps exact client names", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const dialog = await openNewSpecQcDialog(page)
  await dialog.getByTestId("spec-qc-stage-WINDER").click()
  await expect(dialog.getByTestId("spec-qc-param-label-WINDER-id")).toHaveText(/I\.D\./)
  await expect(dialog.getByTestId("spec-qc-param-label-WINDER-od")).toHaveText(/O\.D\./)
  await expect(dialog.getByTestId("spec-qc-param-label-WINDER-height")).toHaveText(/^Height/)
  await expect(dialog.getByTestId("spec-qc-param-label-WINDER-weight")).toHaveText(/Weight/)
  await expect(dialog.getByTestId("spec-qc-param-label-WINDER-cs")).toHaveText(/C\.S\./)
  await expect(dialog).not.toContainText("Inner Diameter")
  await dialog.getByTestId("spec-qc-stage-OVEN").click()
  await expect(dialog.getByTestId("spec-qc-param-label-OVEN-pre_weight")).toHaveText(/Pre-weight/)
  await expect(dialog.getByTestId("spec-qc-param-label-OVEN-post_weight")).toHaveText(/Post-weight/)
  await expect(dialog.getByTestId("spec-qc-param-label-OVEN-pre_moisture")).toHaveText(/Pre-moisture/)
  await expect(dialog.getByTestId("spec-qc-param-label-OVEN-post_moisture")).toHaveText(/Post-moisture/)
  await dialog.getByTestId("spec-qc-stage-PROCESS").click()
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-height")).toHaveText(/^Height/)
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-weight")).toHaveText(/Weight/)
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-cs")).toHaveText(/C\.S\./)
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-notch_distance")).toHaveText(/Notch distance/)
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-notch_depth")).toHaveText(/Notch depth/)
  await expect(dialog.getByTestId("spec-qc-param-label-PROCESS-moisture")).toHaveText(/Moisture/)
  await dialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const specId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const body = await saved.json()
  const winding = (body.qc_profile?.stages?.WINDER?.parameters || []).map((row) => row.label)
  const oven = (body.qc_profile?.stages?.OVEN?.parameters || []).map((row) => row.label)
  const process = (body.qc_profile?.stages?.PROCESS?.parameters || []).map((row) => row.label)
  expect(winding).toEqual(["I.D.", "O.D.", "Height", "Weight", "C.S."])
  expect(oven).toEqual(["Pre-weight", "Post-weight", "Pre-moisture", "Post-moisture"])
  expect(process).toEqual(["Height", "Weight", "C.S.", "Notch distance", "Notch depth", "Moisture"])
  expect(winding.concat(oven, process)).not.toContain("Inner Diameter")
  expect(winding.concat(oven, process)).not.toContain("Length")
  await assertCritical()
})

test("QCT-041 verified non-notched is NOT APPLICABLE; unknown needs review", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const unknownDialog = await openNewSpecQcDialog(page)
  await expect(unknownDialog.getByTestId("spec-qc-notching-review")).toBeVisible()
  await unknownDialog.getByTestId("spec-qc-stage-PROCESS").click()
  await expect(unknownDialog.getByTestId("spec-qc-notching-state")).toHaveValue("unknown")
  await expect(unknownDialog.getByTestId("spec-qc-frozen-PROCESS-notch_distance")).not.toHaveText("NOT APPLICABLE")
  await expect(unknownDialog.getByTestId("spec-qc-row-PROCESS-notch_distance").getByRole("spinbutton").first()).toHaveValue("")
  await unknownDialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const unknownId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const unknownSaved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${unknownId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(unknownSaved.ok(), await unknownSaved.text()).toBeTruthy()
  const unknownBody = await unknownSaved.json()
  const unknownNotch = (unknownBody.qc_profile?.stages?.PROCESS?.parameters || []).find((row) => row.code === "notch_distance")
  expect(unknownBody.qc_profile?.notching_review_required).toBeTruthy()
  expect(unknownNotch?.min ?? null).toBeNull()
  expect(unknownNotch?.max ?? null).toBeNull()
  expect(unknownNotch?.applicable ?? null).not.toBe(false)

  const naDialog = await openNewSpecQcDialog(page)
  await naDialog.getByTestId("spec-qc-stage-PROCESS").click()
  await naDialog.getByTestId("spec-qc-notching-state").selectOption("false")
  await expect(naDialog.getByTestId("spec-qc-notching-review")).toHaveCount(0)
  await expect(naDialog.getByTestId("spec-qc-frozen-PROCESS-notch_distance")).toHaveText("NOT APPLICABLE")
  await expect(naDialog.getByTestId("spec-qc-frozen-PROCESS-notch_depth")).toHaveText("NOT APPLICABLE")
  await expect(naDialog.getByTestId("spec-qc-row-PROCESS-notch_distance").getByRole("spinbutton").first()).toHaveValue("")
  await naDialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const naId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const naSaved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${naId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(naSaved.ok(), await naSaved.text()).toBeTruthy()
  const naBody = await naSaved.json()
  const naNotch = (naBody.qc_profile?.stages?.PROCESS?.parameters || []).find((row) => row.code === "notch_distance")
  expect(naBody.qc_profile?.notching_applicable).toBe(false)
  expect(naNotch?.applicable).toBe(false)
  expect(naNotch?.applicability_label).toBe("NOT APPLICABLE")
  expect(naNotch?.min ?? null).toBeNull()
  expect(naNotch?.max ?? null).toBeNull()
  await assertCritical()
})

test("QCT-042 winding Height basis stays distinct from finished Height", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const runtime = getRuntimeManifest()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await page.goto("/specifications/new", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("spec-sheet-page")).toBeVisible()
  await pickFirstSmartSelectOption(page, "spec-sheet-customer")
  await pickFirstSmartSelectOption(page, "spec-sheet-mandrel")
  await expect(page.getByTestId("spec-sheet-tube-size")).toBeEnabled()
  await pickFirstSmartSelectOption(page, "spec-sheet-tube-size")
  await page.getByTestId("spec-sheet-actual-height").fill("150")
  await page.getByTestId("spec-sheet-save-draft").click()
  const dialog = page.getByTestId("spec-qc-tolerance-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByTestId("spec-qc-stage-WINDER").click()
  await expect(dialog.getByTestId("spec-qc-basis-WINDER-height")).toContainText("Height at winding")
  await dialog.getByTestId("spec-qc-row-WINDER-height").getByPlaceholder("Height at winding").fill("winding caliper")
  await expect(dialog.getByTestId("spec-qc-row-WINDER-height").getByRole("spinbutton").first()).toHaveValue("")
  await dialog.getByTestId("spec-qc-stage-PROCESS").click()
  await expect(dialog.getByTestId("spec-qc-basis-PROCESS-height")).toContainText("Finished height")
  await dialog.getByTestId("spec-qc-row-PROCESS-height").getByPlaceholder("Finished height").fill("finished tube")
  await dialog.getByTestId("spec-qc-row-PROCESS-height").getByRole("spinbutton").first().fill("150")
  await dialog.getByTestId("spec-qc-row-PROCESS-height").getByRole("spinbutton").nth(1).fill("154")
  await dialog.getByTestId("spec-qc-notching-state").selectOption("false")
  await dialog.getByTestId("spec-qc-save-incomplete").click()
  await page.waitForURL(/\/specifications\/[0-9a-f-]{36}(?:\/)?(?:\?.*)?$/i, { timeout: 30_000 })
  const specId = page.url().match(/specifications\/([0-9a-f-]{36})/i)[1]
  const saved = await page.request.get(`${runtime.urls.bff}/api/spec/specifications/${specId}`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
  })
  expect(saved.ok(), await saved.text()).toBeTruthy()
  const body = await saved.json()
  const winding = (body.qc_profile?.stages?.WINDER?.parameters || []).find((row) => row.code === "height")
  const process = (body.qc_profile?.stages?.PROCESS?.parameters || []).find((row) => row.code === "height")
  expect(winding?.min ?? null).toBeNull()
  expect(Number(process?.min)).toBe(150)
  expect(winding?.specimen).toBe("winding caliper")
  expect(process?.specimen).toBe("finished tube")
  expect(winding?.basis_hint).toBe("Height at winding")
  expect(process?.basis_hint).toBe("Finished height")
  await assertCritical()
})


