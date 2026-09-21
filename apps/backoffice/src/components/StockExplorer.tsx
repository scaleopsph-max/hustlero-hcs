'use client'

import { Search, X, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button, Chip, Glass, cn } from '@hcs/ui'
import {
  available,
  ledgerBySku,
  movementLabel,
  statusLabel,
  statusTone,
  stock,
  stockStatus,
  type StockRow,
} from '@/mock/inventory'

const gridCols = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px_72px_76px_72px_104px] gap-2.5'
const ghost =
  'flex min-h-touch items-center gap-2 rounded-control border border-ink-900/[0.14] bg-white/70 px-3.5 text-sm font-medium text-ink-900'

/** Stock levels table with a movement-ledger drawer for the selected SKU. */
export function StockExplorer() {
  const [selectedSku, setSelectedSku] = useState<string | null>(stock[0]?.sku ?? null)
  const [query, setQuery] = useState('')
  const rows = stock.filter((r) => `${r.name} ${r.variant} ${r.sku}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = stock.find((r) => r.sku === selectedSku) ?? null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-[340px]">
          <Search size={18} strokeWidth={1.75} className="absolute left-3.5 top-3 text-ink-500" />
          <input
            type="search"
            aria-label="Search products, SKU or barcode"
            placeholder="Search products, SKU or barcode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-control border border-ink-900/[0.14] bg-white/70 pl-[42px] pr-3.5 text-sm text-ink-900 placeholder:text-ink-500"
          />
        </div>
        {['Main Branch', 'All categories', 'Any status'].map((l) => (
          <button key={l} type="button" className={ghost}>
            {l}
            <ChevronDown size={16} strokeWidth={1.75} className="text-ink-500" />
          </button>
        ))}
        <span className="ml-auto text-[13px] text-ink-500">Showing {rows.length} of 1,302 SKUs</span>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_368px]">
        <Glass variant="data" className="flex flex-col rounded-panel px-4 pb-4 pt-2">
          <div className={cn(gridCols, 'border-b border-ink-900/[0.14] py-3 text-xs font-semibold text-ink-500')}>
            <span>Product and variant</span>
            <span>SKU</span>
            <span className="text-right">On hand</span>
            <span className="text-right">Reserved</span>
            <span className="text-right">Available</span>
            <span className="text-right">In transit</span>
            <span>Status</span>
          </div>
          {rows.map((r: StockRow) => {
            const st = stockStatus(r)
            const isSelected = r.sku === selectedSku
            return (
              <button
                key={r.sku}
                type="button"
                onClick={() => setSelectedSku(r.sku)}
                aria-pressed={isSelected}
                className={cn(
                  gridCols,
                  '-mx-2 min-h-14 items-center rounded-control border-b border-ink-900/[0.07] px-2 py-1 text-left text-sm',
                  isSelected && 'bg-gold-500/[0.22]',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-ink-500">{r.variant}</span>
                </span>
                <span className="text-ink-700">{r.sku}</span>
                <span className="text-right">{r.onHand}</span>
                <span className="text-right">{r.reserved}</span>
                <span className="text-right font-bold">{available(r)}</span>
                <span className="text-right">{r.inTransit}</span>
                <Chip surface="light" tone={statusTone[st]} className="h-6 justify-self-start text-xs">
                  {statusLabel[st]}
                </Chip>
              </button>
            )
          })}
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              No SKU matches. Check the spelling or scan the barcode again.
            </p>
          ) : null}
        </Glass>

        {selected ? <LedgerDrawer row={selected} onClose={() => setSelectedSku(null)} /> : null}
      </div>
    </>
  )
}

function LedgerDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const st = stockStatus(row)
  const movements = ledgerBySku[row.sku] ?? []
  const balances = [
    { label: 'On hand', value: row.onHand },
    { label: 'Reserved', value: row.reserved },
    { label: 'Available', value: available(row) },
    { label: 'In transit', value: row.inTransit },
  ]
  return (
    <Glass variant="data" as="aside" className="flex flex-col gap-[18px] rounded-panel p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="font-display text-[22px] font-bold leading-7">{row.name}</h2>
            <span className="text-sm text-ink-500">
              {row.variant}, SKU {row.sku}, {row.barcodes} barcode{row.barcodes === 1 ? '' : 's'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="flex size-10 flex-none items-center justify-center rounded-control text-ink-700"
          >
            <X size={20} strokeWidth={1.9} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Chip surface="light" tone={statusTone[st]} className="h-6 text-xs">
            {statusLabel[st]}
          </Chip>
          <span className="text-[13px] text-ink-500">Main Branch, reorder level {row.reorderLevel}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {balances.map((b) => (
          <div key={b.label} className="flex flex-col rounded-[14px] bg-ink-900/[0.05] px-3.5 py-3">
            <span className="text-xs text-ink-500">{b.label}</span>
            <span className="font-display text-[26px] font-bold leading-8">{b.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[13px] leading-[19px] text-ink-700">
        Available equals on hand minus reserved. These balances summarize the ledger below. Stock changes only when a
        movement is recorded.
      </p>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between pb-2">
          <h3 className="text-base font-bold leading-[22px]">Movement ledger</h3>
          <span className="text-xs text-ink-500">Latest {movements.length}</span>
        </div>
        {movements.length === 0 ? (
          <p className="border-t border-ink-900/10 py-4 text-sm text-ink-500">
            No movements in the sample data for this SKU.
          </p>
        ) : null}
        {movements.map((m) => (
          <div key={m.reference} className="flex flex-col gap-[3px] border-t border-ink-900/10 py-3">
            <div className="flex justify-between">
              <span className="text-sm font-semibold">{movementLabel[m.type]}</span>
              <span
                className={cn(
                  'text-[15px] font-bold',
                  m.qty < 0 ? 'text-signal-light-critical-fg' : 'text-signal-light-success-fg',
                )}
              >
                {m.qty > 0 ? '+' : '−'}
                {Math.abs(m.qty)}
              </span>
            </div>
            <span className="text-xs text-ink-700">
              {m.reference}, by {m.actor}
            </span>
            <div className="flex justify-between text-xs text-ink-500">
              <span>{m.when}</span>
              <span>Balance after {m.balanceAfter}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <Button className="flex-1 border-ink-900/[0.14] bg-white/70 text-ink-900">Adjust stock</Button>
          <Button className="flex-1 border-ink-900/[0.14] bg-white/70 text-ink-900">Record damage</Button>
        </div>
        <p className="text-xs leading-[18px] text-ink-500">
          Adjustments above your approval limit go to Approvals before stock changes.
        </p>
      </div>
    </Glass>
  )
}
