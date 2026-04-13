'use client'

import { useState } from 'react'
import { productionApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function PlannerPage() {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState('winding')
  const [planDate, setPlanDate] = useState(new Date().toISOString().split('T')[0])
  const [includeUnscheduled, setIncludeUnscheduled] = useState(true)

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['planning-queue', stage, planDate, includeUnscheduled],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningQueue({
        stage,
        plan_date: planDate,
        include_unscheduled: includeUnscheduled,
      })
      return data || []
    },
    enabled: !!stage,
  })

  return (
    <div className="container mx-auto p-6" data-testid="planner-page">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Production Planner</h1>
          <p className="text-gray-500 text-sm">Three-day machine schedule</p>
        </div>
        <Link href="/planning/tracker">
          <Button variant="outline">Tracker</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planning Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-1">Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="border rounded-md p-2"
              >
                <option value="winding">Winding</option>
                <option value="oven">Oven</option>
                <option value="slitting">Slitting</option>
                <option value="finish">Finish</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Plan Date</label>
              <Input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeUnscheduled}
                  onChange={(e) => setIncludeUnscheduled(e.target.checked)}
                />
                Include Unscheduled
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : queue.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No jobs in queue</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Card</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SO</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Spec</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Machine</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {queue.map((job: any) => (
                    <tr key={job.job_card_id} className="hover:bg-gray-50" data-testid={`planner-lane:${job.job_card_id}`}>
                      <td className="px-4 py-3">
                        <Link href={`/job-cards/${job.job_card_id}`} className="text-blue-600 hover:underline">
                          {job.job_card_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{job.order_no}</td>
                      <td className="px-4 py-3">{job.spec_name}</td>
                      <td className="px-4 py-3">{job.quantity}</td>
                      <td className="px-4 py-3">{job.machine_id || '-'}</td>
                      <td className="px-4 py-3">{job.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}