import { describe, expect, it } from 'vitest'
import {
  canDiscardCountCommand,
  CountCommandError,
  countQuantity,
  countQuantityToMilli,
  decodePendingCount,
} from './inventory-count-recovery'

describe('inventory count recovery', () => {
  it('converts fractional and zero quantities exactly and rejects extra precision', () => {
    expect(countQuantityToMilli('0')).toBe(0)
    expect(countQuantityToMilli('12.345')).toBe(12345)
    expect(countQuantity(-12345)).toBe('-12.345')
    expect(() => countQuantityToMilli('1.0001')).toThrow()
    expect(() => countQuantityToMilli('-1')).toThrow()
  })
  it('retains uncertain and authorization failures while allowing known rejected commands to be discarded', () => {
    expect(canDiscardCountCommand(new CountCommandError('changed', 'INVENTORY_COUNT_CHANGED'))).toBe(true)
    expect(canDiscardCountCommand(new CountCommandError('denied', 'FORBIDDEN'))).toBe(false)
    expect(canDiscardCountCommand(new TypeError('network lost'))).toBe(false)
  })
  it('binds a saved retry to its actor and tenant and rejects altered payloads', () => {
    const actorId = '10000000-0000-4000-8000-000000000001',
      tenantId = '20000000-0000-4000-8000-000000000001',
      countId = '30000000-0000-4000-8000-000000000001'
    const raw = JSON.stringify({
      version: 1,
      actorId,
      tenantId,
      key: '40000000-0000-4000-8000-000000000001',
      action: 'post',
      countId,
      body: JSON.stringify({ expectedRevision: 3, reason: 'Stock count' }),
    })
    expect(decodePendingCount(raw, tenantId, actorId).body).toContain('Stock count')
    expect(() => decodePendingCount(raw, tenantId, '50000000-0000-4000-8000-000000000001')).toThrow()
    expect(() => decodePendingCount(raw.replace('Stock count', '  Stock count  '), tenantId, actorId)).toThrow()
  })
})
