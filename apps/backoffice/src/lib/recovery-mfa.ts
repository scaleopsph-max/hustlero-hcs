export type RecoveryMfaDecision =
  { kind: 'verified' } | { kind: 'not-required' } | { kind: 'challenge'; factorId: string } | { kind: 'missing-factor' }

type TotpFactor = { id: string; status: 'verified' | 'unverified' }

export function resolveRecoveryMfa(
  currentLevel: string | null,
  nextLevel: string | null,
  factors: TotpFactor[],
): RecoveryMfaDecision {
  if (currentLevel === 'aal2') return { kind: 'verified' }
  if (nextLevel !== 'aal2') return { kind: 'not-required' }

  const factor = factors.find((item) => item.status === 'verified')
  return factor ? { kind: 'challenge', factorId: factor.id } : { kind: 'missing-factor' }
}
