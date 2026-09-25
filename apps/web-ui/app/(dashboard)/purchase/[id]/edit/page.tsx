"use client"
import { useParams } from "next/navigation"
import PurchaseOrderEditor from "@/components/procurement/po-editor"
export default function EditPurchaseOrderPage() { const { id } = useParams<{ id: string }>(); return <PurchaseOrderEditor orderId={id} /> }
