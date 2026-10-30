import { z } from 'zod'

const base64Url = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`))

/** A browser's PushSubscription, as `subscription.toJSON()` returns it. */
export const pushSubscriptionRequestSchema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .regex(/^https:\/\//),
  keys: z.object({ p256dh: base64Url(80, 100), auth: base64Url(16, 32) }),
  expirationTime: z.number().nullable().optional(),
})
export const pushUnsubscribeRequestSchema = z.strictObject({
  endpoint: z
    .string()
    .max(1000)
    .regex(/^https:\/\//),
})
export const pushSubscriptionResponseSchema = z.object({ enabled: z.boolean() })
/** The sender's public key for `pushManager.subscribe`; null when push is not set up yet. */
export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string().nullable() })

export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>
export type PushSubscriptionResponse = z.infer<typeof pushSubscriptionResponseSchema>
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>
