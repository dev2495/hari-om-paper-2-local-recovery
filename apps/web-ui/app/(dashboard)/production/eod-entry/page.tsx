"use client"

import { useState, useMemo } from "react"
import {
    CheckCircle2,
    Circle,
    ChevronRight,
    Factory,
    ClipboardCheck,
    PackageCheck,
    AlertCircle,
    TrendingUp,
    History,
    Zap
} from "lucide-react"
import { useJobCards, useUpdateJobCard, useValidateJobCard, useCloseJobCard } from "@/hooks/use-production"
import { useInventoryItems } from "@/hooks/use-inventory"

export default function EODProductionEntryPage() {
    const { data: jobs, isLoading: isLoadingJobs } = useJobCards()
    const { data: items } = useInventoryItems()

    const updateJob = useUpdateJobCard()
    const validateJob = useValidateJobCard()
    const closeJob = useCloseJobCard()

    const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
    const [step, setStep] = useState(1) // 1: Select Job, 2: Production Data, 3: Validation & Finish

    const activeJobs = useMemo(() =>
        (jobs || []).filter((j: any) => j.job_state !== "closed"),
        [jobs])

    const selectedJob = useMemo(() =>
        activeJobs.find((j: any) => j.id === selectedJobId),
        [activeJobs, selectedJobId])

    const fgItems = useMemo(() =>
        (items || []).filter((i: any) => i.type === "FINISHED_GOOD"),
        [items])

    const [formData, setFormData] = useState({
        bamboo_produced_qty: 0,
        tubes_produced_qty: 0,
        finished_weight: 0,
        bamboo_scrap_qty: 0,
        tube_scrap_qty: 0,
        fg_item_id: "",
        fg_batch_no: "",
    })

    const handleNextToData = (jobId: string) => {
        setSelectedJobId(jobId)
        const job = activeJobs.find((j: any) => j.id === jobId)
        if (job) {
            setFormData({
                bamboo_produced_qty: job.bamboo_produced_qty || 0,
                tubes_produced_qty: job.tubes_produced_qty || 0,
                finished_weight: job.finished_weight || 0,
                bamboo_scrap_qty: job.bamboo_scrap_qty || 0,
                tube_scrap_qty: job.tube_scrap_qty || 0,
                fg_item_id: job.fg_item_id || "",
                fg_batch_no: job.fg_batch_no || "",
            })
        }
        setStep(2)
    }

    const handleSaveData = async () => {
        if (!selectedJobId) return
        await updateJob.mutateAsync({
            id: selectedJobId,
            data: {
                bamboo_produced_qty: formData.bamboo_produced_qty,
                tubes_produced_qty: formData.tubes_produced_qty,
                finished_weight: formData.finished_weight,
                bamboo_scrap_qty: formData.bamboo_scrap_qty,
                tube_scrap_qty: formData.tube_scrap_qty,
            }
        })

        // Auto validate
        await validateJob.mutateAsync({
            id: selectedJobId,
            data: {}
        })

        setStep(3)
    }

    const handleFinish = async () => {
        if (!selectedJobId) return
        await closeJob.mutateAsync({
            id: selectedJobId,
            data: {
                fg_item_id: formData.fg_item_id || selectedJob?.spec_id, // Default to spec if needed
                fg_batch_no: formData.fg_batch_no || `FG-${new Date().getTime().toString().slice(-6)}`
            }
        })
        setStep(1)
        setSelectedJobId(null)
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20" data-testid="supervisor-entry:search">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white uppercase italic">EOD Production Entry</h1>
                    <p className="text-slate-400 mt-1 uppercase tracking-widest text-[10px] font-bold">End-of-shift shift reconciliation and FG posting</p>
                </div>
            </div>

            {/* Stepper Header */}
            <div className="flex items-center justify-center max-w-2xl mx-auto">
                {[
                    { s: 1, label: "Select Job", icon: Factory },
                    { s: 2, label: "Enter Data", icon: ClipboardCheck },
                    { s: 3, label: "Finish & Post", icon: PackageCheck }
                ].map((item, i) => (
                    <div key={item.s} className="flex items-center group">
                        <div className={`flex flex-col items-center gap-2 transition-all ${step >= item.s ? "text-cyan-400" : "text-slate-600"}`}>
                            <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all ${step >= item.s ? "bg-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.2)] border-cyan-500/50" : "bg-slate-900 border-white/5"} border`}>
                                <item.icon className="h-5 w-5" />
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
                        </div>
                        {i < 2 && (
                            <div className={`w-20 h-px mx-4 transition-colors ${step > item.s ? "bg-cyan-500" : "bg-slate-800"}`} />
                        )}
                    </div>
                ))}
            </div>

            <div className="max-w-4xl mx-auto">
                {step === 1 && (
                    <section className="glass-card overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white tracking-tight uppercase">Open Production Jobs</h2>
                            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                                <Zap className="h-3 w-3 text-amber-500" /> Live Queue
                            </div>
                        </div>
                        <div className="divide-y divide-white/5">
                            {isLoadingJobs ? (
                                <div className="p-12 text-center text-slate-500 uppercase tracking-widest text-xs italic">Awaiting job queue...</div>
                            ) : activeJobs.length === 0 ? (
                                <div className="p-12 text-center text-slate-500 uppercase tracking-widest text-xs font-bold">No active jobs found for this plant.</div>
                            ) : activeJobs.map((job: any) => (
                                <div key={job.id} className="p-5 flex items-center justify-between group hover:bg-white/5 transition-all">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white uppercase tracking-tight">{job.job_card_no}</span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ${job.job_state === "validated" ? "bg-emerald-500/20 text-emerald-400" : "bg-cyan-500/20 text-cyan-400"}`}>
                                                {job.job_state}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] text-slate-500 font-medium">
                                            <span>Operator: <span className="text-slate-300 uppercase">{job.operator_name}</span></span>
                                            <span>Shift: <span className="text-slate-300 uppercase">{job.shift}</span></span>
                                            <span>Target: <span className="text-slate-300 uppercase">{job.planned_tubes_qty} PCS</span></span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleNextToData(job.id)}
                                        className="h-9 px-4 rounded-xl bg-white/5 border border-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:bg-cyan-500 group-hover:text-slate-950 group-hover:border-transparent transition-all flex items-center gap-2"
                                    >
                                        Select Job <ChevronRight className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {step === 2 && selectedJob && (
                    <section className="grid gap-8 lg:grid-cols-3">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="glass-card p-8">
                                <h2 className="text-white font-bold tracking-tight uppercase mb-6 flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-cyan-400 text-cyan-400" /> Shift Data Entry
                                </h2>

                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Bamboo Produced (PCS)</label>
                                            <input
                                                type="number"
                                                value={formData.bamboo_produced_qty}
                                                onChange={(e) => setFormData(s => ({ ...s, bamboo_produced_qty: Number(e.target.value) }))}
                                                className="h-12 w-full rounded-2xl bg-slate-950/50 border border-slate-800 px-4 text-white focus:border-cyan-500/30 transition outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Bamboo Scrap (PCS)</label>
                                            <input
                                                type="number"
                                                value={formData.bamboo_scrap_qty}
                                                onChange={(e) => setFormData(s => ({ ...s, bamboo_scrap_qty: Number(e.target.value) }))}
                                                className="h-12 w-full rounded-2xl bg-slate-950/50 border border-slate-800 px-4 text-white focus:border-cyan-500/30 transition outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Tube Produced (PCS)</label>
                                            <input
                                                type="number"
                                                value={formData.tubes_produced_qty}
                                                onChange={(e) => setFormData(s => ({ ...s, tubes_produced_qty: Number(e.target.value) }))}
                                                className="h-12 w-full rounded-2xl bg-slate-950/50 border border-slate-800 px-4 text-white focus:border-cyan-500/30 transition outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Finished Weight (KG)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.finished_weight}
                                                onChange={(e) => setFormData(s => ({ ...s, finished_weight: Number(e.target.value) }))}
                                                className="h-12 w-full rounded-2xl bg-slate-950/50 border border-slate-800 px-4 text-white font-bold text-lg focus:border-cyan-500/30 transition outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 pt-6">
                                        <button
                                            onClick={() => setStep(1)}
                                            className="h-11 px-6 rounded-xl border border-white/5 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:bg-white/5 transition"
                                        >
                                            Back
                                        </button>
                                        <button
                                            onClick={handleSaveData}
                                            disabled={updateJob.isPending || validateJob.isPending}
                                            className="flex-1 h-11 rounded-xl bg-cyan-600 text-slate-950 font-bold uppercase tracking-widest text-xs hover:bg-cyan-400 transition shadow-xl"
                                        >
                                            {updateJob.isPending ? "Updating Job..." : "Save and Validate"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="glass-card p-6 border-l-4 border-l-cyan-400">
                                <h3 className="text-white font-bold uppercase text-xs tracking-widest mb-4">Job Context</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Job Card:</span>
                                        <span className="text-slate-200 font-bold tracking-tight">{selectedJob.job_card_no}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Target Qty:</span>
                                        <span className="text-slate-200 font-bold tracking-tight">{selectedJob.planned_tubes_qty} PCS</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Material Issued:</span>
                                        <span className="text-slate-200 font-bold tracking-tight">{selectedJob.total_reel_weight_issued} KG</span>
                                    </div>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-amber-500/5 border border-amber-500/10">
                                <div className="flex items-center gap-3 text-amber-500 mb-3">
                                    <AlertCircle className="h-5 w-5" />
                                    <h3 className="font-bold uppercase text-[10px] tracking-widest">Tracking Rule</h3>
                                </div>
                                <p className="text-[11px] leading-relaxed text-slate-400">
                                    Ensure final weight includes only net finished goods before any moisture correction factors.
                                </p>
                            </div>
                        </div>
                    </section>
                )}

                {step === 3 && selectedJob && (
                    <section className="space-y-8 animate-in fly-in-bottom">
                        <div className="glass-card p-10 text-center relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />
                            <div className="relative z-10 flex flex-col items-center">
                                <div className="h-20 w-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                                    <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                                </div>
                                <h2 className="text-3xl font-bold text-white tracking-tight uppercase mb-2">Validation Complete</h2>
                                <p className="text-slate-400 max-w-sm mb-8">Production data matches baseline tolerances. Ready to post finished goods to inventory.</p>

                                <div className="grid grid-cols-2 gap-4 w-full max-w-md bg-slate-950/50 p-6 rounded-2xl border border-white/5 mb-8">
                                    <div className="text-center">
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Piece Variance</p>
                                        <p className={`text-xl font-mono font-bold ${Math.abs(selectedJob.piece_variance_percent || 0) < 5 ? "text-emerald-400" : "text-amber-400"}`}>
                                            {selectedJob.piece_variance_percent?.toFixed(2) || "0.00"}%
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Weight Variance</p>
                                        <p className={`text-xl font-mono font-bold ${Math.abs(selectedJob.weight_variance_percent || 0) < 5 ? "text-emerald-400" : "text-amber-400"}`}>
                                            {selectedJob.weight_variance_percent?.toFixed(2) || "0.00"}%
                                        </p>
                                    </div>
                                </div>

                                <div className="w-full max-w-md space-y-4">
                                    <div className="space-y-2 text-left">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">FG Item Assignment</label>
                                        <select
                                            required
                                            value={formData.fg_item_id}
                                            onChange={(e) => setFormData(s => ({ ...s, fg_item_id: e.target.value }))}
                                            className="h-12 w-full rounded-2xl bg-slate-950/80 border border-slate-800 px-4 text-slate-200 outline-none focus:border-cyan-500/30 transition"
                                        >
                                            <option value="">Select FG Code...</option>
                                            {fgItems.map((fg: any) => (
                                                <option key={fg.id} value={fg.id}>{fg.item_code} - {fg.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-2 text-left">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">FG Lot Number</label>
                                        <input
                                            required
                                            placeholder="e.g., FG-JOB-001"
                                            value={formData.fg_batch_no}
                                            onChange={(e) => setFormData(s => ({ ...s, fg_batch_no: e.target.value }))}
                                            className="h-12 w-full rounded-2xl bg-slate-950/80 border border-slate-800 px-4 text-white outline-none focus:border-cyan-500/30 transition"
                                        />
                                    </div>

                                    <button
                                        onClick={handleFinish}
                                        disabled={closeJob.isPending}
                                        className="w-full h-14 mt-4 rounded-2xl bg-emerald-600 text-slate-950 font-bold uppercase tracking-widest hover:bg-emerald-500 transition shadow-[0_20px_40px_-15px_rgba(16,185,129,0.3)]"
                                    >
                                        {closeJob.isPending ? "Posting Finished Goods..." : "Authorize FG Posting & Close"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    )
}
