const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const repoRoot = path.resolve(root, "..", "..")

const checks = [
  {
    file: path.join(root, "lib", "spec-sheet.ts"),
    required: [
      /export const DEFAULT_MOISTURE_AVG = 9\b/,
      /export const DEFAULT_WET_DIVISOR = 0\.91\b/,
    ],
    forbidden: [
      /DEFAULT_MOISTURE_AVG = 8\b/,
      /DEFAULT_WET_DIVISOR = 0\.905\b/,
    ],
  },
  {
    file: path.join(root, "components", "specs", "spec-sheet-utils.ts"),
    forbidden: [
      /36 - baseLayers/,
      /targetWeightG \* 0\.03/,
      /DEFAULT_FIXED_DRY_MATERIAL_PERCENT/,
      /resolvePredictedDryWeightFromPaperG/,
    ],
  },
  {
    file: path.join(root, "lib", "spec-math.ts"),
    required: [
      /GLOBAL_MOISTURE_LOSS_PERCENT = 9\.0?\b/,
      /RECIPE_MAX_PLIES = 18\b/,
      /DELTA_ABS_G = 3\.0?\b/,
      /DELTA_PCT = 0\.0?\b/,
    ],
  },
  {
    file: path.join(repoRoot, "hariom-erp", "services", "spec-service", "src", "spec_math.py"),
    required: [
      /GLOBAL_MOISTURE_LOSS_PERCENT: float = 9\.0\b/,
      /RECIPE_MAX_PLIES: int = 18\b/,
      /DELTA_ABS_G: float = 3\.0\b/,
      /DELTA_PCT: float = 0\.0\b/,
    ],
  },
  {
    file: path.join(repoRoot, "SYSTEM_DESIGN.md"),
    required: [
      /defaults to `9\.0%`/,
      /defaults to `0\.91`/,
    ],
    forbidden: [
      /defaults to `9\.5%`/,
      /defaults to `0\.905`/,
    ],
  },
]

const failures = []

for (const check of checks) {
  const rel = path.relative(repoRoot, check.file)
  const text = fs.readFileSync(check.file, "utf8")
  for (const pattern of check.required || []) {
    if (!pattern.test(text)) failures.push(`${rel}: missing ${pattern}`)
  }
  for (const pattern of check.forbidden || []) {
    if (pattern.test(text)) failures.push(`${rel}: forbidden ${pattern}`)
  }
}

if (failures.length) {
  console.error("Canonical spec validation failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Canonical spec validation OK")
