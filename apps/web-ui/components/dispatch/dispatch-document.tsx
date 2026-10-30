"use client"

import { businessDate } from "@/lib/business-date"
import { formatKg } from "@/lib/dispatch-challan"
import { stateCodeFor } from "@/lib/party-formats"

import React from "react"

export interface DispatchDocumentProps {
    dispatchData: any
    onChange?: (data: any) => void
    printMode?: boolean
}

const indianDate = (value?: string) => {
    const text = String(value || "")
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
    if (!match) return text
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

const stateLine = (state?: string, code?: string) => (state ? `${state}${code ? ` (${code})` : ""}` : code ? `State code ${code}` : "")

function PartyBlock({ title, name, address, gstin, state, contact, testId }: { title: string; name?: string; address?: string; gstin?: string; state?: string; contact?: string; testId?: string }) {
    return (
        <div className="min-w-0 rounded border border-border p-4" data-testid={testId}>
            <h3 className="mb-2 border-b border-border pb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
            <p className="text-base font-bold sm:text-lg">{name || "—"}</p>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{address || "Address not in the master"}</p>
            {state ? <p className="mt-1 text-sm text-muted-foreground">State: {state}</p> : null}
            {gstin !== undefined ? <p className="mt-1 text-sm text-muted-foreground">GSTIN: <span className="font-mono text-foreground">{gstin || "—"}</span></p> : null}
            {contact ? <p className="mt-1 text-sm text-muted-foreground">Contact: {contact}</p> : null}
        </div>
    )
}

// "1 bundle" / "3 bundles", in the challan's own packing unit when every line uses the same one.
export function packingUnitsText(items: any[], count: number) {
    const kinds = new Set(items.map((item: any) => String(item?.packing_type || "").trim().toLowerCase()).filter(Boolean))
    const noun = kinds.size === 1 && kinds.has("bundle") ? "bundle" : kinds.size === 1 && kinds.has("box") ? "box" : "unit"
    const plural = noun === "box" ? "boxes" : `${noun}s`
    return `${count.toLocaleString("en-IN")} ${count === 1 ? noun : plural}`
}

const fieldClass = "h-11 min-w-0 flex-1 rounded border border-border bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"

export function DispatchDocument({ dispatchData, onChange, printMode = false }: DispatchDocumentProps) {
    const company = dispatchData.company || {}
    const customer = dispatchData.customer || {}
    const editable = !printMode && Boolean(onChange)
    const updateTransporter = (field: string, value: string) => {
        if (!onChange) return
        onChange({
            ...dispatchData,
            transporter: {
                ...(dispatchData.transporter || {}),
                [field]: value
            }
        })
    }

    const updateRemarks = (value: string) => {
        if (!onChange) return
        onChange({
            ...dispatchData,
            remarks: value
        })
    }

    const updateItemRemark = (index: number, value: string) => {
        if (!onChange) return
        const newItems = [...(dispatchData.items || [])]
        newItems[index] = { ...newItems[index], remarks: value }
        onChange({ ...dispatchData, items: newItems })
    }

    // Pre-calculate sums if missing
    const items = dispatchData.items || []
    const summary = dispatchData.summary || {
        total_units: items.reduce((sum: number, item: any) => sum + (Number(item.qty_units) || 0), 0),
        total_pcs: items.reduce((sum: number, item: any) => sum + (Number(item.total_pcs) || 0), 0),
        total_weight: items.reduce((sum: number, item: any) => sum + (Number(item.net_weight) || 0), 0),
    }
    // Older challans kept one customer address; newer ones keep billing and dispatch (ship-to) apart.
    const billing = customer.billing_address || customer.address
    const shipTo = customer.address || customer.billing_address
    const oneAddress = !customer.billing_address || customer.billing_address === customer.address
    const contact = [customer.contact_name, customer.contact_phone].filter(Boolean).join(" · ")

    const transportRow = (field: "vehicle_no" | "lr_no" | "name", label: string, placeholder: string, id: string) => (
        <div className="flex min-w-0 items-center gap-2">
            <label htmlFor={editable ? id : undefined} className="w-24 shrink-0 text-sm font-medium text-muted-foreground">{label}</label>
            {editable ? (
                <input
                    id={id}
                    type="text"
                    className={fieldClass}
                    value={dispatchData.transporter?.[field] || ""}
                    onChange={(e) => updateTransporter(field, e.target.value)}
                    placeholder={placeholder}
                    autoComplete="off"
                />
            ) : (
                <span className="min-w-0 break-words text-sm font-semibold">{dispatchData.transporter?.[field] || "—"}</span>
            )}
        </div>
    )

    return (
        <div className="w-full min-w-0">
        <div className={`min-w-0 break-words bg-card text-foreground ${printMode ? "p-0" : "rounded-lg border border-border p-4 shadow-sm sm:p-8"}`} data-testid="challan-document">
            {/* Header Block */}
            <div className="mb-8 flex flex-col items-start justify-between gap-5 border-b-2 border-foreground pb-4 md:flex-row print:flex-row">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold uppercase tracking-tight sm:text-3xl" data-testid="challan-plant-name">{company.legal_name || company.name || "Plant name not in the master"}</h1>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground" data-testid="challan-plant-address">{company.address || "Plant address not in the master"}</p>
                    {company.state ? <p className="text-sm text-muted-foreground">State: {stateLine(company.state, company.state_code)}</p> : null}
                    <p className="text-sm text-muted-foreground">GSTIN: <span className="font-mono text-foreground" data-testid="challan-plant-gstin">{company.gstin || "—"}</span></p>
                </div>
                <div className="min-w-0 text-left md:text-right print:text-right">
                    <h2 className="inline-block rounded-sm bg-foreground px-4 py-1 text-lg font-bold uppercase tracking-widest text-background sm:text-2xl">
                        Delivery Challan
                    </h2>
                    <div className="mt-4 space-y-1 text-sm">
                        <p><span className="mr-2 font-semibold text-muted-foreground">Challan No:</span>{dispatchData.challan_no || dispatchData.dispatch_ref || "Given on sealing"}</p>
                        <p><span className="mr-2 font-semibold text-muted-foreground">Challan Date:</span>{indianDate(dispatchData.date || businessDate())}</p>
                        <p><span className="mr-2 font-semibold text-muted-foreground">Job Card Ref:</span> {dispatchData.job_card_no}</p>
                    </div>
                </div>
            </div>

            <div className={`mb-8 grid grid-cols-1 gap-4 sm:gap-6 ${oneAddress ? "md:grid-cols-2 print:grid-cols-2" : "md:grid-cols-3 print:grid-cols-3"}`}>
                <PartyBlock
                    title={oneAddress ? "Billed to · Ship to" : "Billed to"}
                    name={customer.name}
                    address={billing}
                    gstin={customer.gstin || ""}
                    state={stateLine(customer.state, customer.state_code)}
                    contact={oneAddress ? contact : undefined}
                    testId="challan-billed-to"
                />
                {!oneAddress && (
                    <PartyBlock
                        title="Ship to (dispatch address)"
                        name={customer.name}
                        address={shipTo}
                        state={stateLine(customer.ship_state, customer.ship_state_code || stateCodeFor(customer.ship_state) || undefined)}
                        contact={contact}
                        testId="challan-ship-to"
                    />
                )}

                {/* Transporter Block */}
                <div className="min-w-0 rounded border border-border p-4">
                    <h3 className="mb-2 border-b border-border pb-1 text-xs font-semibold uppercase text-muted-foreground">Transport Details</h3>
                    <div className="mt-3 space-y-3">
                        {transportRow("vehicle_no", "Vehicle No:", "e.g. GJ15AB1234", "challan-vehicle")}
                        {transportRow("lr_no", "LR No:", "LR number", "challan-lr")}
                        {transportRow("name", "Transporter:", "Transporter name", "challan-transporter")}
                    </div>
                </div>
            </div>

            {/* Material Table */}
            <div className="mb-8 space-y-3 md:hidden print:hidden">
                {items.map((item: any, idx: number) => (
                    <section key={idx} className="space-y-3 rounded-lg border border-border p-4">
                        <h3 className="text-sm font-semibold">{idx + 1}. {item.description}</h3>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <div><dt className="text-muted-foreground">Packing</dt><dd>{item.packing_type}</dd></div>
                            <div><dt className="text-muted-foreground">Units</dt><dd>{item.qty_units}</dd></div>
                            <div><dt className="text-muted-foreground">Pieces / unit</dt><dd>{item.pcs_per_unit}</dd></div>
                            <div><dt className="text-muted-foreground">Total pieces</dt><dd className="font-semibold">{Number(item.total_pcs || 0).toLocaleString("en-IN")}</dd></div>
                            <div><dt className="text-muted-foreground">Net weight (kg)</dt><dd>{formatKg(item.net_weight)}</dd></div>
                        </dl>
                        {editable ? (
                            <label className="block text-sm">Item remarks
                                <input className="mt-1 h-11 w-full min-w-0 rounded border border-border bg-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={item.remarks || ""} onChange={(e) => updateItemRemark(idx, e.target.value)} placeholder="Optional remark" />
                            </label>
                        ) : item.remarks ? <p className="text-sm text-muted-foreground">{item.remarks}</p> : null}
                    </section>
                ))}
                {items.length === 0 && <p className="text-sm text-muted-foreground">No items available for dispatch</p>}
                <p className="rounded-lg bg-muted p-4 text-sm font-semibold">Total: {Number(summary.total_pcs || 0).toLocaleString("en-IN")} pcs · {packingUnitsText(items, Number(summary.total_units) || 0)} · {formatKg(summary.total_weight)} kg</p>
            </div>
            <div className="mb-8 hidden overflow-x-auto md:block print:block">
            <table className="mb-8 w-full border border-border text-sm">
                <thead className="border-b border-border bg-muted">
                    <tr>
                        <th className="border-r border-border px-3 py-2 text-left font-semibold">No.</th>
                        <th className="border-r border-border px-3 py-2 text-left font-semibold">Description</th>
                        <th className="border-r border-border px-3 py-2 text-left font-semibold">Packing</th>
                        <th className="border-r border-border px-3 py-2 text-right font-semibold">Units</th>
                        <th className="border-r border-border px-3 py-2 text-right font-semibold">PCS/Unit</th>
                        <th className="border-r border-border px-3 py-2 text-right font-semibold">Total PCS</th>
                        <th className="border-r border-border px-3 py-2 text-right font-semibold">Net weight (kg)</th>
                        <th className="px-3 py-2 text-left font-semibold">Remarks</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {items.map((item: any, idx: number) => (
                        <tr key={idx}>
                            <td className="border-r border-border px-3 py-2">{idx + 1}</td>
                            <td className="border-r border-border px-3 py-2 font-medium">{item.description}</td>
                            <td className="border-r border-border px-3 py-2">{item.packing_type}</td>
                            <td className="border-r border-border px-3 py-2 text-right">{item.qty_units}</td>
                            <td className="border-r border-border px-3 py-2 text-right">{item.pcs_per_unit}</td>
                            <td className="border-r border-border px-3 py-2 text-right font-semibold">{Number(item.total_pcs || 0).toLocaleString("en-IN")}</td>
                            <td className="border-r border-border px-3 py-2 text-right font-semibold">{formatKg(item.net_weight)}</td>
                            <td className="px-2 py-1">
                                {editable ? (
                                    <input
                                        type="text"
                                        aria-label={`Remark for item ${idx + 1}`}
                                        className="h-9 w-full border-b border-transparent bg-transparent px-2 text-xs hover:border-border focus:border-ring focus:outline-none"
                                        placeholder="Optional remark"
                                        value={item.remarks || ""}
                                        onChange={(e) => updateItemRemark(idx, e.target.value)}
                                    />
                                ) : (
                                    <span className="text-muted-foreground">{item.remarks}</span>
                                )}
                            </td>
                        </tr>
                    ))}
                    {items.length === 0 && (
                        <tr>
                            <td colSpan={8} className="py-8 text-center italic text-muted-foreground">No items available for dispatch</td>
                        </tr>
                    )}
                </tbody>
                <tfoot className="border-t-2 border-foreground bg-muted">
                    <tr>
                        <td colSpan={3} className="border-r border-border px-3 py-3 text-right font-bold">TOTAL</td>
                        <td className="border-r border-border px-3 py-3 text-right font-bold">{summary.total_units}</td>
                        <td className="border-r border-border px-3 py-3"></td>
                        <td className="border-r border-border px-3 py-3 text-right font-bold">{Number(summary.total_pcs || 0).toLocaleString("en-IN")}</td>
                        <td className="border-r border-border px-3 py-3 text-right font-bold">{formatKg(summary.total_weight)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
            </div>

            {/* Footer / Notes */}
            <div className="mb-12">
                <h4 className="mb-2 text-sm font-semibold">Dispatch Notes:</h4>
                {editable ? (
                    <textarea
                        aria-label="Dispatch notes"
                        className="w-full rounded border border-border bg-card p-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        rows={3}
                        placeholder="Any notes for the transporter or customer"
                        value={dispatchData.remarks || ""}
                        onChange={(e) => updateRemarks(e.target.value)}
                    />
                ) : (
                    <div className="min-h-12 whitespace-pre-line text-sm text-muted-foreground">{dispatchData.remarks || "—"}</div>
                )}
            </div>

            {/* Signatures */}
            <div className="mt-16 grid grid-cols-2 gap-x-4 gap-y-8 border-t border-border pt-8 text-center md:grid-cols-4 print:grid-cols-4">
                {["Prepared By", "Supervisor", "Transporter's Sign", "Receiver's Sign"].map((label) => (
                    <div key={label}>
                        <p className="mb-8 text-sm font-semibold">{label}</p>
                        <div className="mx-auto w-full max-w-32 border-b border-muted-foreground"></div>
                    </div>
                ))}
            </div>
        </div>
        </div>
    )
}
