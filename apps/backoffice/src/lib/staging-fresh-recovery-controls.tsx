'use client'
import { useState } from 'react'
import { FlaskConical, Check } from 'lucide-react'
import type { RecoveryControlProps } from './staging-recovery-entry'
import { diagnosticOwner, diagnosticTenant, assertRecoveryScope, environment } from './staging-recovery-policy'
import {
  readFreshState,
  armFreshCase,
  finishFreshCases,
  freshPaymentBody,
  freshFundBody,
} from './staging-fresh-recovery'

export default function FreshRecoveryControls({ family, scope, context }: RecoveryControlProps) {
  const [error, setError] = useState('')
  if (family === 'orders' || scope.user !== diagnosticOwner || scope.tenant !== diagnosticTenant) return null
  let state
  try {
    const env = environment()
    assertRecoveryScope(scope, env, 'fresh-payment-funds-v1')
    state = readFreshState(sessionStorage, env)
  } catch {
    return null
  }
  const entry = state[family]
  return (
    <section
      aria-label="Fresh recovery diagnostics"
      className="space-y-2 border-y border-amber-500 bg-amber-50 p-3 text-sm"
    >
      <h2 className="font-semibold">Staging fresh payment/fund UAT</h2>
      <p>
        Expires {state.until}. {(state.payment?.attempts ?? 0) + (state.funds?.attempts ?? 0)} / 4 requests.
      </p>
      <p className="break-words">
        {family === 'payment'
          ? `PHP 1,600 / ${freshPaymentBody.reference}`
          : `PHP 1,000 Capital / PHP 600 Operating / ${freshFundBody('').settlementReference}`}
      </p>
      {state.payment?.response !== null && state.payment && (
        <p className="break-words">Fresh receipt: {(state.payment.response as { paymentId: string }).paymentId}</p>
      )}
      {entry && (
        <p className="break-words">
          {family}: {entry.phase} / original key {entry.key}
        </p>
      )}
      <button
        type="button"
        disabled={!!state.armed || !!entry || (family === 'funds' && state.payment?.phase !== 'recovered')}
        className="inline-flex items-center gap-2 rounded border border-ink-900/20 px-3 py-2 disabled:opacity-50"
        onClick={() => {
          try {
            armFreshCase(family, scope, context)
            window.location.reload()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Fresh test arming refused.')
          }
        }}
      >
        <FlaskConical size={16} />
        Arm fresh {family} test
      </button>
      {state.payment?.phase === 'recovered' && state.funds?.phase === 'recovered' && (
        <button
          type="button"
          className="ml-3 inline-flex items-center gap-2 border px-3 py-2"
          onClick={() => {
            try {
              finishFreshCases(scope)
              window.location.reload()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Cleanup refused.')
            }
          }}
        >
          <Check size={16} />
          Finish fresh test batch
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
