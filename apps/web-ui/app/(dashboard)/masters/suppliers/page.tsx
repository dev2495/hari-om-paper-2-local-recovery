import { redirect } from "next/navigation"

// Suppliers and vendors are one master: the vendor list (client rule 2026-10-18).
export default function SuppliersRedirect() {
  redirect("/masters/vendors")
}
