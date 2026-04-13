'use client'

import { masterApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export default function MasterPapersPage() {
  const [showDialog, setShowDialog] = useState(false)
  const [formData, setFormData] = useState({ name: '', gsm: 0, width_mm: 0, supplier: '' })

  const { data: papers = [], isLoading } = useQuery({
    queryKey: ['papers'],
    queryFn: async () => {
      const { data } = await masterApi.getPapers()
      return data || []
    },
  })

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Papers</h1>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button>Add Paper</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Paper</DialogTitle>
            </DialogHeader>
            <form className="space-y-4">
              <Input placeholder="Paper Name" onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              <Input type="number" placeholder="GSM" onChange={(e) => setFormData({ ...formData, gsm: parseFloat(e.target.value) })} />
              <Input type="number" placeholder="Width (mm)" onChange={(e) => setFormData({ ...formData, width_mm: parseFloat(e.target.value) })} />
              <Input placeholder="Supplier" onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} />
              <Button type="submit">Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : papers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No papers found</div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">GSM</th>
                  <th className="px-4 py-2 text-left">Width (mm)</th>
                  <th className="px-4 py-2 text-left">Supplier</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((paper: any) => (
                  <tr key={paper.id} className="border-t">
                    <td className="px-4 py-2">{paper.name}</td>
                    <td className="px-4 py-2">{paper.gsm}</td>
                    <td className="px-4 py-2">{paper.width_mm}</td>
                    <td className="px-4 py-2">{paper.supplier}</td>
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