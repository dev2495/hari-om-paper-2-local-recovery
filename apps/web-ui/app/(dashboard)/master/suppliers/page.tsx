"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { Mail, Pencil, Phone, Plus, PowerOff, Save, Search, Truck, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useApp } from "@/context/AppContext"
import {
  useContactDirectory,
  useCreateVendor,
  useCreateVendorContact,
  useDeleteVendor,
  useDeleteVendorContact,
  useUpdateVendor,
  useUpdateVendorContact,
  useVendorContacts,
  useVendors,
} from "@/hooks/use-master-data"

const blankVendor = {
  supplier_code: "",
  name: "",
  gst_no: "",
  pan_no: "",
  address: "",
}

const blankContact = {
  contact_name: "",
  contact_phone: "",
  contact_email: "",
}

function errorMessage(error: any) {
  return error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Action failed"
}

function compact(value: unknown) {
  return String(value || "").trim()
}

function includesSearch(row: any, search: string) {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [row.supplier_code, row.name, row.gst_no, row.pan_no, row.address]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

export default function SupplierMasterPage() {
  const { showToast } = useApp()
  const vendorsQuery = useVendors()
  const directoryQuery = useContactDirectory()
  const createVendor = useCreateVendor()
  const updateVendor = useUpdateVendor()
  const deleteVendor = useDeleteVendor()
  const createContact = useCreateVendorContact()
  const updateContact = useUpdateVendorContact()
  const deleteContact = useDeleteVendorContact()

  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [vendorForm, setVendorForm] = useState(blankVendor)
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [contactForm, setContactForm] = useState(blankContact)

  const vendors = useMemo(() => (Array.isArray(vendorsQuery.data) ? vendorsQuery.data : []), [vendorsQuery.data])
  const filteredVendors = useMemo(
    () => vendors.filter((row: any) => includesSearch(row, search)),
    [vendors, search],
  )

  useEffect(() => {
    if (!selectedId && filteredVendors.length) setSelectedId(filteredVendors[0].id)
    if (selectedId && filteredVendors.every((row: any) => row.id !== selectedId)) {
      setSelectedId(filteredVendors[0]?.id || null)
    }
  }, [filteredVendors, selectedId])

  const selectedVendor = vendors.find((row: any) => row.id === selectedId) || null
  const contactsQuery = useVendorContacts(selectedId)
  const contacts = Array.isArray(contactsQuery.data) ? contactsQuery.data : []
  const vendorDirectory = useMemo(
    () => (Array.isArray(directoryQuery.data) ? directoryQuery.data : []).filter((row: any) => row.entity_type === "VENDOR"),
    [directoryQuery.data],
  )

  const resetVendorForm = () => {
    setEditingId(null)
    setVendorForm(blankVendor)
  }

  const startEditVendor = (vendor: any) => {
    setEditingId(vendor.id)
    setSelectedId(vendor.id)
    setVendorForm({
      supplier_code: vendor.supplier_code || "",
      name: vendor.name || "",
      gst_no: vendor.gst_no || "",
      pan_no: vendor.pan_no || "",
      address: vendor.address || "",
    })
  }

  const submitVendor = async (event: FormEvent) => {
    event.preventDefault()
    const payload = {
      supplier_code: compact(vendorForm.supplier_code).toUpperCase(),
      name: compact(vendorForm.name),
      gst_no: compact(vendorForm.gst_no).toUpperCase() || null,
      pan_no: compact(vendorForm.pan_no).toUpperCase() || null,
      address: compact(vendorForm.address) || null,
      category: "RAW_MATERIAL",
    }
    try {
      if (editingId) {
        await updateVendor.mutateAsync({ id: editingId, data: payload })
        showToast("Vendor updated", "success")
      } else {
        const response = await createVendor.mutateAsync(payload)
        if (response?.data?.id) setSelectedId(response.data.id)
        showToast("Vendor created", "success")
      }
      resetVendorForm()
    } catch (error: any) {
      showToast(errorMessage(error), "error")
    }
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId) return
    const payload = {
      department: "General",
      contact_name: compact(contactForm.contact_name),
      contact_phone: compact(contactForm.contact_phone) || null,
      contact_email: compact(contactForm.contact_email) || null,
    }
    try {
      if (editingContactId) {
        await updateContact.mutateAsync({ vendorId: selectedId, contactId: editingContactId, data: payload })
        showToast("Contact updated", "success")
      } else {
        await createContact.mutateAsync({ vendorId: selectedId, data: payload })
        showToast("Contact added", "success")
      }
      setEditingContactId(null)
      setContactForm(blankContact)
    } catch (error: any) {
      showToast(errorMessage(error), "error")
    }
  }

  const startEditContact = (contact: any) => {
    setEditingContactId(contact.id)
    setContactForm({
      contact_name: contact.contact_name || "",
      contact_phone: contact.contact_phone || "",
      contact_email: contact.contact_email || "",
    })
  }

  const disableVendor = async (vendorId: string) => {
    try {
      await deleteVendor.mutateAsync(vendorId)
      if (selectedId === vendorId) setSelectedId(null)
      showToast("Vendor disabled", "success")
    } catch (error: any) {
      showToast(errorMessage(error), "error")
    }
  }

  const disableContact = async (contactId: string) => {
    if (!selectedId) return
    try {
      await deleteContact.mutateAsync({ vendorId: selectedId, contactId })
      if (editingContactId === contactId) {
        setEditingContactId(null)
        setContactForm(blankContact)
      }
      showToast("Contact disabled", "success")
    } catch (error: any) {
      showToast(errorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-5 shadow-premium">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Vendor Master</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Vendors and contacts</h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[540px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Vendors</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{vendors.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Contacts</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{vendorDirectory.length}</p>
            </div>
            <label className="flex h-full min-h-[76px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/90 shadow-premium">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">GST</th>
                <th className="px-4 py-3">PAN</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredVendors.map((vendor: any) => (
                <tr key={vendor.id} className={vendor.id === selectedId ? "bg-cyan-50/60" : "hover:bg-slate-50"}>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelectedId(vendor.id)} className="text-left">
                      <p className="font-semibold text-slate-950">{vendor.name}</p>
                      <p className="text-xs text-slate-500">{vendor.supplier_code}</p>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{vendor.gst_no || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{vendor.pan_no || "-"}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-slate-600">{vendor.address || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => startEditVendor(vendor)} title="Edit vendor" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => disableVendor(vendor.id)} title="Disable vendor" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
                        <PowerOff className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!vendorsQuery.isLoading && filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No vendors found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <form onSubmit={submitVendor} className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-5 shadow-premium">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{editingId ? "Edit" : "Create"}</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Vendor details</h2>
            </div>
            <Truck className="h-5 w-5 text-cyan-800" />
          </div>
          <div className="mt-5 grid gap-3">
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Vendor Name
              <input required value={vendorForm.name} onChange={(event) => setVendorForm((current) => ({ ...current, name: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Vendor Code
              <input required value={vendorForm.supplier_code} onChange={(event) => setVendorForm((current) => ({ ...current, supplier_code: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                GST
                <input value={vendorForm.gst_no} onChange={(event) => setVendorForm((current) => ({ ...current, gst_no: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-700">
                PAN
                <input value={vendorForm.pan_no} onChange={(event) => setVendorForm((current) => ({ ...current, pan_no: event.target.value.toUpperCase() }))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-cyan-700" />
              </label>
            </div>
            <label className="space-y-1 text-sm font-semibold text-slate-700">
              Address
              <textarea value={vendorForm.address} onChange={(event) => setVendorForm((current) => ({ ...current, address: event.target.value }))} rows={4} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-cyan-700" />
            </label>
            <div className="flex gap-2">
              <Button type="submit" className="h-11 flex-1 rounded-xl bg-slate-950 text-white hover:bg-cyan-950">
                {editingId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                {editingId ? "Save vendor" : "Add vendor"}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={resetVendorForm}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white/90 p-5 shadow-premium">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected vendor</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{selectedVendor?.name || "No vendor selected"}</h2>
          </div>
          <form onSubmit={submitContact} className="grid w-full gap-2 lg:max-w-3xl lg:grid-cols-[1fr_150px_1fr_auto]">
            <input required disabled={!selectedId} value={contactForm.contact_name} onChange={(event) => setContactForm((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Contact Name" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
            <input disabled={!selectedId} value={contactForm.contact_phone} onChange={(event) => setContactForm((current) => ({ ...current, contact_phone: event.target.value }))} placeholder="Number" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
            <input type="email" disabled={!selectedId} value={contactForm.contact_email} onChange={(event) => setContactForm((current) => ({ ...current, contact_email: event.target.value }))} placeholder="Email" className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-700 disabled:bg-slate-100" />
            <Button type="submit" disabled={!selectedId} className="h-11 rounded-xl bg-cyan-900 text-white hover:bg-cyan-800">
              {editingContactId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
          </form>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="py-3">Contact Name</th>
                <th className="py-3">Number</th>
                <th className="py-3">Email</th>
                <th className="py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((contact: any) => (
                <tr key={contact.id}>
                  <td className="py-3 font-semibold text-slate-950">{contact.contact_name}</td>
                  <td className="py-3 text-slate-700">{contact.contact_phone || "-"}</td>
                  <td className="py-3 text-slate-700">{contact.contact_email || "-"}</td>
                  <td className="py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => startEditContact(contact)} title="Edit contact" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => disableContact(contact.id)} title="Disable contact" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
                        <PowerOff className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!contactsQuery.isLoading && contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">No contacts for this vendor.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/90 shadow-premium">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-xl font-semibold text-slate-950">Vendor contact directory</h2>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Phone className="h-4 w-4" />
            <Mail className="h-4 w-4" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Contact Name</th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {vendorDirectory.map((contact: any) => (
                <tr key={contact.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-950">{contact.entity_name}</p>
                    <p className="text-xs text-slate-500">{contact.entity_code}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{contact.contact_name}</td>
                  <td className="px-4 py-3 text-slate-700">{contact.contact_phone || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{contact.contact_email || "-"}</td>
                </tr>
              ))}
              {!directoryQuery.isLoading && vendorDirectory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">No vendor contacts in the directory.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
