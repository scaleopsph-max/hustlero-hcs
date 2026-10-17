'use client'
import { useState } from 'react'
import { RotateCcw, Check } from 'lucide-react'
import type { RecoveryControlProps } from './staging-recovery-entry'
import {
  assertDiagnosticScope,
  environment,
  familyCases,
  restoreDiagnosticCase,
  finishDiagnostics,
  readDiagnosticState,
} from './staging-recovery-diagnostics'

export default function RecoveryControls({ family, scope, context }: RecoveryControlProps) {
  const [error, setError] = useState('')
  let state
  try {
    const env = environment()
    assertDiagnosticScope(scope, env)
    state = readDiagnosticState(sessionStorage, env)
  } catch {
    return null
  }
  return (
    <section
      aria-label="Historical recovery diagnostics"
      className="space-y-3 border-y border-amber-500 bg-amber-50 p-3 text-sm"
    >
      <h2 className="font-semibold">Staging historical recovery UAT</h2>
      <p>
        Expires {state.until}. Historical replay only.{' '}
        {Object.values(state.entries).reduce((n, e) => n + e.attempts, 0)} / 8 requests.
      </p>
      {familyCases(family).map((fixture) => (
        <button
          key={fixture.id}
          type="button"
          disabled={state.entries[fixture.id as keyof typeof state.entries].attempts > 0}
          className="mr-3 inline-flex items-center gap-2 rounded border border-ink-900/20 px-3 py-2 disabled:opacity-50"
          onClick={() => {
            try {
              restoreDiagnosticCase(fixture.id, scope, context)
              window.location.reload()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Diagnostic restoration refused.')
            }
          }}
        >
          <RotateCcw size={16} />
          Restore historical {fixture.id}
        </button>
      ))}
      {Object.values(state.entries).every((e) => e.completed) && (
        <button
          type="button"
          className="inline-flex items-center gap-2 border px-3 py-2"
          onClick={() => {
            try {
              finishDiagnostics(scope)
              window.location.reload()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Cleanup refused.')
            }
          }}
        >
          <Check size={16} />
          Finish diagnostic batch
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
