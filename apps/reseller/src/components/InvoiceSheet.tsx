'use client'

import type { ResellerInvoice } from '@hcs/contracts'
import { Button, formatPeso } from '@hcs/ui'
import { Printer, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { formatQuantity } from '@/lib/cart'
import { formatDateTime } from '@/lib/labels'
import { fileUrl } from '@/lib/portal-api'

const termLabel: Record<NonNullable<ResellerInvoice['paymentTerm']>, string> = {
  prepaid: 'Paid before release',
  cod: 'Cash on delivery',
  net_7: '7 days',
  net_15: '15 days',
  net_30: '30 days',
}

const statusLabel: Record<ResellerInvoice['status'], string> = { open: 'Open', paid: 'Paid', overdue: 'Overdue' }

/** A printable invoice on white paper. Print or "Save as PDF" prints only the paper. */
export function InvoiceSheet({
  invoice,
  loading,
  error,
  onClose,
}: {
  invoice: ResellerInvoice | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const title = invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice'
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-ink-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 bg-ink-950/90 px-4 py-3">
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close invoice"
          className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/10"
        >
          <X size={18} />
        </button>
        <Button variant="primary" size="sm" disabled={!invoice} onClick={() => window.print()}>
          <Printer size={16} className="mr-2" />
          Print or save PDF
        </Button>
      </div>
      <div className="flex-1 px-3 pb-10">
        {loading ? (
          <p className="py-16 text-center text-ink-300" role="status">
            Loading invoice…
          </p>
        ) : error || !invoice ? (
          <p className="py-16 text-center text-signal-dark-critical-fg">
            {error ?? 'The invoice could not be loaded.'}
          </p>
        ) : (
          <article className="print-area mx-auto w-full max-w-2xl rounded-[18px] bg-white p-6 text-[13px] leading-5 text-neutral-900 shadow-xl sm:p-10">
            <header className="flex items-start justify-between gap-4 border-b border-neutral-200 pb-5">
              <div className="flex items-center gap-3">
                {invoice.branding?.logoUrl ? (
                  <img src={fileUrl(invoice.branding.logoUrl)} alt="" className="size-12 rounded-[12px] object-cover" />
                ) : null}
                <div>
                  <p className="text-lg font-bold">{invoice.businessName}</p>
                  <p className="text-neutral-500">{invoice.locationName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold tracking-tight">INVOICE</p>
                <p className="font-mono text-neutral-600">{invoice.invoiceNumber}</p>
              </div>
            </header>

            <section className="grid grid-cols-2 gap-4 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Billed to</p>
                <p className="font-semibold">{invoice.customerName}</p>
                <p className="text-neutral-500">{invoice.customerNumber}</p>
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 text-right">
                <dt className="text-neutral-500">Date</dt>
                <dd>{formatDateTime(invoice.issuedAt)}</dd>
                {invoice.orderNumber ? (
                  <>
                    <dt className="text-neutral-500">Order</dt>
                    <dd>{invoice.orderNumber}</dd>
                  </>
                ) : null}
                {invoice.paymentTerm ? (
                  <>
                    <dt className="text-neutral-500">Terms</dt>
                    <dd>{termLabel[invoice.paymentTerm]}</dd>
                  </>
                ) : null}
                {invoice.dueDate ? (
                  <>
                    <dt className="text-neutral-500">Due</dt>
                    <dd>{invoice.dueDate}</dd>
                  </>
                ) : null}
              </dl>
            </section>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-neutral-200 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="py-2 font-semibold">Item</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Price</th>
                  <th className="py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, index) => (
                  <tr key={`${line.sku}-${index}`} className="border-b border-neutral-100 align-top">
                    <td className="py-2 pr-2">
                      <p className="font-medium">{line.productName}</p>
                      <p className="text-neutral-500">
                        {line.variantName}
                        {line.sku ? ` · ${line.sku}` : ''}
                      </p>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatQuantity(line.quantityMilli)}</td>
                    <td className="py-2 text-right tabular-nums">{formatPeso(line.unitPriceMinor)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatPeso(line.lineTotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto mt-4 grid w-full max-w-xs grid-cols-[1fr,auto] gap-x-6 gap-y-1 tabular-nums">
              <dt className="text-neutral-500">Subtotal</dt>
              <dd className="text-right">{formatPeso(invoice.subtotalMinor)}</dd>
              {invoice.discountMinor > 0 ? (
                <>
                  <dt className="text-neutral-500">Discount</dt>
                  <dd className="text-right">−{formatPeso(invoice.discountMinor)}</dd>
                </>
              ) : null}
              {invoice.shippingFeeMinor > 0 ? (
                <>
                  <dt className="text-neutral-500">Shipping</dt>
                  <dd className="text-right">{formatPeso(invoice.shippingFeeMinor)}</dd>
                </>
              ) : null}
              {invoice.taxMinor > 0 ? (
                <>
                  <dt className="text-neutral-500">Tax</dt>
                  <dd className="text-right">{formatPeso(invoice.taxMinor)}</dd>
                </>
              ) : null}
              <dt className="border-t border-neutral-200 pt-1 font-bold">Total</dt>
              <dd className="border-t border-neutral-200 pt-1 text-right font-bold">
                {formatPeso(invoice.totalMinor)}
              </dd>
              {invoice.settlements.map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="contents text-neutral-600">
                  <dt>
                    {entry.label}
                    <span className="block text-[11px] text-neutral-400">{formatDateTime(entry.at)}</span>
                  </dt>
                  <dd className="text-right">−{formatPeso(entry.amountMinor)}</dd>
                </div>
              ))}
              <dt className="border-t border-neutral-200 pt-1 font-bold">Balance</dt>
              <dd className="border-t border-neutral-200 pt-1 text-right font-bold">
                {formatPeso(invoice.balanceMinor)}
              </dd>
            </dl>
            <p className="mt-6 text-right text-[11px] font-semibold uppercase tracking-wide">
              <span
                className={
                  invoice.status === 'paid'
                    ? 'rounded-full bg-emerald-100 px-3 py-1 text-emerald-800'
                    : invoice.status === 'overdue'
                      ? 'rounded-full bg-red-100 px-3 py-1 text-red-800'
                      : 'rounded-full bg-neutral-100 px-3 py-1 text-neutral-700'
                }
              >
                {statusLabel[invoice.status]}
              </span>
            </p>
          </article>
        )}
      </div>
    </div>
  )
}
