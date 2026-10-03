"use client"
import { useParams } from "next/navigation"
import Link from "next/link"
import JobCardDocument from "@/components/production/JobCardDocument"
export default function SlittingPreparationPage(){const params=useParams<{jobCardId:string}>();return <div className="space-y-4"><Link className="text-sm underline" href={`/production/job-cards/${params.jobCardId}`}>Back to continuous production</Link><JobCardDocument jobCardId={params.jobCardId} mode="supervisor" materialPreparationOnly /></div>}
