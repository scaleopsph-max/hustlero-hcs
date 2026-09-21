import { apiErrorResponseSchema, healthResponseSchema, sessionContextResponseSchema } from '@hcs/contracts'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'

import { readBearerToken, verifySupabaseAccessToken, type AccessTokenVerifier } from './auth'
import { type Bindings, readEnvironment } from './env'
import { loadSessionAccessFromPostgres, type SessionAccessLoader } from './session-repository'

interface AppDependencies {
  verifyAccessToken: AccessTokenVerifier
  loadSessionAccess: SessionAccessLoader
}

const defaultDependencies: AppDependencies = {
  verifyAccessToken: verifySupabaseAccessToken,
  loadSessionAccess: loadSessionAccessFromPostgres,
}

export function createApp(dependencies: AppDependencies = defaultDependencies) {
  const app = new Hono<{ Bindings: Bindings }>()

  app.use('*', requestId())

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
