'use client'

import { masterApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function MasterCustomersPage() {
  const [showDialog, setShowDialog] = useState(false)
  const [formData, setFormData] = useState({ name: '', code: '', contact: '', phone: '', email: '' })

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data } = await masterApi.getCustomers()
      return data || []
    },
  })

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Customers</h1>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button>Add Customer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Customer</DialogTitle>
            </DialogHeader>
            <form className="space-y-4">
              <Input placeholder="Customer Name" onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              <Input placeholder="Customer Code" onChange={(e) => setFormData({ ...formData, code: e.target.value })} />
              <Input placeholder="Contact Person" onChange={(e) => setFormData({ ...formData, contact: e.target.value })} />
              <Input placeholder="Phone" onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              <Input placeholder="Email" onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              <Button type="submit">Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No customers found</div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">Code</th>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Contact</th>
                  <th className="px-4 py-2 text-left">Phone</th>
                  <th className="px-4 py-2 text-left">Email</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c: any) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-2">{c.code}</td>
                    <td className="px-4 py-2">{c.name}</td>
                    <td className="px-4 py-2">{c.contact}</td>
                    <td className="px-4 py-2">{c.phone}</td>
                    <td className="px-4 py-2">{c.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}