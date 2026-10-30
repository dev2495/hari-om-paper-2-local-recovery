import { useEffect, useState, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { hasStoredPeople, peopleVersion, rememberPeople, savePeople, subscribePeople, type PersonRow } from "@/lib/people"

/** Re-render when names arrive (for components that show people and want the update at once). */
export function usePeopleVersion(): number {
  return useSyncExternalStore(subscribePeople, peopleVersion, () => 0)
}

/**
 * Load the people directory (login → display name) once per session, refreshed every 30 minutes.
 * The dashboard layout calls this; the signed-in user's own name is known straight away.
 */
export function usePeopleDirectory(me?: { email?: string | null; name?: string | null } | null) {
  useEffect(() => {
    if (me?.email && me?.name) rememberPeople([{ email: me.email, name: me.name }])
  }, [me?.email, me?.name])
  const query = useQuery({
    queryKey: ["people-directory", (me?.email || "").toLowerCase()],
    enabled: Boolean(me?.email),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await api.get("/api/auth/people")
      const rows: PersonRow[] = Array.isArray(data?.items) ? data.items : []
      return rows
    },
  })
  // Also after signing in again (sign-out forgets the names; the cached list is put back).
  useEffect(() => {
    if (!query.data?.length || !me?.email) return
    rememberPeople(query.data)
    savePeople(query.data)
  }, [query.data, me?.email])
  return query
}

/**
 * Pages format names while they render (who(), personText(), personName() all read the directory), so the
 * layout shows a page once the names are known: at once when this browser already holds the directory,
 * else when the first load answers (or fails), and never later than `waitMs`, so a slow directory never
 * holds a page back for long. Right after sign-in this is one short wait instead of logins on screen.
 */
export function usePeopleReady(query: { isFetched: boolean; isError: boolean }, enabled: boolean, waitMs = 1500): boolean {
  const [stored] = useState(() => hasStoredPeople())
  const [timedOut, setTimedOut] = useState(false)
  const settled = !enabled || stored || query.isFetched || query.isError
  useEffect(() => {
    if (settled) return
    const timer = window.setTimeout(() => setTimedOut(true), waitMs)
    return () => window.clearTimeout(timer)
  }, [settled, waitMs])
  return settled || timedOut
}
