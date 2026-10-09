import { describe, expect, it } from 'vitest'
import { resolveRecoveryMfa } from './recovery-mfa'

describe('resolveRecoveryMfa', () => {
  it('requires the verified TOTP factor when recovery is AAL1 and the account supports AAL2', () => {
    expect(
      resolveRecoveryMfa('aal1', 'aal2', [
        { id: 'pending', status: 'unverified' },
        { id: 'verified', status: 'verified' },
      ]),
    ).toEqual({ kind: 'challenge', factorId: 'verified' })
  })

  it('allows password update after the recovery session reaches AAL2', () => {
    expect(resolveRecoveryMfa('aal2', 'aal2', [])).toEqual({ kind: 'verified' })
  })

  it('does not require MFA for an account without an AAL2 factor', () => {
    expect(resolveRecoveryMfa('aal1', 'aal1', [])).toEqual({ kind: 'not-required' })
  })

  it('fails closed when AAL2 is required but no verified TOTP factor is available', () => {
    expect(resolveRecoveryMfa('aal1', 'aal2', [{ id: 'pending', status: 'unverified' }])).toEqual({
      kind: 'missing-factor',
    })
  })
})
