'use client'

import { productionApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PlanningTrackerPage() {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['planning-tracker-jobs'],
    queryFn: async () => {
      const { data } = await productionApi.getPlanningJobCards({ status: 'in_progress' })
      return data || []
    },
  })

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Planning Tracker</h1>
          <p className="text-gray-500 text-sm">Track active job cards across all stages</p>
        </div>
        <Link href="/production/planner">
          <Button variant="outline">Planner</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No active jobs</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Card</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SO</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Machine</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {jobs.map((job: any) => (
                    <tr key={job.id} className="hover:bg-gray-50" data-testid={`tracker-row:${job.id}`}>
                      <td className="px-4 py-3">
                        <Link href={`/job-cards/${job.id}`} className="text-blue-600 hover:underline">
                          {job.job_card_no || job.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{job.order_no}</td>
                      <td className="px-4 py-3">{job.current_stage}</td>
                      <td className="px-4 py-3">{job.machine_id || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-cyan-600 h-2 rounded-full" style={{ width: `${job.progress || 0}%` }} />
                        </div>
                      </td>
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