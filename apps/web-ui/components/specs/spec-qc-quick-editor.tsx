"use client"

import { useRef } from "react"

import { SpecQcToleranceDialog } from "@/components/qc/SpecQcToleranceDialog"
import { useApp } from "@/context/AppContext"
import { useAuth } from "@/context/AuthContext"
import { useSpec, useUpsertSpecQcProfile } from "@/hooks/use-specs"
import { displayPlantScope } from "@/lib/plant-scope"
import { qcReferencesFromSpec } from "@/lib/qc-measurement"

const avg = (min: unknown, max: unknown) => {
  const low = Number(min)
  const high = Number(max)
  return Number.isFinite(low) && Number.isFinite(high) && (low || high) ? Math.round(((low + high) / 2) * 100) / 100 : null
}

/**
 * Quality parameters straight from the specification list: only the tolerance dialog,
 * never the full spec form. Parameters come from the spec itself; the user sets the
 * allowed ranges that floor entries are checked against. Saves only the QC profile.
 */
export function SpecQcQuickEditor({ specId, open, onOpenChange }: { specId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { showToast } = useApp()
  const { activePlant } = useAuth()
  const specQuery = useSpec(open && specId ? specId : "")
  const upsert = useUpsertSpecQcProfile()
  const operationKey = useRef<string | null>(null)
  const spec: any = specQuery.data
  if (!open || !specId) return null
  if (!spec) {
    return null
  }
  const dims = [avg(spec.id_min_mm, spec.id_max_mm), avg(spec.od_min_mm, spec.od_max_mm), avg(spec.length_min_mm, spec.length_max_mm)]
  const notchValues = spec.dynamic_fields || {}
  const save = async (profile: any, status: string) => {
    if (!operationKey.current) operationKey.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `qc-${Date.now()}`
    try {
      await upsert.mutateAsync({
        specId,
        plantId: activePlant && activePlant !== "ALL" ? activePlant : undefined,
        data: { qc_profile: profile, status, save_operation_key: operationKey.current, expected_revision: spec.write_revision },
      })
      operationKey.current = null
      showToast(status === "draft" ? "Quality parameters saved as draft." : "Quality parameters saved — Owner/Admin approves them on the spec.", "success")
      onOpenChange(false)
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      showToast(typeof detail === "string" ? detail : detail?.message || error?.message || "Could not save quality parameters.", "error")
    }
  }
  return (
    <SpecQcToleranceDialog
      open={open}
      context={{
        customer: spec.customer_name_snapshot || spec.customer_name,
        product: dims.every((value) => value != null) ? `${dims[0]} × ${dims[1]} × ${dims[2]} mm` : undefined,
        plant: displayPlantScope(activePlant),
        dimensions: dims.every((value) => value != null) ? `I.D./O.D./Height ${dims.join("/")}` : undefined,
        targetWeight: spec.target_tube_weight ? `${spec.target_tube_weight} g` : undefined,
        cs: spec.required_cs ? `${spec.required_cs} N` : undefined,
        parchment: spec.parchment_allowed ? spec.parchment_color || "required" : "not used",
        notching:
          spec.qc_profile && Object.prototype.hasOwnProperty.call(spec.qc_profile, "notching_applicable")
            ? spec.qc_profile.notching_applicable
            : notchValues.notch_type || notchValues.notch_distance_mm || notchValues.notch_depth_mm
              ? true
              : null,
      }}
      references={qcReferencesFromSpec({
        finalLimits: {
          id: { min: spec.id_min_mm, max: spec.id_max_mm },
          od: { min: spec.od_min_mm, max: spec.od_max_mm },
          length: { min: spec.length_min_mm, max: spec.length_max_mm },
          weight: { min: spec.weight_min_g, max: spec.weight_max_g },
          cs: { min: spec.cs_min_n, max: spec.cs_max_n },
          moisture: { min: spec.moisture_min_pct, max: spec.moisture_max_pct },
        },
      })}
      saveCompleteLabel="Save QC tolerances"
      initialProfile={spec.qc_profile || null}
      saving={upsert.isPending}
      onBack={() => onOpenChange(false)}
      onDiscard={() => onOpenChange(false)}
      onSaveDraft={(profile) => void save(profile, "draft")}
      onSaveComplete={(profile) => void save(profile, profile?.status || "complete")}
    />
  )
}
