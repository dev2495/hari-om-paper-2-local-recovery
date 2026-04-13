'use client'

import { useState } from 'react'
import { salesApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SalesOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const orderId = params.orderId as string
  const [showReleaseDialog, setShowReleaseDialog] = useState(false)
  const [releaseData, setReleaseData] = useState({ quantity: 0, winder_id: '', target_date: '' })

  const { data: order, isLoading } = useQuery({
    queryKey: ['sales-order', orderId],
    queryFn: async () => {
      const { data } = await salesApi.getOrder(orderId)
      return data
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => salesApi.approveOrder(orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales-order', orderId] }),
  })

  const releaseMutation = useMutation({
    mutationFn: (data: any) => salesApi.releaseOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-order', orderId] })
      setShowReleaseDialog(false)
    },
  })

  if (isLoading) return <div className="container mx-auto p-6">Loading...</div>
  if (!order) return <div className="container mx-auto p-6">Order not found</div>

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800'
      case 'released': return 'bg-blue-100 text-blue-800'
      case 'partially_released': return 'bg-yellow-100 text-yellow-800'
      case 'draft': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="container mx-auto p-6" data-testid="sales-orders:tracking-page">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/sales-orders">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-2xl font-bold">Sales Order: {order.order_no || orderId}</h1>
        <span className={`px-3 py-1 rounded ${getStatusColor(order.status)}`}>{order.status}</span>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="lines">Lines</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Order Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-500">Customer</label>
                  <p className="font-medium">{order.customer_name || order.customer_id}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Order Date</label>
                  <p className="font-medium">{order.order_date || order.created_at}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Delivery Date</label>
                  <p className="font-medium">{order.delivery_date || '-'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">Total Value</label>
                  <p className="font-medium">₹{order.total_amount || 0}</p>
                </div>
              </div>
              {order.notes && (
                <div className="mt-4">
                  <label className="text-sm text-gray-500">Notes</label>
                  <p>{order.notes}</p>
                </div>
              )}
              <div className="mt-6 flex gap-4">
                {order.status === 'draft' && (
                  <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                    Approve Order
                  </Button>
                )}
                {order.status === 'approved' && (
                  <Button onClick={() => setShowReleaseDialog(true)}>Release to Production</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lines">
          <Card>
            <CardHeader>
              <CardTitle>Order Lines</CardTitle>
            </CardHeader>
            <CardContent>
              {order.lines?.length > 0 ? (
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">Product Code</th>
                      <th className="px-4 py-2 text-left">Description</th>
                      <th className="px-4 py-2 text-right">Quantity</th>
                      <th className="px-4 py-2 text-right">Rate</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">Released</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line: any, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{line.product_code}</td>
                        <td className="px-4 py-2">{line.description}</td>
                        <td className="px-4 py-2 text-right">{line.quantity} {line.unit}</td>
                        <td className="px-4 py-2 text-right">₹{line.rate}</td>
                        <td className="px-4 py-2 text-right">₹{line.amount}</td>
                        <td className="px-4 py-2 text-right">{line.released_qty || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500">No lines</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="releases">
          <Card>
            <CardHeader>
              <CardTitle>Production Releases</CardTitle>
            </CardHeader>
            <CardContent>
              {order.releases?.length > 0 ? (
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">Release ID</th>
                      <th className="px-4 py-2 text-left">Line</th>
                      <th className="px-4 py-2 text-right">Quantity</th>
                      <th className="px-4 py-2 text-left">Winder</th>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.releases.map((release: any, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{release.id || release.release_id}</td>
                        <td className="px-4 py-2">{release.line_product_code}</td>
                        <td className="px-4 py-2 text-right">{release.quantity}</td>
                        <td className="px-4 py-2">{release.winder_id}</td>
                        <td className="px-4 py-2">{release.release_date}</td>
                        <td className="px-4 py-2">{release.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500">No releases yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showReleaseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg max-w-md">
            <h3 className="text-lg font-bold mb-4">Release to Production</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Quantity</label>
                <input
                  type="number"
                  className="w-full p-2 border rounded"
                  value={releaseData.quantity}
                  onChange={(e) => setReleaseData({ ...releaseData, quantity: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Target Winder</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded"
                  value={releaseData.winder_id}
                  onChange={(e) => setReleaseData({ ...releaseData, winder_id: e.target.value })}
                  placeholder="Winder ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Target Date</label>
                <input
                  type="date"
                  className="w-full p-2 border rounded"
                  value={releaseData.target_date}
                  onChange={(e) => setReleaseData({ ...releaseData, target_date: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4">
              <Button onClick={() => releaseMutation.mutate(releaseData)} disabled={releaseMutation.isPending}>
                {releaseMutation.isPending ? 'Releasing...' : 'Release'}
              </Button>
              <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}