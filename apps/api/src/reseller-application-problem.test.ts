import { resellerApplicationRequestSchema } from '@hcs/contracts'
import { describe, expect, it } from 'vitest'

import { applicationProblem } from './reseller-application-problem'

const address = {
  line: 'Blk 4 Lot 12, Mabini St.',
  barangayCode: '0402119001',
  barangay: 'Kaybagal Central',
  cityCode: '0402119000',
  city: 'Tagaytay City',
  provinceCode: '0402100000',
  province: 'Cavite',
}
const valid = { fullName: 'Scale Ops', email: 'ops@example.test', phone: '09365408714', address }
const problem = (body: unknown) => {
  const parsed = resellerApplicationRequestSchema.safeParse(body)
  return parsed.success ? null : applicationProblem(parsed.error.issues)
}

describe('applicationProblem', () => {
  it('tells an applicant on an old copy of the form to refresh', () => {
    const { address: _address, ...old } = valid
    expect(problem({ ...old, city: '' })).toMatch(/out of date/)
  })

  it('names the field to fix', () => {
    expect(problem({ ...valid, address: undefined })).toMatch(/Add your delivery address/)
    expect(problem({ ...valid, address: { ...address, line: 'x' } })).toMatch(/house number and street/)
    expect(problem({ ...valid, address: { ...address, barangayCode: '' } })).toMatch(/barangay/)
    expect(problem({ ...valid, phone: '0281234567' })).toMatch(/Philippine mobile number/)
    expect(problem({ ...valid, email: 'not-an-email' })).toMatch(/valid email/)
    expect(problem({ ...valid, fullName: 'A' })).toMatch(/full name/)
  })

  it('accepts a complete application', () => {
    expect(problem(valid)).toBeNull()
  })
})
