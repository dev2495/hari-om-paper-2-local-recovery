'use client'

import { useState } from 'react'
import { salesApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export default function SalesOrdersPage() {
  const queryClient = useQueryClient()
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [formData, setFormData] = useState({
    order_no: '',
    customer_id: '',
    customer_name: '',
    order_date: new Date().toISOString().split('T')[0],
    delivery_date: '',
    status: 'draft',
  })

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: async () => {
      const { data } = await salesApi.getOrders()
      return Array.isArray(data) ? data : data?.items || data?.rows || []
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => salesApi.createOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      setShowNewDialog(false)
      setFormData({
        order_no: '',
        customer_id: '',
        customer_name: '',
        order_date: new Date().toISOString().split('T')[0],
        delivery_date: '',
        status: 'draft',
      })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

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
    <div className="container mx-auto p-6" data-testid="sales-orders:page">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Sales Orders</h1>
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button>New Sales Order</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Sales Order</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Order Number</label>
                <Input
                  value={formData.order_no}
                  onChange={(e) => setFormData({ ...formData, order_no: e.target.value })}
                  placeholder="SO-001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Customer Name</label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="Customer Name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Order Date</label>
                <Input
                  type="date"
                  value={formData.order_date}
                  onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Delivery Date</label>
                <Input
                  type="date"
                  value={formData.delivery_date}
                  onChange={(e) => setFormData({ ...formData, delivery_date: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Order'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="sales-orders:heading">Sales POs, Product Buckets, and Release Lots</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No sales orders found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order No</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lines</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orders.map((order: any) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/sales-orders/${order.id}`} className="text-blue-600 hover:underline">
                          {order.order_no || order.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{order.customer_name || order.customer_id}</td>
                      <td className="px-4 py-3">{order.order_date || order.created_at}</td>
                      <td className="px-4 py-3">{order.lines?.length || 0}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/sales-orders/${order.id}`}>
                          <Button variant="outline" size="sm">View</Button>
                        </Link>
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