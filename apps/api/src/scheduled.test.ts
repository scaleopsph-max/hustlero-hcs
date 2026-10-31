import { describe, expect, it, vi } from 'vitest'

import type { Bindings } from './env'
import { deliverPushNotifications } from './push-delivery'
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

describe('scheduled push delivery', () => {
  it('sends pushes after the sweep, even when the sweep failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const push = vi.fn(async () => ({ notifications: 2, sent: 3, gone: 1, failed: 0 }))
    await createScheduledHandler(async () => Promise.reject(new Error('db down')), push)({}, bindings)
    expect(push).toHaveBeenCalledWith(bindings)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"push_notifications_sent"'))
    error.mockRestore()
    log.mockRestore()
  })

  it('does nothing until the push keys are configured', async () => {
    await expect(deliverPushNotifications(bindings)).resolves.toEqual({ notifications: 0, sent: 0, gone: 0, failed: 0 })
  })
})
