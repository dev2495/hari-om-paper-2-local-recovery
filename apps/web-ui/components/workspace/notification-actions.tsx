"use client"

import Link from "next/link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2, OctagonX } from "lucide-react"

import { ReasonPicker, useReasonChoice } from "@/components/reasons"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, authApi } from "@/lib/api"
import { notificationButtons, type InboxNotification, type NotificationButton } from "@/lib/notifications"
import { errorText } from "@/lib/stock-format"
import { cn } from "@/lib/utils"

const TONE: Record<string, string> = {
  primary: "erp-btn-primary",
  secondary: "erp-btn-secondary",
  danger: "erp-btn-secondary !border-signal-rose-line !text-signal-rose-ink",
  link: "inline-flex items-center px-1 text-[12px] font-semibold text-signal-cyan-ink underline-offset-2 hover:underline",
}

/** Outcome words from the API answer: its `outcome` / `message`, else a plain "Done". */
function outcomeOf(data: any, button: NotificationButton) {
  if (data && typeof data === "object") {
    if (typeof data.outcome === "string" && data.outcome) return data.outcome
    if (typeof data.message === "string" && data.message) return data.message
  }
  return `${button.label.replace(/…$/, "")}: done`
}

/**
 * The action buttons of one notification (6 Nov 2026): Make debit note / Skip… / Open bill, Send in / Ask to
 * wait… Each button calls its own API on the notification's plant; the server checks the role. A button with a
 * reason list asks for the reason first. Once answered, the outcome replaces the buttons.
 */
export function NotificationActions({ item, onNavigate }: { item: InboxNotification; onNavigate?: () => void }) {
  const queryClient = useQueryClient()
  const buttons = notificationButtons(item)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState(item.action_result || null)
  const [asking, setAsking] = useState<NotificationButton | null>(null)
  const plantId = (item as any).plant_id || item.payload?.plant_id
  const reason = useReasonChoice(asking?.reason_category || "", plantId, { enabled: Boolean(asking?.reason_category) })
  if (!buttons.length) return null
  const shown = result || item.action_result

  async function run(button: NotificationButton, extra: Record<string, any> = {}) {
    setBusy(button.key)
    let outcome = { key: button.key, ok: false, message: "" }
    try {
      const { data } = await api.request({
        url: button.path, method: (button.method || "POST").toLowerCase() as any, data: { ...(button.body || {}), ...extra },
        headers: plantId && String(plantId).toUpperCase() !== "ALL" ? { "X-Plant-ID": String(plantId) } : undefined,
      })
      outcome = { key: button.key, ok: true, message: outcomeOf(data, button) }
    } catch (error) {
      outcome = { key: button.key, ok: false, message: errorText(error, "That did not go through. Try again from the page.") }
    }
    setResult(outcome)
    setBusy(null)
    setAsking(null)
    try {
      await authApi.recordNotificationActionResult(item.id, outcome)
    } catch {
      // The outcome still shows here; the inbox shows the buttons again next time.
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace-notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-notifications-unread"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-notifications-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-v2"] }),
    ])
  }

  const links = buttons.filter((button) => button.href)
  const calls = buttons.filter((button) => button.path)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid={`notification-actions-${item.id}`} onClick={(event) => event.stopPropagation()}>
      {shown ? (
        <span className={cn("inline-flex max-w-full items-start gap-1 rounded-md px-2 py-1 text-[12px] font-semibold", shown.ok ? "bg-signal-emerald-soft text-signal-emerald-ink" : "bg-signal-rose-soft text-signal-rose-ink")} data-testid="notification-action-result">
          {shown.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <OctagonX className="mt-px h-3.5 w-3.5 shrink-0" />}
          <span>{shown.message}</span>
        </span>
      ) : calls.map((button) => (
        <button key={button.key} type="button" disabled={Boolean(busy)} data-testid={`notification-button-${button.key}`}
          className={cn(TONE[button.tone || "secondary"] || TONE.secondary, "!h-11 !px-3 !text-[12.5px] sm:!h-8")}
          onClick={() => { if (button.reason_category) { reason.reset(); setAsking(button) } else void run(button) }}>
          {busy === button.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {button.label}
        </button>
      ))}
      {shown && !shown.ok ? calls.map((button) => (
        <button key={button.key} type="button" disabled={Boolean(busy)} className={cn(TONE.link, "min-h-11 sm:min-h-0")}
          onClick={() => { setResult(null); if (button.reason_category) { reason.reset(); setAsking(button) } else void run(button) }}>Try {button.label.replace(/…$/, "")} again</button>
      )) : null}
      {links.map((button) => (
        <Link key={button.key} href={button.href!} onClick={() => onNavigate?.()} className={cn(TONE.link, "min-h-11 sm:min-h-0")} data-testid={`notification-link-${button.key}`}>{button.label}</Link>
      ))}
      <Dialog open={Boolean(asking)} onOpenChange={(open) => { if (!open) setAsking(null) }}>
        <DialogContent className="max-w-md" data-notification-dialog>
          <DialogTitle>{asking?.label.replace(/…$/, "")}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
          <div className="space-y-3 pt-2">
            {asking?.reason_category ? (
              <ReasonPicker category={asking.reason_category} plantId={plantId} label="Reason" value={reason.value} onChange={reason.setValue} showErrors={reason.touched} compact testIdPrefix="notification-reason" />
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="erp-btn-secondary !h-11 sm:!h-9" onClick={() => setAsking(null)}>Cancel</button>
              <button type="button" className="erp-btn-primary !h-11 sm:!h-9" disabled={Boolean(busy)} data-testid="notification-reason-confirm"
                onClick={() => { if (asking && reason.validate()) void run(asking, reason.payload(null)) }}>
                {busy ? "Saving…" : asking?.label.replace(/…$/, "")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
