#!/usr/bin/env node
/**
 * Dark theme for hard-coded colours (client 2026-10-20: dark mode back, system by default).
 *
 * Most screens use theme tokens (bg-card, text-foreground …) and switch on their own. Some use fixed
 * colours (bg-[#f8faf9], text-[#102832], bg-white, text-slate-900 …); in dark mode those stayed light
 * panels under light text, or dark text on the dark page — the white-on-white the client reported.
 *
 * This script finds every fixed colour class in the app and writes app/dark-theme-colours.css, which
 * gives each one a dark-mode equivalent of the same hue (light surfaces become dark tinted surfaces,
 * dark ink becomes light ink, light hairlines become dark hairlines). Light mode is untouched.
 *
 *   node scripts/dark-theme-colours.cjs          regenerate the CSS
 *   node scripts/dark-theme-colours.cjs --check  fail if a fixed colour has no dark equivalent yet
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const SOURCES = ["app", "components", "lib", "hooks", "context"]
const OUTPUT = path.join(ROOT, "app", "dark-theme-colours.css")
const palette = require(path.join(ROOT, "node_modules", "tailwindcss", "colors"))

const PALETTES = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
const UTILITIES = "bg|text|border|border-[tblrxy]|from|via|to|ring|outline|placeholder"
const VARIANTS = ["hover", "focus", "focus-visible", "disabled", "group-hover", "active"]
// Fixed colours that must stay as they are in dark mode too.
const KEEP = new Set([
  "border-white/80", // QR scanner viewfinder drawn over the camera picture
])
const CLASS_RE = new RegExp(`(?<![\\w-])((?:[a-z-]+:)*)(${UTILITIES})-(\\[#[0-9a-fA-F]{3,8}\\]|white|black|(?:${PALETTES})-(?:50|[1-9]00|950))(?:/(\\d{1,3}))?(?![\\w\\[#-])`, "g")

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
  }
  return out
}

function hexToRgb(hex) {
  let h = hex.replace("#", "")
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("")
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: s * 100, l: l * 100 }
}

function colourOf(token) {
  if (token.startsWith("[#")) return token.slice(1, -1)
  if (token === "white") return "#ffffff"
  if (token === "black") return "#000000"
  const [name, shade] = token.split("-")
  return palette[name][shade]
}

const fmt = (n) => Math.round(n * 10) / 10
const hsl = (h, s, l, a) => `hsl(${fmt(h)} ${fmt(s)}% ${fmt(l)}%${a < 1 ? ` / ${a}` : ""})`

/** Dark-mode colour for one fixed colour in one role, or null when it already reads on dark. */
function darkColour(role, hex, alpha) {
  const { h, s, l } = rgbToHsl(hexToRgb(hex))
  const neutral = s < 12
  if (role === "surface") {
    // Light panels become dark panels of the same tint (white ≈ the card colour).
    if (l < 78 || alpha < 0.5) return null
    return neutral ? hsl(224, 15, 9.5 + (100 - l) * 0.4, alpha) : hsl(h, Math.min(s * 0.6, 45), 9.5 + (100 - l) * 0.4, alpha)
  }
  if (role === "ink") {
    // Dark ink becomes light ink of the same hue; light ink (meant for dark panels) stays.
    if (l > 52) return null
    return neutral ? hsl(220, 16, 94 - l * 0.55, alpha) : hsl(h, Math.min(s, 70), 94 - l * 0.55, alpha)
  }
  // Hairlines: light borders become dark borders of the same tint.
  if (l < 68 || alpha < 0.5) return null
  return neutral ? hsl(224, 11, 14 + (100 - l) * 0.35, alpha) : hsl(h, Math.min(s * 0.5, 30), 14 + (100 - l) * 0.35, alpha)
}

const ROLE = { bg: "surface", from: "surface", via: "surface", to: "surface", text: "ink", placeholder: "ink" }
const BORDER_SIDES = { border: ["border-color"], "border-t": ["border-top-color"], "border-b": ["border-bottom-color"], "border-l": ["border-left-color"], "border-r": ["border-right-color"], "border-x": ["border-left-color", "border-right-color"], "border-y": ["border-top-color", "border-bottom-color"] }

function declarations(utility, colour) {
  if (utility === "bg") return `background-color: ${colour}`
  if (utility === "text") return `color: ${colour}`
  if (utility === "placeholder") return `color: ${colour}`
  if (utility === "ring") return `--tw-ring-color: ${colour}`
  if (utility === "outline") return `outline-color: ${colour}`
  if (BORDER_SIDES[utility]) return BORDER_SIDES[utility].map((prop) => `${prop}: ${colour}`).join("; ")
  const clear = colour.replace(/\)$/, " / 0)").replace(/ \/ [\d.]+ \/ 0\)$/, " / 0)")
  if (utility === "from") return `--tw-gradient-from: ${colour} var(--tw-gradient-from-position); --tw-gradient-to: ${clear} var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`
  if (utility === "via") return `--tw-gradient-to: ${clear} var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${colour} var(--tw-gradient-via-position), var(--tw-gradient-to)`
  if (utility === "to") return `--tw-gradient-to: ${colour} var(--tw-gradient-to-position)`
  throw new Error(`No CSS for ${utility}`)
}

const escapeClass = (name) => name.replace(/([^a-zA-Z0-9_-])/g, "\\$1")

function selectorFor(className, variants) {
  let selector = `.${escapeClass(className)}`
  for (const variant of variants) {
    if (variant === "group-hover") selector = `.group:hover ${selector}`
    else if (variant === "disabled") selector += ":disabled"
    else selector += `:${variant}`
  }
  if (className.startsWith("placeholder:") || className.match(/(^|:)placeholder-/)) selector += "::placeholder"
  // Printed-document previews (.tube-paper) stay paper-white with dark ink. :where() keeps the
  // specificity equal to the Tailwind class it replaces, so hover and other states still win.
  return `:where(:root[data-theme="dark"]) ${selector}:not(:where(.tube-paper, .tube-paper *))`
}

function collect() {
  const found = new Map()
  for (const dir of SOURCES) {
    const base = path.join(ROOT, dir)
    if (!fs.existsSync(base)) continue
    for (const file of walk(base, [])) {
      const text = fs.readFileSync(file, "utf8")
      for (const match of text.matchAll(CLASS_RE)) {
        const [className, variantText, utility, token, opacity] = match
        const variants = variantText ? variantText.slice(0, -1).split(":") : []
        if (variants.includes("print") || variants.includes("dark") || KEEP.has(className)) continue
        const unknown = variants.filter((v) => !VARIANTS.includes(v) && !/^(sm|md|lg|xl|2xl)$/.test(v))
        if (unknown.length) throw new Error(`${path.relative(ROOT, file)}: variant ${unknown.join(":")} in "${className}" is not handled; add it to VARIANTS`)
        found.set(className, { className, variants, utility, token, alpha: opacity ? Number(opacity) / 100 : 1 })
      }
    }
  }
  return [...found.values()].sort((a, b) => a.className.localeCompare(b.className))
}

const SCREENS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 }

function render(entries) {
  const lines = []
  const media = new Map()
  for (const entry of entries) {
    const role = ROLE[entry.utility] || "line"
    const colour = darkColour(role, colourOf(entry.token), entry.alpha)
    if (!colour) continue
    const screen = entry.variants.find((v) => SCREENS[v])
    const rule = `${selectorFor(entry.className, entry.variants.filter((v) => !SCREENS[v]))} { ${declarations(entry.utility, colour)}; }`
    if (screen) media.set(screen, [...(media.get(screen) || []), rule])
    else lines.push(rule)
  }
  for (const [screen, rules] of media) lines.push(`@media (min-width: ${SCREENS[screen]}px) {\n${rules.map((r) => "  " + r).join("\n")}\n}`)
  return `/* GENERATED by scripts/dark-theme-colours.cjs — do not edit; run \`node scripts/dark-theme-colours.cjs\`.
 * Dark-mode equivalents for the fixed colour classes used in the app (screen only; print stays light). */
@media screen {
${lines.join("\n")}
}
`
}

const css = render(collect())
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : ""
  if (current !== css) {
    console.error("app/dark-theme-colours.css is out of date: a fixed colour class was added or removed. Run: node scripts/dark-theme-colours.cjs")
    process.exit(1)
  }
  console.log("dark-theme-colours.css covers every fixed colour class")
} else {
  fs.writeFileSync(OUTPUT, css)
  console.log(`wrote ${path.relative(ROOT, OUTPUT)} (${css.split("\n").length} lines)`)
}

module.exports = { darkColour, CLASS_RE }
