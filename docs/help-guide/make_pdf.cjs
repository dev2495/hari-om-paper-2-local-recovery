// Print dist/Hari-Om-TubeOS-Help-Guide.html to PDF with Playwright.
//   cd apps/web-ui && NODE_PATH=$PWD/node_modules node ../../docs/help-guide/make_pdf.cjs
const { chromium } = require("playwright")
const path = require("path")
const fs = require("fs")

const dist = path.join(__dirname, "dist")
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" // fallback when the Playwright shell is not installed
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell"

;(async () => {
  const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : fs.existsSync(chrome) ? { executablePath: chrome } : {})
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto("file://" + path.join(dist, "Hari-Om-TubeOS-Help-Guide.html"), { waitUntil: "load" })
  await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")))
  await page.waitForTimeout(2500)
  await page.emulateMedia({ media: "print", colorScheme: "light" })
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)))
  const out = path.join(dist, "Hari-Om-TubeOS-Help-Guide.pdf")
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font:8px system-ui;color:#64748b;width:100%;text-align:center">Hari Om TubeOS Help Guide &middot; page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
  })
  console.log("PDF", out, (fs.statSync(out).size / 1e6).toFixed(1) + " MB")
  await browser.close()
})()
