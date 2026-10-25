import { describe, expect, it } from 'vitest'

import {
  wholesaleCreditSettingsRequestSchema,
  wholesaleOpeningReceivableRequestSchema,
  wholesalePaymentAllocationRequestSchema,
  wholesaleReceivablesContextSchema,
} from './wholesale-receivables'

const customerId = '4f4d4e13-b333-49db-a3fe-f367e7cdfe82'
const invoiceId = '11111111-1111-4111-8111-111111111111'
const payment = {
  customerId,
  paymentMethodId: '22222222-2222-4222-8222-222222222222',
  amountMinor: 225000,
  reference: 'Receipt reference',
  allocations: [{ invoiceId, amountMinor: 225000 }],
}

describe('AW3 command contracts', () => {
  it('rejects oversized allocation collections before reading invalid invoice entries', () => {
    let inspected = 0
    const allocations = Array.from({ length: 501 }, () => ({
      get invoiceId() {
        inspected++
        return 'invalid-invoice'
      },
      amountMinor: 0,
    }))
    const result = wholesalePaymentAllocationRequestSchema.safeParse({ ...payment, allocations })
    expect(result.success).toBe(false)
    expect(inspected).toBe(0)
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: 'too_big', maximum: 500, path: ['allocations'] }),
      ])
    }
  })

  it('accepts exactly 500 unique invoice allocations whose centavos match the receipt', () => {
    const allocations = Array.from({ length: 500 }, (_, index) => ({
      invoiceId: `10000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
      amountMinor: 1,
    }))
    expect(
      wholesalePaymentAllocationRequestSchema.parse({ ...payment, amountMinor: 500, allocations }).allocations,
    ).toEqual(allocations)
    expect(
      wholesalePaymentAllocationRequestSchema.safeParse({ ...payment, amountMinor: 499, allocations }).success,
    ).toBe(false)
  })

  it('keeps unclassified debt unknown and rejects misleading zero-balance projections', () => {
    const invoice = {
      invoiceId,
      invoiceNumber: 'INV-001',
      customerId,
      customerName: 'Fixture',
      locationId: '33333333-3333-4333-8333-333333333333',
      locationName: 'Main Store',
      totalMinor: 225000,
      classification: 'unclassified',
      eligibleForOpening: true,
      openBalanceMinor: null,
      dueDate: null,
    }
    expect(wholesaleReceivablesContextSchema.safeParse({ canRecordOpening: true, invoices: [invoice] }).success).toBe(
      true,
    )
    expect(
      wholesaleReceivablesContextSchema.safeParse({
        canRecordOpening: true,
        invoices: [{ ...invoice, openBalanceMinor: 0 }],
      }).success,
    ).toBe(false)
    expect(
      wholesaleReceivablesContextSchema.safeParse({
        canRecordOpening: true,
        invoices: [{ ...invoice, classification: 'opening' }],
      }).success,
    ).toBe(false)
  })
  it('accepts zero credit limit without treating it as unlimited', () => {
    expect(
      wholesaleCreditSettingsRequestSchema.parse({
        customerId,
        creditLimitMinor: 0,
        paymentTerm: 'cod',
        reason: 'No credit',
      }).creditLimitMinor,
    ).toBe(0)
  })

  it('rejects client-supplied tenant and opening amount', () => {
    expect(
      wholesaleOpeningReceivableRequestSchema.safeParse({
        invoiceId,
        dueDate: '2026-10-10',
        reason: 'Owner approved unpaid opening balance',
        tenantId: customerId,
      }).success,
    ).toBe(false)
    expect(
      wholesaleOpeningReceivableRequestSchema.safeParse({
        invoiceId,
        dueDate: '2026-10-10',
        reason: 'Opening',
        amountMinor: 225000,
      }).success,
    ).toBe(false)
  })

  it('accepts the confirmed opening due date without inventing payment terms', () => {
    expect(
      wholesaleOpeningReceivableRequestSchema.parse({
        invoiceId,
        dueDate: '2026-10-10',
        reason: 'Owner approved unpaid opening balance',
      }).dueDate,
    ).toBe('2026-10-10')
  })

  it('accepts explicitly allocated payments', () => {
    expect(wholesalePaymentAllocationRequestSchema.safeParse(payment).success).toBe(true)
  })

  it('rejects duplicate invoice allocations and unallocated money', () => {
    expect(
      wholesalePaymentAllocationRequestSchema.safeParse({
        ...payment,
        amountMinor: 450000,
        allocations: [...payment.allocations, ...payment.allocations],
      }).success,
    ).toBe(false)
    expect(wholesalePaymentAllocationRequestSchema.safeParse({ ...payment, amountMinor: 225001 }).success).toBe(false)
  })

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid payment %s', (amountMinor) => {
    expect(wholesalePaymentAllocationRequestSchema.safeParse({ ...payment, amountMinor }).success).toBe(false)
  })

  it('rejects nested client balance or cross-context fields', () => {
    expect(
      wholesalePaymentAllocationRequestSchema.safeParse({
        ...payment,
        allocations: [{ ...payment.allocations[0], openBalanceMinor: 225000 }],
      }).success,
    ).toBe(false)
    expect(wholesalePaymentAllocationRequestSchema.safeParse({ ...payment, tenantId: customerId }).success).toBe(false)
  })
})
