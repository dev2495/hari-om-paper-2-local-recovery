"use client"

import { SalesOrderCreateForm } from "@/components/sales/sales-order-create-form"
import { useParams } from "next/navigation"

export default function EditSalesOrderPage() {
  const params = useParams()
  const orderId = String(params?.orderId || "")
  return <SalesOrderCreateForm orderId={orderId} />
}
