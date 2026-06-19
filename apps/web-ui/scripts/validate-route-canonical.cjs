const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const appRoot = path.join(root, "app", "(dashboard)")

const failures = []

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
    } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

if (fs.existsSync(path.join(appRoot, "master"))) {
  failures.push("old /master route source directory still exists")
}

const nextConfig = fs.readFileSync(path.join(root, "next.config.js"), "utf8")
const requiredRedirectPairs = [
  ['source: "/master"', 'destination: "/masters"'],
  ['source: "/planning"', 'destination: "/planning/board"'],
  ['source: "/production/planner"', 'destination: "/planning/board"'],
  ['source: "/dispatch"', 'destination: "/logistics/dispatch"'],
  ['source: "/specs"', 'destination: "/specifications"'],
]

for (const [source, destination] of requiredRedirectPairs) {
  if (!nextConfig.includes(source) || !nextConfig.includes(destination)) {
    failures.push(`next.config.js missing canonical redirect ${source} -> ${destination}`)
  }
}

const files = walk(root).filter((file) => {
  const normalized = file.split(path.sep).join("/")
  return (
    !normalized.endsWith("/next.config.js") &&
    !normalized.includes("/app/(dashboard)/[...legacy]/") &&
    !normalized.endsWith("/scripts/validate-route-canonical.cjs")
  )
})

for (const file of files) {
  const rel = path.relative(root, file)
  const text = fs.readFileSync(file, "utf8")
  const checks = [
    { pattern: /@\/app\/\(dashboard\)\/master\//, label: "imports deleted /master route source" },
    { pattern: /href=["']\/master(?:\/|["'])/, label: "links to old /master route" },
    { pattern: /href=["']\/dispatch["']/, label: "links to old /dispatch route" },
    { pattern: /href=["']\/production\/planner["']/, label: "links to old /production/planner route" },
  ]
  for (const check of checks) {
    if (check.pattern.test(text)) failures.push(`${rel}: ${check.label}`)
  }
}

if (failures.length) {
  console.error("Canonical route validation failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Canonical route validation OK")
