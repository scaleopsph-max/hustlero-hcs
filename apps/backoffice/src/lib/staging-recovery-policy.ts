import type { RecoveryScope } from './staging-recovery-entry'

export const diagnosticOwner = 'd4bc81e3-3391-4106-88c7-b256661d8f71'
export const diagnosticTenant = 'b3a4f304-7d38-46fe-831e-db0370f9d0c3'
export type DiagnosticEnvironment = {
  mode: string | undefined
  until: string | undefined
  origin: string
  api: string | undefined
  auth: string | undefined
  now: number
}
export const environment = (): DiagnosticEnvironment => ({
  mode: process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT,
  until: process.env.NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL,
  origin: window.location.origin,
  api: process.env.NEXT_PUBLIC_API_URL,
  auth: process.env.NEXT_PUBLIC_SUPABASE_URL,
  now: Date.now(),
})
export function assertRecoveryScope(
  scope: RecoveryScope,
  env: DiagnosticEnvironment,
  mode: 'historical-v1' | 'fresh-payment-funds-v1',
) {
  const until = Date.parse(env.until ?? '')
  if (
    env.mode !== mode ||
    env.origin !== 'https://hustlero-hcs-backoffice-staging.scaleopsph.workers.dev' ||
    env.api !== 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev' ||
    env.auth !== 'https://sdfwdhbryjyfufgtfqmf.supabase.co' ||
    scope.user !== diagnosticOwner ||
    scope.tenant !== diagnosticTenant ||
    !Number.isFinite(until) ||
    env.now >= until ||
    env.now < until - 3600000
  )
    throw new Error('Recovery diagnostics are unavailable for this scope or window.')
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
