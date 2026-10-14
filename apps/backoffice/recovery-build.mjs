import process from 'node:process'

export function recoveryBuildEnv(env = process.env, now = Date.now()) {
  const enabled = env.NEXT_PUBLIC_HCS_RECOVERY_UAT === 'historical-v1'
  if (env.NEXT_PUBLIC_HCS_RECOVERY_UAT && !enabled && env.NEXT_PUBLIC_HCS_RECOVERY_UAT !== 'off')
    throw new Error('Unknown recovery diagnostic build mode.')
  if (enabled) {
    const until = Date.parse(env.NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL ?? '')
    if (
      env.CLOUDFLARE_ENV !== 'staging' ||
      env.NEXT_PUBLIC_API_URL !== 'https://hustlero-hcs-api-staging.scaleopsph.workers.dev' ||
      env.NEXT_PUBLIC_SUPABASE_URL !== 'https://sdfwdhbryjyfufgtfqmf.supabase.co' ||
      !Number.isFinite(until) ||
      until <= now ||
      until > now + 60 * 60 * 1000
    )
      throw new Error('Recovery diagnostics require exact Staging endpoints and a maximum 60-minute window.')
  }
  return {
    NEXT_PUBLIC_HCS_RECOVERY_UAT: enabled ? 'historical-v1' : 'off',
    NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: enabled ? env.NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL : '',
  }
}
