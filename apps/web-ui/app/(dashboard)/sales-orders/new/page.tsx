'use client'

import { useState } from 'react'
import { salesApi } from '@/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

interface OrderLine {
  id: string
  product_code: string
  description: string
  quantity: number
  unit: string
  rate: number
  amount: number
}

export default function NewSalesOrderPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState({
    order_no: '',
    customer_name: '',
    order_date: new Date().toISOString().split('T')[0],
    delivery_date: '',
    notes: '',
  })
  const [lines, setLines] = useState<OrderLine[]>([
    { id: '1', product_code: '', description: '', quantity: 0, unit: 'pcs', rate: 0, amount: 0 },
  ])

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        ...data,
        lines: lines.filter(l => l.product_code && l.quantity > 0),
      }
      return salesApi.createOrder(payload)
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] })
      router.push(`/sales-orders/${response.data?.id}`)
    },
  })

  const addLine = () => {
    setLines([...lines, { id: Date.now().toString(), product_code: '', description: '', quantity: 0, unit: 'pcs', rate: 0, amount: 0 }])
  }

  const removeLine = (id: string) => {
    if (lines.length > 1) setLines(lines.filter(l => l.id !== id))
  }

  const updateLine = (id: string, field: string, value: any) => {
    setLines(lines.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'quantity' || field === 'rate') {
        updated.amount = updated.quantity * updated.rate
      }
      return updated
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  return (
    <div className="container mx-auto p-6" data-testid="sales-orders:create-form">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/sales-orders">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-2xl font-bold">New Sales Order</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Order Number *</label>
                <Input
                  value={formData.order_no}
                  onChange={(e) => setFormData({ ...formData, order_no: e.target.value })}
                  placeholder="SO-001"
                  required
                  data-testid="sales-orders:product-code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Customer Name *</label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  placeholder="Customer Name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Order Date *</label>
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
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                className="w-full p-2 border rounded-md"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes..."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Order Lines</CardTitle>
            <Button type="button" variant="outline" onClick={addLine}>Add Line</Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium">Product Code</th>
                    <th className="px-2 py-2 text-left text-xs font-medium">Description</th>
                    <th className="px-2 py-2 text-left text-xs font-medium">Qty</th>
                    <th className="px-2 py-2 text-left text-xs font-medium">Unit</th>
                    <th className="px-2 py-2 text-left text-xs font-medium">Rate</th>
                    <th className="px-2 py-2 text-left text-xs font-medium">Amount</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="p-2">
                        <Input
                          value={line.product_code}
                          onChange={(e) => updateLine(line.id, 'product_code', e.target.value)}
                          placeholder="PC-001"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.description}
                          onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                          placeholder="Description"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, 'quantity', parseFloat(e.target.value) || 0)}
                          className="w-20"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={line.unit}
                          onChange={(e) => updateLine(line.id, 'unit', e.target.value)}
                          className="w-16"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={line.rate}
                          onChange={(e) => updateLine(line.id, 'rate', parseFloat(e.target.value) || 0)}
                          className="w-24"
                        />
                      </td>
                      <td className="p-2 font-medium">₹{line.amount.toFixed(2)}</td>
                      <td className="p-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(line.id)}>✕</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-bold">
                    <td colSpan={5} className="p-2 text-right">Total:</td>
                    <td className="p-2">₹{lines.reduce((sum, l) => sum + l.amount, 0).toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Order'}
          </Button>
          <Link href="/sales-orders">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}