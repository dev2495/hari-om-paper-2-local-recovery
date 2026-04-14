'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CalendarDays, ChevronRight, Factory, Layers3, ListTodo, TimerReset } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { productionApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const stages = [
  { value: 'winding', label: 'Winding' },
  { value: 'oven', label: 'Oven' },
  { value: 'slitting', label: 'Slitting' },
  { value: 'finish', label: 'Finish' },
]

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  )
}

export default function PlannerPage() {
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
      return Array.isArray(data) ? data : []
    },
    enabled: !!stage,
  })

  const queueSummary = useMemo(() => {
    const totalQty = queue.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0)
    const assigned = queue.filter((row: any) => Boolean(row.machine_id)).length
    const open = queue.filter((row: any) => String(row.status || '').toUpperCase() !== 'DONE').length
    return {
      totalQty,
      assigned,
      open,
    }
  }, [queue])

  return (
    <div className="space-y-6 px-6 pb-8 pt-2" data-testid="planner-page">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(186,230,253,0.3),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">TubeOS Workspace</p>
            <h1 className="mt-2 text-[2.4rem] font-semibold tracking-tight text-slate-950">Production Planner</h1>
            <p className="mt-2 text-sm text-slate-600">
              Scheduling workspace for machine lanes, queue review, and job-card launch decisions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/planning/tracker">
              <Button variant="outline" className="rounded-full px-5">Tracker</Button>
            </Link>
            <Link href="/production/job-cards">
              <Button className="rounded-full bg-slate-950 px-5 hover:bg-slate-800">Job cards</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Queue rows" value={String(queue.length)} hint="Current planning candidates" />
        <StatTile label="Assigned machines" value={String(queueSummary.assigned)} hint="Rows already mapped to machines" />
        <StatTile label="Open work" value={String(queueSummary.open)} hint="Rows not fully completed" />
        <StatTile label="Planned quantity" value={String(queueSummary.totalQty)} hint="Total units across the queue" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[28px] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-950">
                <Layers3 className="h-4 w-4 text-cyan-700" />
                <h2 className="font-semibold">Planning queue</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">Recovered route with stage filter, date anchor, and job-card links.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Plan date
                </label>
                <Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="h-11 rounded-2xl" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Stage</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                >
                  {stages.map((stageOption) => (
                    <option key={stageOption.value} value={stageOption.value}>
                      {stageOption.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeUnscheduled}
                  onChange={(e) => setIncludeUnscheduled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Include unscheduled
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {stages.map((stageOption) => (
              <button
                key={stageOption.value}
                type="button"
                onClick={() => setStage(stageOption.value)}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-medium transition',
                  stage === stageOption.value
                    ? 'border-cyan-200 bg-cyan-50 text-cyan-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                )}
              >
                {stageOption.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-sm text-slate-500">Loading planning queue…</div>
          ) : queue.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">No jobs in queue for this stage and date.</div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
              <div className="grid grid-cols-[1.1fr_0.7fr_1.2fr_0.6fr_0.8fr_0.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <div>Job card</div>
                <div>SO</div>
                <div>Spec</div>
                <div>Qty</div>
                <div>Machine</div>
                <div>Status</div>
              </div>
              <div className="divide-y divide-slate-100">
                {queue.map((job: any) => (
                  <div
                    key={job.job_card_id}
                    className="grid grid-cols-[1.1fr_0.7fr_1.2fr_0.6fr_0.8fr_0.8fr] gap-3 px-4 py-4 text-sm text-slate-700"
                    data-testid={`planner-lane:${job.job_card_id}`}
                  >
                    <div>
                      <Link href={`/production/job-cards/${job.job_card_id}`} className="inline-flex items-center gap-2 font-medium text-slate-950 hover:text-cyan-700">
                        {job.job_card_id}
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </Link>
                    </div>
                    <div>{job.order_no || '-'}</div>
                    <div className="text-slate-600">{job.spec_name || '-'}</div>
                    <div>{job.quantity || 0}</div>
                    <div>{job.machine_id || '-'}</div>
                    <div>{job.status || '-'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-2 text-slate-950">
              <Factory className="h-4 w-4 text-cyan-700" />
              <h2 className="font-semibold">Planner notes</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>The April-style route shell is back on the live planner path instead of the plain table fallback.</p>
              <p>Tracker and job-card links stay visible from the planner header.</p>
              <p>Queue rows still use the existing production API, so the page stays compatible with the recovered backend.</p>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#0f172a,#164e63_55%,#0f766e)] px-5 py-5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-white/80" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">Execution</p>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Schedule from one queue</h2>
            <p className="mt-2 text-sm leading-6 text-white/75">
              Stage, date, machine, and job-card access remain on a single planner surface.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-white/85">
              <TimerReset className="h-4 w-4" />
              Live filter state is preserved in the client workspace.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
