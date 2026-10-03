import { describe, expect, it } from 'vitest'
import { businessSlugFromName } from './business-slug'

describe('businessSlugFromName', () => {
  it('keeps the generated slug synchronized with the complete business name', () => {
    expect(businessSlugFromName('S')).toBe('s')
    expect(businessSlugFromName('SAH RESTORATION')).toBe('sah-restoration')
  })

  it('normalizes punctuation and surrounding separators', () => {
    expect(businessSlugFromName('  SAH & Restoration, Inc.  ')).toBe('sah-restoration-inc')
  })
})
