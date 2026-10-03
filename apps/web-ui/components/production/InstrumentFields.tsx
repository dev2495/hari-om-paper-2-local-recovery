"use client"
import { Input } from "@/components/ui/input"

export function InstrumentFields({value,onChange}:{value:any;onChange:(value:any)=>void}) {
  return <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"><legend className="px-2 text-sm font-semibold">Required instrument evidence</legend>
    <label className="text-xs">Instrument ID *<Input value={value.instrument_id || ""} onChange={e=>onChange({...value,instrument_id:e.target.value})}/></label>
    <label className="text-xs">Calibration due date<Input type="date" value={value.calibration_due || ""} onChange={e=>onChange({...value,calibration_due:e.target.value})}/></label>
    <label className="text-xs">Calibration document / reference<Input value={value.instrument_evidence || ""} onChange={e=>onChange({...value,instrument_evidence:e.target.value})}/></label>
    <p className="text-xs text-muted-foreground sm:col-span-3">Use the instrument that took these readings. Provide a current calibration due date or documented calibration evidence.</p>
  </fieldset>
}
