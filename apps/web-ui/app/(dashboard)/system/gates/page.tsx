"use client"

/** System › Gates (6 Nov 2026): the plant's gates, each with its visitor QR poster. Owner and Admin. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DoorOpen, Plus, Printer, RefreshCcw } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Chip } from "@/components/inventory/stock-ui"
import { Field, MessageBar, WorkPanel, fieldClass, primaryButton, secondaryButton } from "@/components/procurement/procurement-shell"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/workspace/page-header"
import { useAuth } from "@/context/AuthContext"
import { gateApi, type Gate, type GateDirection } from "@/lib/api-gate"
import { errorText, timeText, who } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const DIRECTION_WORDS: Record<GateDirection, string> = { BOTH: "In and out", IN: "In only", OUT: "Out only" }

export default function GatesPage() {
  const { activePlant } = useAuth()
  const client = useQueryClient()
  const concrete = Boolean(activePlant && activePlant !== "ALL")
  const gates = useQuery({ queryKey: ["gate", "gates", activePlant, "all"], enabled: concrete, queryFn: () => gateApi.gates(true) })
  const [form, setForm] = useState({ code: "", name: "", direction: "BOTH" as GateDirection })
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const [rotating, setRotating] = useState<Gate | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["gate", "gates"] })
  const create = useMutation({
    mutationFn: () => gateApi.createGate({ code: form.code.trim(), name: form.name.trim(), direction: form.direction }),
    onSuccess: (gate) => { setNotice({ tone: "success", text: `${gate.name} added. Print its QR poster and put it up at the gate.` }); setForm({ code: "", name: "", direction: "BOTH" }); refresh() },
    onError: (error) => setNotice({ tone: "error", text: errorText(error) }),
  })
  const update = useMutation({
    mutationFn: ({ gate, patch }: { gate: Gate; patch: { active?: boolean; direction?: GateDirection } }) => gateApi.updateGate(gate.id, { expected_version: gate.version, ...patch }),
    onSuccess: (gate) => { setNotice({ tone: "success", text: `${gate.name} saved.` }); refresh() },
    onError: (error) => setNotice({ tone: "error", text: errorText(error) }),
  })
  const rotate = useMutation({
    mutationFn: (gate: Gate) => gateApi.rotateToken(gate.id, gate.version),
    onSuccess: (gate) => { setRotating(null); setNotice({ tone: "success", text: `${gate.name} has a new QR. The old poster no longer works: print the new one now.` }); refresh() },
    onError: (error) => setNotice({ tone: "error", text: errorText(error) }),
  })
  return (
    <div className="min-w-0 space-y-5" data-testid="system-gates">
      <PageHeader title="Gates" description="Each gate has a QR poster for visitors to check themselves in. The watchman picks the gate on the gate desk." />
      {!concrete ? <MessageBar tone="info">Pick one plant at the top to set up its gates.</MessageBar> : <>
        {notice ? <MessageBar tone={notice.tone}>{notice.text}</MessageBar> : null}
        <WorkPanel title="Add a gate">
          <form className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_180px_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
            <Field label="Code"><input className={cn(fieldClass, "uppercase max-sm:h-11")} value={form.code} maxLength={20} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="G1" data-testid="gate-code" /></Field>
            <Field label="Name"><input className={cn(fieldClass, "max-sm:h-11")} value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Main gate" data-testid="gate-name-input" /></Field>
            <Field label="Used for"><select className={cn(fieldClass, "max-sm:h-11")} value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as GateDirection })}>{Object.entries(DIRECTION_WORDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <button className={primaryButton} disabled={!form.code.trim() || !form.name.trim() || create.isPending} data-testid="gate-add"><Plus className="h-4 w-4" /> Add gate</button>
          </form>
        </WorkPanel>
        {gates.isError ? <MessageBar tone="error">Gates could not load: {errorText(gates.error)}</MessageBar> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {gates.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
          {!gates.isLoading && !gates.data?.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground md:col-span-2">No gate yet. Add the first one above.</p> : null}
          {(gates.data || []).map((gate) => (
            <article key={gate.id} className="erp-panel rounded-xl p-4" data-testid="gate-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 text-[15px] font-semibold"><DoorOpen className="h-4 w-4 text-primary" /> {gate.name}</p>
                  <p className="text-[12.5px] text-muted-foreground">{gate.code} · {DIRECTION_WORDS[gate.direction]}</p>
                </div>
                <Chip tone={gate.active ? "emerald" : "slate"}>{gate.active ? "In use" : "Switched off"}</Chip>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">{gate.token_rotated_at ? `QR changed ${timeText(gate.token_rotated_at)} by ${who(gate.token_rotated_by)}.` : "First QR since the gate was added."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className={primaryButton} href={`/system/gates/${gate.id}/poster`} data-testid="gate-poster-link"><Printer className="h-4 w-4" /> QR poster</Link>
                <select aria-label={`${gate.name} used for`} className={cn(fieldClass, "w-auto max-sm:h-11")} value={gate.direction} onChange={(event) => update.mutate({ gate, patch: { direction: event.target.value as GateDirection } })}>{Object.entries(DIRECTION_WORDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                <button className={secondaryButton} onClick={() => update.mutate({ gate, patch: { active: !gate.active } })}>{gate.active ? "Switch off" : "Switch on"}</button>
                <button className={secondaryButton} onClick={() => setRotating(gate)}><RefreshCcw className="h-4 w-4" /> New QR</button>
              </div>
            </article>
          ))}
        </div>
      </>}
      <Dialog open={Boolean(rotating)} onOpenChange={(open) => { if (!open) setRotating(null) }}>
        <DialogContent className="max-w-md">
          <DialogTitle>Give {rotating?.name} a new QR?</DialogTitle>
          <DialogDescription>Use this when the poster&apos;s QR was copied or posted somewhere. The old printed QR stops working at once, so print and put up the new poster straight away.</DialogDescription>
          <div className="flex justify-end gap-2">
            <button className={secondaryButton} onClick={() => setRotating(null)}>Cancel</button>
            <button className={primaryButton} disabled={rotate.isPending} onClick={() => rotating && rotate.mutate(rotating)} data-testid="gate-rotate-confirm">Make a new QR</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
