"use client"

import { useSearchParams } from "next/navigation"

import { SalesOrderCreateForm } from "@/components/sales/sales-order-create-form"

export default function NewSalesOrderPage() {
  const searchParams = useSearchParams()
  const copyFrom = String(searchParams?.get("copy") || "")
  return <SalesOrderCreateForm copyFromOrderId={copyFrom || undefined} />
}
