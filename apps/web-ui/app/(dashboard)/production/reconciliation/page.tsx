'use client'

import { productionApi, inventoryApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function ReconciliationPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ actual_kg: 0, actual_cost: 0 })

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['reconciliation-jobs'],
    queryFn: async () => {
      const { data } = await productionApi.getJobs()
      return (data || []).filter((j: any) => j.status === 'completed')
    },
  })

  const saveMutation = useMutation({
    mutationFn: async ({ jobId, data }: { jobId: string; data: any }) => {
      return productionApi.closeJob(jobId, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation-jobs'] })
      setEditingId(null)
    },
  })

  const handleSave = (jobId: string) => {
    saveMutation.mutate({ jobId, data: editData })
  }

  if (isLoading) return <div className="container mx-auto p-6">Loading...</div>

  return (
    <div className="container mx-auto p-6" data-testid="reconciliation-page">
      <h1 className="text-2xl font-bold mb-6">Material Reconciliation</h1>

      <Card>
        <CardHeader>
          <CardTitle data-testid="reconciliation-grid">Completed Jobs - Enter Actual Data</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-gray-500">No completed jobs for reconciliation</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">Job Card</th>
                    <th className="px-4 py-3 text-left">Spec</th>
                    <th className="px-4 py-3 text-right">Planned Qty</th>
                    <th className="px-4 py-3 text-right">Planned Cost</th>
                    <th className="px-4 py-3 text-right">Actual KG</th>
                    <th className="px-4 py-3 text-right">Actual Cost</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job: any) => (
                    <tr key={job.id} className="border-t">
                      <td className="px-4 py-3">{job.job_card_no || job.id}</td>
                      <td className="px-4 py-3">{job.spec_name}</td>
                      <td className="px-4 py-3 text-right">{job.planned_qty}</td>
                      <td className="px-4 py-3 text-right">₹{job.planned_cost || 0}</td>
                      <td className="px-4 py-3 text-right">
                        {editingId === job.id ? (
                          <Input
                            type="number"
                            value={editData.actual_kg}
                            onChange={(e) => setEditData({ ...editData, actual_kg: parseFloat(e.target.value) })}
                            className="w-24"
                            data-testid={`reconciliation-actual-kg:${job.id}`}
                          />
                        ) : (
                          <span data-testid={`reconciliation-actual-kg:${job.id}`}>{job.actual_kg || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingId === job.id ? (
                          <Input
                            type="number"
                            value={editData.actual_cost}
                            onChange={(e) => setEditData({ ...editData, actual_cost: parseFloat(e.target.value) })}
                            className="w-24"
                            data-testid={`reconciliation-actual-cost:${job.id}`}
                          />
                        ) : (
                          <span data-testid={`reconciliation-actual-cost:${job.id}`}>₹{job.actual_cost || 0}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === job.id ? (
                          <div className="flex gap-2 justify-center">
                            <Button size="sm" onClick={() => handleSave(job.id)} data-testid="reconciliation-save-button">Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => { setEditingId(job.id); setEditData({ actual_kg: job.actual_kg || 0, actual_cost: job.actual_cost || 0 }) }}>
                            Edit
                          </Button>
                        )}
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