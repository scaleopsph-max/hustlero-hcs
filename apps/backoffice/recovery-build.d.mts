export function recoveryBuildEnv(
  env?: Record<string, string | undefined>,
  now?: number,
): {
  NEXT_PUBLIC_HCS_RECOVERY_UAT: string
  NEXT_PUBLIC_HCS_RECOVERY_UAT_UNTIL: string
}
