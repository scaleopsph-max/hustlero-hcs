import { describe, expect, it } from 'vitest'

import {
  applicationLink,
  approvalRequest,
  commandKey,
  orderReviewRequest,
  rejectionRequest,
} from './reseller-portal-admin'

const priceListId = '41000000-0000-4000-8000-000000000001'

describe('reseller portal admin helpers', () => {
  it('builds an approval with credit in centavos', () => {
    expect(
      approvalRequest({ customerId: '', priceListId, paymentTerm: 'prepaid', creditLimit: '15,000.50', note: '' }),
    ).toEqual({ decision: 'approve', priceListId, paymentTerm: 'prepaid', creditLimitMinor: 1_500_050 })
  })

  it('explains what is missing from an approval', () => {
    expect(
      approvalRequest({ customerId: '', priceListId: '', paymentTerm: 'cod', creditLimit: '0', note: '' }),
    ).toMatch(/price list/)
    expect(approvalRequest({ customerId: '', priceListId, paymentTerm: 'cod', creditLimit: '-5', note: '' })).toMatch(
      /credit limit/,
    )
    expect(approvalRequest({ customerId: '', priceListId, paymentTerm: '', creditLimit: '0', note: '' })).toMatch(
      /payment terms/,
    )
  })

  it('links an existing customer when chosen', () => {
    const customerId = '90000000-0000-4000-8000-000000000001'
    expect(
      approvalRequest({ customerId, priceListId, paymentTerm: 'net_7', creditLimit: '0', note: 'Existing buyer' }),
    ).toMatchObject({
      customerId,
      reason: 'Existing buyer',
    })
  })

  it('requires reasons for rejections only', () => {
    expect(rejectionRequest(' ')).toMatch(/reason/)
    expect(rejectionRequest('Incomplete details')).toEqual({ decision: 'reject', reason: 'Incomplete details' })
    expect(orderReviewRequest('approve', '')).toEqual({ decision: 'approve' })
    expect(orderReviewRequest('reject', '')).toMatch(/why/)
  })

  it('builds the public application link', () => {
    expect(applicationLink('https://reseller.example.test/', 'kape-ni-juan')).toBe(
      'https://reseller.example.test/apply?b=kape-ni-juan',
    )
    expect(applicationLink(undefined, 'kape-ni-juan')).toBeNull()
  })

  it('reuses a command key for the same target until cleared', () => {
    const keys = new Map<string, string>()
    const first = commandKey(keys, 'order:1')
    expect(commandKey(keys, 'order:1')).toBe(first)
    expect(first).toMatch(/^reseller-portal-[0-9a-f-]{36}$/)
    keys.delete('order:1')
    expect(commandKey(keys, 'order:1')).not.toBe(first)
  })
})
