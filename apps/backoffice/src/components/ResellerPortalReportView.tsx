'use client'

import type { PortalShipmentStatus, ResellerPortalReport, ResellerReportOrderBucket } from '@hcs/contracts'
import { Glass, formatPeso } from '@hcs/ui'

import { courierLabel } from './LogisticsBoard'
import { downloadCsv, formatReportDate, MetricPanel, quantity, ReportHeader, ReportTable } from './report-parts'

const bucketLabel: Record<ResellerReportOrderBucket, string> = {
  awaiting_payment: 'Awaiting payment',
  for_confirmation: 'For confirmation',
  confirmed: 'Confirmed',
  expired: 'Expired (not paid in 4 hours)',
  rejected: 'Rejected or cancelled',
}
const shipmentLabel: Record<PortalShipmentStatus, string> = {
  to_pack: 'To pack',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered / picked up',
}
const methodLabel = { gcash: 'GCash', bank_transfer: 'Bank transfer' } as const
const courierName = (courier: keyof typeof courierLabel | 'none' | null) =>
  courier === null || courier === 'none' ? 'No courier' : courierLabel[courier]
const peso = (minor: number) => minor / 100

/** Reseller portal report: orders, sales per reseller, top products, verified payments, and logistics. */
export function ResellerPortalReportView({ report }: { report: ResellerPortalReport }) {
  const { summary } = report
  const range = `${report.from}-${report.to}`
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricPanel label="Portal orders" value={summary.orderCount.toLocaleString('en-PH')} />
        <MetricPanel label="Confirmed sales" value={formatPeso(summary.salesMinor)} />
        <MetricPanel label="Verified payments" value={formatPeso(summary.verifiedPaymentsMinor)} />
        <MetricPanel label="Outstanding balance" value={formatPeso(summary.outstandingMinor)} />
        <MetricPanel label="Shipments" value={`${summary.deliveredCount} of ${summary.shipmentCount} done`} />
      </div>
      <p className="text-xs text-ink-500">
        Uses the date range only (channel and location do not apply). Orders and products count by the date the reseller
        ordered, payments by the date the proof was sent, and logistics by the date the order was confirmed.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Glass variant="light" className="overflow-hidden">
          <ReportHeader
            title="Orders by status"
            subtitle="Every portal order placed in the range."
            onExport={() =>
              downloadCsv(`hcs-portal-orders-by-status-${range}.csv`, [
                ['Status', 'Orders', 'Order total'],
                ...report.byStatus.map((row) => [bucketLabel[row.status], row.orderCount, peso(row.totalMinor)]),
              ])
            }
          />
          <ReportTable
            compact
            headings={['Status', 'Orders', 'Order total']}
            rows={report.byStatus.map((row) => [bucketLabel[row.status], row.orderCount, formatPeso(row.totalMinor)])}
          />
        </Glass>
        <Glass variant="light" className="overflow-hidden">
          <ReportHeader
            title="Logistics"
            subtitle="Orders that reached Logistics, delivery and pickup."
            onExport={() =>
              downloadCsv(`hcs-portal-logistics-${range}.csv`, [
                ['Status', 'Delivery', 'Pickup'],
                ...report.logistics.byStatus.map((row) => [
                  shipmentLabel[row.status],
                  row.deliveryCount,
                  row.pickupCount,
                ]),
              ])
            }
          />
          <ReportTable
            compact
            headings={['Status', 'Delivery', 'Pickup']}
            rows={report.logistics.byStatus.map((row) => [
              shipmentLabel[row.status],
              row.deliveryCount,
              row.status === 'shipped' ? '—' : row.pickupCount,
            ])}
          />
        </Glass>
      </div>

      <Glass variant="light" className="overflow-hidden">
        <ReportHeader
          title="Sales per reseller"
          subtitle="Confirmed sales, verified payments, and what is still owed."
          onExport={() =>
            downloadCsv(`hcs-portal-sales-per-reseller-${range}.csv`, [
              ['Reseller', 'Customer no.', 'Orders', 'Confirmed', 'Sales', 'Paid', 'Outstanding'],
              ...report.byReseller.map((row) => [
                row.customerName,
                row.customerNumber ?? '',
                row.orderCount,
                row.confirmedCount,
                peso(row.salesMinor),
                peso(row.paidMinor),
                peso(row.outstandingMinor),
              ]),
            ])
          }
        />
        <ReportTable
          headings={['Reseller', 'Orders', 'Confirmed', 'Sales', 'Paid', 'Outstanding']}
          rows={report.byReseller.map((row) => [
            <div key="reseller">
              <strong>{row.customerName}</strong>
              {row.customerNumber ? <div className="text-xs text-ink-500">{row.customerNumber}</div> : null}
            </div>,
            row.orderCount,
            row.confirmedCount,
            formatPeso(row.salesMinor),
            formatPeso(row.paidMinor),
            row.outstandingMinor > 0 ? (
              <span key="owed" className="inline-block bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                {formatPeso(row.outstandingMinor)}
              </span>
            ) : (
              formatPeso(0)
            ),
          ])}
        />
      </Glass>

      <Glass variant="light" className="overflow-hidden">
        <ReportHeader
          title="Top products"
          subtitle="Best sellers from confirmed portal orders (top 20)."
          onExport={() =>
            downloadCsv(`hcs-portal-top-products-${range}.csv`, [
              ['Product', 'Variant', 'SKU', 'Quantity', 'Orders', 'Sales'],
              ...report.topProducts.map((row) => [
                row.productName,
                row.variantName,
                row.sku,
                quantity(row.quantityMilli),
                row.orderCount,
                peso(row.salesMinor),
              ]),
            ])
          }
        />
        <ReportTable
          headings={['Item', 'Quantity', 'Orders', 'Sales']}
          rows={report.topProducts.map((row) => [
            <div key="item">
              <strong>{row.productName}</strong>
              <div className="text-xs text-ink-500">
                {row.variantName} · {row.sku}
              </div>
            </div>,
            quantity(row.quantityMilli),
            row.orderCount,
            formatPeso(row.salesMinor),
          ])}
        />
      </Glass>

      <Glass variant="light" className="overflow-hidden">
        <ReportHeader
          title="Payments received"
          subtitle="Accepted payment proofs, GCash and bank transfer, with each reference."
          onExport={() =>
            downloadCsv(`hcs-portal-payments-${range}.csv`, [
              ['Sent', 'Verified', 'Order', 'Reseller', 'Method', 'Reference', 'Amount'],
              ...report.payments.receipts.map((row) => [
                formatReportDate(row.sentAt),
                formatReportDate(row.verifiedAt),
                row.orderNumber,
                row.customerName,
                methodLabel[row.method],
                row.reference,
                peso(row.amountMinor),
              ]),
            ])
          }
        />
        <div className="grid gap-3 border-b border-ink-900/10 p-5 sm:grid-cols-2">
          {report.payments.byMethod.map((row) => (
            <MetricPanel
              key={row.method}
              label={`${methodLabel[row.method]} · ${row.count} ${row.count === 1 ? 'payment' : 'payments'}`}
              value={formatPeso(row.amountMinor)}
            />
          ))}
        </div>
        <ReportTable
          headings={['Order', 'Method', 'Reference', 'Sent', 'Amount']}
          rows={report.payments.receipts.map((row) => [
            <div key="order">
              <strong>{row.orderNumber}</strong>
              <div className="text-xs text-ink-500">{row.customerName}</div>
            </div>,
            methodLabel[row.method],
            <span key="reference" className="font-mono text-xs">
              {row.reference}
            </span>,
            formatReportDate(row.sentAt),
            formatPeso(row.amountMinor),
          ])}
        />
      </Glass>

      <Glass variant="light" className="overflow-hidden">
        <ReportHeader
          title="Shipments per courier"
          subtitle="Delivery orders that were shipped, with tracking numbers."
          onExport={() =>
            downloadCsv(`hcs-portal-shipments-${range}.csv`, [
              ['Order', 'Reseller', 'Method', 'Status', 'Courier', 'Tracking number', 'Shipped', 'Delivered'],
              ...report.logistics.shipments.map((row) => [
                row.orderNumber,
                row.customerName,
                row.method === 'pickup' ? 'Pickup' : 'Delivery',
                shipmentLabel[row.status],
                row.method === 'pickup' ? '' : courierName(row.courier),
                row.trackingNumber ?? '',
                row.shippedAt ? formatReportDate(row.shippedAt) : '',
                row.deliveredAt ? formatReportDate(row.deliveredAt) : '',
              ]),
            ])
          }
        />
        <div className="flex flex-wrap gap-2 border-b border-ink-900/10 p-5">
          {report.logistics.byCourier.length ? (
            report.logistics.byCourier.map((row) => (
              <span
                key={row.courier}
                className="border border-ink-900/15 bg-white px-3 py-1 text-sm font-medium text-ink-800"
              >
                {courierName(row.courier)}: {row.shipmentCount} shipped · {row.deliveredCount} delivered
              </span>
            ))
          ) : (
            <span className="text-sm text-ink-500">No shipped deliveries in this range.</span>
          )}
        </div>
        <ReportTable
          headings={['Order', 'Status', 'Courier', 'Tracking number', 'Shipped']}
          rows={report.logistics.shipments.map((row) => [
            <div key="order">
              <strong>{row.orderNumber}</strong>
              <div className="text-xs text-ink-500">
                {row.customerName} · {row.method === 'pickup' ? 'Pickup' : 'Delivery'}
              </div>
            </div>,
            shipmentLabel[row.status],
            row.method === 'pickup' ? '—' : courierName(row.courier),
            row.trackingNumber ? (
              <span key="tracking" className="font-mono text-xs">
                {row.trackingNumber}
              </span>
            ) : (
              '—'
            ),
            row.shippedAt ? formatReportDate(row.shippedAt) : '—',
          ])}
        />
      </Glass>
    </>
  )
}
