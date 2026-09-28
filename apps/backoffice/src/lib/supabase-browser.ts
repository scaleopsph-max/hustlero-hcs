import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

export type { SupabaseClient, User } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null
let browserClientConfiguration: string | null = null

export function createClient(url: string, publishableKey: string): SupabaseClient {
  const configuration = `${url}\n${publishableKey}`
  if (browserClient && browserClientConfiguration !== configuration) {
    throw new Error('Supabase browser client was initialized with different configuration.')
  }
  if (!browserClient) {
    browserClient = createSupabaseClient(url, publishableKey)
    browserClientConfiguration = configuration
  }
  return browserClient
}
