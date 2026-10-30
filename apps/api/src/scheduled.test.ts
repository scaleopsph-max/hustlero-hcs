import { describe, expect, it, vi } from 'vitest'

import type { Bindings } from './env'
import { createScheduledHandler, expireResellerPaymentHolds } from './scheduled'

const bindings = { ENVIRONMENT: 'test' } as Bindings

describe('scheduled payment-hold sweep', () => {
  it('runs the sweep with the Worker bindings', async () => {
    const sweep = vi.fn(async () => 2)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await createScheduledHandler(sweep)({}, bindings)
    expect(sweep).toHaveBeenCalledWith(bindings)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"expired":2'))
    log.mockRestore()
  })

  it('logs a failed sweep instead of throwing so the next run retries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      createScheduledHandler(async () => Promise.reject(new Error('db down')))({}, bindings),
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'))
    error.mockRestore()
  })

  it('skips the sweep when the database binding is missing', async () => {
    await expect(expireResellerPaymentHolds(bindings)).resolves.toBe(0)
  })
})
