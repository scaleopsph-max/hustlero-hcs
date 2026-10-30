import {
  apiErrorResponseSchema,
  resellerAccountInviteRequestSchema,
  resellerAccountStatusRequestSchema,
  resellerApplicationDecisionRequestSchema,
  resellerApplicationRequestSchema,
  resellerOrderReviewRequestSchema,
  resellerOrderSubmitRequestSchema,
  resellerPortalSettingsRequestSchema,
  resellerPaymentAccountSaveRequestSchema,
  portalShipmentUpdateRequestSchema,
  resellerPortalReportFilterSchema,
  type ResellerOrder,
  type ResellerPaymentAccount,
  type ResellerPortalCatalog,
} from '@hcs/contracts'
import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'

import { readBearerToken, type AccessTokenVerifier } from './auth'
import type { Bindings } from './env'
import type {
  PortalCommand,
  ResellerPortalRepository,
  StoredPaymentAccount,
  StoredResellerOrder,
} from './reseller-portal-repository'

type AppContext = Context<{ Bindings: Bindings }>

export interface ResellerPortalRouteDependencies {
  verifyAccessToken: AccessTokenVerifier
  /** Resolves the signed-in Back Office member and selected tenant, or null. */
  resolveBackofficeTenant: (context: AppContext) => Promise<{ userId: string; tenantId: string } | null>
  repository: ResellerPortalRepository
  requestHash: (value: unknown) => Promise<string>
  postgresErrorCode: (error: unknown) => string | null
  /** Adds signed product photo URLs to the reseller catalog. */
  decorateCatalog?: (
    catalog: ResellerPortalCatalog,
    authUserId: string,
    tenantId: string,
    bindings: Bindings,
  ) => Promise<ResellerPortalCatalog>
  /** Signs payment-proof links and removes storage keys before orders leave the API. */
  presentOrders?: (orders: StoredResellerOrder[], bindings: Bindings) => Promise<ResellerOrder[]>
  /** Signs a stored file key (payment QR images); null when file storage is not configured. */
  signFileKey?: (key: string, bindings: Bindings) => Promise<string | null>
}

const dropProofs = async (orders: StoredResellerOrder[]): Promise<ResellerOrder[]> =>
  orders.map((order) => ({ ...order, paymentProofs: [] }))

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i
const idempotencyPattern = /^[A-Za-z0-9_-]{16,128}$/
// Application decisions derive nested keys, so they leave room for a suffix.
const decisionIdempotencyPattern = /^[A-Za-z0-9_-]{16,120}$/

const errorMap: Record<string, { status: ContentfulStatusCode; code: string; message: string }> = {
  HCSD0: { status: 403, code: 'REPORTING_ACCESS_DENIED', message: 'Your role cannot view these reports.' },
  HCSD1: { status: 400, code: 'INVALID_REPORT_FILTERS', message: 'Choose a valid date range of up to one year.' },
  HCRP9: {
    status: 409,
    code: 'PAYMENT_METHOD_REQUIRED',
    message:
      'Turn on an E-wallet and a Bank Transfer payment method in Payment methods so verified payments can be recorded.',
  },
  HCSQ1: {
    status: 403,
    code: 'WHOLESALE_ORDER_ACCESS_DENIED',
    message: 'Your role cannot release stock or issue invoices. Ask an owner or a wholesale manager.',
  },
  HCQ11: {
    status: 409,
    code: 'STOCK_RESERVATION_MISMATCH',
    message: 'The reserved stock for this order no longer matches inventory. Check Inventory, then try again.',
  },
  HCRP0: { status: 404, code: 'RESELLER_PORTAL_UNAVAILABLE', message: 'The reseller portal is not available.' },
  HCRP1: { status: 403, code: 'RESELLER_ACCESS_DENIED', message: 'This account does not have reseller access here.' },
  HCRP2: { status: 409, code: 'RESELLER_PORTAL_NOT_CONFIGURED', message: 'The reseller portal is not set up yet.' },
  HCRP3: { status: 400, code: 'INVALID_RESELLER_PORTAL_REQUEST', message: 'Check the details and try again.' },
  HCRP4: {
    status: 409,
    code: 'RESELLER_ITEM_UNAVAILABLE',
    message: 'An item or the reseller price list is no longer available.',
  },
  HCRP5: {
    status: 409,
    code: 'RESELLER_MINIMUM_NOT_MET',
    message: 'Add more items to reach the wholesale minimum quantity.',
  },
  HCRP6: { status: 409, code: 'RESELLER_APPLICATIONS_CLOSED', message: 'Reseller applications are closed right now.' },
  HCRP7: {
    status: 409,
    code: 'RESELLER_ITEM_OUT_OF_STOCK',
    message: 'An item in your cart is out of stock. Remove it and submit again.',
  },
  HCRP8: {
    status: 409,
    code: 'RESELLER_STOCK_SHORT',
    message: 'There is not enough stock for one of the items. Lower the quantity and try again.',
  },
  HCRA1: {
    status: 403,
    code: 'RESELLER_PORTAL_ADMIN_DENIED',
    message: 'Reseller portal management permission is required.',
  },
  HCRA2: { status: 409, code: 'RESELLER_CUSTOMER_REQUIRED', message: 'Choose an active reseller customer.' },
  HCRA3: { status: 409, code: 'RESELLER_ACCOUNT_EXISTS', message: 'This customer or email already has portal access.' },
  HCRA4: {
    status: 404,
    code: 'RESELLER_RECORD_NOT_FOUND',
    message: 'The application, account, or order was not found.',
  },
  HCRA5: {
    status: 409,
    code: 'RESELLER_RECORD_ALREADY_DECIDED',
    message: 'This record was already updated. Refresh and try again.',
  },
  HCRA6: {
    status: 409,
    code: 'RESELLER_ORDER_AWAITING_PAYMENT',
    message: "This order is still waiting for the reseller's payment proof.",
  },
  HCRA7: {
    status: 409,
    code: 'PAYMENT_ACCOUNT_LIMIT',
    message: 'Up to 6 payment accounts can be shown. Hide one first.',
  },
  HCS08: {
    status: 409,
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    message: 'This request key was already used for a different request.',
  },
  HCSB3: {
    status: 409,
    code: 'CUSTOMER_CONTACT_EXISTS',
    message: 'An active customer already uses this email or phone. Link that customer instead.',
  },
  HCQ10: {
    status: 409,
    code: 'WHOLESALE_STOCK_INSUFFICIENT',
    message: 'Available stock is still insufficient for this order.',
  },
  HCCR1: {
    status: 409,
    code: 'WHOLESALE_CREDIT_LIMIT_EXCEEDED',
    message:
      "The unpaid balance is over this reseller's credit limit. Ask for the rest of the payment, or raise the limit in Wholesale credit.",
  },
  HCCR2: {
    status: 409,
    code: 'WHOLESALE_CREDIT_SETTINGS_REQUIRED',
    message: 'Save credit settings for this reseller first.',
  },
  HCCR4: {
    status: 409,
    code: 'WHOLESALE_INVOICE_CLASSIFICATION_REQUIRED',
    message: 'Classify historical invoices for this reseller first.',
  },
}

/** Replaces QR storage keys with signed links (or null) before accounts leave the API. */
async function presentAccounts(
  accounts: StoredPaymentAccount[] | undefined,
  bindings: Bindings,
  sign: ResellerPortalRouteDependencies['signFileKey'],
): Promise<ResellerPaymentAccount[] | undefined> {
  if (!accounts) return undefined
  return Promise.all(
    accounts.map(async ({ qrStorageKey, ...account }) => ({
      ...account,
      qrUrl: qrStorageKey && sign ? await sign(qrStorageKey, bindings).catch(() => null) : null,
    })),
  )
}

export function registerResellerPortalRoutes(
  app: Hono<{ Bindings: Bindings }>,
  dependencies: ResellerPortalRouteDependencies,
) {
  const fail = (context: AppContext, status: ContentfulStatusCode, code: string, message: string) =>
    context.json(
      apiErrorResponseSchema.parse({ error: { code, message, requestId: context.get('requestId') } }),
      status,
    )

  const mapError = (context: AppContext, error: unknown) => {
    const code = dependencies.postgresErrorCode(error)
    const mapped = code ? errorMap[code] : undefined
    if (mapped) return fail(context, mapped.status, mapped.code, mapped.message)
    if (code?.startsWith('HCSQ') || code?.startsWith('HCCR') || code?.startsWith('HCCO'))
      return fail(
        context,
        409,
        'WHOLESALE_CONFIRMATION_BLOCKED',
        'The order could not be confirmed. Refresh and review it.',
      )
    return null
  }

  const run = async (context: AppContext, action: () => Promise<Response>) => {
    try {
      return await action()
    } catch (error) {
      const response = mapError(context, error)
      if (response) return response
      throw error
    }
  }

  const readJson = async <T>(context: AppContext, schema: ZodType<T>) => {
    const parsed = schema.safeParse(await context.req.json().catch(() => null))
    return parsed.success ? parsed.data : null
  }

  const command = async (
    context: AppContext,
    body: unknown,
    pattern = idempotencyPattern,
  ): Promise<PortalCommand | null> => {
    const key = context.req.header('idempotency-key')
    if (!key || !pattern.test(key)) return null
    return {
      idempotencyKey: key,
      requestHash: await dependencies.requestHash(body),
      requestId: context.get('requestId'),
    }
  }

  const resolveReseller = async (context: AppContext, requireTenant: boolean) => {
    const token = readBearerToken(context.req.header('authorization'))
    const user = token ? await dependencies.verifyAccessToken(token, context.env) : null
    if (!user) return fail(context, 401, 'AUTHENTICATION_REQUIRED', 'Sign in to the reseller portal.')
    const tenantId = context.req.header('x-tenant-id')
    if (requireTenant && (!tenantId || !uuidPattern.test(tenantId)))
      return fail(context, 400, 'RESELLER_BUSINESS_REQUIRED', 'Choose the business you are ordering from.')
    // The tenant header is only a selector; the database verifies the reseller account in that tenant.
    return { userId: user.userId, tenantId: tenantId ?? '' }
  }

  const resolveAdmin = async (context: AppContext) => {
    const resolved = await dependencies.resolveBackofficeTenant(context)
    return (
      resolved ??
      fail(context, 403, 'RESELLER_PORTAL_ADMIN_DENIED', 'Sign in and select a business to manage the reseller portal.')
    )
  }

  // Public application form ---------------------------------------------------

  app.get('/v1/public/reseller-portal/:slug', (context) => {
    const slug = context.req.param('slug')
    if (!slugPattern.test(slug) || slug.length > 63)
      return fail(context, 404, 'RESELLER_PORTAL_UNAVAILABLE', 'The reseller portal is not available.')
    return run(context, async () => context.json(await dependencies.repository.loadPublic(slug, context.env)))
  })

  app.post('/v1/public/reseller-portal/:slug/applications', async (context) => {
    const slug = context.req.param('slug')
    if (!slugPattern.test(slug) || slug.length > 63)
      return fail(context, 404, 'RESELLER_PORTAL_UNAVAILABLE', 'The reseller portal is not available.')
    const request = await readJson(context, resellerApplicationRequestSchema)
    if (!request)
      return fail(context, 400, 'INVALID_RESELLER_APPLICATION', 'Check your name, email, and mobile number.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.submitApplication(slug, request, context.get('requestId'), context.env),
        202,
      ),
    )
  })

  // Reseller portal -----------------------------------------------------------

  app.get('/v1/portal/session', async (context) => {
    const reseller = await resolveReseller(context, false)
    if (reseller instanceof Response) return reseller
    return run(context, async () =>
      context.json(await dependencies.repository.loadSession(reseller.userId, context.env)),
    )
  })

  app.get('/v1/portal/catalog', async (context) => {
    const reseller = await resolveReseller(context, true)
    if (reseller instanceof Response) return reseller
    return run(context, async () =>
      context.json(
        await (dependencies.decorateCatalog ?? (async (catalog) => catalog))(
          await (async () => {
            const { payment, ...catalog } = await dependencies.repository.loadCatalog(
              reseller.userId,
              reseller.tenantId,
              context.env,
            )
            if (!payment) return catalog
            const { accounts, ...rest } = payment
            const presented = await presentAccounts(accounts, context.env, dependencies.signFileKey)
            return { ...catalog, payment: presented ? { ...rest, accounts: presented } : rest }
          })(),
          reseller.userId,
          reseller.tenantId,
          context.env,
        ),
      ),
    )
  })

  app.get('/v1/portal/orders', async (context) => {
    const reseller = await resolveReseller(context, true)
    if (reseller instanceof Response) return reseller
    return run(context, async () =>
      context.json({
        orders: await (dependencies.presentOrders ?? dropProofs)(
          (await dependencies.repository.listOrders(reseller.userId, reseller.tenantId, context.env)).orders,
          context.env,
        ),
      }),
    )
  })

  app.post('/v1/portal/orders', async (context) => {
    const reseller = await resolveReseller(context, true)
    if (reseller instanceof Response) return reseller
    const request = await readJson(context, resellerOrderSubmitRequestSchema)
    if (!request)
      return fail(context, 400, 'INVALID_RESELLER_ORDER', 'Check the items, delivery details, and payment method.')
    const portalCommand = await command(context, request)
    if (!portalCommand) return fail(context, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide a valid Idempotency-Key.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.submitOrder(
          reseller.userId,
          reseller.tenantId,
          request,
          portalCommand,
          context.env,
        ),
        201,
      ),
    )
  })

  // Back Office administration -----------------------------------------------

  app.get('/v1/reseller-portal/admin', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    return run(context, async () => {
      const { paymentAccounts, ...loaded } = await dependencies.repository.loadAdmin(
        admin.userId,
        admin.tenantId,
        context.env,
      )
      const accounts = await presentAccounts(paymentAccounts, context.env, dependencies.signFileKey)
      return context.json({
        ...loaded,
        ...(accounts ? { paymentAccounts: accounts } : {}),
        reviewQueue: await (dependencies.presentOrders ?? dropProofs)(loaded.reviewQueue, context.env),
      })
    })
  })

  app.post('/v1/reseller-portal/settings', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const request = await readJson(context, resellerPortalSettingsRequestSchema)
    const portalCommand = request ? await command(context, request) : null
    if (!request || !portalCommand)
      return fail(
        context,
        400,
        'INVALID_RESELLER_PORTAL_SETTINGS',
        'Choose a branch and provide a valid Idempotency-Key.',
      )
    return run(context, async () =>
      context.json(
        await dependencies.repository.saveSettings(admin.userId, admin.tenantId, request, portalCommand, context.env),
      ),
    )
  })

  app.post('/v1/reseller-portal/payment-accounts', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const request = await readJson(context, resellerPaymentAccountSaveRequestSchema)
    const portalCommand = request ? await command(context, request) : null
    if (!request || !portalCommand)
      return fail(
        context,
        400,
        'INVALID_PAYMENT_ACCOUNT',
        'Enter the provider, account name, and account number, with a valid Idempotency-Key.',
      )
    return run(context, async () =>
      context.json(
        await dependencies.repository.savePaymentAccount(
          admin.userId,
          admin.tenantId,
          request,
          portalCommand,
          context.env,
        ),
      ),
    )
  })

  app.post('/v1/reseller-portal/shipments/:orderId', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const orderId = context.req.param('orderId')
    const request = await readJson(context, portalShipmentUpdateRequestSchema)
    if (!uuidPattern.test(orderId) || !request)
      return fail(context, 400, 'INVALID_SHIPMENT_UPDATE', 'Choose the next step, and the courier when shipping.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.updateShipment(
          admin.userId,
          admin.tenantId,
          orderId,
          request,
          context.get('requestId'),
          context.env,
        ),
      ),
    )
  })

  app.get('/v1/reports/reseller-portal', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const filter = resellerPortalReportFilterSchema.safeParse({
      from: context.req.query('from'),
      to: context.req.query('to'),
    })
    if (!filter.success)
      return fail(context, 400, 'INVALID_REPORT_FILTERS', 'Choose a valid date range of up to one year.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.loadReport(
          admin.userId,
          admin.tenantId,
          filter.data.from,
          filter.data.to,
          context.env,
        ),
      ),
    )
  })

  app.post('/v1/reseller-portal/applications/:id/decision', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const applicationId = context.req.param('id')
    const request = await readJson(context, resellerApplicationDecisionRequestSchema)
    const portalCommand = request
      ? await command(context, { applicationId, ...request }, decisionIdempotencyPattern)
      : null
    if (!uuidPattern.test(applicationId) || !request || !portalCommand)
      return fail(
        context,
        400,
        'INVALID_RESELLER_APPLICATION_DECISION',
        'Check the decision details and Idempotency-Key.',
      )
    return run(context, async () =>
      context.json(
        await dependencies.repository.decideApplication(
          admin.userId,
          admin.tenantId,
          applicationId,
          request,
          portalCommand,
          context.env,
        ),
      ),
    )
  })

  app.post('/v1/reseller-portal/accounts', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const request = await readJson(context, resellerAccountInviteRequestSchema)
    const portalCommand = request ? await command(context, request) : null
    if (!request || !portalCommand)
      return fail(
        context,
        400,
        'INVALID_RESELLER_INVITATION',
        'Check the customer, email, price list, and Idempotency-Key.',
      )
    return run(context, async () =>
      context.json(
        await dependencies.repository.inviteAccount(admin.userId, admin.tenantId, request, portalCommand, context.env),
        201,
      ),
    )
  })

  app.post('/v1/reseller-portal/accounts/:id/status', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const accountId = context.req.param('id')
    const request = await readJson(context, resellerAccountStatusRequestSchema)
    if (!uuidPattern.test(accountId) || !request)
      return fail(context, 400, 'INVALID_RESELLER_ACCOUNT_STATUS', 'Choose active or suspended.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.setAccountStatus(
          admin.userId,
          admin.tenantId,
          accountId,
          request,
          context.get('requestId'),
          context.env,
        ),
      ),
    )
  })

  app.post('/v1/reseller-portal/orders/:id/review', async (context) => {
    const admin = await resolveAdmin(context)
    if (admin instanceof Response) return admin
    const salesOrderId = context.req.param('id')
    const request = await readJson(context, resellerOrderReviewRequestSchema)
    const portalCommand = request ? await command(context, { salesOrderId, ...request }) : null
    if (!uuidPattern.test(salesOrderId) || !request || !portalCommand)
      return fail(context, 400, 'INVALID_RESELLER_ORDER_REVIEW', 'Check the review decision and Idempotency-Key.')
    return run(context, async () =>
      context.json(
        await dependencies.repository.reviewOrder(
          admin.userId,
          admin.tenantId,
          salesOrderId,
          request,
          portalCommand,
          context.env,
        ),
      ),
    )
  })
}
