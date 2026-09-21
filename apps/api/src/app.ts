import { healthResponseSchema } from '@hcs/contracts'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'

import { type Bindings, readEnvironment } from './env'

export const app = new Hono<{ Bindings: Bindings }>()

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

app.notFound((context) =>
  context.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist.',
        requestId: context.get('requestId'),
      },
    },
    404,
  ),
)
