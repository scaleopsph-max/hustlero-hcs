import {
  apiErrorResponseSchema,
  healthResponseSchema,
  onboardingResponseSchema,
  sessionContextResponseSchema,
  tenantBootstrapRequestSchema,
  tenantBootstrapResponseSchema,
} from '@hcs/contracts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'

import { readBearerToken, verifySupabaseAccessToken, type AccessTokenVerifier } from './auth'
import { type Bindings, readEnvironment } from './env'
import {
  bootstrapTenantInPostgres,
  countActiveLocationsInPostgres,
  type ActiveLocationCounter,
  type TenantBootstrapper,
} from './onboarding-repository'
import { loadSessionAccessFromPostgres, type SessionAccessLoader } from './session-repository'

interface AppDependencies {
  verifyAccessToken: AccessTokenVerifier
  loadSessionAccess: SessionAccessLoader
  bootstrapTenant: TenantBootstrapper
  countActiveLocations: ActiveLocationCounter
}

const defaultDependencies: AppDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  loadSessionAccess: loadSessionAccessFromPostgres,
  bootstrapTenant: bootstrapTenantInPostgres,
  countActiveLocations: countActiveLocationsInPostgres,
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
      allowMethods: ['GET', 'POST', 'OPTIONS'],
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

    const hasMainLocation = (await dependencies.countActiveLocations(tenant.tenantId, context.env)) > 0
    return context.json(
      onboardingResponseSchema.parse({
        tenantId: tenant.tenantId,
        readyToSell: false,
        steps: [
          { code: 'business', status: 'complete' },
          { code: 'main_location', status: hasMainLocation ? 'complete' : 'pending' },
          { code: 'business_questions', status: 'pending' },
          { code: 'feature_selection', status: 'pending' },
          { code: 'products', status: 'pending' },
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
