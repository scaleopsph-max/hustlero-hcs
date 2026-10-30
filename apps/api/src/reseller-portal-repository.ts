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
  type ResellerPortalPublic,
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
const storedResellerPortalAdminSchema = resellerPortalAdminSchema.extend({
  reviewQueue: z.array(storedResellerOrderSchema),
  paymentAccounts: z.array(storedPaymentAccountSchema).optional(),
})
const storedResellerPortalCatalogSchema = resellerPortalCatalogSchema.extend({
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
  loadPublic(tenantSlug: string, bindings: Bindings): Promise<ResellerPortalPublic>
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
      resellerPortalPublicSchema.parse(value),
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
}
