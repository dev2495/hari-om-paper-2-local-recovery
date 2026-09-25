"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/workspace/page-header"
import { ErrorState, LoadingState, EmptyQueryState, PaginationBar } from "@/components/workspace/query-state"
import { RoleGate } from "@/components/workspace/role-gate"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"

export default function AuditPage() {
  const { activePlant } = useAuth()
  const [hours, setHours] = useState(168)
  const [offset, setOffset] = useState(0)
  const [eventType, setEventType] = useState("")
  const [live, setLive] = useState(false)
  const events = useQuery({
    queryKey: ["audit-events", hours, offset, eventType, activePlant],
    queryFn: async () =>
      (
        await api.get("/api/auth/audit-events", {
          params: {
            since_hours: hours,
            limit: 100,
            offset,
            ...(eventType ? { event_type: eventType } : {}),
            ...(activePlant && activePlant !== "ALL" ? { plant_id: activePlant } : {}),
          },
        })
      ).data,
    refetchInterval: live ? 30000 : false,
  })

  return (
    <RoleGate allow={["Owner", "Admin"]} fallbackMessage="Only Owner and Admin can view the system audit workspace.">
      <main className="space-y-6">
        <PageHeader
          eyebrow="Governance"
          title="System audit history"
          description="Recorded events from the central audit log. Each row shows the actor, time, source, and saved event details. Historical activity that was never recorded cannot be reconstructed here."
        />
        <Card className="rounded-[1.6rem]">
          <CardContent className="flex flex-wrap items-end gap-4 p-5">
            <div className="space-y-1">
              <Label htmlFor="audit-period">Period</Label>
              <select
                id="audit-period"
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={hours}
                onChange={(event) => {
                  setHours(Number(event.target.value))
                  setOffset(0)
                }}
              >
                <option value={24}>24 hours</option>
                <option value={168}>7 days</option>
                <option value={720}>30 days</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-event-type">Event type</Label>
              <Input
                id="audit-event-type"
                placeholder="All event types"
                value={eventType}
                onChange={(event) => {
                  setEventType(event.target.value)
                  setOffset(0)
                }}
                className="h-10 w-56 rounded-xl"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
              Refresh every 30 seconds
            </label>
            <Button type="button" onClick={() => events.refetch()} disabled={events.isFetching} className="rounded-xl">
              {events.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          {events.data?.total_count ?? "—"} recorded events in this period · Last fetched:{" "}
          {events.dataUpdatedAt ? new Date(events.dataUpdatedAt).toLocaleString() : "Not yet fetched"}
        </p>
        {events.isError ? (
          <ErrorState
            message="The audit log could not be loaded. Refresh to retry. Previously displayed rows may be stale."
            onRetry={() => {
              void events.refetch()
            }}
          />
        ) : null}
        {events.isLoading ? <LoadingState label="Loading audit records…" /> : null}
        {!events.isLoading && events.isSuccess && !events.data?.items?.length ? (
          <EmptyQueryState title="No recorded events match these filters." message="Widen the period or clear the event type." />
        ) : null}
        <div className="space-y-3">
          {(events.data?.items || []).map((event: any) => (
            <details key={event.id} className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer">
                <span className="font-semibold">{event.summary || event.event_type}</span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  {new Date(event.occurred_at + (/Z$|[+-]\d\d:\d\d$/.test(event.occurred_at) ? "" : "Z")).toLocaleString()} ·{" "}
                  {event.actor_email || "System"} · {event.actor_role || "—"} · {event.source_service || "Unknown source"}
                </span>
              </summary>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Event</dt>
                  <dd>
                    <Badge variant="outline">{event.event_type}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Entity</dt>
                  <dd>
                    {event.entity_type} {event.entity_id}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Record ID</dt>
                  <dd>{event.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Plant</dt>
                  <dd>{event.plant_id || "Account / global"}</dd>
                </div>
              </dl>
              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
            </details>
          ))}
        </div>
        <PaginationBar
          page={offset / 100 + 1}
          hasPrevious={Boolean(offset)}
          hasNext={Boolean(events.data?.has_more)}
          onPrevious={() => setOffset(Math.max(0, offset - 100))}
          onNext={() => setOffset(offset + 100)}
        />
      </main>
    </RoleGate>
  )
}
