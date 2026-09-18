const fs = require("fs")
const path = require("path")

const workspaceRoot = path.resolve(__dirname, "..", "..", "..")

function resolveRuntimeManifestPath() {
  if (process.env.ERP_RUNTIME_MANIFEST) return process.env.ERP_RUNTIME_MANIFEST
  const preferred = path.join(workspaceRoot, "hariom-erp", "runtime-verify", "runtime_manifest.json")
  if (fs.existsSync(preferred)) return preferred
  const runtime = path.join(workspaceRoot, "hariom-erp", "runtime", "runtime_manifest.json")
  if (fs.existsSync(runtime)) return runtime
  return path.join(workspaceRoot, "hariom-erp", ".runtime", "runtime_manifest.json")
}

function resolveBrowserFixturePath() {
  return (
    process.env.ERP_BROWSER_FIXTURE ||
    path.join(workspaceRoot, "reports", "browser_e2e_fixture_latest.json")
  )
}

function readRequiredJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} missing at ${filePath}. Start the isolated verify stack and seed real test records before running Playwright (discovery does not require this file).`,
    )
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    throw new Error(`Unable to read ${label} ${filePath}: ${String(error.message || error)}`)
  }
}

function getRuntimeManifest() {
  const manifest = readRequiredJson(resolveRuntimeManifestPath(), "Runtime manifest")
  if (!manifest?.urls?.web || !manifest?.urls?.bff) {
    throw new Error("Runtime manifest is present but missing urls.web / urls.bff from the live stack")
  }
  return manifest
}

function getBrowserFixture() {
  const fixture = readRequiredJson(resolveBrowserFixturePath(), "Browser fixture")
  if (!fixture?.auth?.admin_email || !fixture?.auth?.admin_password) {
    throw new Error("Browser fixture is present but missing real admin credentials from seeded test data")
  }
  if (!fixture?.plants?.plant_a?.id) {
    throw new Error("Browser fixture is present but missing real plants.plant_a.id")
  }
  return fixture
}

function requireCredential(key) {
  const browserFixture = getBrowserFixture()
  if (key === "admin") {
    const email = browserFixture.auth.admin_email
    const password = browserFixture.auth.admin_password
    if (!email || !password) {
      throw new Error("Missing browser credential fixture for admin")
    }
    return { email, password, plant_id: browserFixture.plants?.plant_a?.id }
  }
  const user = browserFixture.users?.[key]
  if (!user?.email || !user?.password) {
    throw new Error(`Missing browser credential fixture for ${key}`)
  }
  return user
}

function beginCriticalMonitoring(page, options = {}) {
  const critical = []
  const expected = Array.isArray(options.expected) ? options.expected : []

  function isExpected(kind, text, url, status) {
    return expected.some((rule) => {
      if (rule.kind && rule.kind !== kind) return false
      if (rule.status != null && Number(status) !== Number(rule.status)) return false
      if (rule.urlIncludes && !String(url || "").includes(rule.urlIncludes)) return false
      if (rule.textIncludes && !String(text || "").includes(rule.textIncludes)) return false
      if (rule.pageUrlIncludes && !page.url().includes(rule.pageUrlIncludes)) return false
      return Boolean(rule.kind || rule.status || rule.urlIncludes || rule.textIncludes || rule.pageUrlIncludes)
    })
  }

  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (isExpected("console", text, page.url())) return
    if (text.includes("401") && page.url().includes("/login")) return
    critical.push({ kind: "console", text })
  })

  page.on("pageerror", (error) => {
    const text = String(error?.message || error)
    if (isExpected("pageerror", text, page.url())) return
    critical.push({ kind: "pageerror", text })
  })

  page.on("response", (response) => {
    const url = response.url()
    const status = response.status()
    if (status < 400) return
    if (isExpected("response", `${status} ${url}`, url, status)) return
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
    if ([400, 403, 404].includes(status) && !url.includes("/_next/")) {
      critical.push({ kind: "response", text: `${status} ${url}` })
    }
  })

  return async () => {
    const expect = require("@playwright/test").expect
    expect(
      critical,
      critical.length
        ? `Critical browser/runtime errors detected:\n${critical.map((item) => `${item.kind}: ${item.text}`).join("\n")}`
        : "No critical browser/runtime errors detected.",
    ).toEqual([])
  }
}

async function pickFirstSmartSelectOption(page, testId) {
  const { expect } = require("@playwright/test")
  const trigger = page.getByTestId(testId)
  await expect(trigger).toBeVisible()
  await trigger.click()
  const option = trigger.locator("xpath=following-sibling::*[1]").getByRole("button").first()
  await expect(option, `Expected a live option after opening ${testId}`).toBeVisible()
  const label = ((await option.innerText()) || "").trim()
  await option.click()
  return label
}

module.exports = {
  workspaceRoot,
  resolveRuntimeManifestPath,
  resolveBrowserFixturePath,
  getRuntimeManifest,
  getBrowserFixture,
  requireCredential,
  beginCriticalMonitoring,
  pickFirstSmartSelectOption,
}
