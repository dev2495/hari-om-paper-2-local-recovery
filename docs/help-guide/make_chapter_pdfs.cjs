// One PDF per chapter (plus the glossary / Q&A / samples / page index) for NotebookLM sources.
//   cd apps/web-ui && NODE_PATH=$PWD/node_modules node ../../docs/help-guide/make_chapter_pdfs.cjs
const { chromium } = require("playwright")
const path = require("path")
const fs = require("fs")

const dist = path.join(__dirname, "dist")
const out = path.join(__dirname, "notebooklm-pack", "sources")
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" // fallback when the Playwright shell is not installed
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell"
const footer = (title) =>
  `<div style="font:8px system-ui;color:#64748b;width:100%;text-align:center">Hari Om TubeOS Help Guide &middot; ${title.replace(/</g, "&lt;")} &middot; page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`

async function printEach(browser, htmlFile, items, hideCss) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto("file://" + path.join(dist, htmlFile), { waitUntil: "load" })
  await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")))
  await page.waitForTimeout(2000)
  await page.emulateMedia({ media: "print", colorScheme: "light" })
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)))
  for (const item of items) {
    const handle = await page.addStyleTag({ content: `${hideCss} .chapter:not(#${item.id}){display:none!important}` })
    const file = path.join(out, item.file + ".pdf")
    await page.pdf({ path: file, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer(item.title), margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" } })
    await handle.evaluate((el) => el.remove())
    console.log(path.basename(file), (fs.statSync(file).size / 1e6).toFixed(1) + " MB")
  }
  await page.close()
}

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : fs.existsSync(chrome) ? { executablePath: chrome } : {})
  const chapters = JSON.parse(fs.readFileSync(path.join(dist, "chapters.json"), "utf8"))
  await printEach(browser, "Hari-Om-TubeOS-Help-Guide.html", chapters, ".hero,.how,.grp,.cards,footer,.top,nav.side{display:none!important} .chapter{break-before:auto!important}")
  const extras = JSON.parse(fs.readFileSync(path.join(dist, "extras.json"), "utf8"))
  await printEach(browser, "_extras.html", extras, ".chapter{break-before:auto!important}")
  await browser.close()
})()
