import { describe, expect, it } from 'vitest'
import { paymentReferenceLastFourSchema, requiresPaymentReference } from './payment-references'
import { posSalePaymentRequestSchema } from './pos-sales'

describe('online payment reference suffix', () => {
  it('preserves exactly four ASCII digits, including leading zeros', () => {
    expect(paymentReferenceLastFourSchema.parse('0047')).toBe('0047')
  })
  it.each(['', '123', '12345', '12a4', ' 0047', '0047 ', '１２３４', 47, null])(
    'rejects malformed suffix %j',
    (value) => {
      expect(paymentReferenceLastFourSchema.safeParse(value).success).toBe(false)
    },
  )
  it('requires reference for wallet and transfer, not cash/card/other', () => {
    expect(requiresPaymentReference('e_wallet')).toBe(true)
    expect(requiresPaymentReference('bank_transfer')).toBe(true)
    for (const type of ['cash', 'card_terminal', 'other']) expect(requiresPaymentReference(type)).toBe(false)
  })
  it('retains the reference through request parsing instead of stripping it', () => {
    expect(
      posSalePaymentRequestSchema.parse({
        paymentMethodId: '10000000-0000-4000-8000-000000000001',
        amountCentavos: 100,
        tenderedCentavos: 100,
        referenceLastFour: '0047',
      }).referenceLastFour,
    ).toBe('0047')
  })
})
