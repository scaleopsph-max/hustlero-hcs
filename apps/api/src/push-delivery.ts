import { Client } from 'pg'
import { z } from 'zod'

import type { Bindings } from './env'
import { sendPush, type PushOutcome, type VapidKeys } from './web-push'

const batchSchema = z.object({
  items: z.array(
    z.object({
      audience: z.enum(['reseller', 'member']),
      notificationId: z.uuid(),
      title: z.string(),
      body: z.string(),
      url: z.string(),
      subscriptions: z.array(z.object({ id: z.uuid(), endpoint: z.string(), p256dh: z.string(), auth: z.string() })),
    }),
  ),
})

/** VAPID keys from Worker secrets; null when push is not set up for this environment. */
export function readVapidKeys(bindings: Bindings): VapidKeys | null {
  return bindings.VAPID_PUBLIC_KEY && bindings.VAPID_PRIVATE_KEY
    ? { publicKey: bindings.VAPID_PUBLIC_KEY, privateKey: bindings.VAPID_PRIVATE_KEY }
    : null
}

/** Push services need a contact for the sender; an https URL or mailto. */
export function vapidSubject(bindings: Bindings): string {
  return bindings.VAPID_SUBJECT ?? 'https://hustlero-hcs-api.scaleopsph.workers.dev'
}

/**
 * Pushes new notifications (reseller updates and Back Office portal items) to subscribed browsers.
 * Each notification is attempted once; the database switches off subscriptions that are gone.
 */
export async function deliverPushNotifications(
  bindings: Bindings,
  send: typeof fetch = fetch,
): Promise<{ notifications: number; sent: number; gone: number; failed: number }> {
  const keys = readVapidKeys(bindings)
  const totals = { notifications: 0, sent: 0, gone: 0, failed: 0 }
  if (!keys || !bindings.HYPERDRIVE?.connectionString) return totals
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    const collected = await client.query<{ batch: unknown }>('select app.collect_push_batch(100) as batch')
    const batch = batchSchema.parse(collected.rows[0]?.batch)
    if (batch.items.length === 0) return totals
    const outcomes = new Map<string, PushOutcome>()
    for (const item of batch.items) {
      const message = { title: item.title, body: item.body, url: item.url, tag: item.notificationId }
      const results = await Promise.all(
        item.subscriptions.map(async (subscription) => ({
          id: subscription.id,
          outcome: await sendPush(subscription, message, keys, vapidSubject(bindings), send),
        })),
      )
      for (const { id, outcome } of results) {
        // A browser that took any message this run counts as working.
        if (outcomes.get(id) !== 'sent') outcomes.set(id, outcome)
        totals[outcome] += 1
      }
    }
    totals.notifications = batch.items.length
    await client.query('select app.complete_push_batch($1::jsonb)', [
      JSON.stringify({
        notifications: batch.items.map((item) => ({ audience: item.audience, notificationId: item.notificationId })),
        subscriptions: [...outcomes].map(([id, outcome]) => ({ id, outcome })),
      }),
    ])
    return totals
  } finally {
    await client.end()
  }
}
