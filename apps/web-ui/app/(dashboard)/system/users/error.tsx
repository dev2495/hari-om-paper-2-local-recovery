"use client"

import { useEffect } from "react"
import Link from "next/link"

export default function UsersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("User administration route error:", error)
  }, [error])

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="rounded-2xl border border-signal-rose-line bg-signal-rose-soft p-6 text-signal-rose-ink shadow-sm">
        <h1 className="text-2xl font-semibold">User administration hit a problem</h1>
        <p className="mt-2 text-sm leading-6">
          The page could not finish loading, but nothing was changed by this error. No user was created or edited.
          Try again, and if it keeps happening, reload the page or contact another Owner/Admin.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            href="/system/users"
            className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-muted"
          >
            Back to users
          </Link>
        </div>
      </div>
    </main>
  )
}
