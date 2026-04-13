"use client"

import React from "react"
import { Building2, ChevronDown } from "lucide-react"
import { useAuth } from "@/context/AuthContext"

const PLANTS = [
    { id: "PLANT-1", name: "Plant 1 (Main)" },
    { id: "PLANT-2", name: "Plant 2 (Extension)" },
]

export function PlantSwitcher() {
    const { user, activePlant, setActivePlant } = useAuth()
    const [isOpen, setIsOpen] = React.useState(false)

    // Only show for Owner
    if (!user || user.role !== "Owner") {
        return (
            <div className="flex items-center gap-2 rounded-lg bg-cyan-950 px-3 py-1.5 text-xs font-medium text-cyan-100 uppercase tracking-wider">
                <Building2 className="h-3 w-3" />
                {activePlant || "Unknown Plant"}
            </div>
        )
    }

    const currentPlantName = PLANTS.find((p) => p.id === activePlant)?.name || activePlant

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 rounded-lg bg-cyan-950 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-900"
            >
                <Building2 className="h-3 w-3" />
                <span className="uppercase tracking-wider">{currentPlantName}</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl z-20">
                        <p className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                            Select Plant
                        </p>
                        {PLANTS.map((plant) => (
                            <button
                                key={plant.id}
                                onClick={() => {
                                    setActivePlant(plant.id)
                                    setIsOpen(false)
                                    window.location.reload() // Reload to refresh all data
                                }}
                                className={`w-full flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition ${activePlant === plant.id
                                        ? "bg-cyan-50 text-cyan-900"
                                        : "text-slate-700 hover:bg-slate-50"
                                    }`}
                            >
                                <span className="text-xs font-medium">{plant.name}</span>
                                <span className="text-[10px] opacity-70">{plant.id}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
