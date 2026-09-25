"use client"
import { useParams } from "next/navigation"
import ReceiptRegister from "@/components/procurement/receipt-register"
export default function ReceiptDetailPage() { const { id } = useParams<{ id: string }>(); return <ReceiptRegister receiptId={id} /> }
