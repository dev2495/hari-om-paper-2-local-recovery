"use client"
import { useParams } from "next/navigation"
import { UserEditor } from "@/components/auth/user-editor"
export default function EditUserPage() {
  const params = useParams<{ id: string }>()
  return <UserEditor userId={params.id} />
}
