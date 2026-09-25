"use client"

import type { ReactNode } from "react"

import { EmptyState } from "@/components/erp/shell"
import { cn } from "@/lib/utils"

export type DataGridColumn<T> = {
  key: string
  label: string
  align?: "left" | "right" | "center"
  className?: string
  render?: (row: T, index: number) => ReactNode
}

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  emptyLabel,
  testId,
}: {
  columns: DataGridColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  emptyLabel: string
  testId?: string
}) {
  return (
    <div data-testid={testId} className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "px-3 py-3",
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                  column.className,
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-0 py-4">
                <EmptyState label={emptyLabel} className="mx-2" />
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-b border-border align-top last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-3 text-muted-foreground",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.className,
                    )}
                  >
                    {column.render ? column.render(row, index) : String((row as any)?.[column.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}