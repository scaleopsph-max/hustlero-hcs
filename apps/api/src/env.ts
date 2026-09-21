import { environmentSchema } from '@hcs/contracts'

export interface Bindings {
  ENVIRONMENT: string
  SUPABASE_URL?: string
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
