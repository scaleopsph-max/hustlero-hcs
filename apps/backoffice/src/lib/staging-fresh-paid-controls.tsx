'use client'
import { useState } from 'react'
import { FlaskConical, Check } from 'lucide-react'
import type { RecoveryControlProps } from './staging-recovery-entry'
import { assertRecoveryScope, environment } from './staging-recovery-policy'
import { paidCases, armPaidCase, closePaidCase, finishPaidCases, readPaidState } from './staging-fresh-paid'
export default function FreshPaidControls({ family, scope, context }: RecoveryControlProps) {
  const [error, setError] = useState('')
  if (family !== 'orders') return null
  let state
  try {
    const env = environment()
    assertRecoveryScope(scope, env, 'fresh-paid-v1')
    state = readPaidState(sessionStorage, env)
  } catch {
    return null
  }
  const action = (run: () => void) => {
    try {
      run()
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Paid test refused.')
    }
  }
  return (
    <section
      aria-label="Fresh paid recovery diagnostics"
      className="space-y-2 border-y border-amber-500 bg-amber-50 p-3 text-sm"
    >
      <h2 className="font-semibold">Staging fresh COD/Prepaid UAT</h2>
      <p>
        Expires {state.until}. {(state.cod?.attempts ?? 0) + (state.prepaid?.attempts ?? 0)} / 4 fulfillment requests.
      </p>
      {paidCases.map((id) => (
        <div key={id} className="space-y-2">
          <p className="break-words">
            {id}: {state[id]?.phase ?? 'not armed'} / confirm {state[id]?.confirmation ?? 'not started'} / original key{' '}
            {state[id]?.key ?? 'not generated'}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 border px-3 py-2 disabled:opacity-50"
            disabled={!!state.active || !!state[id] || (id === 'prepaid' && state.cod?.phase !== 'closed')}
            onClick={() => action(() => armPaidCase(id, scope, context))}
          >
            <FlaskConical size={16} />
            Arm fresh {id} draft
          </button>
          <button
            type="button"
            className="ml-3 inline-flex items-center gap-2 border px-3 py-2 disabled:opacity-50"
            disabled={state[id]?.phase !== 'recovered'}
            onClick={() => action(() => closePaidCase(id, scope, context))}
          >
            <Check size={16} />
            Reconcile cancelled {id} case
          </button>
        </div>
      ))}
      {paidCases.every((id) => state[id]?.phase === 'closed') && (
        <button
          type="button"
          className="inline-flex items-center gap-2 border px-3 py-2"
          onClick={() => action(() => finishPaidCases(scope))}
        >
          <Check size={16} />
          Finish fresh paid batch
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
