import { expect, it } from 'vitest'
import { pricingAmountMinor, pricingThresholdMilli } from './pricing-input'

it.each([
  ['450', 45000],
  ['399.99', 39999],
  ['0', 0],
  ['0.01', 1],
  ['90071992547409.91', Number.MAX_SAFE_INTEGER],
] as const)('parses exact price %s', (input, expected) => {
  expect(pricingAmountMinor(input)).toBe(expected)
})
it.each(['', '-1', '1..2', '1.001', '1e2', '90071992547409.92'])('rejects invalid/unsafe price %s', (input) => {
  expect(pricingAmountMinor(input)).toBeNull()
})
it.each([
  ['10', 10000],
  ['9.999', 9999],
  ['0.001', 1],
] as const)('parses exact MOQ %s', (input, expected) => {
  expect(pricingThresholdMilli(input)).toBe(expected)
})
it.each(['0', '-10', '10.0001', '1..0', '9007199254740.992'])('rejects invalid/unsafe MOQ %s', (input) => {
  expect(pricingThresholdMilli(input)).toBeNull()
})
