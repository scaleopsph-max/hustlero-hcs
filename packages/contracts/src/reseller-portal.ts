import { z } from 'zod'

import { paymentProofSchema } from './files'

const uuid = z.uuid()
const minor = z.number().int().nonnegative()
const milli = z.number().int().nonnegative()
const timestamp = z.string().min(1)

export const resellerStockStatusSchema = z.enum(['in_stock', 'low_stock', 'out_of_stock'])
export const resellerFulfillmentMethodSchema = z.enum(['delivery', 'pickup'])
export const resellerPaymentPreferenceSchema = z.enum(['gcash', 'bank_transfer'])
export const resellerReviewReasonSchema = z.enum([
  'manual_review',
  'credit_settings_missing',
  'credit_review',
  'stock_insufficient',
  'credit_limit',
  /** Pay first: stock is held for four hours until the reseller sends a payment proof. */
  'awaiting_payment',
  /** A payment proof arrived; the team verifies it and confirms the order. */
  'payment_review',
])
export const resellerOrderStatusSchema = z.enum([
  'submitted',
  'confirmed',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
])

/** A GCash or bank account resellers pay into; the QR link is signed by the API. */
export const resellerPaymentAccountSchema = z.object({
  id: uuid,
  method: resellerPaymentPreferenceSchema,
  providerName: z.string().min(1),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  isActive: z.boolean(),
  qrUrl: z.string().nullable(),
})

// Public application form -------------------------------------------------

/** Accent colors a business can choose for its reseller portal. */
export const resellerAccentColorSchema = z.enum(['gold', 'emerald', 'sky', 'rose', 'violet', 'orange'])
/** How a business's reseller portal looks: its name, accent color, and logo (a signed link). */
export const resellerBrandingSchema = z.object({
  portalName: z.string().min(1),
  /** The business's own name; the portal name falls back to it. */
  businessName: z.string().min(1).optional(),
  accentColor: resellerAccentColorSchema,
  logoUrl: z.string().min(1).nullable(),
})
export const resellerBrandingSaveRequestSchema = z.strictObject({
  portalName: z.string().trim().min(2).max(60).nullable(),
  accentColor: resellerAccentColorSchema,
  removeLogo: z.boolean().optional(),
})

export const resellerPortalPublicSchema = z.object({
  branding: resellerBrandingSchema.optional(),
  tenantSlug: z.string().min(1),
  businessName: z.string().min(1),
  configured: z.boolean(),
  applicationsOpen: z.boolean(),
})

export const resellerApplicationRequestSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(160),
  businessName: z.string().trim().min(2).max(160).optional(),
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^0-9+]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{7,15}$/)),
  city: z.string().trim().min(2).max(120).optional(),
  message: z.string().trim().max(1000).optional(),
})

export const resellerApplicationResponseSchema = z.object({ status: z.literal('received') })

// Reseller session, catalog, and orders -----------------------------------

export const resellerPortalSessionSchema = z.object({
  accounts: z.array(
    z.object({
      tenantId: uuid,
      tenantSlug: z.string().min(1),
      businessName: z.string().min(1),
      accountId: uuid,
      customerId: uuid,
      customerName: z.string().min(1),
      customerNumber: z.string().min(1),
      email: z.string().min(1),
    }),
  ),
})

export const resellerCatalogItemSchema = z.object({
  variantId: uuid,
  productId: uuid,
  productName: z.string().min(1),
  variantName: z.string().min(1),
  sku: z.string().min(1),
  categoryName: z.string().nullable(),
  unitPriceMinor: minor,
  srpMinor: minor,
  pricingGroupId: uuid,
  pricingGroupName: z.string().min(1),
  thresholdMilli: milli,
  stockStatus: resellerStockStatusSchema,
  /** Signed API-relative paths of the primary product photo. */
  imageUrl: z.string().nullable().optional(),
  thumbUrl: z.string().nullable().optional(),
})

export const resellerPortalCatalogSchema = z.object({
  branding: resellerBrandingSchema.optional(),
  account: z.object({
    accountId: uuid,
    customerId: uuid,
    customerName: z.string().min(1),
    businessName: z.string().min(1),
    priceListName: z.string().min(1),
    pricingType: z.enum(['wholesale', 'dealer']),
    paymentTerm: z.enum(['prepaid', 'cod', 'net_7', 'net_15', 'net_30']).nullable(),
    creditLimitMinor: minor.nullable(),
    availableCreditMinor: minor.nullable(),
    pointsBalance: z.number().int().nonnegative(),
  }),
  fulfillmentLocationName: z.string().min(1),
  /** Where to send payment. Optional so older API versions still parse. */
  payment: z
    .object({
      instructions: z.string().nullable(),
      holdHours: z.number().int().positive(),
      accounts: z.array(resellerPaymentAccountSchema).optional(),
    })
    .optional(),
  items: z.array(resellerCatalogItemSchema),
})

export const portalShipmentStatusSchema = z.enum(['to_pack', 'packed', 'shipped', 'delivered'])
export const portalCourierSchema = z.enum(['jnt', 'lalamove', 'other'])

/** Where a confirmed order is in packing and delivery, as the reseller sees it. */
export const resellerShipmentSchema = z.object({
  status: portalShipmentStatusSchema,
  courier: portalCourierSchema.nullable(),
  trackingNumber: z.string().nullable(),
  packedAt: timestamp.nullable(),
  shippedAt: timestamp.nullable(),
  deliveredAt: timestamp.nullable(),
})

/** A shipment in the Back Office Logistics list. */
export const portalShipmentSchema = z.object({
  salesOrderId: uuid,
  orderNumber: z.string().min(1),
  customerName: z.string().min(1),
  customerPhone: z.string().nullable(),
  method: z.enum(['delivery', 'pickup']),
  status: portalShipmentStatusSchema,
  courier: portalCourierSchema.nullable(),
  trackingNumber: z.string().nullable(),
  note: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  locationName: z.string().min(1),
  totalMinor: minor,
  confirmedAt: timestamp.nullable(),
  packedAt: timestamp.nullable(),
  shippedAt: timestamp.nullable(),
  deliveredAt: timestamp.nullable(),
  /** Set once shipping (or pickup) completed the sale. */
  invoiceId: uuid.nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  /** What the reseller still owes on the invoice; null before the sale is completed. */
  balanceMinor: z.number().int().nullable().optional(),
  lines: z.array(
    z.object({
      productName: z.string().min(1),
      variantName: z.string().min(1),
      sku: z.string().min(1),
      quantityMilli: milli,
    }),
  ),
})

export const resellerOrderSchema = z.object({
  id: uuid,
  orderNumber: z.string().min(1),
  status: resellerOrderStatusSchema,
  source: z.enum(['backoffice', 'reseller_portal']),
  reviewReason: resellerReviewReasonSchema.nullable(),
  reviewDecisionReason: z.string().nullable(),
  fulfillmentMethod: resellerFulfillmentMethodSchema.nullable(),
  deliveryAddress: z.string().nullable(),
  paymentPreference: resellerPaymentPreferenceSchema.nullable(),
  notes: z.string().nullable(),
  customerId: uuid,
  customerName: z.string().min(1),
  customerNumber: z.string().min(1),
  locationName: z.string().min(1),
  totalMinor: minor,
  createdAt: timestamp,
  confirmedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  /** When an order awaiting payment is cancelled if no proof arrives. */
  paymentDueAt: timestamp.nullable().optional(),
  lines: z.array(
    z.object({
      id: uuid,
      variantId: uuid,
      productName: z.string().min(1),
      variantName: z.string().min(1),
      sku: z.string().min(1),
      orderedQuantityMilli: milli,
      fulfilledQuantityMilli: milli,
      cancelledQuantityMilli: milli,
      unitPriceMinor: minor,
      lineTotalMinor: minor,
      stockStatus: resellerStockStatusSchema.nullable(),
    }),
  ),
  invoices: z.array(z.object({ id: uuid, invoiceNumber: z.string().min(1), totalMinor: minor, issuedAt: timestamp })),
  paymentProofs: z.array(paymentProofSchema).optional(),
  shipment: resellerShipmentSchema.nullable().optional(),
  /** Returns (credit notes) recorded on this order's invoices. */
  returns: z
    .array(
      z.object({
        id: uuid,
        invoiceNumber: z.string().min(1),
        amountMinor: minor,
        /** Part of the return kept as credit because the invoice was already paid. */
        creditMinor: minor,
        reason: z.string().min(1),
        recordedAt: timestamp,
        lines: z.array(
          z.object({
            productName: z.string().min(1),
            variantName: z.string(),
            quantityMilli: milli,
            returnToStock: z.boolean(),
          }),
        ),
      }),
    )
    .optional(),
})

export const resellerOrdersSchema = z.object({ orders: z.array(resellerOrderSchema) })

export const resellerOrderSubmitRequestSchema = z
  .strictObject({
    lines: z
      .array(z.strictObject({ variantId: uuid, quantityMilli: z.number().int().min(1).max(999_999_999_999) }))
      .min(1)
      .max(100)
      .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, {
        message: 'Each item may appear only once.',
      }),
    fulfillmentMethod: resellerFulfillmentMethodSchema,
    deliveryAddress: z.string().trim().min(5).max(500).optional(),
    paymentPreference: resellerPaymentPreferenceSchema,
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((order) => order.fulfillmentMethod === 'pickup' || order.deliveryAddress !== undefined, {
    message: 'A delivery address is required.',
    path: ['deliveryAddress'],
  })

export const resellerOrderSubmitResponseSchema = z.object({
  salesOrderId: uuid,
  orderNumber: z.string().min(1),
  status: z.enum(['confirmed', 'submitted']),
  reviewReason: resellerReviewReasonSchema.nullable(),
  paymentDueAt: timestamp.nullable().optional(),
  lineCount: z.number().int().positive(),
  totalMinor: minor,
})

// Back Office administration ---------------------------------------------

export const resellerPortalSettingsRequestSchema = z.strictObject({
  fulfillmentLocationId: uuid,
  defaultPriceListId: uuid.optional(),
  applicationsOpen: z.boolean(),
  /** Ignored: portal orders are always pay first. Kept for older clients. */
  autoConfirm: z.boolean().optional(),
  /** GCash or bank details shown to resellers; null clears them. */
  paymentInstructions: z.string().trim().min(2).max(1000).nullable().optional(),
})

export const resellerPortalSettingsResponseSchema = z.object({
  status: z.literal('saved'),
  fulfillmentLocationId: uuid,
  defaultPriceListId: uuid.nullable(),
  applicationsOpen: z.boolean(),
  autoConfirm: z.boolean(),
  paymentInstructions: z.string().nullable().optional(),
})

export const resellerPaymentAccountSaveRequestSchema = z.strictObject({
  id: uuid.optional(),
  method: resellerPaymentPreferenceSchema,
  providerName: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(4).max(40),
  isActive: z.boolean().optional(),
})

export const resellerPaymentAccountSaveResponseSchema = z.object({
  status: z.literal('saved'),
  accountId: uuid,
  isActive: z.boolean(),
})

export const paymentQrUploadResponseSchema = z.object({
  status: z.literal('uploaded'),
  accountId: uuid,
  fileId: uuid,
})

export const portalShipmentUpdateRequestSchema = z
  .strictObject({
    status: z.enum(['packed', 'shipped', 'delivered']),
    courier: portalCourierSchema.optional(),
    trackingNumber: z.string().trim().min(3).max(80).optional(),
    note: z.string().trim().min(2).max(500).optional(),
  })
  .refine((update) => update.status !== 'shipped' || update.courier !== undefined, {
    message: 'Choose the courier.',
    path: ['courier'],
  })

export const portalShipmentUpdateResponseSchema = z.object({
  salesOrderId: uuid,
  status: portalShipmentStatusSchema,
  /** Present when this step completed the sale: stock released, invoice issued, verified payments recorded. */
  invoiceNumber: z.string().nullable().optional(),
  recordedPaymentMinor: z.number().int().nonnegative().optional(),
  /** Loyalty points the completed sale earned. */
  pointsEarned: z.number().int().nonnegative().optional(),
  balanceMinor: z.number().int().optional(),
})

export const resellerApplicationDecisionRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    customerId: uuid.optional(),
    priceListId: uuid,
    paymentTerm: z.enum(['prepaid', 'cod', 'net_7', 'net_15', 'net_30']),
    creditLimitMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    reason: z.string().trim().min(2).max(500).optional(),
  }),
  z.strictObject({ decision: z.literal('reject'), reason: z.string().trim().min(2).max(500) }),
])

export const resellerApplicationDecisionResponseSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  applicationId: uuid,
  accountId: uuid.optional(),
  customerId: uuid.optional(),
})

export const resellerAccountInviteRequestSchema = z.strictObject({
  customerId: uuid,
  email: z.email().max(254),
  priceListId: uuid,
})

export const resellerAccountInviteResponseSchema = z.object({
  status: z.literal('invited'),
  accountId: uuid,
  customerId: uuid,
})

export const resellerAccountStatusRequestSchema = z.strictObject({ status: z.enum(['active', 'suspended']) })
export const resellerAccountStatusResponseSchema = z.object({
  accountId: uuid,
  status: z.enum(['invited', 'active', 'suspended']),
})

export const resellerOrderReviewRequestSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    reason: z.string().trim().min(2).max(500).optional(),
    creditOverrideId: uuid.optional(),
  }),
  z.strictObject({ decision: z.literal('reject'), reason: z.string().trim().min(2).max(500) }),
])

export const resellerOrderReviewResponseSchema = z.object({
  salesOrderId: uuid,
  status: z.enum(['confirmed', 'cancelled']),
  totalMinor: minor.optional(),
})

export const resellerPortalAdminSchema = z.object({
  /** False for members who handle orders only (managers): settings, accounts, and applications are read-only. */
  canManage: z.boolean().optional(),
  branding: resellerBrandingSchema.optional(),
  tenantSlug: z.string().min(1),
  settings: z
    .object({
      fulfillmentLocationId: uuid,
      defaultPriceListId: uuid.nullable(),
      applicationsOpen: z.boolean(),
      autoConfirm: z.boolean(),
      paymentInstructions: z.string().nullable().optional(),
      /** What one loyalty point is worth when a reseller pays with points; null = paying with points is off. */
      pointsRedeemValueMinor: z.number().int().positive().nullable().optional(),
      pointsMinRedeem: z.number().int().positive().optional(),
      updatedAt: timestamp,
    })
    .nullable(),
  locations: z.array(z.object({ id: uuid, code: z.string().min(1), name: z.string().min(1) })),
  priceLists: z.array(
    z.object({
      id: uuid,
      name: z.string().min(1),
      pricingType: z.enum(['wholesale', 'dealer']),
      isDefault: z.boolean(),
    }),
  ),
  resellerCustomers: z.array(
    z.object({
      id: uuid,
      customerNumber: z.string().min(1),
      fullName: z.string().min(1),
      email: z.string().nullable(),
    }),
  ),
  applications: z.array(
    z.object({
      id: uuid,
      fullName: z.string().min(1),
      businessName: z.string().nullable(),
      email: z.string().min(1),
      phone: z.string().min(1),
      city: z.string().nullable(),
      message: z.string().nullable(),
      status: z.enum(['pending', 'approved', 'rejected']),
      decisionReason: z.string().nullable(),
      reviewedAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
  accounts: z.array(
    z.object({
      id: uuid,
      customerId: uuid,
      customerName: z.string().min(1),
      customerNumber: z.string().min(1),
      email: z.string().min(1),
      status: z.enum(['invited', 'active', 'suspended']),
      priceListId: uuid,
      priceListName: z.string().min(1),
      activatedAt: timestamp.nullable(),
      createdAt: timestamp,
    }),
  ),
  reviewQueue: z.array(resellerOrderSchema),
  paymentAccounts: z.array(resellerPaymentAccountSchema).optional(),
  shipments: z.array(portalShipmentSchema).optional(),
  awaitingPayment: z
    .array(
      z.object({
        id: uuid,
        orderNumber: z.string().min(1),
        customerName: z.string().min(1),
        totalMinor: minor,
        createdAt: timestamp,
        paymentDueAt: timestamp,
      }),
    )
    .optional(),
})

export type ResellerStockStatus = z.infer<typeof resellerStockStatusSchema>
export type ResellerReviewReason = z.infer<typeof resellerReviewReasonSchema>
export type ResellerPortalPublic = z.infer<typeof resellerPortalPublicSchema>
export type ResellerApplicationRequest = z.infer<typeof resellerApplicationRequestSchema>
export type ResellerApplicationResponse = z.infer<typeof resellerApplicationResponseSchema>
export type ResellerPortalSession = z.infer<typeof resellerPortalSessionSchema>
export type ResellerCatalogItem = z.infer<typeof resellerCatalogItemSchema>
export type ResellerPortalCatalog = z.infer<typeof resellerPortalCatalogSchema>
export type ResellerOrder = z.infer<typeof resellerOrderSchema>
export type ResellerOrders = z.infer<typeof resellerOrdersSchema>
export type ResellerOrderSubmitRequest = z.infer<typeof resellerOrderSubmitRequestSchema>
export type ResellerOrderSubmitResponse = z.infer<typeof resellerOrderSubmitResponseSchema>
export type ResellerPortalSettingsRequest = z.infer<typeof resellerPortalSettingsRequestSchema>
export type ResellerPortalSettingsResponse = z.infer<typeof resellerPortalSettingsResponseSchema>
export type ResellerApplicationDecisionRequest = z.infer<typeof resellerApplicationDecisionRequestSchema>
export type ResellerApplicationDecisionResponse = z.infer<typeof resellerApplicationDecisionResponseSchema>
export type ResellerAccountInviteRequest = z.infer<typeof resellerAccountInviteRequestSchema>
export type ResellerAccountInviteResponse = z.infer<typeof resellerAccountInviteResponseSchema>
export type ResellerAccountStatusRequest = z.infer<typeof resellerAccountStatusRequestSchema>
export type ResellerAccountStatusResponse = z.infer<typeof resellerAccountStatusResponseSchema>
export type ResellerOrderReviewRequest = z.infer<typeof resellerOrderReviewRequestSchema>
export type ResellerOrderReviewResponse = z.infer<typeof resellerOrderReviewResponseSchema>
export type ResellerPortalAdmin = z.infer<typeof resellerPortalAdminSchema>
export type ResellerPaymentAccount = z.infer<typeof resellerPaymentAccountSchema>
export type ResellerPaymentAccountSaveRequest = z.infer<typeof resellerPaymentAccountSaveRequestSchema>
export type ResellerPaymentAccountSaveResponse = z.infer<typeof resellerPaymentAccountSaveResponseSchema>
export type PaymentQrUploadResponse = z.infer<typeof paymentQrUploadResponseSchema>
export type PortalShipment = z.infer<typeof portalShipmentSchema>
export type PortalShipmentStatus = z.infer<typeof portalShipmentStatusSchema>
export type PortalCourier = z.infer<typeof portalCourierSchema>
export type ResellerShipment = z.infer<typeof resellerShipmentSchema>
export type PortalShipmentUpdateRequest = z.infer<typeof portalShipmentUpdateRequestSchema>
export type PortalShipmentUpdateResponse = z.infer<typeof portalShipmentUpdateResponseSchema>

/** A cart item the business cannot fill right now; returned with RESELLER_ITEM_OUT_OF_STOCK / RESELLER_STOCK_SHORT. */
export const resellerStockIssueSchema = z.object({
  variantId: uuid,
  productName: z.string().min(1),
  variantName: z.string(),
  requestedMilli: milli,
  availableMilli: milli,
})
export const resellerStockIssuesSchema = z.object({ stockIssues: z.array(resellerStockIssueSchema) })

export const resellerNotificationKindSchema = z.enum([
  'order_confirmed',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'picked_up',
  'payment_verified',
  'payment_rejected',
  'order_expired',
  'order_rejected',
  'return_recorded',
  'payment_due_soon',
  'payment_overdue',
  'payment_window_closing',
])
export const resellerNotificationSchema = z.object({
  id: uuid,
  kind: resellerNotificationKindSchema,
  title: z.string().min(1),
  message: z.string().min(1),
  salesOrderId: uuid.nullable(),
  createdAt: timestamp,
  readAt: timestamp.nullable(),
})
export const resellerNotificationsSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  items: z.array(resellerNotificationSchema),
})
export const resellerNotificationReadRequestSchema = z.strictObject({ notificationId: uuid.optional() })
export const resellerNotificationReadResponseSchema = z.object({ unreadCount: z.number().int().nonnegative() })

export type ResellerStockIssue = z.infer<typeof resellerStockIssueSchema>
export type ResellerNotificationKind = z.infer<typeof resellerNotificationKindSchema>
export type ResellerNotification = z.infer<typeof resellerNotificationSchema>
export type ResellerNotifications = z.infer<typeof resellerNotificationsSchema>
export type ResellerNotificationReadRequest = z.infer<typeof resellerNotificationReadRequestSchema>
export type ResellerNotificationReadResponse = z.infer<typeof resellerNotificationReadResponseSchema>

/** Whether the portal is in the plan and turned on, and what this member may do about it. */
export const resellerPortalAvailabilitySchema = z.object({
  entitled: z.boolean(),
  enabled: z.boolean(),
  advancedWholesaleEnabled: z.boolean(),
  canToggle: z.boolean(),
  canManage: z.boolean(),
  canHandleOrders: z.boolean(),
})
export const resellerPortalEnableRequestSchema = z.strictObject({ enabled: z.boolean() })
export type ResellerPortalAvailability = z.infer<typeof resellerPortalAvailabilitySchema>
export type ResellerPortalEnableRequest = z.infer<typeof resellerPortalEnableRequestSchema>

/** The reseller's statement of account with this business. */
export const resellerStatementSchema = z.object({
  asOf: z.string().min(1),
  summary: z.object({
    outstandingMinor: minor,
    overdueMinor: minor,
    /** Confirmed orders not shipped yet, less verified payments. */
    notInvoicedMinor: minor,
    pendingProofsMinor: minor,
    creditAvailableMinor: minor,
  }),
  points: z
    .object({
      balance: z.number().int().nonnegative(),
      redeemValueMinor: z.number().int().positive().nullable(),
      minimumPoints: z.number().int().positive(),
    })
    .nullable()
    .optional(),
  invoices: z.array(
    z.object({
      invoiceId: uuid,
      invoiceNumber: z.string().min(1),
      salesOrderId: uuid.nullable(),
      orderNumber: z.string().nullable(),
      issuedAt: timestamp,
      dueDate: z.string().nullable(),
      totalMinor: minor,
      paidMinor: minor,
      creditedMinor: minor,
      balanceMinor: minor,
      status: z.enum(['open', 'overdue', 'paid']),
      daysOverdue: z.number().int().nonnegative(),
    }),
  ),
  notInvoiced: z.array(
    z.object({
      salesOrderId: uuid,
      orderNumber: z.string().min(1),
      confirmedAt: timestamp.nullable(),
      amountMinor: minor,
    }),
  ),
  activity: z.array(
    z.object({
      id: z.string().min(1),
      at: timestamp,
      kind: z.enum(['invoice', 'payment', 'return']),
      label: z.string().min(1),
      debitMinor: minor,
      creditMinor: minor,
    }),
  ),
})

/** Loyalty points for the reseller: the rule, balance, and recent history. */
export const resellerLoyaltySchema = z.object({
  enabled: z.boolean(),
  spendPerPointMinor: z.number().int().positive().nullable(),
  /** Peso value of one point when paying an invoice; null = paying with points is off. */
  redeemValueMinor: z.number().int().positive().nullable().optional(),
  minimumPoints: z.number().int().positive().nullable().optional(),
  balancePoints: z.number().int().nonnegative(),
  lifetimeEarnedPoints: z.number().int().nonnegative(),
  history: z.array(
    z.object({
      id: uuid,
      type: z.enum(['sale_earn', 'refund_reversal', 'redemption']),
      points: z.number().int(),
      balanceAfter: z.number().int().nonnegative(),
      occurredAt: timestamp,
      invoiceNumber: z.string().nullable(),
      orderNumber: z.string().nullable(),
      receiptNumber: z.string().nullable(),
    }),
  ),
})

export type ResellerStatement = z.infer<typeof resellerStatementSchema>
export type ResellerLoyalty = z.infer<typeof resellerLoyaltySchema>

export const resellerCreditApplyRequestSchema = z.strictObject({
  invoiceId: uuid,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export const resellerCreditApplyResponseSchema = z.object({
  invoiceId: uuid,
  amountMinor: minor,
  balanceMinor: minor,
  applications: z.number().int().nonnegative(),
})
export const resellerPointsRedeemRequestSchema = z.strictObject({
  invoiceId: uuid,
  points: z.number().int().positive().max(1_000_000_000),
})
export const resellerPointsRedeemResponseSchema = z.object({
  invoiceId: uuid,
  paymentId: uuid,
  points: z.number().int().positive(),
  amountMinor: minor,
  balanceMinor: minor,
  pointsLeft: z.number().int().nonnegative(),
})
export const resellerPointsSettingsRequestSchema = z.strictObject({
  redeemValueMinor: z.number().int().positive().max(10_000_000).nullable(),
  minimumPoints: z.number().int().min(1).max(1_000_000),
})
export const resellerPointsSettingsResponseSchema = z.object({
  redeemValueMinor: z.number().int().positive().nullable(),
  minimumPoints: z.number().int().positive(),
})

export type ResellerCreditApplyRequest = z.infer<typeof resellerCreditApplyRequestSchema>
export type ResellerCreditApplyResponse = z.infer<typeof resellerCreditApplyResponseSchema>
export type ResellerPointsRedeemRequest = z.infer<typeof resellerPointsRedeemRequestSchema>
export type ResellerPointsRedeemResponse = z.infer<typeof resellerPointsRedeemResponseSchema>
export type ResellerPointsSettingsRequest = z.infer<typeof resellerPointsSettingsRequestSchema>

export type ResellerAccentColor = z.infer<typeof resellerAccentColorSchema>
export type ResellerBranding = z.infer<typeof resellerBrandingSchema>
export type ResellerBrandingSaveRequest = z.infer<typeof resellerBrandingSaveRequestSchema>
