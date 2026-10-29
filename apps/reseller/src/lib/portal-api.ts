import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export class PortalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message)
  }
}

let client: SupabaseClient | null = null

/** One browser Supabase client; null when the build is missing configuration. */
export function portalAuth(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) return null
  client ??= createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hcs.reseller.auth' },
  })
  return client
}

/** Turns a signed API-relative file path into an absolute URL. */
export function fileUrl(path: string): string {
  return `${(apiUrl ?? '').replace(/\/$/, '')}${path}`
}

export function apiConfigured(): boolean {
  return Boolean(apiUrl)
}

export async function portalRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  options: { token?: string; tenantId?: string; method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  if (!apiUrl) throw new PortalApiError('The reseller portal is not configured.', 0, null)
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? null : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    })
  } catch {
    throw new PortalApiError('Walang internet connection. Subukan ulit kapag may signal na.', 0, 'OFFLINE')
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (data as { error?: { message?: string; code?: string } } | null)?.error
    throw new PortalApiError(
      error?.message ?? 'Hindi natuloy ang request. Subukan ulit.',
      response.status,
      error?.code ?? null,
    )
  }
  return parse(data)
}

/** A fresh key per checkout; reused on retry so a double tap never creates two orders. */
export function newIdempotencyKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const tenantKey = 'hcs.reseller.tenant'

export function readSelectedTenant(): string | null {
  try {
    return window.localStorage.getItem(tenantKey)
  } catch {
    return null
  }
}

export function saveSelectedTenant(tenantId: string): void {
  try {
    window.localStorage.setItem(tenantKey, tenantId)
  } catch {
    // Selection falls back to the first business on the next visit.
  }
}
