"use client"

import { SALES_ACTION_ROLES } from "@/components/sales/sales-action-roles"
import { SalesOrderCreateForm } from "@/components/sales/sales-order-create-form"
import { RoleGate } from "@/components/workspace/role-gate"
import { useParams } from "next/navigation"

export default function EditSalesOrderPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")
  // Only the roles the sales service lets change an order (Owner, Admin, Sales).
  return (
    <RoleGate allow={[...SALES_ACTION_ROLES.edit]} fallbackTitle="Only Sales can change an order">
      <SalesOrderCreateForm orderId={orderId} />
    </RoleGate>
  )
}
