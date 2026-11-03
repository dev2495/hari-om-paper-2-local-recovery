"use client"

import { useSearchParams } from "next/navigation"

import { SALES_ACTION_ROLES } from "@/components/sales/sales-action-roles"
import { SalesOrderCreateForm } from "@/components/sales/sales-order-create-form"
import { RoleGate } from "@/components/workspace/role-gate"

export default function NewSalesOrderPage() {
  const searchParams = useSearchParams()
  const copyFrom = String(searchParams?.get("copy") || "")
  // Only the roles the sales service lets create an order (Owner, Admin, Sales).
  return (
    <RoleGate allow={[...SALES_ACTION_ROLES.create]} fallbackTitle="Only Sales can enter a new order">
      <SalesOrderCreateForm copyFromOrderId={copyFrom || undefined} />
    </RoleGate>
  )
}
