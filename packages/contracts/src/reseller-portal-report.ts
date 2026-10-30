import { z } from 'zod'

import {
  portalCourierSchema,
  portalShipmentStatusSchema,
  resellerFulfillmentMethodSchema,
  resellerPaymentPreferenceSchema,
} from './reseller-portal'

const uuid = z.uuid()
const minor = z.number().int().nonnegative()
const count = z.number().int().nonnegative()
const timestamp = z.string().min(1)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Where a portal order stands for reporting: pay-first holds, the review queue, confirmed, or closed. */
export const resellerReportOrderBucketSchema = z.enum([
  'awaiting_payment',
  'for_confirmation',
  'confirmed',
  'expired',
  'rejected',
])

export const resellerPortalReportFilterSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((filter) => filter.from <= filter.to, { message: 'The start date must be on or before the end date.' })

export const resellerPortalReportSchema = z.object({
  from: isoDate,
  to: isoDate,
  timezone: z.string().min(1),
  summary: z.object({
    orderCount: count,
    confirmedCount: count,
    salesMinor: minor,
    verifiedPaymentsMinor: minor,
    outstandingMinor: minor,
    shipmentCount: count,
    deliveredCount: count,
  }),
  byStatus: z.array(z.object({ status: resellerReportOrderBucketSchema, orderCount: count, totalMinor: minor })),
  byReseller: z.array(
    z.object({
      customerId: uuid,
      customerName: z.string().min(1),
      customerNumber: z.string().nullable(),
      orderCount: count,
      confirmedCount: count,
      salesMinor: minor,
      paidMinor: minor,
      outstandingMinor: minor,
    }),
  ),
  topProducts: z.array(
    z.object({
      variantId: uuid,
      productName: z.string().min(1),
      variantName: z.string(),
      sku: z.string(),
      quantityMilli: count,
      orderCount: count,
      salesMinor: minor,
    }),
  ),
  payments: z.object({
    byMethod: z.array(z.object({ method: resellerPaymentPreferenceSchema, count, amountMinor: minor })),
    receipts: z.array(
      z.object({
        id: uuid,
        orderNumber: z.string().min(1),
        customerName: z.string().min(1),
        method: resellerPaymentPreferenceSchema,
        reference: z.string().min(1),
        amountMinor: minor,
        sentAt: timestamp,
        verifiedAt: timestamp,
      }),
    ),
  }),
  logistics: z.object({
    byStatus: z.array(z.object({ status: portalShipmentStatusSchema, deliveryCount: count, pickupCount: count })),
    byCourier: z.array(
      z.object({
        courier: z.union([portalCourierSchema, z.literal('none')]),
        shipmentCount: count,
        deliveredCount: count,
      }),
    ),
    shipments: z.array(
      z.object({
        orderId: uuid,
        orderNumber: z.string().min(1),
        customerName: z.string().min(1),
        method: resellerFulfillmentMethodSchema,
        status: portalShipmentStatusSchema,
        courier: portalCourierSchema.nullable(),
        trackingNumber: z.string().nullable(),
        shippedAt: timestamp.nullable(),
        deliveredAt: timestamp.nullable(),
      }),
    ),
  }),
})

export type ResellerReportOrderBucket = z.infer<typeof resellerReportOrderBucketSchema>
export type ResellerPortalReportFilter = z.infer<typeof resellerPortalReportFilterSchema>
export type ResellerPortalReport = z.infer<typeof resellerPortalReportSchema>
