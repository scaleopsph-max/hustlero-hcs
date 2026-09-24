import {
  apiErrorResponseSchema,
  catalogProductCreateRequestSchema,
  catalogProductCreateResponseSchema,
  catalogResponseSchema,
  healthResponseSchema,
  onboardingResponseSchema,
  onboardingUpdateRequestSchema,
  onboardingUpdateResponseSchema,
  sessionContextResponseSchema,
  tenantBootstrapRequestSchema,
  tenantBootstrapResponseSchema,
} from '@hcs/contracts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'

import { readBearerToken, verifySupabaseAccessToken, type AccessTokenVerifier } from './auth'
import {
  createCatalogProductInPostgres,
  loadCatalogFromPostgres,
  type CatalogLoader,
  type CatalogProductCreator,
} from './catalog-repository'
import { type Bindings, readEnvironment } from './env'
import {
  bootstrapTenantInPostgres,
  loadOnboardingFromPostgres,
  updateOnboardingInPostgres,
  type OnboardingLoader,
  type OnboardingUpdater,
  type TenantBootstrapper,
} from './onboarding-repository'
import { loadSessionAccessFromPostgres, type SessionAccessLoader } from './session-repository'

interface AppDependencies {
  verifyAccessToken: AccessTokenVerifier
  loadSessionAccess: SessionAccessLoader
  bootstrapTenant: TenantBootstrapper
  loadOnboarding: OnboardingLoader
  updateOnboarding: OnboardingUpdater
  loadCatalog: CatalogLoader
  createCatalogProduct: CatalogProductCreator
}

const defaultDependencies: AppDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  loadSessionAccess: loadSessionAccessFromPostgres,
  bootstrapTenant: bootstrapTenantInPostgres,
  loadOnboarding: loadOnboardingFromPostgres,
  updateOnboarding: updateOnboardingInPostgres,
  loadCatalog: loadCatalogFromPostgres,
  createCatalogProduct: createCatalogProductInPostgres,
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }

  return null
}

async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createApp(dependencies: AppDependencies = defaultDependencies) {
  const app = new Hono<{ Bindings: Bindings }>()

  app.use('*', requestId())
  app.use(
    '/v1/*',
    cors({
      origin: (origin, context) => (origin === context.env.BACKOFFICE_ORIGIN ? origin : ''),
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Tenant-Id'],
    }),
  )

  app.get('/health', (context) => {
    const payload = healthResponseSchema.parse({
      service: 'hustlero-hcs-api',
      status: 'ok',
      environment: readEnvironment(context.env),
      requestId: context.get('requestId'),
      timestamp: new Date().toISOString(),
    })

    return context.json(payload)
  })

  app.get('/v1/me', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))

    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'A valid bearer access token is required.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const authenticatedUser = await dependencies.verifyAccessToken(accessToken, context.env)

    if (!authenticatedUser) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(authenticatedUser.userId, context.env)
    const payload = sessionContextResponseSchema.parse({
      userId: authenticatedUser.userId,
      tenants,
    })

    return context.json(payload)
  })

  app.post('/v1/tenants', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before creating a business.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = tenantBootstrapRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_BUSINESS_DETAILS',
            message: 'Check the business and main location details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.bootstrapTenant(
        user.userId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )

      return context.json(tenantBootstrapResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS01') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different business details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'BUSINESS_SLUG_TAKEN',
              message: 'This business URL identifier is already in use.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS02') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ACCOUNT_NOT_FOUND',
              message: 'Your account is no longer available. Sign in again.',
              requestId: context.get('requestId'),
            },
          }),
          401,
        )
      }

      throw error
    }
  })

  app.get('/v1/catalog', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view products.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to view its products.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    try {
      return context.json(
        catalogResponseSchema.parse(await dependencies.loadCatalog(user.userId, tenant.tenantId, context.env)),
      )
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      throw error
    }
  })

  app.post('/v1/catalog/products', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before adding a product.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }
    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const idempotencyKey = context.req.header('idempotency-key')
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'A valid Idempotency-Key is required.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business before adding a product.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }
    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'CATALOG_ACCESS_DENIED',
            message: 'You do not have access to this business catalog.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = catalogProductCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'Check the product, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.createCatalogProduct(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogProductCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different product details.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'DUPLICATE_SKU_OR_BARCODE',
              message: 'The SKU or barcode is already used by another product.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS09' || code === 'HCS10') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS10' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_ACCESS_DENIED',
              message: code === 'HCS10' ? 'The catalog module is not enabled.' : 'You do not have catalog permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS11') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_PRODUCT_DETAILS',
              message: 'Check the product, SKU, barcode, and price details.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      throw error
    }
  })

  app.get('/v1/onboarding', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view business setup.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to continue setup.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }

    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]

    if (!tenant || !tenant.isOwner) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'ONBOARDING_ACCESS_DENIED',
            message: 'Business setup is available to its owner.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const setup = await dependencies.loadOnboarding(tenant.tenantId, context.env)
    return context.json(
      onboardingResponseSchema.parse({
        tenantId: tenant.tenantId,
        readyToSell: false,
        businessProfile: setup.businessProfile,
        featureOptions: setup.featureOptions,
        steps: [
          { code: 'business', status: 'complete' },
          { code: 'main_location', status: setup.hasMainLocation ? 'complete' : 'pending' },
          { code: 'business_questions', status: setup.businessQuestionsComplete ? 'complete' : 'pending' },
          { code: 'feature_selection', status: setup.featureSelectionComplete ? 'complete' : 'pending' },
          { code: 'products', status: setup.hasProducts ? 'complete' : 'pending' },
          { code: 'opening_inventory', status: 'pending' },
          { code: 'payment_methods', status: 'pending' },
          { code: 'basic_fund_setup', status: 'pending' },
          { code: 'employees', status: 'pending' },
          { code: 'register', status: 'pending' },
          { code: 'pos_activation', status: 'pending' },
          { code: 'test_sale', status: 'pending' },
        ],
      }),
    )
  })

  app.patch('/v1/onboarding', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to continue business setup.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const user = await dependencies.verifyAccessToken(accessToken, context.env)
    if (!user) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'The access token is invalid or expired.',
            requestId: context.get('requestId'),
          },
        }),
        401,
      )
    }

    const tenants = await dependencies.loadSessionAccess(user.userId, context.env)
    const requestedTenantId = context.req.header('x-tenant-id')
    if (!requestedTenantId && tenants.length > 1) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'TENANT_SELECTION_REQUIRED',
            message: 'Select a business to continue setup.',
            requestId: context.get('requestId'),
          },
        }),
        409,
      )
    }

    const tenant = requestedTenantId ? tenants.find((entry) => entry.tenantId === requestedTenantId) : tenants[0]
    if (!tenant || !tenant.isOwner) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'ONBOARDING_ACCESS_DENIED',
            message: 'Business setup is available to its owner.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }

    const body: unknown = await context.req.json().catch(() => null)
    const parsed = onboardingUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_ONBOARDING_DETAILS',
            message: 'Check the setup answers and try again.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.updateOnboarding(
        user.userId,
        tenant.tenantId,
        parsed.data,
        context.get('requestId'),
        context.env,
      )
      return context.json(onboardingUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS04') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ONBOARDING_ACCESS_DENIED',
              message: 'Business setup is available to its active owner.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS06') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'ONBOARDING_STEP_OUT_OF_ORDER',
              message: 'Complete the business setup questions first.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS05' || code === 'HCS07') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_ONBOARDING_DETAILS',
              message: 'Check the setup answers and try again.',
              requestId: context.get('requestId'),
            },
          }),
          400,
        )
      }
      throw error
    }
  })

  app.onError((error, context) => {
    console.error('Unhandled API error', {
      error,
      requestId: context.get('requestId'),
    })

    return context.json(
      apiErrorResponseSchema.parse({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred.',
          requestId: context.get('requestId'),
        },
      }),
      500,
    )
  })

  app.notFound((context) =>
    context.json(
      apiErrorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource does not exist.',
          requestId: context.get('requestId'),
        },
      }),
      404,
    ),
  )

  return app
}

export const app = createApp()
