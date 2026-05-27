"use client"

// /reports/quality is the same surface as the Quality & Variance Bridge.
// Import the variance page implementation directly to avoid duplicating UI.
import VarianceBridgePage from "../variance/page"

export default function QualityReportsPage() {
  return <VarianceBridgePage />
}
