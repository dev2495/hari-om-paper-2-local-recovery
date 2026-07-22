/**
 * Convert a percentage recipe into whole-ply counts without losing a ply.
 * Largest-remainder allocation is stable by row order for tied fractions.
 */
export function allocateAdhesivePlies(
  rows: Array<{ ratio: number }>,
  totalPlies: number,
) {
  const safeTotalPlies = Math.max(0, Math.round(Number(totalPlies) || 0))
  const ratios = rows.map((row) => Math.max(0, Number(row.ratio) || 0))
  const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0)
  if (!safeTotalPlies || !ratioTotal) return ratios.map(() => 0)

  const shares = ratios.map((ratio, index) => {
    const exact = (safeTotalPlies * ratio) / ratioTotal
    return { index, whole: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let unassigned = safeTotalPlies - shares.reduce((sum, share) => sum + share.whole, 0)
  const priority = [...shares].sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const share of priority) {
    if (unassigned <= 0) break
    shares[share.index].whole += 1
    unassigned -= 1
  }
  return shares.map((share) => share.whole)
}
