import { describe, expect, it } from 'vitest'

import { activeWholesaleSection } from './WholesaleTabs'

describe('activeWholesaleSection', () => {
  it('highlights the section of the page', () => {
    expect(activeWholesaleSection('/wholesale')).toBe('/wholesale')
    expect(activeWholesaleSection('/wholesale/payments/')).toBe('/wholesale/payments')
    expect(activeWholesaleSection('/wholesale/statements')).toBe('/wholesale/statements')
  })

  it('keeps sub-pages under their section', () => {
    expect(activeWholesaleSection('/wholesale/approvals/manage')).toBe('/wholesale/approvals')
  })
})
