import { describe, expect, it } from 'vitest'

import { PortalApiError } from './portal-api'
import { readStockIssues, stockIssueText } from './stock-issues'

const variantId = '50000000-0000-4000-8000-000000000001'
const issue = { variantId, productName: 'Barako', variantName: '1kg', requestedMilli: 10_000, availableMilli: 4_000 }

describe('stock issues', () => {
  it('reads the named items from a stock refusal', () => {
    const error = new PortalApiError('short', 409, 'RESELLER_STOCK_SHORT', { stockIssues: [issue] })
    expect(readStockIssues(error).get(variantId)).toEqual(issue)
    expect(readStockIssues(new Error('x')).size).toBe(0)
    expect(readStockIssues(new PortalApiError('x', 409, 'OTHER', { stockIssues: 'bad' })).size).toBe(0)
  })

  it('tells the reseller how far to lower or to remove the item', () => {
    expect(stockIssueText(issue)).toBe('Only 4 left. Lower the quantity to 4 or less.')
    expect(stockIssueText({ ...issue, availableMilli: 0 })).toBe(
      'Out of stock now. Remove this item to place the order.',
    )
  })
})
