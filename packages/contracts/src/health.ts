import { z } from 'zod'

export const environmentSchema = z.enum(['development', 'staging', 'production', 'test'])

export const healthResponseSchema = z.object({
  service: z.literal('hustlero-hcs-api'),
  status: z.literal('ok'),
  environment: environmentSchema,
  requestId: z.string().min(1),
  timestamp: z.iso.datetime(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
