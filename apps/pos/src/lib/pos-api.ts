import { posCustomerSchema, posPinLoginResponseSchema, type PosCustomer } from '@hcs/contracts'

export const POS_SESSION_KEY = 'hustlero.pos.session'
export const POS_CART_KEY = 'hustlero.pos.cart'
export const POS_CUSTOMER_KEY = 'hustlero.pos.customer'

export type PosCartLine = { variantId: string; quantityMilli: number }

export function readPosSession() {
  const raw = sessionStorage.getItem(POS_SESSION_KEY)
  if (!raw) return null
  try {
    return posPinLoginResponseSchema.parse(JSON.parse(raw))
  } catch {
    sessionStorage.removeItem(POS_SESSION_KEY)
    return null
  }
}

export function readPosCart(): PosCartLine[] {
  const raw = sessionStorage.getItem(POS_CART_KEY)
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter(
      (line): line is PosCartLine =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as PosCartLine).variantId === 'string' &&
        Number.isInteger((line as PosCartLine).quantityMilli) &&
        (line as PosCartLine).quantityMilli > 0,
    )
  } catch {
    return []
  }
}

export function writePosCart(lines: PosCartLine[]) {
  sessionStorage.setItem(POS_CART_KEY, JSON.stringify(lines))
}

export function readPosCustomer(): PosCustomer | null {
  const raw = sessionStorage.getItem(POS_CUSTOMER_KEY)
  if (!raw) return null
  try {
    return posCustomerSchema.parse(JSON.parse(raw))
  } catch {
    sessionStorage.removeItem(POS_CUSTOMER_KEY)
    return null
  }
}

export function writePosCustomer(customer: PosCustomer | null) {
  if (customer) sessionStorage.setItem(POS_CUSTOMER_KEY, JSON.stringify(customer))
  else sessionStorage.removeItem(POS_CUSTOMER_KEY)
}

export function newIdempotencyKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

export async function posRequest(path: string, init: RequestInit = {}) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const session = readPosSession()
  if (!apiUrl || !session) throw new Error('POS session is unavailable. Sign in again.')
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-POS-Session-Token': session.sessionToken,
      ...init.headers,
    },
  })
  const data: unknown = await response.json().catch(() => null)
  if (response.status === 401) {
    sessionStorage.removeItem(POS_SESSION_KEY)
    throw new Error('Your POS session expired. Sign in again.')
  }
  if (!response.ok) {
    throw new Error((data as { error?: { message?: string } } | null)?.error?.message ?? 'Request failed.')
  }
  return data
}
