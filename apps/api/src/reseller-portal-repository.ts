import {
  resellerAccountInviteResponseSchema,
  resellerAccountStatusResponseSchema,
  resellerApplicationDecisionResponseSchema,
  resellerApplicationResponseSchema,
  resellerOrderReviewResponseSchema,
  resellerOrderSubmitResponseSchema,
  resellerOrderSchema,
  resellerPortalAdminSchema,
  resellerPortalCatalogSchema,
  resellerPortalPublicSchema,
  resellerPortalSessionSchema,
  resellerPortalSettingsResponseSchema,
  resellerPaymentAccountSchema,
  resellerPaymentAccountSaveResponseSchema,
  portalShipmentUpdateResponseSchema,
  resellerPortalReportSchema,
  resellerStockIssuesSchema,
  resellerBrandingSchema,
  type ResellerBrandingSaveRequest,
  resellerCreditApplyResponseSchema,
  resellerPointsRedeemResponseSchema,
  resellerPointsSettingsResponseSchema,
  type ResellerCreditApplyRequest,
  type ResellerCreditApplyResponse,
  type ResellerPointsRedeemRequest,
  type ResellerPointsRedeemResponse,
  type ResellerPointsSettingsRequest,
  resellerStatementSchema,
  resellerLoyaltySchema,
  type ResellerStatement,
  type ResellerLoyalty,
  resellerPortalAvailabilitySchema,
  type ResellerPortalAvailability,
  pushSubscriptionResponseSchema,
  type PushSubscriptionResponse,
  resellerNotificationsSchema,
  resellerNotificationReadResponseSchema,
  type ResellerStockIssue,
  type ResellerNotifications,
  type ResellerNotificationReadResponse,
  type ResellerPortalReport,
  type PortalShipmentUpdateRequest,
  type PortalShipmentUpdateResponse,
  type ResellerAccountInviteRequest,
  type ResellerAccountInviteResponse,
  type ResellerAccountStatusRequest,
  type ResellerAccountStatusResponse,
  type ResellerApplicationDecisionRequest,
  type ResellerApplicationDecisionResponse,
  type ResellerApplicationRequest,
  type ResellerApplicationResponse,
  type ResellerOrderReviewRequest,
  type ResellerOrderReviewResponse,
  type ResellerOrderSubmitRequest,
  type ResellerOrderSubmitResponse,
  type ResellerPaymentAccountSaveRequest,
  type ResellerPaymentAccountSaveResponse,
  type ResellerPortalSession,
  type ResellerPortalSettingsRequest,
  type ResellerPortalSettingsResponse,
} from '@hcs/contracts'
import { Client } from 'pg'
import { z } from 'zod'

import { storedPaymentProofSchema } from './files-repository'

import type { Bindings } from './env'

/** Orders as stored: payment proofs still carry storage keys until the API signs them. */
export const storedResellerOrderSchema = resellerOrderSchema.extend({
  paymentProofs: z.array(storedPaymentProofSchema).optional(),
})
export type StoredResellerOrder = z.infer<typeof storedResellerOrderSchema>
export type StoredResellerOrders = { orders: StoredResellerOrder[] }
const storedResellerOrdersSchema = z.object({ orders: z.array(storedResellerOrderSchema) })
/** Payment accounts as stored: the QR carries its storage key until the API signs it. */
export const storedPaymentAccountSchema = resellerPaymentAccountSchema
  .omit({ qrUrl: true })
  .extend({ qrStorageKey: z.string().min(1).nullable() })
export type StoredPaymentAccount = z.infer<typeof storedPaymentAccountSchema>
/** Branding as stored: the logo carries its storage key until the API signs it. */
export const storedBrandingSchema = resellerBrandingSchema
  .omit({ logoUrl: true })
  .extend({ logoStorageKey: z.string().min(1).nullable() })
export type StoredBranding = z.infer<typeof storedBrandingSchema>
const storedResellerPortalPublicSchema = resellerPortalPublicSchema.extend({
  branding: storedBrandingSchema.optional(),
})
export type StoredResellerPortalPublic = z.infer<typeof storedResellerPortalPublicSchema>
const storedResellerPortalAdminSchema = resellerPortalAdminSchema.extend({
  branding: storedBrandingSchema.optional(),
  reviewQueue: z.array(storedResellerOrderSchema),
  paymentAccounts: z.array(storedPaymentAccountSchema).optional(),
})
const storedResellerPortalCatalogSchema = resellerPortalCatalogSchema.extend({
  branding: storedBrandingSchema.optional(),
  payment: z
    .object({
      instructions: z.string().nullable(),
      holdHours: z.number().int().positive(),
      accounts: z.array(storedPaymentAccountSchema).optional(),
    })
    .optional(),
})
export type StoredResellerPortalCatalog = z.infer<typeof storedResellerPortalCatalogSchema>
export type StoredResellerPortalAdmin = z.infer<typeof storedResellerPortalAdminSchema>

/** A command's idempotency and audit context, derived by the API. */
export interface PortalCommand {
  idempotencyKey: string
  requestHash: string
  requestId: string
}

export interface ResellerPortalRepository {
  loadPublic(tenantSlug: string, bindings: Bindings): Promise<StoredResellerPortalPublic>
  submitApplication(
    tenantSlug: string,
    request: ResellerApplicationRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<ResellerApplicationResponse>
  loadSession(authUserId: string, bindings: Bindings): Promise<ResellerPortalSession>
  loadCatalog(authUserId: string, tenantId: string, bindings: Bindings): Promise<StoredResellerPortalCatalog>
  listOrders(authUserId: string, tenantId: string, bindings: Bindings): Promise<StoredResellerOrders>
  submitOrder(
    authUserId: string,
    tenantId: string,
    request: ResellerOrderSubmitRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerOrderSubmitResponse>
  loadAdmin(userId: string, tenantId: string, bindings: Bindings): Promise<StoredResellerPortalAdmin>
  saveSettings(
    userId: string,
    tenantId: string,
    request: ResellerPortalSettingsRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerPortalSettingsResponse>
  decideApplication(
    userId: string,
    tenantId: string,
    applicationId: string,
    request: ResellerApplicationDecisionRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerApplicationDecisionResponse>
  inviteAccount(
    userId: string,
    tenantId: string,
    request: ResellerAccountInviteRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerAccountInviteResponse>
  setAccountStatus(
    userId: string,
    tenantId: string,
    accountId: string,
    request: ResellerAccountStatusRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<ResellerAccountStatusResponse>
  reviewOrder(
    userId: string,
    tenantId: string,
    salesOrderId: string,
    request: ResellerOrderReviewRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerOrderReviewResponse>
  savePaymentAccount(
    userId: string,
    tenantId: string,
    request: ResellerPaymentAccountSaveRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerPaymentAccountSaveResponse>
  updateShipment(
    userId: string,
    tenantId: string,
    salesOrderId: string,
    request: PortalShipmentUpdateRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<PortalShipmentUpdateResponse>
  /** Cart items that cannot be filled right now; used after a stock refusal. */
  checkCartStock(
    authUserId: string,
    tenantId: string,
    lines: Array<{ variantId: string; quantityMilli: number }>,
    bindings: Bindings,
  ): Promise<ResellerStockIssue[]>
  loadNotifications(
    authUserId: string,
    tenantId: string,
    limit: number,
    bindings: Bindings,
  ): Promise<ResellerNotifications>
  /** Marks one notification read, or all of them when notificationId is null. */
  markNotificationsRead(
    authUserId: string,
    tenantId: string,
    notificationId: string | null,
    bindings: Bindings,
  ): Promise<ResellerNotificationReadResponse>
  /** Saves this browser's push subscription for a reseller ('reseller') or a Back Office member ('member'). */
  savePushSubscription(
    audience: 'reseller' | 'member',
    userId: string,
    tenantId: string,
    subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
    bindings: Bindings,
  ): Promise<PushSubscriptionResponse>
  removePushSubscription(
    userId: string,
    tenantId: string,
    endpoint: string,
    bindings: Bindings,
  ): Promise<PushSubscriptionResponse>
  loadAvailability(userId: string, tenantId: string, bindings: Bindings): Promise<ResellerPortalAvailability>
  /** Owner only: turns the portal on or off for the business. */
  setEnabled(
    userId: string,
    tenantId: string,
    enabled: boolean,
    requestId: string,
    bindings: Bindings,
  ): Promise<ResellerPortalAvailability>
  loadStatement(authUserId: string, tenantId: string, bindings: Bindings): Promise<ResellerStatement>
  loadLoyalty(authUserId: string, tenantId: string, bindings: Bindings): Promise<ResellerLoyalty>
  applyCredit(
    authUserId: string,
    tenantId: string,
    request: ResellerCreditApplyRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerCreditApplyResponse>
  redeemPoints(
    authUserId: string,
    tenantId: string,
    request: ResellerPointsRedeemRequest,
    command: PortalCommand,
    bindings: Bindings,
  ): Promise<ResellerPointsRedeemResponse>
  savePointsSettings(
    userId: string,
    tenantId: string,
    request: ResellerPointsSettingsRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<{ redeemValueMinor: number | null; minimumPoints: number }>
  saveBranding(
    userId: string,
    tenantId: string,
    request: ResellerBrandingSaveRequest,
    requestId: string,
    bindings: Bindings,
  ): Promise<StoredBranding>
  /** Read-only report for the Back Office Reports page; dates are in the business's time zone. */
  loadReport(
    userId: string,
    tenantId: string,
    from: string,
    to: string,
    bindings: Bindings,
  ): Promise<ResellerPortalReport>
}

function connectionString(bindings: Bindings): string {
  if (!bindings.HYPERDRIVE?.connectionString) throw new Error('HYPERDRIVE binding is not configured.')
  return bindings.HYPERDRIVE.connectionString
}

async function queryOne<T>(bindings: Bindings, text: string, values: unknown[], parse: (value: unknown) => T) {
  const client = new Client({ connectionString: connectionString(bindings) })
  try {
    await client.connect()
    const result = await client.query(text, values)
    return parse(result.rows[0]?.response)
  } finally {
    await client.end()
  }
}

export const resellerPortalPostgresRepository: ResellerPortalRepository = {
  loadPublic: (tenantSlug, bindings) =>
    queryOne(bindings, 'select app.load_reseller_portal_public($1::text) response', [tenantSlug], (value) =>
      storedResellerPortalPublicSchema.parse(value),
    ),
  submitApplication: (tenantSlug, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.submit_reseller_application($1::text, $2::jsonb, $3::text) response',
      [tenantSlug, JSON.stringify(request), requestId],
      (value) => resellerApplicationResponseSchema.parse(value),
    ),
  loadSession: (authUserId, bindings) =>
    queryOne(bindings, 'select app.load_reseller_portal_session($1::uuid) response', [authUserId], (value) =>
      resellerPortalSessionSchema.parse(value),
    ),
  loadCatalog: (authUserId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_portal_catalog($1::uuid, $2::uuid) response',
      [authUserId, tenantId],
      (value) => storedResellerPortalCatalogSchema.parse(value),
    ),
  listOrders: (authUserId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.list_reseller_portal_orders($1::uuid, $2::uuid) response',
      [authUserId, tenantId],
      (value) => storedResellerOrdersSchema.parse(value),
    ),
  submitOrder: (authUserId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.submit_reseller_portal_order($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [authUserId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerOrderSubmitResponseSchema.parse(value),
    ),
  loadAdmin: (userId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_portal_admin($1::uuid, $2::uuid) response',
      [userId, tenantId],
      (value) => storedResellerPortalAdminSchema.parse(value),
    ),
  saveSettings: (userId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.save_reseller_portal_settings($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [userId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerPortalSettingsResponseSchema.parse(value),
    ),
  decideApplication: (userId, tenantId, applicationId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.decide_reseller_application($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
      [
        userId,
        tenantId,
        applicationId,
        JSON.stringify(request),
        command.idempotencyKey,
        command.requestHash,
        command.requestId,
      ],
      (value) => resellerApplicationDecisionResponseSchema.parse(value),
    ),
  inviteAccount: (userId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.invite_reseller_account($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [userId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerAccountInviteResponseSchema.parse(value),
    ),
  setAccountStatus: (userId, tenantId, accountId, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.set_reseller_account_status($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text) response',
      [userId, tenantId, accountId, request.status, requestId],
      (value) => resellerAccountStatusResponseSchema.parse(value),
    ),
  reviewOrder: (userId, tenantId, salesOrderId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.review_reseller_portal_order($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text, $7::text) response',
      [
        userId,
        tenantId,
        salesOrderId,
        JSON.stringify(request),
        command.idempotencyKey,
        command.requestHash,
        command.requestId,
      ],
      (value) => resellerOrderReviewResponseSchema.parse(value),
    ),
  savePaymentAccount: (userId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.save_reseller_payment_account($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [userId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerPaymentAccountSaveResponseSchema.parse(value),
    ),
  checkCartStock: (authUserId, tenantId, lines, bindings) =>
    queryOne(
      bindings,
      'select app.reseller_cart_stock_issues($1::uuid, $2::uuid, $3::jsonb) response',
      [authUserId, tenantId, JSON.stringify(lines)],
      (value) => resellerStockIssuesSchema.parse(value).stockIssues,
    ),
  loadNotifications: (authUserId, tenantId, limit, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_notifications($1::uuid, $2::uuid, $3::integer) response',
      [authUserId, tenantId, limit],
      (value) => resellerNotificationsSchema.parse(value),
    ),
  markNotificationsRead: (authUserId, tenantId, notificationId, bindings) =>
    queryOne(
      bindings,
      'select app.mark_reseller_notifications_read($1::uuid, $2::uuid, $3::uuid) response',
      [authUserId, tenantId, notificationId],
      (value) => resellerNotificationReadResponseSchema.parse(value),
    ),
  savePushSubscription: (audience, userId, tenantId, subscription, bindings) =>
    queryOne(
      bindings,
      audience === 'reseller'
        ? 'select app.save_reseller_push_subscription($1::uuid, $2::uuid, $3::jsonb) response'
        : 'select app.save_member_push_subscription($1::uuid, $2::uuid, $3::jsonb) response',
      [userId, tenantId, JSON.stringify(subscription)],
      (value) => pushSubscriptionResponseSchema.parse(value),
    ),
  removePushSubscription: (userId, tenantId, endpoint, bindings) =>
    queryOne(
      bindings,
      'select app.remove_push_subscription($1::uuid, $2::uuid, $3::text) response',
      [userId, tenantId, endpoint],
      (value) => pushSubscriptionResponseSchema.parse(value),
    ),
  loadAvailability: (userId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_portal_availability($1::uuid, $2::uuid) response',
      [userId, tenantId],
      (value) => resellerPortalAvailabilitySchema.parse(value),
    ),
  setEnabled: (userId, tenantId, enabled, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.set_reseller_portal_enabled($1::uuid, $2::uuid, $3::boolean, $4::text) response',
      [userId, tenantId, enabled, requestId],
      (value) => resellerPortalAvailabilitySchema.parse(value),
    ),
  loadStatement: (authUserId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_statement($1::uuid, $2::uuid) response',
      [authUserId, tenantId],
      (value) => resellerStatementSchema.parse(value),
    ),
  loadLoyalty: (authUserId, tenantId, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_loyalty($1::uuid, $2::uuid) response',
      [authUserId, tenantId],
      (value) => resellerLoyaltySchema.parse(value),
    ),
  applyCredit: (authUserId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.apply_reseller_credit($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [authUserId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerCreditApplyResponseSchema.parse(value),
    ),
  redeemPoints: (authUserId, tenantId, request, command, bindings) =>
    queryOne(
      bindings,
      'select app.redeem_reseller_points($1::uuid, $2::uuid, $3::jsonb, $4::text, $5::text, $6::text) response',
      [authUserId, tenantId, JSON.stringify(request), command.idempotencyKey, command.requestHash, command.requestId],
      (value) => resellerPointsRedeemResponseSchema.parse(value),
    ),
  savePointsSettings: (userId, tenantId, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.save_reseller_points_settings($1::uuid, $2::uuid, $3::jsonb, $4::text) response',
      [userId, tenantId, JSON.stringify(request), requestId],
      (value) => resellerPointsSettingsResponseSchema.parse(value),
    ),
  saveBranding: (userId, tenantId, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.save_reseller_portal_branding($1::uuid, $2::uuid, $3::jsonb, $4::text) response',
      [userId, tenantId, JSON.stringify(request), requestId],
      (value) => storedBrandingSchema.parse(value),
    ),
  loadReport: (userId, tenantId, from, to, bindings) =>
    queryOne(
      bindings,
      'select app.load_reseller_portal_report($1::uuid, $2::uuid, $3::date, $4::date) || app.load_reseller_portal_insights($1::uuid, $2::uuid, $3::date, $4::date) response',
      [userId, tenantId, from, to],
      (value) => resellerPortalReportSchema.parse(value),
    ),
  updateShipment: (userId, tenantId, salesOrderId, request, requestId, bindings) =>
    queryOne(
      bindings,
      'select app.update_portal_shipment($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text) response',
      [userId, tenantId, salesOrderId, JSON.stringify(request), requestId],
      (value) => portalShipmentUpdateResponseSchema.parse(value),
    ),
}
