"use client"

/**
 * Customer master form (client 2026-10-28): GSTIN, billing address and dispatch (ship-to) address with
 * state and PIN code, main and dispatch contacts. All details are optional; only code and name are
 * needed to save. The delivery challan reads the GSTIN and addresses from here.
 */
import { useRef, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { customerBillingAddress, customerDispatchAddress, hasSeparateShipTo, placeLine } from "@/lib/dispatch-challan"
import { GST_STATES, emailError, fromGstin, gstinError, panError, phoneError, pinError, stateName } from "@/lib/party-formats"

export const CUSTOMER_CATEGORIES = ["Wholesale (B2B)", "Retail", "Distributor", "Export", "Other"] as const

export type Customer = {
  id: string
  customer_code?: string
  name?: string
  gst_no?: string | null
  tax_id?: string | null
  pan_no?: string | null
  address?: string | null
  billing_address?: string | null
  billing_city?: string | null
  billing_state?: string | null
  billing_state_code?: string | null
  billing_pin_code?: string | null
  shipping_address?: string | null
  shipping_city?: string | null
  shipping_state?: string | null
  shipping_state_code?: string | null
  shipping_pin_code?: string | null
  billing_full_address?: string | null
  shipping_full_address?: string | null
  primary_contact_name?: string | null
  primary_contact_phone?: string | null
  primary_contact_email?: string | null
  dispatch_contact_name?: string | null
  dispatch_contact_phone?: string | null
  category?: string | null
  is_active?: boolean
  credit_limit?: number | null
  payment_terms?: string | null
}

export type CustomerForm = {
  customer_code: string
  name: string
  category: string
  gst_no: string
  pan_no: string
  billing_address: string
  billing_city: string
  billing_state_code: string
  billing_pin_code: string
  ship_same: boolean
  shipping_address: string
  shipping_city: string
  shipping_state_code: string
  shipping_pin_code: string
  primary_contact_name: string
  primary_contact_phone: string
  primary_contact_email: string
  dispatch_contact_name: string
  dispatch_contact_phone: string
  credit_limit: string
  payment_terms: string
}

const text = (value: unknown) => (value == null ? "" : String(value))

export function emptyCustomerForm(): CustomerForm {
  return {
    customer_code: "", name: "", category: "", gst_no: "", pan_no: "",
    billing_address: "", billing_city: "", billing_state_code: "", billing_pin_code: "",
    ship_same: true, shipping_address: "", shipping_city: "", shipping_state_code: "", shipping_pin_code: "",
    primary_contact_name: "", primary_contact_phone: "", primary_contact_email: "",
    dispatch_contact_name: "", dispatch_contact_phone: "", credit_limit: "", payment_terms: "",
  }
}

export function formFromCustomer(customer: Customer): CustomerForm {
  const separate = hasSeparateShipTo(customer)
  return {
    customer_code: text(customer.customer_code),
    name: text(customer.name),
    category: text(customer.category),
    gst_no: text(customer.gst_no || customer.tax_id),
    pan_no: text(customer.pan_no),
    billing_address: text(customer.billing_address || customer.address),
    billing_city: text(customer.billing_city),
    billing_state_code: text(customer.billing_state_code),
    billing_pin_code: text(customer.billing_pin_code),
    ship_same: !separate,
    shipping_address: separate ? text(customer.shipping_address) : "",
    shipping_city: separate ? text(customer.shipping_city) : "",
    shipping_state_code: separate ? text(customer.shipping_state_code) : "",
    shipping_pin_code: separate ? text(customer.shipping_pin_code) : "",
    primary_contact_name: text(customer.primary_contact_name),
    primary_contact_phone: text(customer.primary_contact_phone),
    primary_contact_email: text(customer.primary_contact_email),
    dispatch_contact_name: text(customer.dispatch_contact_name),
    dispatch_contact_phone: text(customer.dispatch_contact_phone),
    credit_limit: customer.credit_limit == null ? "" : String(customer.credit_limit),
    payment_terms: text(customer.payment_terms),
  }
}

/** Body for create / update. Blanks go as null so a cleared field is cleared on the server. */
export function payloadFromCustomerForm(form: CustomerForm) {
  const value = (raw: string) => raw.trim() || null
  const upper = (raw: string) => raw.replace(/\s+/g, "").toUpperCase() || null
  const billingStreet = value(form.billing_address)
  return {
    customer_code: form.customer_code.trim(),
    name: form.name.trim(),
    category: value(form.category),
    gst_no: upper(form.gst_no),
    pan_no: upper(form.pan_no),
    address: billingStreet,
    billing_address: billingStreet,
    billing_city: value(form.billing_city),
    billing_state_code: value(form.billing_state_code),
    billing_state: form.billing_state_code ? stateName(form.billing_state_code) || null : null,
    billing_pin_code: value(form.billing_pin_code),
    // "Same as billing" keeps no separate ship-to address: the challan then dispatches to the billing address.
    shipping_address: form.ship_same ? null : value(form.shipping_address),
    shipping_city: form.ship_same ? null : value(form.shipping_city),
    shipping_state_code: form.ship_same ? null : value(form.shipping_state_code),
    shipping_state: !form.ship_same && form.shipping_state_code ? stateName(form.shipping_state_code) || null : null,
    shipping_pin_code: form.ship_same ? null : value(form.shipping_pin_code),
    primary_contact_name: value(form.primary_contact_name),
    primary_contact_phone: value(form.primary_contact_phone),
    primary_contact_email: value(form.primary_contact_email),
    dispatch_contact_name: value(form.dispatch_contact_name),
    dispatch_contact_phone: value(form.dispatch_contact_phone),
    credit_limit: form.credit_limit.trim() === "" ? null : Number(form.credit_limit),
    payment_terms: value(form.payment_terms),
  }
}

/** Field → plain error for the filled fields; required code and name are checked separately. */
export function customerFormErrors(form: CustomerForm) {
  const checks: [keyof CustomerForm, string][] = [
    ["gst_no", gstinError(form.gst_no)],
    ["pan_no", panError(form.pan_no) || (fromGstin(form.gst_no).pan && form.pan_no.trim() && form.pan_no.trim().toUpperCase() !== fromGstin(form.gst_no).pan ? `PAN does not match the GSTIN (it carries PAN ${fromGstin(form.gst_no).pan})` : "")],
    // A GSTIN is registered in one state and the billing address is that registration's (the server refuses a mismatch).
    ["billing_state_code", fromGstin(form.gst_no).stateCode && form.billing_state_code && form.billing_state_code !== fromGstin(form.gst_no).stateCode ? `The GSTIN is registered in ${fromGstin(form.gst_no).state} (${fromGstin(form.gst_no).stateCode}), so the billing state must be ${fromGstin(form.gst_no).state}` : ""],
    ["billing_pin_code", pinError(form.billing_pin_code)],
    ["shipping_pin_code", form.ship_same ? "" : pinError(form.shipping_pin_code)],
    ["primary_contact_phone", phoneError(form.primary_contact_phone)],
    ["dispatch_contact_phone", phoneError(form.dispatch_contact_phone)],
    ["primary_contact_email", emailError(form.primary_contact_email)],
    ["credit_limit", form.credit_limit.trim() !== "" && !(Number(form.credit_limit) >= 0) ? "Credit limit must be 0 or more" : ""],
  ]
  return Object.fromEntries(checks.filter(([, error]) => error)) as Partial<Record<keyof CustomerForm, string>>
}

/** What the delivery challan still needs from this customer (blocking: dispatch address; GSTIN is optional). */
export function customerChallanStatus(customer: Customer) {
  const dispatchAddress = customerDispatchAddress(customer)
  const gstin = String(customer.gst_no || customer.tax_id || "").trim()
  return { ready: Boolean(dispatchAddress), dispatchAddress, billingAddress: customerBillingAddress(customer), gstin }
}

/**
 * The dispatch address the form will save, as the challan prints it; "" without a street line, because goods
 * cannot be sent to "Gujarat" (the GSTIN fills the state by itself). The server applies the same rule.
 */
export function formDispatchPreview(form: CustomerForm) {
  if (form.ship_same) {
    return form.billing_address.trim() ? placeLine(form.billing_address, form.billing_city, stateName(form.billing_state_code), form.billing_pin_code) : ""
  }
  return form.shipping_address.trim() ? placeLine(form.shipping_address, form.shipping_city, stateName(form.shipping_state_code), form.shipping_pin_code) : ""
}

const inputClass = "h-11 w-full min-w-0 rounded-md border bg-card px-3 text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:text-sm"

function Field({ id, label, value, onChange, error, hint, required, mono, inputMode, maxLength, placeholder, className, testId }: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  error?: string
  hint?: ReactNode
  required?: boolean
  mono?: boolean
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email"
  maxLength?: number
  placeholder?: string
  className?: string
  testId?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className || ""}`}>
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label} {required ? <span className="text-signal-rose-ink">*</span> : null}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        data-testid={testId}
        className={`${inputClass} ${mono ? "font-mono uppercase tracking-wide" : ""} ${error ? "border-signal-rose-line" : "border-border"}`}
      />
      {error ? (
        <span id={`${id}-note`} className="flex items-start gap-1 text-xs font-medium text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{error}</span>
      ) : hint ? <span id={`${id}-note`} className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function AddressArea({ id, label, value, onChange, testId }: { id: string; label: string; value: string; onChange: (next: string) => void; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Plot / building, street, area"
        data-testid={testId}
        className="w-full min-w-0 rounded-md border border-border bg-card px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
      />
    </div>
  )
}

function StateSelect({ id, label, value, onChange, note, error, testId }: { id: string; label: string; value: string; onChange: (code: string) => void; note?: ReactNode; error?: string; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} ${error ? "border-signal-rose-line" : "border-border"}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-note` : undefined} data-testid={testId}>
        <option value="">Choose state…</option>
        {GST_STATES.map((row) => (
          <option key={row.code} value={row.code}>{row.code} · {row.name}</option>
        ))}
      </select>
      {error ? <span id={`${id}-note`} className="flex items-start gap-1 text-xs font-medium text-signal-rose-ink"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{error}</span> : note}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="mt-5 first:mt-0">
      <legend className="text-sm font-semibold text-foreground">{title}{hint ? <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span> : null}</legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function CustomerFormFields({ form, setForm, errors, sameGstin }: {
  form: CustomerForm
  setForm: (next: CustomerForm) => void
  errors: Partial<Record<keyof CustomerForm, string>>
  sameGstin?: Customer | null
}) {
  const set = (key: keyof CustomerForm) => (value: string) => setForm({ ...form, [key]: value })
  const tax = fromGstin(form.gst_no)
  const gstProblem = gstinError(form.gst_no)
  const stateError = errors.billing_state_code || customerFormErrors(form).billing_state_code

  // A complete GSTIN fills PAN when it is empty or still the old GSTIN's, and always moves the billing state
  // (the form refuses a billing state other than the GSTIN's; the server does the same).
  // "The old GSTIN" is the last complete one: typed key by key, the value just before the last key is only
  // 14 characters and carries no PAN or state (checker round 4, 28 Oct).
  const lastCompleteGstin = useRef(form.gst_no)
  const onGstin = (raw: string) => {
    const value = raw.toUpperCase()
    const next = { ...form, gst_no: value }
    const derived = fromGstin(value)
    const previous = fromGstin(fromGstin(form.gst_no).pan ? form.gst_no : lastCompleteGstin.current)
    if (derived.pan) {
      const pan = form.pan_no.trim().toUpperCase()
      if (!pan || pan === previous.pan) next.pan_no = derived.pan
      next.billing_state_code = derived.stateCode
      lastCompleteGstin.current = value
    } else if (fromGstin(form.gst_no).pan) {
      lastCompleteGstin.current = form.gst_no
    }
    setForm(next)
  }
  const panMismatch = Boolean(tax.pan && form.pan_no.trim() && !panError(form.pan_no) && form.pan_no.trim().toUpperCase() !== tax.pan)

  const gstHint = form.gst_no.trim()
    ? sameGstin
      ? <span className="flex items-center gap-1 text-signal-amber-ink"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{sameGstin.name} ({sameGstin.customer_code}) already has this GSTIN</span>
      : <span className="flex items-center gap-1 text-signal-emerald-ink"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Format OK · {tax.state} ({tax.stateCode}) · PAN {tax.pan}</span>
    : "15 characters, e.g. 24ABCDE1234F1Z5. Prints on the challan; fills PAN and state."
  const preview = formDispatchPreview(form)

  return (
    <div data-testid="customer-form">
      <Section title="Customer">
        <Field id="cust-code" label="Code" required value={form.customer_code} onChange={set("customer_code")} placeholder="WB-XXXX" testId="customer-code" />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="cust-category" className="text-xs font-semibold text-muted-foreground">Category</label>
          <select id="cust-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={`${inputClass} border-border`}>
            <option value="">Choose…</option>
            {CUSTOMER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Field id="cust-name" label="Customer name" required value={form.name} onChange={set("name")} className="sm:col-span-2" testId="customer-name" />
      </Section>

      <Section title="Tax" hint="optional">
        <Field id="cust-gstin" label="GSTIN" value={form.gst_no} onChange={onGstin} mono maxLength={18} error={errors.gst_no || (form.gst_no.trim() ? gstProblem : "") || undefined} hint={gstHint} testId="customer-gstin" />
        <Field id="cust-pan" label="PAN" value={form.pan_no} onChange={(v) => setForm({ ...form, pan_no: v.toUpperCase() })} mono maxLength={12} error={errors.pan_no || (panMismatch ? `The GSTIN carries PAN ${tax.pan}. Correct the PAN or the GSTIN.` : undefined)} hint="10 characters, e.g. ABCDE1234F" />
      </Section>

      <Section title="Billing address" hint="prints under Billed to">
        <AddressArea id="cust-bill-street" label="Address" value={form.billing_address} onChange={set("billing_address")} testId="customer-billing-address" />
        <Field id="cust-bill-city" label="City" value={form.billing_city} onChange={set("billing_city")} testId="customer-billing-city" />
        <StateSelect
          id="cust-bill-state"
          label="State"
          value={form.billing_state_code}
          onChange={(code) => setForm({ ...form, billing_state_code: code })}
          testId="customer-billing-state"
          error={stateError}
        />
        <Field id="cust-bill-pin" label="PIN code" value={form.billing_pin_code} onChange={set("billing_pin_code")} inputMode="numeric" maxLength={6} error={errors.billing_pin_code} testId="customer-billing-pin" />
      </Section>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-foreground">Dispatch (ship-to) address <span className="ml-2 text-xs font-normal text-muted-foreground">the challan sends goods here</span></legend>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={form.ship_same} onChange={(e) => setForm({ ...form, ship_same: e.target.checked })} data-testid="customer-ship-same" />
          <span>Same as the billing address</span>
        </label>
        {!form.ship_same ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AddressArea id="cust-ship-street" label="Dispatch address" value={form.shipping_address} onChange={set("shipping_address")} testId="customer-shipping-address" />
            <Field id="cust-ship-city" label="City" value={form.shipping_city} onChange={set("shipping_city")} testId="customer-shipping-city" />
            <StateSelect id="cust-ship-state" label="State" value={form.shipping_state_code} onChange={(code) => setForm({ ...form, shipping_state_code: code })} testId="customer-shipping-state" />
            <Field id="cust-ship-pin" label="PIN code" value={form.shipping_pin_code} onChange={set("shipping_pin_code")} inputMode="numeric" maxLength={6} error={errors.shipping_pin_code} testId="customer-shipping-pin" />
          </div>
        ) : null}
        <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="customer-dispatch-preview">
          {preview ? <>Challan prints: <span className="text-foreground">{preview}</span></> : <span className="text-signal-amber-ink">No dispatch street address yet ({form.ship_same ? "billing" : "dispatch"} address line above): a challan for this customer cannot be sealed until one is added. City, state or GSTIN alone are not enough.</span>}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="cust-dispatch-name" label="Dispatch contact (stores / gate)" value={form.dispatch_contact_name} onChange={set("dispatch_contact_name")} />
          <Field id="cust-dispatch-phone" label="Dispatch contact phone" value={form.dispatch_contact_phone} onChange={set("dispatch_contact_phone")} inputMode="tel" error={errors.dispatch_contact_phone} />
        </div>
      </fieldset>

      <Section title="Main contact" hint="optional">
        <Field id="cust-contact" label="Contact person" value={form.primary_contact_name} onChange={set("primary_contact_name")} testId="customer-contact" />
        <Field id="cust-phone" label="Phone" value={form.primary_contact_phone} onChange={set("primary_contact_phone")} inputMode="tel" error={errors.primary_contact_phone} testId="customer-phone" />
        <Field id="cust-email" label="Email" value={form.primary_contact_email} onChange={set("primary_contact_email")} inputMode="email" error={errors.primary_contact_email} className="sm:col-span-2" testId="customer-email" />
      </Section>

      <Section title="Payment" hint="optional">
        <Field id="cust-credit" label="Credit limit (₹)" value={form.credit_limit} onChange={set("credit_limit")} inputMode="decimal" error={errors.credit_limit} />
        <Field id="cust-terms" label="Payment terms" value={form.payment_terms} onChange={set("payment_terms")} placeholder="e.g. 60 days" />
      </Section>
    </div>
  )
}
