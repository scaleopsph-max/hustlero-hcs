'use client'
import { lazy, Suspense } from 'react'

export type RecoveryScope = { user: string; tenant: string }
export type RecoveryFamily = 'payment' | 'funds' | 'orders'
export type RecoveryControlProps = { family: RecoveryFamily; scope: RecoveryScope; context: unknown }
export type RecoveryRequest = { scope: RecoveryScope; path: string; key: string; body: unknown }

const enabled = process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT === 'historical-v1'
const fresh = process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT === 'fresh-payment-funds-v1'
const Controls = enabled
  ? lazy(() => import('./staging-recovery-controls'))
  : fresh
    ? lazy(() => import('./staging-fresh-recovery-controls'))
    : null

export function StagingRecoveryControls(props: RecoveryControlProps) {
  return Controls ? (
    <Suspense fallback={null}>
      <Controls {...props} />
    </Suspense>
  ) : null
}

export function assertRecoveryPending(pending: unknown) {
  if (enabled && !pending) throw new Error('Diagnostic build permits original pending commands only.')
}

export async function recoveryRequest(request: RecoveryRequest, send: () => Promise<unknown>) {
  if (fresh) {
    const { freshRequestWithFault } = await import('./staging-fresh-recovery')
    return freshRequestWithFault(request, send)
  }
  if (!enabled) return send()
  const { replayWithFault } = await import('./staging-recovery-diagnostics')
  return replayWithFault(request, send)
}
