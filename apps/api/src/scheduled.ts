import { Client } from 'pg'

import type { Bindings } from './env'
import { deliverPushNotifications } from './push-delivery'

type Sweep = (bindings: Bindings) => Promise<number>

/** Cancels pay-first reseller orders whose four-hour payment window passed, releasing their stock. */
export const expireResellerPaymentHolds: Sweep = async (bindings) => {
  if (!bindings.HYPERDRIVE?.connectionString) return 0
  const client = new Client({ connectionString: bindings.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    const result = await client.query<{ expired: number }>('select app.expire_reseller_payment_holds(null) as expired')
    return Number(result.rows[0]?.expired ?? 0)
  } finally {
    await client.end()
  }
}

type PushDelivery = (
  bindings: Bindings,
) => Promise<{ notifications: number; sent: number; gone: number; failed: number }>

/** Cron entry point: expire unpaid holds first (their notices go out in the same run), then send pushes.
 * A failed step is logged and retried by the next run. */
export function createScheduledHandler(
  sweep: Sweep = expireResellerPaymentHolds,
  push: PushDelivery = deliverPushNotifications,
) {
  return async (_controller: unknown, bindings: Bindings): Promise<void> => {
    try {
      const expired = await sweep(bindings)
      if (expired > 0) console.log(JSON.stringify({ event: 'reseller_payment_holds_expired', expired }))
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'reseller_payment_hold_sweep_failed',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      )
    }
    try {
      const pushed = await push(bindings)
      if (pushed.notifications > 0) console.log(JSON.stringify({ event: 'push_notifications_sent', ...pushed }))
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'push_delivery_failed', message: error instanceof Error ? error.message : 'unknown' }),
      )
    }
  }
}
