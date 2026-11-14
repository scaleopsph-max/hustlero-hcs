import { describe, expect, it } from 'vitest'

import { countedCentavos } from './register-close'

describe('countedCentavos', () => {
  it('adds bills by denomination and the coins total', () => {
    expect(countedCentavos({ b1000: '2', b500: '1', b20: '3' }, '12.50')).toBe(257_250)
  })

  it('ignores blank and invalid entries', () => {
    expect(countedCentavos({ b100: '', b50: 'x' }, '')).toBe(0)
  })
})
