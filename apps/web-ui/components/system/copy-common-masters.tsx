"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { masterApi } from "@/lib/api"
import { errorText } from "@/lib/season-api"

type PlantOption = { id: string; code?: string; name?: string }
type CopyRow = { key: string; label: string; to_copy: number; already_there: number; samples: string[]; contacts?: number }
type CopyResult = { dry_run: boolean; types: CopyRow[]; total_to_copy?: number; copied?: number; stock_items?: { created?: number; error?: string } }

const plantName = (plant?: PlantOption) => plant?.name || plant?.code || "plant"

/** Plant A first: it holds the full material list today (owner decision 3 Nov 2026). */
export function defaultSourcePlant(plants: PlantOption[], targetId: string): string {
    const others = plants.filter((plant) => plant.id !== targetId)
    const plantA = others.find((plant) => String(plant.code || "").toUpperCase() === "PLANT_A")
    return (plantA || others[0])?.id || ""
}

/** Owner/Admin: copy the common masters (materials, customers, suppliers, tool list) into this plant. */
export function CopyCommonMasters({ target, plants, onClose }: { target: PlantOption | null; plants: PlantOption[]; onClose: () => void }) {
    const sources = useMemo(() => plants.filter((plant) => target && plant.id !== target.id), [plants, target])
    const [sourceId, setSourceId] = useState("")
    const [check, setCheck] = useState<CopyResult | null>(null)
    const [done, setDone] = useState<CopyResult | null>(null)
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        if (!target) return
        setSourceId(defaultSourcePlant(plants, target.id))
        setCheck(null)
        setDone(null)
        setConfirming(false)
        setError("")
    }, [target, plants])

    const source = sources.find((plant) => plant.id === sourceId)
    const run = async (dryRun: boolean) => {
        if (!target || !sourceId) return
        setBusy(true)
        setError("")
        try {
            const { data } = await masterApi.copyCommonMasters({ source_plant_id: sourceId, target_plant_id: target.id, dry_run: dryRun })
            if (dryRun) setCheck(data)
            else { setDone(data); setCheck(null); setConfirming(false) }
        } catch (err) {
            setError(errorText(err))
        } finally {
            setBusy(false)
        }
    }

    const shown = done || check
    const total = done ? done.copied ?? 0 : check?.total_to_copy ?? 0
    return (
        <Dialog open={target !== null} onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="max-h-[92vh] overflow-y-auto" data-testid="copy-common-dialog">
                <DialogHeader>
                    <DialogTitle>Copy common masters into {plantName(target || undefined)}</DialogTitle>
                    <DialogDescription>
                        Copies materials, customers, suppliers and the tool list from {plantName(source)}. Machines, people, locations, specs and stock are not copied. Already present items are skipped.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label htmlFor="copy-source" className="text-sm font-medium text-foreground">Copy from</label>
                        <select
                            id="copy-source"
                            value={sourceId}
                            disabled={busy || Boolean(done)}
                            onChange={(event) => { setSourceId(event.target.value); setCheck(null); setConfirming(false) }}
                            className="h-11 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground sm:h-9"
                            data-testid="copy-source"
                        >
                            {sources.map((plant) => <option key={plant.id} value={plant.id}>{plantName(plant)}</option>)}
                        </select>
                        {!sources.length ? <p className="text-xs text-muted-foreground">There is no other plant to copy from.</p> : null}
                    </div>

                    {shown ? (
                        <div className="overflow-x-auto rounded-lg border border-border" data-testid="copy-common-result">
                            <table className="w-full text-sm">
                                <thead className="bg-muted text-left text-xs text-muted-foreground">
                                    <tr><th className="px-3 py-2 font-semibold">Master</th><th className="px-3 py-2 text-right font-semibold">{done ? "Copied" : "To copy"}</th><th className="px-3 py-2 text-right font-semibold">Already there</th></tr>
                                </thead>
                                <tbody>
                                    {shown.types.map((row) => (
                                        <tr key={row.key} className="border-t border-border align-top">
                                            <td className="px-3 py-2 text-foreground">
                                                {row.label}
                                                {row.contacts ? <span className="text-xs text-muted-foreground"> · {row.contacts} contact{row.contacts === 1 ? "" : "s"}</span> : null}
                                                {!done && row.samples.length ? <span className="block break-words text-xs text-muted-foreground">{row.samples.join(", ")}{row.to_copy > row.samples.length ? ", …" : ""}</span> : null}
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{row.to_copy}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.already_there}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}

                    {done ? (
                        <p role="status" className="flex items-start gap-2 rounded-lg border border-signal-emerald-line bg-signal-emerald-soft px-3 py-2 text-sm text-signal-emerald-ink">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            {total ? `${total} item${total === 1 ? "" : "s"} copied into ${plantName(target || undefined)}.` : "Nothing new to copy. Everything is already there."}
                            {done.stock_items?.error ? ` ${done.stock_items.error}` : typeof done.stock_items?.created === "number" ? ` ${done.stock_items.created} stock item${done.stock_items.created === 1 ? "" : "s"} made.` : ""}
                        </p>
                    ) : check && !total ? (
                        <p role="status" className="text-sm text-muted-foreground">Nothing new to copy. Everything is already there.</p>
                    ) : null}

                    {confirming && check ? (
                        <div className="rounded-lg border border-signal-amber-line bg-signal-amber-soft p-3 text-sm text-signal-amber-ink" data-testid="copy-common-confirm">
                            <p>Copy {total} item{total === 1 ? "" : "s"} from {plantName(source)} into {plantName(target || undefined)}? Copied items can be edited or turned off later in the masters.</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button type="button" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => void run(false)} data-testid="copy-common-yes">{busy ? "Copying…" : "Yes, copy"}</Button>
                                <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => setConfirming(false)}>No</Button>
                            </div>
                        </div>
                    ) : null}

                    {error ? <p role="alert" data-no-mirror className="flex items-start gap-2 rounded-lg border border-signal-rose-line bg-signal-rose-soft px-3 py-2 text-sm text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p> : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={onClose}>{done ? "Close" : "Cancel"}</Button>
                    {done ? null : (
                        <>
                            <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" disabled={busy || !sourceId} onClick={() => void run(true)} data-testid="copy-common-check">{busy && !confirming ? "Checking…" : "Check"}</Button>
                            <Button type="button" className="min-h-11 sm:min-h-0" disabled={busy || !check || !total || confirming} onClick={() => setConfirming(true)} data-testid="copy-common-copy"><Copy className="h-4 w-4" aria-hidden="true" />Copy</Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
