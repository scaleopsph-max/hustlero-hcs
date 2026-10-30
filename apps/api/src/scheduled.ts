import { Client } from 'pg'

import type { Bindings } from './env'

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

/** Cron entry point. A failed sweep is logged and retried by the next run. */
export function createScheduledHandler(sweep: Sweep = expireResellerPaymentHolds) {
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
  }
}
