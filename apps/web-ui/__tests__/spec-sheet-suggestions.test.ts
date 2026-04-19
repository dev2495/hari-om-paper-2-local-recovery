import { strict as assert } from "node:assert"

import { computePreview } from "../lib/spec-math"
import { formatRecipeRowsTitle, pickVisibleRecipeSuggestions, suggestRecipeRowsFromPapers, type GroupedRecipeRow, type RecipeSuggestion } from "../lib/spec-sheet"

const passed: string[] = []
const failed: { name: string; error: unknown }[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed.push(name)
  } catch (error) {
    failed.push({ name, error })
  }
}

type CandidatePaper = {
  id: string
  code: string
  gsm: number
  thickness_mm: number
  bulk_factor: number
}

function combinations<T>(items: T[], size: number, start = 0, picked: T[] = [], out: T[][] = []) {
  if (picked.length === size) {
    out.push([...picked])
    return out
  }
  for (let index = start; index <= items.length - (size - picked.length); index += 1) {
    picked.push(items[index])
    combinations(items, size, index + 1, picked, out)
    picked.pop()
  }
  return out
}

function positiveCompositions(total: number, parts: number, prefix: number[] = [], out: number[][] = []) {
  if (parts === 1) {
    out.push([...prefix, total])
    return out
  }
  for (let current = 1; current <= total - (parts - 1); current += 1) {
    prefix.push(current)
    positiveCompositions(total - current, parts - 1, prefix, out)
    prefix.pop()
  }
  return out
}

function exactBestSuggestion(
  papers: CandidatePaper[],
  targetWetWeightG: number,
  tubeLengthMm: number,
  tubeIdMm: number,
  dryingPercent: number,
  parchmentPercent: number,
) {
  const targetDryWeightG = targetWetWeightG * (1 - dryingPercent / 100)
  let best: { title: string; totalPlyCount: number; deltaDryG: number } | null = null

  for (let size = 3; size <= Math.min(5, papers.length); size += 1) {
    for (const combo of combinations(papers, size)) {
      for (let totalPlyCount = 4; totalPlyCount <= 18; totalPlyCount += 1) {
        for (const counts of positiveCompositions(totalPlyCount, size)) {
          const rows = combo.map((paper, index) => ({
            code: paper.code,
            paper_id: paper.id,
            gsm: paper.gsm,
            bulk: paper.bulk_factor,
            ply_count: counts[index],
          }))
          const preview = computePreview({
            mandrel_od_mm: tubeIdMm,
            tube_length_mm: tubeLengthMm,
            papers: rows,
            target_dry_g: targetDryWeightG,
            adhesive_percent: 15,
            parchment_percent: parchmentPercent,
            moisture_loss_percent: dryingPercent,
            parchment_allowed: true,
          })
          const candidate = {
            title: combo.map((paper, index) => (counts[index] === 1 ? paper.code : `${paper.code} x ${counts[index]}`)).join(" + "),
            totalPlyCount,
            deltaDryG: Number(preview.validation.delta_g.toFixed(4)),
          }
          if (
            !best ||
            Math.abs(candidate.deltaDryG) < Math.abs(best.deltaDryG) - 1e-9 ||
            (Math.abs(Math.abs(candidate.deltaDryG) - Math.abs(best.deltaDryG)) <= 1e-9 &&
              candidate.totalPlyCount < best.totalPlyCount)
          ) {
            best = candidate
          }
        }
      }
    }
  }

  assert.ok(best, "expected an exact best suggestion")
  return best
}

test("formatRecipeRowsTitle reflects the current recipe rows", () => {
  const rows: GroupedRecipeRow[] = [
    {
      id: "r1",
      paper_id: "221",
      code: "221",
      variety: "KRAFT",
      category: "PAPER",
      gsm: 220,
      bfPerPly: 20,
      thicknessPerPly: 0.33,
      plyBond: 400,
      plyCount: 2,
      adhesiveLabel: "TL-4",
      positionsText: "1,2",
    },
    {
      id: "r2",
      paper_id: "352",
      code: "352",
      variety: "KRAFT",
      category: "PAPER",
      gsm: 350,
      bfPerPly: 24,
      thicknessPerPly: 0.5075,
      plyBond: 500,
      plyCount: 4,
      adhesiveLabel: "TL-4",
      positionsText: "3,4,5,6",
    },
  ]

  assert.equal(formatRecipeRowsTitle(rows), "221 x 2 + 352 x 4")
  assert.equal(formatRecipeRowsTitle(rows, { includeCounts: false }), "221 + 352")
})

test("suggestRecipeRowsFromPapers finds the global closest dry delta across 4-18 plies", () => {
  const papers: CandidatePaper[] = [
    { id: "221", code: "221", gsm: 220, thickness_mm: 0.33, bulk_factor: 1.5 },
    { id: "231", code: "231", gsm: 230, thickness_mm: 0.345, bulk_factor: 1.5 },
    { id: "301", code: "301", gsm: 300, thickness_mm: 0.45, bulk_factor: 1.5 },
    { id: "350", code: "350", gsm: 350, thickness_mm: 0.5425, bulk_factor: 1.55 },
    { id: "351", code: "351", gsm: 350, thickness_mm: 0.525, bulk_factor: 1.5 },
    { id: "352", code: "352", gsm: 350, thickness_mm: 0.5075, bulk_factor: 1.45 },
    { id: "353", code: "353", gsm: 350, thickness_mm: 0.49, bulk_factor: 1.4 },
    { id: "354", code: "354", gsm: 350, thickness_mm: 0.49, bulk_factor: 1.4 },
    { id: "355", code: "355", gsm: 350, thickness_mm: 0.5425, bulk_factor: 1.55 },
  ]

  const suggestions = suggestRecipeRowsFromPapers(papers, 274.73, 150, 110.65, 123.94, {
    dryingPercent: 9,
    parchmentPercent: 1.5,
  })

  assert.ok(suggestions.length > 0, "expected at least one suggestion")
  assert.ok(suggestions.every((suggestion) => (suggestion.totalPlyCount || 0) >= 4 && (suggestion.totalPlyCount || 0) <= 18))

  for (let index = 1; index < suggestions.length; index += 1) {
    assert.ok(
      Math.abs(Number(suggestions[index - 1].deltaDryG || 0)) <= Math.abs(Number(suggestions[index].deltaDryG || 0)) + 1e-9,
      "suggestions should be sorted by closest dry delta first",
    )
  }

  const expected = exactBestSuggestion(papers, 274.73, 150, 110.65, 9, 1.5)
  const actual = suggestions[0]

  assert.equal(actual.totalPlyCount, expected.totalPlyCount)
  assert.ok(Math.abs(Number(actual.deltaDryG || 0)) <= Math.abs(expected.deltaDryG) + 0.01)
})

test("pickVisibleRecipeSuggestions diversifies the visible cards by ply count first", () => {
  const ranked: RecipeSuggestion[] = [
    { id: "a", title: "A", rows: [], predictedPaperWeightG: 0, deltaG: 0.1, totalPlyCount: 14 },
    { id: "b", title: "B", rows: [], predictedPaperWeightG: 0, deltaG: 0.2, totalPlyCount: 14 },
    { id: "c", title: "C", rows: [], predictedPaperWeightG: 0, deltaG: 0.3, totalPlyCount: 13 },
    { id: "d", title: "D", rows: [], predictedPaperWeightG: 0, deltaG: 0.4, totalPlyCount: 15 },
    { id: "e", title: "E", rows: [], predictedPaperWeightG: 0, deltaG: 0.5, totalPlyCount: 16 },
    { id: "f", title: "F", rows: [], predictedPaperWeightG: 0, deltaG: 0.6, totalPlyCount: 17 },
  ]

  const visible = pickVisibleRecipeSuggestions(ranked, 4)
  assert.deepEqual(
    visible.map((item) => item.id),
    ["a", "c", "d", "e"],
  )
})

if (failed.length) {
  for (const entry of failed) {
    console.error(`FAIL ${entry.name}`)
    console.error(entry.error)
  }
  process.exit(1)
}

console.log(`PASS ${passed.length}/${passed.length}`)
