"use client"

// Operator scan scope on screen (owner, 2 Nov 2026): which stage an Operator-only login sees on a card, the
// one-line status when that stage is not open, and the note for a login not linked to an employee.
// Screen flow only; the server keeps every rule as before (lib/floor-scope.ts has the decision).

import { Info, Lock } from "lucide-react"
import { useMemo } from "react"

import { useAuth } from "@/context/AuthContext"
import { floorScope, isOperatorOnly, unlinkedNote, type FloorScope } from "@/lib/floor-scope"
import { cn } from "@/lib/utils"
import { useCardMasters } from "./data"
import { toneClass } from "./model"

/** The floor scope of the signed-in login on this card's plant; `loading` while an operator's employee list loads. */
export function useFloorScope(card: any): { scope: FloorScope; loading: boolean } {
  const { user } = useAuth()
  const { employees } = useCardMasters(card)
  return useMemo(() => {
    const roles = [user?.role, ...(user?.roles || [])]
    if (!isOperatorOnly(roles)) return { scope: { kind: "full" } as FloorScope, loading: false }
    if (employees.isLoading) return { scope: { kind: "full" } as FloorScope, loading: true }
    return { scope: floorScope({ roles, email: user?.email, employees: Array.isArray(employees.data) ? employees.data : [] }), loading: false }
  }, [user?.role, user?.roles, user?.email, employees.isLoading, employees.data])
}

/** One-line status when the operator's stage takes nothing now ("This card is at Winding; Oven opens when …"). */
export function ScopeStatusLine({ message, testId = "scope-status" }: { message: string; testId?: string }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl border border-border bg-muted px-3.5 py-3 text-[14px] font-medium" data-testid={testId}>
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{message} Nothing to log here now.</span>
    </p>
  )
}

/** The small note for an Operator-only login that is not linked to one stage. */
export function UnlinkedNote({ scope }: { scope: FloorScope }) {
  const text = unlinkedNote(scope)
  if (!text) return null
  return (
    <p className={cn("flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px]", toneClass("blue"))} data-testid="scope-unlinked-note">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  )
}
