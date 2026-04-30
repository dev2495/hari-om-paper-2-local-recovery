"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { Pencil, Plus, PowerOff, Users } from "lucide-react"

import { CustomerForm } from "@/components/forms/master-forms"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useApp } from "@/context/AppContext"
import {
  useCreateCustomer,
  useCreateCustomerContact,
  useCustomerContacts,
  useCustomers,
  useDeleteCustomer,
  useDeleteCustomerContact,
  useUpdateCustomer,
  useUpdateCustomerContact,
} from "@/hooks/use-master-data"

function getErrorMessage(error: any): string {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    "Action failed"
  )
}

const blankContact = {
  department: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  notes: "",
}

export default function CustomersPage() {
  const { showToast } = useApp()
  const customersQuery = useCustomers()
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const deleteCustomer = useDeleteCustomer()
  const createCustomerContact = useCreateCustomerContact()
  const updateCustomerContact = useUpdateCustomerContact()
  const deleteCustomerContact = useDeleteCustomerContact()

  const [search, setSearch] = useState("")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<any>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [editingContact, setEditingContact] = useState<any>(null)
  const [contactForm, setContactForm] = useState(blankContact)

  const customers = useMemo(() => (Array.isArray(customersQuery.data) ? customersQuery.data : []), [customersQuery.data])
  const filteredCustomers = useMemo(
    () =>
      customers.filter((row: any) =>
        [row.customer_code, row.name, row.gst_no, row.primary_contact_name]
          .filter(Boolean)
          .some((value: string) => value.toLowerCase().includes(search.toLowerCase())),
      ),
    [customers, search],
  )

  useEffect(() => {
    if (!selectedCustomerId && filteredCustomers.length > 0) {
      setSelectedCustomerId(filteredCustomers[0].id)
      return
    }
    if (selectedCustomerId && filteredCustomers.every((row: any) => row.id !== selectedCustomerId)) {
      setSelectedCustomerId(filteredCustomers[0]?.id || null)
    }
  }, [filteredCustomers, selectedCustomerId])

  const selectedCustomer = filteredCustomers.find((row: any) => row.id === selectedCustomerId) || null
  const contactsQuery = useCustomerContacts(selectedCustomerId)
  const contacts = contactsQuery.data || []

  const submitCustomer = async (payload: any, customerId?: string) => {
    const normalizedPayload = {
      ...payload,
      customer_code: String(payload.customer_code || "").trim().toUpperCase(),
      name: String(payload.name || "").trim(),
      address: String(payload.address || "").trim() || null,
      billing_address: String(payload.billing_address || "").trim() || null,
      shipping_address: String(payload.shipping_address || "").trim() || null,
      pan_no: String(payload.pan_no || "").trim() || null,
      gst_no: String(payload.gst_no || "").trim() || null,
      primary_contact_name: String(payload.primary_contact_name || "").trim() || null,
      primary_contact_phone: String(payload.primary_contact_phone || "").trim() || null,
      primary_contact_email: String(payload.primary_contact_email || "").trim() || null,
      dispatch_contact_name: String(payload.dispatch_contact_name || "").trim() || null,
      dispatch_contact_phone: String(payload.dispatch_contact_phone || "").trim() || null,
    }
    try {
      if (customerId) {
        await updateCustomer.mutateAsync({ id: customerId, data: normalizedPayload })
        showToast("Customer updated", "success")
        setEditingCustomer(null)
      } else {
        const response = await createCustomer.mutateAsync(normalizedPayload)
        const createdId = response?.data?.id
        if (createdId) setSelectedCustomerId(createdId)
        showToast("Customer created", "success")
        setIsAddOpen(false)
      }
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  const removeCustomer = async (id: string) => {
    try {
      await deleteCustomer.mutateAsync(id)
      if (selectedCustomerId === id) setSelectedCustomerId(null)
      showToast("Customer disabled. Existing records keep their customer snapshot.", "success")
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  const submitContact = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedCustomerId) return
    const payload = {
      department: contactForm.department.trim(),
      contact_name: contactForm.contact_name.trim(),
      contact_phone: contactForm.contact_phone.trim() || null,
      contact_email: contactForm.contact_email.trim() || null,
      notes: contactForm.notes.trim() || null,
    }
    try {
      if (editingContact) {
        await updateCustomerContact.mutateAsync({
          customerId: selectedCustomerId,
          contactId: editingContact.id,
          data: payload,
        })
        showToast("Directory contact updated", "success")
      } else {
        await createCustomerContact.mutateAsync({ customerId: selectedCustomerId, data: payload })
        showToast("Directory contact added", "success")
      }
      setContactForm(blankContact)
      setEditingContact(null)
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  const startEditContact = (contact: any) => {
    setEditingContact(contact)
    setContactForm({
      department: contact.department || "",
      contact_name: contact.contact_name || "",
      contact_phone: contact.contact_phone || "",
      contact_email: contact.contact_email || "",
      notes: contact.notes || "",
    })
  }

  const removeContact = async (contactId: string) => {
    if (!selectedCustomerId) return
    try {
      await deleteCustomerContact.mutateAsync({ customerId: selectedCustomerId, contactId })
      showToast("Directory contact disabled.", "success")
      if (editingContact?.id === contactId) {
        setEditingContact(null)
        setContactForm(blankContact)
      }
    } catch (error: any) {
      showToast(getErrorMessage(error), "error")
    }
  }

  return (
    <div className="space-y-6">
      <section className="page-hero">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100">Master Data</p>
            <h1 className="page-title">Customers</h1>
            <p className="mt-2 max-w-3xl text-sm text-cyan-50/90">
              Full customer master plus departmental directory contacts for sales, specification linking, and dispatch truth.
            </p>
          </div>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="erp-btn-primary">
                <Plus className="mr-2 h-4 w-4" /> Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Add Customer</DialogTitle>
              </DialogHeader>
              <CustomerForm onSubmit={(data) => submitCustomer(data)} onCancel={() => setIsAddOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </section>

      <section className="erp-panel p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Customer Registry</h2>
            <p className="text-sm text-slate-600">Canonical customers with PAN, GST, address, and primary contact.</p>
          </div>
          <input
            placeholder="Search customers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full max-w-sm rounded-lg border border-slate-200 px-3 text-sm"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Code</th>
                <th className="py-2">Name</th>
                <th className="py-2">GST</th>
                <th className="py-2">Address</th>
                <th className="py-2">Primary Contact</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((row: any) => {
                const isSelected = row.id === selectedCustomerId
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 ${isSelected ? "bg-cyan-50/60" : ""}`}
                  >
                    <td className="py-3 font-semibold text-slate-800">
                      <button type="button" className="text-left" onClick={() => setSelectedCustomerId(row.id)}>
                        {row.customer_code}
                      </button>
                    </td>
                    <td className="py-3">{row.name}</td>
                    <td className="py-3">{row.gst_no || "-"}</td>
                    <td className="py-3 max-w-72 truncate">{row.address || row.billing_address || "-"}</td>
                    <td className="py-3">{row.primary_contact_name || row.primary_contact_phone || row.primary_contact_email || "-"}</td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setEditingCustomer(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-amber-700" title="Disable customer" onClick={() => removeCustomer(row.id)}>
                          <PowerOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!customersQuery.isLoading && filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No customers in this plant scope
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="erp-panel p-5 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Customer Directory</h2>
              <p className="text-sm text-slate-600">
                {selectedCustomer ? `Departmental contacts for ${selectedCustomer.name}` : "Select a customer to manage departmental contacts."}
              </p>
            </div>
          </div>

          {selectedCustomer ? (
            <>
              <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Address</p>
                  <p className="mt-1 text-sm text-slate-700">{selectedCustomer.address || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">PAN / GST</p>
                  <p className="mt-1 text-sm text-slate-700">{selectedCustomer.pan_no || "-"} / {selectedCustomer.gst_no || "-"}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {contacts.map((contact: any) => (
                  <div key={contact.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{contact.department}</p>
                        <p className="mt-1 text-base font-semibold text-slate-900">{contact.contact_name}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {[contact.contact_phone, contact.contact_email].filter(Boolean).join(" | ") || "No phone/email"}
                        </p>
                        {contact.notes ? <p className="mt-2 text-sm text-slate-600">{contact.notes}</p> : null}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => startEditContact(contact)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-amber-700" title="Disable contact" onClick={() => removeContact(contact.id)}>
                          <PowerOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {!contactsQuery.isLoading && contacts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No directory contacts yet.
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Select a customer to manage the departmental directory.
            </div>
          )}
        </div>

        <div className="erp-panel p-5 shadow-xl">
          <h2 className="text-lg font-semibold text-slate-900">{editingContact ? "Edit Directory Contact" : "Add Directory Contact"}</h2>
          <p className="mt-1 text-sm text-slate-600">Departmental contact rows stay attached to the selected customer.</p>

          <form onSubmit={submitContact} className="mt-4 space-y-3">
            <input
              required
              placeholder="Department"
              value={contactForm.department}
              onChange={(event) => setContactForm((state) => ({ ...state, department: event.target.value }))}
              disabled={!selectedCustomer}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-100"
            />
            <input
              required
              placeholder="Contact name"
              value={contactForm.contact_name}
              onChange={(event) => setContactForm((state) => ({ ...state, contact_name: event.target.value }))}
              disabled={!selectedCustomer}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-100"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                placeholder="Phone"
                value={contactForm.contact_phone}
                onChange={(event) => setContactForm((state) => ({ ...state, contact_phone: event.target.value }))}
                disabled={!selectedCustomer}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-100"
              />
              <input
                type="email"
                placeholder="Email"
                value={contactForm.contact_email}
                onChange={(event) => setContactForm((state) => ({ ...state, contact_email: event.target.value }))}
                disabled={!selectedCustomer}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm disabled:bg-slate-100"
              />
            </div>
            <textarea
              placeholder="Notes"
              value={contactForm.notes}
              onChange={(event) => setContactForm((state) => ({ ...state, notes: event.target.value }))}
              disabled={!selectedCustomer}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-3 text-sm disabled:bg-slate-100"
            />
            <div className="flex gap-2">
              <Button type="submit" className="erp-btn-primary" disabled={!selectedCustomer}>
                {editingContact ? "Update Contact" : "Add Contact"}
              </Button>
              {editingContact ? (
                <Button type="button" variant="outline" onClick={() => {
                  setEditingContact(null)
                  setContactForm(blankContact)
                }}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      {editingCustomer ? (
        <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit Customer</DialogTitle>
            </DialogHeader>
            <CustomerForm
              initialData={editingCustomer}
              onSubmit={(data) => submitCustomer(data, editingCustomer.id)}
              onCancel={() => setEditingCustomer(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
