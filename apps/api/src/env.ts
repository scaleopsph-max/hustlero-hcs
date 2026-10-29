import { environmentSchema } from '@hcs/contracts'

import type { FileBucket } from './files'

export interface Bindings {
  ENVIRONMENT: string
  SUPABASE_URL?: string
  BACKOFFICE_ORIGIN?: string
  POS_ORIGIN?: string
  ADMIN_ORIGIN?: string
  RESELLER_ORIGIN?: string
  /** Cloudflare R2 bucket for tenant files. */
  FILES?: FileBucket
  /** Secret for signing file links (Worker secret, never a plain var). */
  FILES_URL_SECRET?: string
  HYPERDRIVE?: {
    connectionString: string
  }
}

export function readEnvironment(bindings: Bindings) {
  return environmentSchema.parse(bindings.ENVIRONMENT)
}

export function readSupabaseUrl(bindings: Bindings): URL {
  if (!bindings.SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not configured.')
  }

  return new URL(bindings.SUPABASE_URL)
}
