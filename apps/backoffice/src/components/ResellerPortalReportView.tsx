'use client'

import type {
  PortalShipmentStatus,
  ResellerPortalReport,
  ResellerReportOrderBucket,
  ResellerReportSpeedStep,
} from '@hcs/contracts'
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
const speedLabel: Record<ResellerReportSpeedStep, string> = {
  order_to_payment: 'Order → payment sent',
  payment_to_confirmed: 'Payment sent → confirmed',
  confirmed_to_sent: 'Confirmed → shipped or picked up',
  sent_to_delivered: 'Shipped → delivered',
  order_to_delivered: 'Order → delivered (total)',
}
/** "45 min", "6.5 hrs", "2.3 days" */
function duration(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${hours.toFixed(1)} hrs`
  return `${(hours / 24).toFixed(1)} days`
}

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

      {report.aging ? (
        <Glass variant="light" className="overflow-hidden">
          <ReportHeader
            title="Who owes, and for how long"
            subtitle={`Open invoice balances by days past due, as of ${report.aging.asOf} (not limited by the dates above).`}
            onExport={() =>
              downloadCsv(`hcs-portal-aging-${report.aging!.asOf}.csv`, [
                [
                  'Reseller',
                  'Customer no.',
                  'Not due',
                  '1–7 days',
                  '8–15 days',
                  '16–30 days',
                  'Over 30 days',
                  'Total',
                  'Oldest (days)',
                ],
                ...report.aging!.resellers.map((row) => [
                  row.customerName,
                  row.customerNumber ?? '',
                  peso(row.notDueMinor),
                  peso(row.days1To7Minor),
                  peso(row.days8To15Minor),
                  peso(row.days16To30Minor),
                  peso(row.over30Minor),
                  peso(row.totalMinor),
                  row.oldestDaysOverdue,
                ]),
              ])
            }
          />
          <div className="grid gap-3 border-b border-ink-900/10 p-5 sm:grid-cols-5">
            <MetricPanel label="Not due yet" value={formatPeso(report.aging.totals.notDueMinor)} />
            <MetricPanel label="1–7 days late" value={formatPeso(report.aging.totals.days1To7Minor)} />
            <MetricPanel label="8–15 days late" value={formatPeso(report.aging.totals.days8To15Minor)} />
            <MetricPanel label="16–30 days late" value={formatPeso(report.aging.totals.days16To30Minor)} />
            <MetricPanel label="Over 30 days late" value={formatPeso(report.aging.totals.over30Minor)} />
          </div>
          <ReportTable
            headings={['Reseller', 'Not due', '1–7', '8–15', '16–30', '30+', 'Total']}
            rows={report.aging.resellers.map((row) => [
              <div key="reseller">
                <strong>{row.customerName}</strong>
                <div className="text-xs text-ink-500">
                  {row.oldestDaysOverdue > 0 ? `Oldest ${row.oldestDaysOverdue} days late` : 'Nothing late'}
                </div>
              </div>,
              formatPeso(row.notDueMinor),
              formatPeso(row.days1To7Minor),
              formatPeso(row.days8To15Minor),
              formatPeso(row.days16To30Minor),
              row.over30Minor > 0 ? (
                <span key="late" className="font-semibold text-red-700">
                  {formatPeso(row.over30Minor)}
                </span>
              ) : (
                formatPeso(0)
              ),
              <strong key="total">{formatPeso(row.totalMinor)}</strong>,
            ])}
          />
        </Glass>
      ) : null}

      {report.conversion ? (
        <Glass variant="light" className="overflow-hidden">
          <ReportHeader
            title="Paid vs expired per reseller"
            subtitle="Orders placed in the range: paid and confirmed, expired after 4 hours, rejected, or still waiting."
            onExport={() =>
              downloadCsv(`hcs-portal-paid-vs-expired-${range}.csv`, [
                ['Reseller', 'Placed', 'Paid', 'Expired', 'Rejected', 'Still open', 'Paid %'],
                ...report.conversion!.map((row) => [
                  row.customerName,
                  row.placed,
                  row.paid,
                  row.expired,
                  row.rejected,
                  row.open,
                  row.paidPercent ?? '',
                ]),
              ])
            }
          />
          <ReportTable
            headings={['Reseller', 'Placed', 'Paid', 'Expired', 'Rejected', 'Paid %']}
            rows={report.conversion.map((row) => [
              <div key="reseller">
                <strong>{row.customerName}</strong>
                {row.open > 0 ? (
                  <div className="text-xs text-ink-500">{row.open} still waiting for payment or review</div>
                ) : null}
              </div>,
              row.placed,
              row.paid,
              row.expired > 0 ? (
                <span key="expired" className="font-semibold text-amber-800">
                  {row.expired}
                </span>
              ) : (
                0
              ),
              row.rejected,
              row.paidPercent === null ? '—' : `${row.paidPercent}%`,
            ])}
          />
        </Glass>
      ) : null}

      {report.speed ? (
        <Glass variant="light" className="overflow-hidden">
          <ReportHeader
            title="How fast orders move"
            subtitle="Median time for each step (half of the orders were faster), for orders placed in the range."
            onExport={() =>
              downloadCsv(`hcs-portal-speed-${range}.csv`, [
                ['Step', 'Orders', 'Median hours', 'Average hours'],
                ...report.speed!.map((row) => [
                  speedLabel[row.step],
                  row.orders,
                  row.medianHours ?? '',
                  row.averageHours ?? '',
                ]),
              ])
            }
          />
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
            {report.speed.map((row) => (
              <MetricPanel
                key={row.step}
                label={`${speedLabel[row.step]} · ${row.orders} ${row.orders === 1 ? 'order' : 'orders'}`}
                value={duration(row.medianHours)}
              />
            ))}
          </div>
        </Glass>
      ) : null}

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
