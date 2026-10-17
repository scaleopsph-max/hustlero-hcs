import { expect, it } from 'vitest'
import { nextTransferReceiptItem } from './transfer-receipt'

it('skips completed first lines when receiving a multi-item transfer', () => {
  const remaining = { id: 'second', requestedQuantityMilli: 3000, receivedQuantityMilli: 1000 }
  expect(
    nextTransferReceiptItem([{ id: 'first', requestedQuantityMilli: 2000, receivedQuantityMilli: 2000 }, remaining]),
  ).toBe(remaining)
})

it('returns no receipt line when all units have been received', () => {
  expect(nextTransferReceiptItem([{ requestedQuantityMilli: 1000, receivedQuantityMilli: 1000 }])).toBeUndefined()
  expect(nextTransferReceiptItem([])).toBeUndefined()
})
