import {
  apiErrorResponseSchema,
  catalogProductCreateRequestSchema,
  catalogProductCreateResponseSchema,
  catalogProductUpdateRequestSchema,
  catalogProductUpdateResponseSchema,
  catalogResponseSchema,
  catalogVariantCreateRequestSchema,
  catalogVariantCreateResponseSchema,
  catalogVariantDeactivateResponseSchema,
  catalogVariantUpdateRequestSchema,
  catalogVariantUpdateResponseSchema,
  healthResponseSchema,
  openingInventoryContextSchema,
  openingInventoryCreateRequestSchema,
  openingInventoryCreateResponseSchema,
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
  createCatalogVariantInPostgres,
  deactivateCatalogVariantInPostgres,
  loadCatalogFromPostgres,
  updateCatalogProductInPostgres,
  updateCatalogVariantInPostgres,
  type CatalogLoader,
  type CatalogProductCreator,
  type CatalogVariantCreator,
  type CatalogVariantDeactivator,
  type CatalogVariantUpdater,
  type CatalogProductUpdater,
} from './catalog-repository'
import { type Bindings, readEnvironment } from './env'
import {
  loadOpeningInventoryFromPostgres,
  recordOpeningInventoryInPostgres,
  type OpeningInventoryLoader,
  type OpeningInventoryRecorder,
} from './inventory-repository'
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
  createCatalogVariant: CatalogVariantCreator
  updateCatalogProduct: CatalogProductUpdater
  updateCatalogVariant: CatalogVariantUpdater
  deactivateCatalogVariant: CatalogVariantDeactivator
  loadOpeningInventory: OpeningInventoryLoader
  recordOpeningInventory: OpeningInventoryRecorder
}

const defaultDependencies: AppDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  loadSessionAccess: loadSessionAccessFromPostgres,
  bootstrapTenant: bootstrapTenantInPostgres,
  loadOnboarding: loadOnboardingFromPostgres,
  updateOnboarding: updateOnboardingInPostgres,
  loadCatalog: loadCatalogFromPostgres,
  createCatalogProduct: createCatalogProductInPostgres,
  createCatalogVariant: createCatalogVariantInPostgres,
  updateCatalogProduct: updateCatalogProductInPostgres,
  updateCatalogVariant: updateCatalogVariantInPostgres,
  deactivateCatalogVariant: deactivateCatalogVariantInPostgres,
  loadOpeningInventory: loadOpeningInventoryFromPostgres,
  recordOpeningInventory: recordOpeningInventoryInPostgres,
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
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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

  app.post('/v1/catalog/products/:productId/variants', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before adding a product variant.',
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

    const productId = context.req.param('productId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product reference is invalid.',
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
            message: 'Select a business before adding a product variant.',
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
    const parsed = catalogVariantCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'Check the variant, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }

    try {
      const response = await dependencies.createCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request key was already used for different variant details.',
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
              message: 'The SKU or barcode is already used by another variant.',
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
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'PRODUCT_NOT_FOUND' : 'INVALID_VARIANT_DETAILS',
              message:
                code === 'HCS12' ? 'The product was not found.' : 'Check the variant, SKU, barcode, and price details.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  app.patch('/v1/catalog/products/:productId/variants/:variantId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before editing a product variant.',
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
    const productId = context.req.param('productId')
    const variantId = context.req.param('variantId')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(productId) || !uuidPattern.test(variantId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product or variant reference is invalid.',
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
            message: 'Select a business before editing a product variant.',
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
    const parsed = catalogVariantUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'Check the variant, SKU, barcode, and price details.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.updateCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        variantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantUpdateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === '23505' ? 'DUPLICATE_SKU_OR_BARCODE' : 'IDEMPOTENCY_KEY_CONFLICT',
              message:
                code === '23505'
                  ? 'The SKU or barcode is already used by another variant.'
                  : 'This request key was already used for different variant details.',
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
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'VARIANT_NOT_FOUND' : 'INVALID_VARIANT_DETAILS',
              message: code === 'HCS12' ? 'The product variant was not found.' : 'Check the variant details.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  app.delete('/v1/catalog/products/:productId/variants/:variantId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before removing a product variant.',
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
    const productId = context.req.param('productId')
    const variantId = context.req.param('variantId')
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(productId) || !uuidPattern.test(variantId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_VARIANT_DETAILS',
            message: 'The product or variant reference is invalid.',
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
            message: 'Select a business before removing a product variant.',
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
      const identity = { productId, variantId }
      const response = await dependencies.deactivateCatalogVariant(
        user.userId,
        tenant.tenantId,
        productId,
        variantId,
        idempotencyKey,
        await requestHash(identity),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogVariantDeactivateResponseSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS13') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS13' ? 'LAST_ACTIVE_VARIANT' : 'IDEMPOTENCY_KEY_CONFLICT',
              message:
                code === 'HCS13'
                  ? 'A product must keep at least one active variant.'
                  : 'This request key was already used for a different variant.',
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
      if (code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'VARIANT_NOT_FOUND',
              message: 'The product variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.patch('/v1/catalog/products/:productId', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before editing a product.',
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
    const productId = context.req.param('productId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'The product reference is invalid.',
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
            message: 'Select a business before editing a product.',
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
    const parsed = catalogProductUpdateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_PRODUCT_DETAILS',
            message: 'Check the product name, category, and description.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.updateCatalogProduct(
        user.userId,
        tenant.tenantId,
        productId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(catalogProductUpdateResponseSchema.parse(response))
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
      if (code === 'HCS11' || code === 'HCS12') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS12' ? 'PRODUCT_NOT_FOUND' : 'INVALID_PRODUCT_DETAILS',
              message:
                code === 'HCS12' ? 'The product was not found.' : 'Check the product name, category, and description.',
              requestId: context.get('requestId'),
            },
          }),
          code === 'HCS12' ? 404 : 400,
        )
      }
      throw error
    }
  })

  app.get('/v1/inventory/opening-balances', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in to view opening inventory.',
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
            message: 'Select a business to view opening inventory.',
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
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const locationId = context.req.query('locationId') ?? null
    if (
      locationId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(locationId)
    ) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_LOCATION',
            message: 'The inventory location reference is invalid.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.loadOpeningInventory(user.userId, tenant.tenantId, locationId, context.env)
      return context.json(openingInventoryContextSchema.parse(response))
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'LOCATION_NOT_FOUND',
              message: 'The inventory location was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      throw error
    }
  })

  app.post('/v1/inventory/opening-balances', async (context) => {
    const accessToken = readBearerToken(context.req.header('authorization'))
    if (!accessToken) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in before recording opening inventory.',
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
            message: 'Select a business before recording opening inventory.',
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
            code: 'INVENTORY_ACCESS_DENIED',
            message: 'You do not have access to this business inventory.',
            requestId: context.get('requestId'),
          },
        }),
        403,
      )
    }
    const body: unknown = await context.req.json().catch(() => null)
    const parsed = openingInventoryCreateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiErrorResponseSchema.parse({
          error: {
            code: 'INVALID_OPENING_INVENTORY',
            message: 'Add at least one positive quantity and a valid unit cost.',
            requestId: context.get('requestId'),
          },
        }),
        400,
      )
    }
    try {
      const response = await dependencies.recordOpeningInventory(
        user.userId,
        tenant.tenantId,
        parsed.data,
        idempotencyKey,
        await requestHash(parsed.data),
        context.get('requestId'),
        context.env,
      )
      return context.json(openingInventoryCreateResponseSchema.parse(response), 201)
    } catch (error) {
      const code = postgresErrorCode(error)
      if (code === 'HCS08' || code === 'HCS16' || code === '23505') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS08' ? 'IDEMPOTENCY_KEY_CONFLICT' : 'OPENING_INVENTORY_EXISTS',
              message:
                code === 'HCS08'
                  ? 'This request key was already used for different opening inventory.'
                  : 'Opening inventory already exists, or stock has already moved for one of these variants.',
              requestId: context.get('requestId'),
            },
          }),
          409,
        )
      }
      if (code === 'HCS17' || code === 'HCS18') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS18' ? 'INVENTORY_UNAVAILABLE' : 'INVENTORY_ACCESS_DENIED',
              message:
                code === 'HCS18' ? 'The inventory module is not enabled.' : 'You do not have inventory permission.',
              requestId: context.get('requestId'),
            },
          }),
          403,
        )
      }
      if (code === 'HCS19' || code === 'HCS21') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: code === 'HCS19' ? 'LOCATION_NOT_FOUND' : 'VARIANT_NOT_FOUND',
              message:
                code === 'HCS19' ? 'The inventory location was not found.' : 'An inventory variant was not found.',
              requestId: context.get('requestId'),
            },
          }),
          404,
        )
      }
      if (code === 'HCS20' || code === '22P02' || code === '22003') {
        return context.json(
          apiErrorResponseSchema.parse({
            error: {
              code: 'INVALID_OPENING_INVENTORY',
              message: 'Check the opening quantities and unit costs.',
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
          { code: 'opening_inventory', status: setup.hasOpeningInventory ? 'complete' : 'pending' },
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
