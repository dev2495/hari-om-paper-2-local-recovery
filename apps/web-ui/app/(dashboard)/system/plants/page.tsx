"use client"

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Building2, CheckCircle2, Factory, Pencil, Plus, Users2, Wrench } from "lucide-react"
import { useCreatePlant, useDeletePlant, usePlants, useUpdatePlant } from "@/hooks/use-system"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fromGstin, gstinError } from "@/lib/party-formats"
import { errorText } from "@/lib/season-api"

function SystemSetupNav() {
    const items = [
        { href: "/system/users", label: "Users", icon: Users2 },
        { href: "/system/plants", label: "Plants", icon: Building2 },
        { href: "/system/machines", label: "Machines", icon: Factory },
        { href: "/system/scheduler", label: "Background jobs", icon: Wrench },
    ]

    return (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/85 p-2 shadow-lg shadow-slate-900/5">
            {items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition sm:min-h-0 ${
                        item.href === "/system/plants" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                </Link>
            ))}
        </section>
    )
}

type Plant = { id: string; code?: string; name?: string; legal_name?: string | null; address?: string | null; gstin?: string | null; is_active?: boolean; user_count?: number }
type PlantForm = { code: string; name: string; legal_name: string; address: string; gstin: string }
const EMPTY: PlantForm = { code: "", name: "", legal_name: "", address: "", gstin: "" }

/** What the delivery challan still needs from this plant (client 2026-10-28). */
function challanMissing(plant: Plant) {
    const missing: string[] = []
    if (!String(plant.legal_name || plant.name || "").trim()) missing.push("legal name")
    if (!String(plant.address || "").trim()) missing.push("address")
    if (!String(plant.gstin || "").trim()) missing.push("GSTIN")
    return missing
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode }) {
    return (
        <div className="space-y-1">
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</label>
            {children}
            {error ? (
                <p id={`${htmlFor}-error`} className="flex items-start gap-1 text-xs font-medium text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{error}</p>
            ) : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    )
}

function PlantsBody() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const plantsQuery = usePlants()
    const plants: Plant[] = useMemo(() => (Array.isArray(plantsQuery.data) ? plantsQuery.data : []), [plantsQuery.data])
    const createPlant = useCreatePlant()
    const updatePlant = useUpdatePlant()
    const deletePlant = useDeletePlant()

    const [editing, setEditing] = useState<Plant | "new" | null>(null)
    const [form, setForm] = useState<PlantForm>(EMPTY)
    const [error, setError] = useState("")
    const [tried, setTried] = useState(false)
    const [confirmDisable, setConfirmDisable] = useState(false)
    const [saved, setSaved] = useState("")
    const openedFromLink = useRef<string | null>(null)

    const open = (plant: Plant | "new") => {
        setEditing(plant)
        setForm(plant === "new" ? EMPTY : {
            code: plant.code || "",
            name: plant.name || "",
            legal_name: plant.legal_name || "",
            address: plant.address || "",
            gstin: plant.gstin || "",
        })
        setError("")
        setTried(false)
        setConfirmDisable(false)
    }

    // /system/plants?edit=<plant id or code> opens that plant (the challan links here when details are missing).
    const editParam = searchParams?.get("edit") || ""
    useEffect(() => {
        if (!editParam || openedFromLink.current === editParam || !plants.length) return
        const plant = plants.find((row) => String(row.id) === editParam || String(row.code || "").toUpperCase() === editParam.toUpperCase())
        if (!plant) return
        openedFromLink.current = editParam
        open(plant)
    }, [editParam, plants])

    const close = () => {
        setEditing(null)
        if (editParam) router.replace("/system/plants")
    }

    const gstProblem = gstinError(form.gstin)
    const tax = fromGstin(form.gstin)
    const codeMissing = !form.code.trim()
    const nameMissing = !form.name.trim()
    const saving = createPlant.isPending || updatePlant.isPending

    const save = async () => {
        setTried(true)
        setError("")
        if (codeMissing || nameMissing || gstProblem) {
            // The message shows once, under its field; focus goes there.
            const first = codeMissing ? "plant-code" : nameMissing ? "plant-name" : "plant-gstin"
            window.requestAnimationFrame(() => document.getElementById(first)?.focus())
            return
        }
        const body = {
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            legal_name: form.legal_name.trim() || null,
            address: form.address.trim() || null,
            gstin: form.gstin.replace(/\s+/g, "").toUpperCase() || null,
        }
        try {
            if (editing === "new") await createPlant.mutateAsync(body)
            else if (editing) await updatePlant.mutateAsync({ id: editing.id, data: body })
            setSaved(`${body.legal_name || body.name} saved. Challans that are not sealed yet pick up the new details.`)
            close()
        } catch (err) {
            setError(errorText(err))
        }
    }

    const disable = async () => {
        if (!editing || editing === "new") return
        try {
            await deletePlant.mutateAsync(editing.id)
            setSaved(`${editing.name} disabled.`)
            close()
        } catch (err) {
            setError(errorText(err))
        }
    }

    return (
        <div className="min-w-0 space-y-5">
            <SystemSetupNav />
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold text-foreground">Plants</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">The legal name, address and GSTIN of each plant print on the delivery challan. Fill all three before sealing a challan.</p>
                </div>
                <Button className="min-h-11 sm:min-h-0" onClick={() => open("new")}><Plus className="h-4 w-4" aria-hidden="true" />Add plant</Button>
            </section>

            {saved ? <p role="status" className="flex items-start gap-2 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-sm text-signal-emerald-ink"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{saved}</p> : null}
            {plantsQuery.isError ? <p role="alert" className="text-sm text-destructive">Could not load plants: {errorText(plantsQuery.error)}</p> : null}
            {plantsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading plants…</p> : null}

            <div className="grid gap-4 md:grid-cols-2" data-testid="plant-list">
                {plants.map((plant) => {
                    const missing = challanMissing(plant)
                    const tax = fromGstin(plant.gstin)
                    return (
                        <article key={plant.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4" data-testid={`plant-${plant.code}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-mono text-xs text-muted-foreground">{plant.code}</p>
                                    <h2 className="mt-0.5 break-words text-base font-semibold text-foreground">{plant.name}</h2>
                                </div>
                                {missing.length ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-signal-amber-line bg-signal-amber-soft px-2 py-0.5 text-xs font-semibold text-signal-amber-ink"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Challan details missing</span>
                                ) : (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-signal-emerald-line bg-signal-emerald-soft px-2 py-0.5 text-xs font-semibold text-signal-emerald-ink"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Ready for challan</span>
                                )}
                            </div>
                            <dl className="mt-3 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                                <dt className="text-muted-foreground">Legal name</dt>
                                <dd className="break-words text-foreground">{plant.legal_name || <span className="text-muted-foreground">Same as plant name</span>}</dd>
                                <dt className="text-muted-foreground">Address</dt>
                                <dd className={`whitespace-pre-line break-words ${plant.address ? "text-foreground" : "font-semibold text-signal-amber-ink"}`}>{plant.address || "Missing"}</dd>
                                <dt className="text-muted-foreground">GSTIN</dt>
                                <dd className={`break-words ${plant.gstin ? "font-mono text-foreground" : "font-semibold text-signal-amber-ink"}`}>{plant.gstin ? `${plant.gstin}${tax.state ? ` · ${tax.state}` : ""}` : "Missing"}</dd>
                                <dt className="text-muted-foreground">Users</dt>
                                <dd className="text-foreground">{plant.user_count ?? 0}</dd>
                            </dl>
                            {missing.length ? <p className="mt-2 text-xs text-signal-amber-ink">Add the {missing.join(" and ")} so challans from this plant can be sealed.</p> : null}
                            <div className="mt-auto flex justify-end pt-3">
                                <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => open(plant)} data-testid={`plant-edit-${plant.code}`}><Pencil className="h-4 w-4" aria-hidden="true" />Edit plant</Button>
                            </div>
                        </article>
                    )
                })}
                {!plantsQuery.isLoading && !plants.length ? <p className="rounded-xl border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground md:col-span-2">No plants yet. Add the first one.</p> : null}
            </div>

            <Dialog open={editing !== null} onOpenChange={(next) => { if (!next) close() }}>
                <DialogContent className="max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editing === "new" ? "Add plant" : `Edit ${editing?.name || "plant"}`}</DialogTitle>
                        <DialogDescription>Legal name, address and GSTIN print on the delivery challan.</DialogDescription>
                    </DialogHeader>
                    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save() }} data-testid="plant-form">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Plant code *" htmlFor="plant-code" error={tried && codeMissing ? "Plant code is required." : undefined}>
                                <Input id="plant-code" aria-invalid={(tried && codeMissing) || undefined} aria-describedby={tried && codeMissing ? "plant-code-error" : undefined} className="min-h-11 font-mono uppercase sm:min-h-0" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PLANT_A" autoComplete="off" />
                            </Field>
                            <Field label="Plant name *" htmlFor="plant-name" error={tried && nameMissing ? "Plant name is required." : undefined}>
                                <Input id="plant-name" aria-invalid={(tried && nameMissing) || undefined} aria-describedby={tried && nameMissing ? "plant-name-error" : undefined} className="min-h-11 sm:min-h-0" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Plant A" autoComplete="off" />
                            </Field>
                        </div>
                        <Field label="Legal name (prints on the challan)" htmlFor="plant-legal" hint="As on the GST certificate, e.g. AMIGO UNIT - II. Blank prints the plant name.">
                            <Input id="plant-legal" className="min-h-11 sm:min-h-0" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} autoComplete="off" data-testid="plant-legal-name" />
                        </Field>
                        <Field label="Address" htmlFor="plant-address" hint="Street, area, city, state and PIN code, as it should print.">
                            <textarea id="plant-address" rows={3} className="w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-[var(--shadow-xs)] focus-visible:border-ring/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/15 sm:text-[13px]" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="plant-address" />
                        </Field>
                        <Field
                            label="GSTIN"
                            htmlFor="plant-gstin"
                            error={form.gstin.trim() ? gstProblem || undefined : undefined}
                            hint={tax.state ? <span className="inline-flex items-center gap-1 text-signal-emerald-ink"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Format OK · {tax.state} ({tax.stateCode}) · PAN {tax.pan}</span> : "15 characters, e.g. 24ABCDE1234F1Z5"}
                        >
                            <Input id="plant-gstin" aria-invalid={Boolean(form.gstin.trim() && gstProblem) || undefined} aria-describedby={form.gstin.trim() && gstProblem ? "plant-gstin-error" : undefined} className="min-h-11 font-mono uppercase sm:min-h-0" maxLength={18} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} autoComplete="off" data-testid="plant-gstin" />
                        </Field>
                        {error ? <p role="alert" data-no-mirror className="flex items-start gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p> : null}
                        <DialogFooter>
                            <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={close}>Cancel</Button>
                            <Button type="submit" className="min-h-11 sm:min-h-0" disabled={saving} data-testid="plant-save">{saving ? "Saving…" : editing === "new" ? "Add plant" : "Save plant"}</Button>
                        </DialogFooter>
                        {editing && editing !== "new" ? (
                            <div className="border-t border-border pt-3">
                                {confirmDisable ? (
                                    <div className="rounded-lg border border-signal-rose-line bg-signal-rose-soft p-3 text-sm text-signal-rose-ink">
                                        <p>Disable {editing.name}? It disappears from plant lists; its records stay.</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <Button type="button" variant="destructive" className="min-h-11 sm:min-h-0" disabled={deletePlant.isPending} onClick={() => void disable()}>Yes, disable</Button>
                                            <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setConfirmDisable(false)}>No, keep it</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <button type="button" className="min-h-11 text-sm font-semibold text-signal-rose-ink underline underline-offset-2 sm:min-h-0" onClick={() => setConfirmDisable(true)}>Disable this plant…</button>
                                )}
                            </div>
                        ) : null}
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function PlantsPage() {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading plants…</div>}>
            <PlantsBody />
        </Suspense>
    )
}
