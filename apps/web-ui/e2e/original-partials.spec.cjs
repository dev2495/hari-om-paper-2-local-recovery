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
  await page.goto("/login", { waitUntil: "domcontentloaded" })
  const response = await page.request.post("/api/auth/login", {
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

test("QCT-043/044 inspected job print stays rev A after rev B and frozen rule sits beside the field", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const { spawnSync } = require("child_process")
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const py = path.join(workspaceRoot, "hariom-erp", "venv-verify", "bin", "python")
  const seeded = spawnSync(
    py,
    ["-m", "pytest", "tests/test_original_qct043_live.py", "-q", "--tb=short"],
    {
      encoding: "utf8",
      cwd: path.join(workspaceRoot, "hariom-erp", "services", "production-service"),
      env: {
        ...process.env,
        HARI_OM_LIVE_PG: "1",
        DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
        HARI_OM_PRODUCTION_DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
      },
    },
  )
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifactPath = path.join(workspaceRoot, "reports", "qct043-job.json")
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"))
  await page.goto(`/production/job-cards/${artifact.job_id}/print`, { waitUntil: "domcontentloaded" })
  const printWinder = page.getByTestId("print-qc-winder")
  await expect(printWinder).toBeVisible()
  await expect(printWinder).toHaveAttribute("data-profile-revision", String(artifact.revision_a))
  await expect(printWinder).toContainText(`Rev ${artifact.revision_a}`)
  await expect(printWinder.getByTestId("allowed-height")).toContainText("118")
  await expect(printWinder.getByTestId("allowed-height")).toContainText("122")
  await expect(printWinder.getByTestId("stage-qc-meta-id")).toContainText("Unit mm")
  await expect(printWinder.getByTestId("stage-qc-meta-id")).toContainText("Checkpoint Winding")
  await expect(printWinder.getByTestId("stage-qc-meta-id")).toContainText(`Rev ${artifact.revision_a}`)
  await expect(printWinder.getByTestId("allowed-height")).not.toContainText("10–14")
  const evidence = await page.request.get(`${getRuntimeManifest().urls.bff}/api/production/quality/inspections`, {
    headers: { "X-Plant-ID": fixture.plants.plant_a.id },
    params: { job_card_id: artifact.job_id },
  })
  expect(evidence.ok(), await evidence.text()).toBeTruthy()
  const rows = await evidence.json()
  const first = Array.isArray(rows) ? rows[0] : rows
  expect(String(first.status)).toBe("PASS")
  const idRule = (first.frozen_rules || []).find((row) => row.code === "height")
  expect(Number(idRule.max)).toBe(122)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(printWinder.getByTestId("stage-qc-meta-id")).toBeVisible()
  await expect(printWinder.getByTestId("stage-qc-meta-id")).toContainText(`Rev ${artifact.revision_a}`)
  await page.goto(`/production/job-cards/${artifact.prospective_job_id}/print`, { waitUntil: "domcontentloaded" })
  const printB = page.getByTestId("print-qc-winder")
  await expect(printB).toHaveAttribute("data-profile-revision", String(artifact.revision_b))
  await expect(printB.getByTestId("allowed-height")).toContainText("10")
  await expect(printB.getByTestId("allowed-height")).toContainText("14")
  await assertCritical()
})

test("QCT-045 keyboard outside value shows readable FAIL, difference, focusable reason, and print text", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const { spawnSync } = require("child_process")
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const py = path.join(workspaceRoot, "hariom-erp", "venv-verify", "bin", "python")
  const seeded = spawnSync(
    py,
    ["-m", "pytest", "tests/test_original_qct043_live.py", "-q", "--tb=short"],
    {
      encoding: "utf8",
      cwd: path.join(workspaceRoot, "hariom-erp", "services", "production-service"),
      env: {
        ...process.env,
        HARI_OM_LIVE_PG: "1",
        DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
        HARI_OM_PRODUCTION_DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
      },
    },
  )
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct043-job.json"), "utf8"))
  await page.goto("/quality/stage", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("quality-stage-page")).toBeVisible()
  await page.getByTestId("quality-stage-job-search").fill(String(artifact.prospective_job_id))
  await expect(page.getByTestId("quality-stage-job").locator(`option[value="${artifact.prospective_job_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await page.getByTestId("quality-stage-job").selectOption(String(artifact.prospective_job_id))
  const height = page.getByTestId("stage-qc-reading-height")
  await expect(height).toBeVisible()
  await height.click()
  await page.keyboard.type("120")
  const feedback = page.getByTestId("stage-qc-feedback-height")
  await expect(feedback).toContainText("FAIL")
  await expect(feedback).toContainText("14")
  await expect(feedback).toContainText("106")
  await expect(feedback).toContainText("difference")
  await expect(feedback).toHaveAttribute("role", "status")
  await expect(height).toHaveAttribute("aria-invalid", "true")
  await page.keyboard.press("Tab")
  await expect(page.getByTestId("stage-qc-reason-height")).toBeFocused()
  await page.keyboard.type("outside winding height")
  await expect(page.getByTestId("stage-qc-issue-summary")).toContainText("Height FAIL")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(feedback).toBeVisible()
  await expect(page.getByTestId("stage-qc-reason-height")).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`/production/job-cards/${artifact.prospective_job_id}/print`, { waitUntil: "domcontentloaded" })
  await page.emulateMedia({ media: "print" })
  const printFail = page.getByTestId("print-qc-winder").getByTestId("stage-qc-feedback-height")
  await expect(printFail).toBeVisible()
  await expect(printFail).toContainText("FAIL")
  await expect(printFail).toContainText("difference")
  await expect(printFail).toContainText("14")
  const printText = await printFail.innerText()
  expect(printText).toMatch(/FAIL/)
  expect(printText).not.toMatch(/^$/)
  const color = await printFail.evaluate((el) => getComputedStyle(el).color)
  expect(color).toBeTruthy()
  await assertCritical()
})

function spawnProductionPytest(testPath) {
  const { spawnSync } = require("child_process")
  const py = path.join(workspaceRoot, "hariom-erp", "venv-verify", "bin", "python")
  const result = spawnSync(
    py,
    ["-m", "pytest", testPath, "-q", "--tb=short"],
    {
      encoding: "utf8",
      timeout: 120_000,
      killSignal: "SIGKILL",
      cwd: path.join(workspaceRoot, "hariom-erp", "services", "production-service"),
      env: {
        ...process.env,
        HARI_OM_LIVE_PG: "1",
        DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
        HARI_OM_PRODUCTION_DATABASE_URL: "postgresql://devarshthakkar@127.0.0.1:5432/hariom_nverify_productiondb",
      },
    },
  )
  if (result.error && result.error.code === "ETIMEDOUT") {
    result.status = 124
    result.stderr = `${result.stderr || ""}\npytest timed out after 120s: ${testPath}`
  }
  return result
}

async function selectSeededQualityJob(page, jobId) {
  await page.goto("/quality/stage", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("quality-stage-page")).toBeVisible()
  await page.getByTestId("quality-stage-job-search").fill(jobId)
  await expect(page.getByText("Loading job cards for stage QC…")).toHaveCount(0, { timeout: 45_000 })
  await expect(page.getByTestId("quality-stage-job").locator(`option[value="${jobId}"]`)).toHaveCount(1, { timeout: 30_000 })
  await page.getByTestId("quality-stage-job").selectOption(jobId)
}

test("QCT-046 blank multi-page print keeps samples, paired oven, writable spaces, and no default PASS", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const seeded = spawnProductionPytest("tests/test_original_qct046_live.py::test_qct046_blank_job_print_has_frozen_stage_rules")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct046-job.json"), "utf8"))
  await page.goto(`/production/job-cards/${artifact.blank_job_id}/print`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("print-page-winding")).toBeVisible()
  await expect(page.getByTestId("print-page-oven")).toBeVisible()
  await expect(page.getByTestId("print-page-process")).toBeVisible()
  await expect(page.getByTestId("print-winder-sample")).toHaveCount(4)
  await expect(page.getByTestId("print-process-sample")).toHaveCount(2)
  await expect(page.getByTestId("print-winder-allowed-row")).toContainText("118")
  await expect(page.getByTestId("print-winder-allowed-row")).toContainText("122")
  await expect(page.getByTestId("print-oven-pair-table")).toContainText("Pre-weight")
  await expect(page.getByTestId("print-oven-pair-table")).toContainText("Post-weight")
  await expect(page.getByTestId("print-oven-allowed-row")).toBeVisible()
  await expect(page.getByTestId("allowed-pre_weight")).toBeVisible()
  await expect(page.getByTestId("allowed-post_weight")).toBeVisible()
  await expect(page.getByTestId("allowed-pre_moisture")).toBeVisible()
  await expect(page.getByTestId("allowed-post_moisture")).toBeVisible()
  await expect(page.getByTestId("print-qc-process")).toBeVisible()
  const windingQc = page.getByTestId("print-qc-winder")
  await expect(windingQc.getByTestId("stage-qc-reading-height")).toHaveAttribute("data-blank", "true")
  const windingText = await windingQc.innerText()
  expect(windingText).not.toMatch(/\bPASS\b/)
  const ovenText = await page.getByTestId("print-qc-oven").innerText()
  expect(ovenText).not.toMatch(/\bPASS\b/)
  await page.emulateMedia({ media: "print" })
  const overflow = await page.getByTestId("print-page-winding").evaluate((el) => getComputedStyle(el).overflow)
  expect(overflow).not.toBe("hidden")
  const breakAfter = await page.getByTestId("print-page-winding").evaluate((el) => getComputedStyle(el).breakAfter || getComputedStyle(el).pageBreakAfter)
  expect(["page", "always"]).toContain(breakAfter)
  const ovenBreak = await page.getByTestId("print-page-oven").evaluate((el) => getComputedStyle(el).breakAfter || getComputedStyle(el).pageBreakAfter)
  expect(["page", "always"]).toContain(ovenBreak)
  const writable = page.locator(".qc-print-writable").first()
  await expect(writable).toBeVisible()
  const minHeight = await writable.evaluate((el) => parseFloat(getComputedStyle(el).minHeight))
  expect(minHeight).toBeGreaterThan(0)
  await assertCritical()
})

test("QCT-047 signed print keeps original Height unit and revision after later dictionary change", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const seeded = spawnProductionPytest("tests/test_original_qct046_live.py::test_qct047_signed_print_keeps_old_label_after_dictionary_change")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct047-job.json"), "utf8"))
  await page.goto(`/production/job-cards/${artifact.job_id}/print`, { waitUntil: "domcontentloaded" })
  const printWinder = page.getByTestId("print-qc-winder")
  await expect(printWinder).toHaveAttribute("data-profile-revision", String(artifact.revision_a))
  await expect(printWinder).toContainText("Height")
  await expect(printWinder).not.toContainText("Ht-B")
  await expect(printWinder).not.toContainText("Dict-B")
  await expect(printWinder.getByTestId("allowed-height")).toContainText("118")
  await expect(printWinder.getByTestId("allowed-height")).toContainText("122")
  await expect(printWinder.getByTestId("allowed-height")).toContainText("mm")
  await expect(printWinder.getByTestId("allowed-height")).not.toContainText("cm")
  await expect(printWinder.getByTestId("allowed-height")).not.toContainText("14")
  await expect(printWinder.getByTestId("stage-qc-reading-height")).toHaveAttribute("data-blank", "false")
  await expect(printWinder.getByTestId("stage-qc-reading-height")).toContainText("120")
  await assertCritical()
})

test("QCT-048 oven pre save then later post keeps the same pair and requires post when due", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const seeded = spawnProductionPytest("tests/test_original_qct048_live.py::test_qct048_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct048-ui-job.json"), "utf8"))
  await page.goto("/quality/stage", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("quality-stage-page")).toBeVisible()
  await page.getByTestId("quality-stage-job-search").fill(String(artifact.job_id))
  await expect(page.getByTestId("quality-stage-job").locator(`option[value="${artifact.job_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await page.getByTestId("quality-stage-job").selectOption(String(artifact.job_id))
  await page.getByTestId("quality-stage-type").selectOption("OVEN")
  await page.getByTestId("quality-stage-checkpoint").selectOption("PRE")
  await expect(page.getByTestId("stage-qc-not-due-post_weight")).toHaveText("Not yet due")
  await expect(page.getByTestId("stage-qc-not-due-post_moisture")).toHaveText("Not yet due")
  await page.getByTestId("stage-qc-sample-id").fill("PAIR-A")
  await page.getByTestId("stage-qc-reading-pre_weight").fill("1.5")
  await page.getByTestId("stage-qc-reading-pre_moisture").fill("5")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("PASS")
  await page.getByTestId("quality-stage-checkpoint").selectOption("POST")
  await expect(page.getByTestId("stage-qc-reading-post_weight")).toBeVisible()
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).not.toHaveText("PASS")
  await page.getByTestId("stage-qc-reading-post_weight").fill("1.4")
  await page.getByTestId("stage-qc-reading-post_moisture").fill("4")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("PASS")
  await expect(page.getByTestId("stage-qc-sample-id")).toHaveValue("PAIR-A")
  await assertCritical()
})

test("QCT-049 oven post for a different sample is not combined into a valid pair", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const seeded = spawnProductionPytest("tests/test_original_qct048_live.py::test_qct049_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct049-ui-job.json"), "utf8"))
  await page.goto("/quality/stage", { waitUntil: "domcontentloaded" })
  await page.getByTestId("quality-stage-job-search").fill(String(artifact.job_id))
  await expect(page.getByTestId("quality-stage-job").locator(`option[value="${artifact.job_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await page.getByTestId("quality-stage-job").selectOption(String(artifact.job_id))
  await page.getByTestId("quality-stage-type").selectOption("OVEN")
  await page.getByTestId("quality-stage-checkpoint").selectOption("PRE")
  await page.getByTestId("stage-qc-sample-id").fill("PAIR-A")
  await page.getByTestId("stage-qc-reading-pre_weight").fill("1.5")
  await page.getByTestId("stage-qc-reading-pre_moisture").fill("5")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("PASS")
  await page.getByTestId("quality-stage-checkpoint").selectOption("POST")
  await page.getByTestId("stage-qc-sample-id").fill("PAIR-B")
  await page.getByTestId("stage-qc-reading-post_weight").fill("1.4")
  await page.getByTestId("stage-qc-reading-post_moisture").fill("4")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).not.toHaveText("PASS")
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText(/INCOMPLETE|FAIL/)
  await assertCritical()
})

test("QCT-050 complete job card returns hidden-stage issues and keeps form data", async ({ page }) => {
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  const seeded = spawnProductionPytest("tests/test_original_qct050_live.py::test_qct050_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct050-ui-job.json"), "utf8"))
  await page.goto("/quality/stage", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("quality-stage-page")).toBeVisible()
  await page.getByTestId("quality-stage-job-search").fill(String(artifact.job_id))
  await expect(page.getByTestId("quality-stage-job").locator(`option[value="${artifact.job_id}"]`)).toHaveCount(1, { timeout: 20_000 })
  await page.getByTestId("quality-stage-job").selectOption(String(artifact.job_id))
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("120")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await page.getByTestId("quality-stage-tab-PROCESS").click()
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await page.getByTestId("stage-qc-reading-moisture").fill("5")
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await expect(page.getByTestId("stage-qc-reading-height")).toHaveValue("120")
  await page.getByTestId("quality-card-submit").click()
  await expect(page.getByTestId("quality-card-issues")).toBeVisible()
  await expect(page.getByTestId("quality-card-issue-OVEN-pre_weight")).toBeVisible()
  await expect(page.getByTestId("quality-card-issue-PROCESS-height")).toContainText("FAIL")
  await expect(page.getByTestId("quality-stage-verdict")).not.toHaveText("PASS")
  await expect(page.getByTestId("stage-qc-reading-height")).toHaveValue("120")
  await page.getByTestId("quality-stage-tab-PROCESS").click()
  await expect(page.getByTestId("stage-qc-reading-height")).toHaveValue("90")
  await assertCritical()
})

test("QCT-051 same observations through adapters share one FAIL and ignore shortcut PASS", async ({ page }) => {
  test.setTimeout(180_000)
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const seeded = spawnProductionPytest("tests/test_original_qct051_live.py::test_qct051_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct051-ui-job.json"), "utf8"))
  const jobId = String(artifact.job_id)
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await selectSeededQualityJob(page, jobId)
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await expect(page.getByTestId("stage-qc-reason-height")).toBeVisible()
  await page.getByTestId("stage-qc-reason-height").fill("measured short on winding")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("FAIL")
  const plantHeaders = { "X-Plant-ID": fixture.plants.plant_a.id }
  const observation = {
    job_card_id: jobId,
    stage_type: "WINDER",
    readings: {
      id: 77,
      od: 91,
      height: 90,
      weight: 250,
      cs: 100,
      overall: "PASS",
      status: "PASS",
      disposition: "RELEASED",
    },
    reasons: { height: "measured short on winding" },
    overall: "PASS",
    status: "PASS",
  }
  const supervisor = await page.request.post("/api/production/quality/supervisor/inspections", {
    headers: plantHeaders,
    data: observation,
  })
  expect(supervisor.ok(), await supervisor.text()).toBeTruthy()
  const supervisorBody = await supervisor.json()
  expect(supervisorBody.status).toBe("FAIL")
  expect(supervisorBody.reused).toBeTruthy()
  const eod = await page.request.post("/api/production/quality/eod/inspections", {
    headers: plantHeaders,
    data: { job_id: jobId, stage: "WINDER", checks: observation.readings, reasons: observation.reasons, result: "PASS" },
  })
  expect(eod.ok(), await eod.text()).toBeTruthy()
  expect((await eod.json()).status).toBe("FAIL")
  const imported = await page.request.post("/api/production/quality/inspections/import", {
    headers: plantHeaders,
    data: { rows: [observation] },
  })
  expect(imported.ok(), await imported.text()).toBeTruthy()
  const importedBody = await imported.json()
  expect(importedBody[0].status).toBe("FAIL")
  const legacy = await page.request.post("/api/production/quality/legacy/inspections", {
    headers: plantHeaders,
    data: { job_id: jobId, stage: "WINDER", checks: { id: 77, od: 91, height: 90, weight: 250, cs: 100 }, reasons: observation.reasons, status: "PASS", overall: "PASS" },
  })
  expect(legacy.ok(), await legacy.text()).toBeTruthy()
  expect((await legacy.json()).status).toBe("FAIL")
  const listed = await page.request.get(`/api/production/quality/inspections?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(listed.ok(), await listed.text()).toBeTruthy()
  const rows = await listed.json()
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("FAIL")
  expect(rows[0].readings.overall).toBeUndefined()
  expect(rows[0].readings.height).toBe(90)
  await assertCritical()
})

test("QCT-053 detailed reason keeps FAIL and still requires disposition authority", async ({ page }) => {
  test.setTimeout(180_000)
  const assertCritical = beginCriticalMonitoring(page, {
    expected: [{ kind: "response", status: 403, urlIncludes: "/quality/holds/" }],
  })
  const fixture = getBrowserFixture()
  const seeded = spawnProductionPytest("tests/test_original_qct051_live.py::test_qct053_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct053-ui-job.json"), "utf8"))
  const jobId = String(artifact.job_id)
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await selectSeededQualityJob(page, jobId)
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await expect(page.getByTestId("stage-qc-reason-height")).toBeVisible()
  await page.getByTestId("stage-qc-reason-height").fill("detailed valid reason: core crushed during winding")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-verdict")).not.toHaveText("PASS")
  const plantHeaders = { "X-Plant-ID": fixture.plants.plant_a.id }
  const holds = await page.request.get(`/api/production/quality/holds?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(holds.ok(), await holds.text()).toBeTruthy()
  const holdRows = await holds.json()
  expect(holdRows.length).toBeGreaterThan(0)
  const holdId = holdRows[0].id
  const released = await page.request.post(`/api/production/quality/holds/${holdId}/release`, {
    headers: plantHeaders,
    data: {},
  })
  expect(released.status()).toBe(403)
  const again = await page.request.get(`/api/production/quality/holds?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  const after = await again.json()
  expect(after[0].status).toBe("HOLD")
  await assertCritical()
})

test("QCT-054 Cause under investigation keeps FAIL and leaves investigation open", async ({ page }) => {
  test.setTimeout(180_000)
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const seeded = spawnProductionPytest("tests/test_original_qct051_live.py::test_qct054_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct054-ui-job.json"), "utf8"))
  const jobId = String(artifact.job_id)
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await selectSeededQualityJob(page, jobId)
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await expect(page.getByTestId("stage-qc-reason-code-height")).toBeVisible()
  await page.getByTestId("stage-qc-reason-code-height").selectOption("CAUSE_UNDER_INVESTIGATION")
  await page.getByTestId("stage-qc-reason-height").fill("height measured short versus Allowed 118-122 mm; cause not yet known")
  await page.getByTestId("stage-qc-containment-height").fill("quarantine the wound reel at the QC cage")
  await page.getByTestId("stage-qc-assignee-height").fill("qc.supervisor")
  await expect(page.getByTestId("stage-qc-investigation-hint-height")).toContainText(/Investigation remains open/i)
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-verdict")).not.toHaveText("PASS")
  await expect(page.getByTestId("quality-stage-investigation")).toHaveText("OPEN")
  const plantHeaders = { "X-Plant-ID": fixture.plants.plant_a.id }
  const listed = await page.request.get(`/api/production/quality/inspections?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(listed.ok(), await listed.text()).toBeTruthy()
  const rows = await listed.json()
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("FAIL")
  expect(rows[0].investigation_status).toBe("OPEN")
  expect(rows[0].investigation_open).toBeTruthy()
  expect(rows[0].reasons.height.code).toBe("CAUSE_UNDER_INVESTIGATION")
  expect(rows[0].reasons.height.investigation_status).toBe("OPEN")
  expect(rows[0].reasons.height.root_cause).toBeUndefined()
  const holds = await page.request.get(`/api/production/quality/holds?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(holds.ok(), await holds.text()).toBeTruthy()
  const holdRows = await holds.json()
  expect(holdRows[0].status).toBe("HOLD")
  await assertCritical()
})

test("QCT-055 three related failures share one common cause without losing parameters", async ({ page }) => {
  test.setTimeout(180_000)
  const assertCritical = beginCriticalMonitoring(page)
  const fixture = getBrowserFixture()
  const seeded = spawnProductionPytest("tests/test_original_qct051_live.py::test_qct055_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct055-ui-job.json"), "utf8"))
  const jobId = String(artifact.job_id)
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await selectSeededQualityJob(page, jobId)
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-reading-id").fill("70")
  await page.getByTestId("stage-qc-reading-od").fill("80")
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await expect(page.getByTestId("quality-stage-common-cause")).toBeVisible()
  await page.getByTestId("stage-qc-common-explanation").fill("crushed core during winding affected ID, OD and height")
  await page.getByTestId("stage-qc-common-containment").fill("hold the entire winder cage")
  await page.getByTestId("stage-qc-common-assignee").fill("qc.supervisor")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-grouped-case")).toHaveText("COMMON")
  const plantHeaders = { "X-Plant-ID": fixture.plants.plant_a.id }
  const listed = await page.request.get(`/api/production/quality/inspections?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(listed.ok(), await listed.text()).toBeTruthy()
  const rows = await listed.json()
  expect(rows).toHaveLength(1)
  expect(rows[0].status).toBe("FAIL")
  expect(rows[0].grouped_case_id).toBe("COMMON")
  expect([...rows[0].grouped_parameters].sort()).toEqual(["height", "id", "od"])
  const failCodes = (rows[0].failures || []).map((row) => String(row.code || ""))
  expect(failCodes).toContain("id")
  expect(failCodes).toContain("od")
  expect(failCodes).toContain("height")
  expect(rows[0].reasons.id.common_cause_id).toBe("COMMON")
  expect(rows[0].reasons.od.common_cause_id).toBe("COMMON")
  expect(rows[0].reasons.height.common_cause_id).toBe("COMMON")
  const groupedHolds = await page.request.get(`/api/production/quality/holds?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect((await groupedHolds.json())[0].status).toBe("HOLD")
  await assertCritical()
})

test("QCT-056 changing a failing number keeps original FAIL, requires correction audit, and does not clear the hold", async ({ page }) => {
  test.setTimeout(180_000)
  const assertCritical = beginCriticalMonitoring(page, {
    expected: [{ kind: "response", status: 400, urlIncludes: "/quality/inspections" }],
  })
  const fixture = getBrowserFixture()
  const seeded = spawnProductionPytest("tests/test_original_qct051_live.py::test_qct056_ui_job_seed")
  expect(seeded.status, seeded.stderr || seeded.stdout).toBe(0)
  const artifact = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "reports", "qct056-ui-job.json"), "utf8"))
  const jobId = String(artifact.job_id)
  await cookieLogin(page, fixture.auth.admin_email, fixture.auth.admin_password, fixture.plants.plant_a.id)
  await selectSeededQualityJob(page, jobId)
  await page.getByTestId("quality-stage-tab-WINDER").click()
  await page.getByTestId("stage-qc-sample-id").fill("CORR-1")
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("90")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await expect(page.getByTestId("stage-qc-reason-height")).toBeVisible()
  await page.getByTestId("stage-qc-reason-height").fill("measured short on winding")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-original-status")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-original-height")).toHaveText("90")
  const plantHeaders = { "X-Plant-ID": fixture.plants.plant_a.id }
  const rejected = await page.request.post("/api/production/quality/inspections", {
    headers: plantHeaders,
    data: {
      job_card_id: jobId,
      stage_type: "WINDER",
      readings: { id: 77, od: 91, height: 120, weight: 250, cs: 100 },
      sample_id: "CORR-1",
    },
  })
  expect(rejected.status()).toBe(400)
  expect(await rejected.text()).toMatch(/original value is retained/i)
  await page.getByTestId("stage-qc-sample-id").fill("CORR-1")
  await page.getByTestId("stage-qc-reading-id").fill("77")
  await page.getByTestId("stage-qc-reading-od").fill("91")
  await page.getByTestId("stage-qc-reading-height").fill("120")
  await page.getByTestId("stage-qc-reading-weight").fill("250")
  await page.getByTestId("stage-qc-reading-cs").fill("100")
  await page.getByTestId("quality-stage-correction-reason").fill("height was a transcription error from the vernier card")
  await page.getByTestId("quality-stage-submit").click()
  await expect(page.getByTestId("quality-stage-verdict")).toHaveText("PASS")
  await expect(page.getByTestId("quality-stage-original-status")).toHaveText("FAIL")
  await expect(page.getByTestId("quality-stage-correction-revision")).toHaveText("2")
  const listed = await page.request.get(`/api/production/quality/inspections?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect(listed.ok(), await listed.text()).toBeTruthy()
  const rows = await listed.json()
  expect(rows).toHaveLength(2)
  const original = rows.find((row) => row.status === "FAIL")
  const correction = rows.find((row) => row.status === "PASS")
  expect(original.readings.height).toBe(90)
  expect(original.evaluation.workflow_status).toBe("SUPERSEDED")
  expect(correction.readings.height).toBe(120)
  expect(correction.parent_inspection_id).toBe(original.id)
  expect(correction.correction_revision).toBe(2)
  expect(correction.correction_reason).toMatch(/transcription error/i)
  expect(correction.correction_actor).toBeTruthy()
  expect(correction.correction_at).toBeTruthy()
  expect(correction.original_status).toBe("FAIL")
  expect(correction.review_required).toBeTruthy()
  const holds = await page.request.get(`/api/production/quality/holds?job_card_id=${jobId}`, {
    headers: plantHeaders,
  })
  expect((await holds.json())[0].status).toBe("HOLD")
  await assertCritical()
})


