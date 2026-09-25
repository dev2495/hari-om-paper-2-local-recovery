"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, Mail, Phone, Search, Users } from "lucide-react"

import { useContactDirectory } from "@/hooks/use-master-data"

function matches(row: any, query: string, filter: string) {
  const typeMatch = filter === "ALL" || row.entity_type === filter
  if (!typeMatch) return false
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [row.entity_name, row.entity_code, row.contact_name, row.contact_phone, row.contact_email]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

export default function ContactDirectoryPage() {
  const directoryQuery = useContactDirectory()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("ALL")
  const rows = useMemo(() => (Array.isArray(directoryQuery.data) ? directoryQuery.data : []), [directoryQuery.data])
  const visibleRows = useMemo(() => rows.filter((row: any) => matches(row, search, filter)), [rows, search, filter])
  const customerCount = rows.filter((row: any) => row.entity_type === "CUSTOMER").length
  const vendorCount = rows.filter((row: any) => row.entity_type === "VENDOR").length

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-border bg-card/90 p-5 shadow-premium">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Contact Directory</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Customer and vendor contacts</h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[540px]">
            <button
              type="button"
              onClick={() => setFilter("ALL")}
              className={`rounded-2xl border px-4 py-3 text-left transition ${filter === "ALL" ? "border-slate-950 bg-slate-950 text-white" : "border-border bg-muted text-muted-foreground"}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">All</p>
              <p className="mt-2 text-2xl font-semibold">{rows.length}</p>
            </button>
            <button
              type="button"
              onClick={() => setFilter("CUSTOMER")}
              className={`rounded-2xl border px-4 py-3 text-left transition ${filter === "CUSTOMER" ? "border-cyan-900 bg-cyan-900 text-white" : "border-border bg-muted text-muted-foreground"}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">Customers</p>
              <p className="mt-2 text-2xl font-semibold">{customerCount}</p>
            </button>
            <button
              type="button"
              onClick={() => setFilter("VENDOR")}
              className={`rounded-2xl border px-4 py-3 text-left transition ${filter === "VENDOR" ? "border-cyan-900 bg-cyan-900 text-white" : "border-border bg-muted text-muted-foreground"}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">Vendors</p>
              <p className="mt-2 text-2xl font-semibold">{vendorCount}</p>
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-premium">
        <label className="flex h-12 items-center gap-2 rounded-xl border border-border bg-muted px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, name, number, email"
            className="h-11 w-full bg-transparent text-sm outline-none"
          />
        </label>
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-border bg-card/90 shadow-premium">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Master</th>
                <th className="px-4 py-3">Contact Name</th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((contact: any) => (
                <tr key={contact.id} className="hover:bg-muted">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${contact.entity_type === "CUSTOMER" ? "bg-signal-cyan-soft text-signal-cyan-ink" : "bg-muted text-foreground"}`}>
                      {contact.entity_type === "CUSTOMER" ? <Users className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
                      {contact.entity_type === "CUSTOMER" ? "Customer" : "Vendor"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{contact.entity_name}</p>
                    <p className="text-xs text-muted-foreground">{contact.entity_code}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{contact.contact_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {contact.contact_phone || "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {contact.contact_email || "-"}
                    </span>
                  </td>
                </tr>
              ))}
              {!directoryQuery.isLoading && visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No contacts found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/masters/customers" className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:border-signal-cyan-line hover:text-signal-cyan-ink">
          Customer master
        </Link>
        <Link href="/masters/vendors" className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:border-signal-cyan-line hover:text-signal-cyan-ink">
          Vendor master
        </Link>
      </div>
    </div>
  )
}
