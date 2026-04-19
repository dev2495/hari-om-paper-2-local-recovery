export type ReconciliationBridgeInput = {
  paperKg: number
  adhesiveKg: number
  parchmentKg: number
  moisturePercent: number
  wastageKg: number
  targetOutputKg: number
}

export type ReconciliationBridgeResult = {
  grossWetKg: number
  moistureLossKg: number
  afterMoistureKg: number
  wastageKg: number
  wastagePercentOfDry: number
  finalOutputKg: number
  varianceKg: number
  targetWetBeforeMoistureKg: number
  exactPaperRequiredKg: number
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

export function computeReconciliationBridge(input: ReconciliationBridgeInput): ReconciliationBridgeResult {
  const paperKg = Math.max(0, finite(input.paperKg))
  const adhesiveKg = Math.max(0, finite(input.adhesiveKg))
  const parchmentKg = Math.max(0, finite(input.parchmentKg))
  const moisturePercent = Math.min(99.99, Math.max(0, finite(input.moisturePercent)))
  const wastageKg = Math.max(0, finite(input.wastageKg))
  const targetOutputKg = Math.max(0, finite(input.targetOutputKg))
  const dryDivisor = Math.max(1 - moisturePercent / 100, 0.0001)
  const grossWetKg = paperKg + adhesiveKg + parchmentKg
  const moistureLossKg = grossWetKg * (moisturePercent / 100)
  const afterMoistureKg = grossWetKg - moistureLossKg
  const finalOutputKg = Math.max(0, afterMoistureKg - wastageKg)
  const targetWetBeforeMoistureKg = (targetOutputKg + wastageKg) / dryDivisor
  const exactPaperRequiredKg = Math.max(0, targetWetBeforeMoistureKg - adhesiveKg - parchmentKg)
  const wastagePercentOfDry = afterMoistureKg > 0 ? (wastageKg / afterMoistureKg) * 100 : 0

  return {
    grossWetKg,
    moistureLossKg,
    afterMoistureKg,
    wastageKg,
    wastagePercentOfDry,
    finalOutputKg,
    varianceKg: finalOutputKg - targetOutputKg,
    targetWetBeforeMoistureKg,
    exactPaperRequiredKg,
  }
}
