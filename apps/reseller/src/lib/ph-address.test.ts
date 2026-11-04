import { describe, expect, it } from 'vitest'

import { formatAddress } from './ph-address'

const address = {
  line: 'Blk 4 Lot 12, Mabini St.',
  barangayCode: '0402119001',
  barangay: 'Kaybagal Central',
  cityCode: '0402119000',
  city: 'Tagaytay City',
  provinceCode: '0402100000',
  province: 'Cavite',
}

describe('formatAddress', () => {
  it('writes the address on one line for the courier', () => {
    expect(formatAddress(address)).toBe('Blk 4 Lot 12, Mabini St., Brgy. Kaybagal Central, Tagaytay City, Cavite')
  })

  it('does not repeat "Barangay" for numbered barangays', () => {
    expect(formatAddress({ ...address, barangay: 'Barangay 105', city: 'Manila City', province: 'Metro Manila' })).toBe(
      'Blk 4 Lot 12, Mabini St., Barangay 105, Manila City, Metro Manila',
    )
  })
})
