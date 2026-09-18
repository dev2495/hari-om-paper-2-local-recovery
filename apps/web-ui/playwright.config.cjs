const path = require("path")
const { defineConfig, devices } = require("@playwright/test")

const sha = process.env.ERP_EXPECTED_SHA || "local"
const outputRoot = process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(__dirname, "..", "..", "output", "playwright", sha)

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(outputRoot, "html"), open: "never" }],
    ["junit", { outputFile: path.join(outputRoot, "junit.xml") }],
  ],
  outputDir: path.join(outputRoot, "test-results"),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:13000",
    trace: process.env.PLAYWRIGHT_TRACE || "retain-on-failure",
    screenshot: process.env.PLAYWRIGHT_SCREENSHOT || "on",
    video: process.env.PLAYWRIGHT_VIDEO || "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHROME_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL } : {}),
      },
    },
  ],
})
