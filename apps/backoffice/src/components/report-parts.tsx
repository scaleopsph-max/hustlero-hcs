'use client'

import { reportCsv } from '@/lib/report-csv'
import { Button } from '@hcs/ui'
import { Download } from 'lucide-react'

export function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const blob = new Blob([reportCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
  URL.revokeObjectURL(href)
}

export function quantity(value: number) {
  return (value / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

export function ReportHeader({ title, subtitle, onExport }: { title: string; subtitle: string; onExport: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-900/10 p-5">
      <div>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="text-sm text-ink-500">{subtitle}</p>
      </div>
      <Button type="button" variant="secondary" onClick={onExport}>
        <Download size={16} className="mr-2" />
        CSV
      </Button>
    </div>
  )
}

export function MetricPanel({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-ink-900/10 bg-white p-4">
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className="mt-2 break-words font-display text-2xl font-bold">{value}</div>
    </div>
  )
}

export function formatReportDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function ReportTable({
  headings,
  rows,
  compact = false,
}: {
  headings: string[]
  rows: Array<Array<React.ReactNode>>
  /** Narrow tables (three columns or fewer) fit half-width panels without scrolling. */
  compact?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-sm ${compact ? '' : 'min-w-[680px]'}`}>
        <thead>
          <tr className="border-b border-ink-900/10 text-xs uppercase text-ink-500">
            {headings.map((heading, index) => (
              <th key={heading} className={`px-5 py-3 ${index ? 'text-right' : ''}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-ink-900/10 last:border-0">
                {row.map((cell, index) => (
                  <td key={index} className={`px-5 py-4 ${index ? 'text-right' : ''}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headings.length} className="px-5 py-10 text-center text-ink-500">
                No activity for this scope.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
