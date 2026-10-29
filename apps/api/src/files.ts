/**
 * File storage helpers. Bytes live in Cloudflare R2; PostgreSQL keeps the record.
 * Images reach browsers through short-lived signed URLs, so <img> tags work without
 * an Authorization header and objects are never public.
 */

export type FileKind = 'product_image' | 'payment_proof'
export type StoredMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

/** The slice of the R2 binding the API uses. */
export interface FileBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
  delete(keys: string | string[]): Promise<void>
}

export const PRODUCT_IMAGE_MAX_BYTES = 2_621_440 // 2.5 MiB, after browser resizing
export const THUMB_MAX_BYTES = 524_288
export const PAYMENT_PROOF_MAX_BYTES = 5_242_880
export const UPLOAD_REQUEST_MAX_BYTES = 6_291_456

export function storageKey(tenantId: string, kind: FileKind, fileId: string, variant: 'main' | 'thumb'): string {
  return `t/${tenantId}/${kind}/${fileId}/${variant}`
}

const storageKeyPattern = /^t\/[0-9a-f-]{36}\/(product_image|payment_proof)\/[0-9a-f-]{36}\/(main|thumb)$/

/** Detects the real type from the first bytes; the browser-reported type is never trusted. */
export function detectMime(bytes: Uint8Array): StoredMime | null {
  const at = (index: number) => bytes[index] ?? -1
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => at(index) === value)) return 'image/png'
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf'
  return null
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

/** Product photos share one expiry per 6-hour window so URLs stay stable and cacheable. */
export function productImageExpiry(nowSeconds: number): number {
  const window = 6 * 3600
  return (Math.floor(nowSeconds / window) + 1) * window + 18 * 3600
}

/** Payment proofs are private; their links expire within about 15 minutes. */
export function paymentProofExpiry(nowSeconds: number): number {
  return (Math.floor(nowSeconds / 60) + 15) * 60
}

export interface FileUrlSigner {
  sign(key: string, expiresAt: number): Promise<string>
}

/** Returns API-relative paths; each client prefixes its configured API URL. */
export function createFileUrlSigner(secret: string): FileUrlSigner {
  return {
    async sign(key, expiresAt) {
      const signature = await hmac(secret, `${key}\n${expiresAt}`)
      return `/v1/files/content?key=${encodeURIComponent(key)}&exp=${expiresAt}&sig=${signature}`
    },
  }
}

export async function verifyFileUrl(
  secret: string,
  key: string | undefined,
  exp: string | undefined,
  sig: string | undefined,
  nowSeconds: number,
): Promise<string | null> {
  if (!key || !exp || !sig || !storageKeyPattern.test(key) || !/^\d{9,11}$/.test(exp)) return null
  const expiresAt = Number(exp)
  if (expiresAt < nowSeconds || expiresAt > nowSeconds + 2 * 86400) return null
  const expected = await hmac(secret, `${key}\n${expiresAt}`)
  if (expected.length !== sig.length) return null
  let difference = 0
  for (let index = 0; index < expected.length; index += 1)
    difference |= expected.charCodeAt(index) ^ sig.charCodeAt(index)
  return difference === 0 ? key : null
}

export type StoredImageKey = {
  productId: string
  fileId: string
  position: number
  storageKey: string
  thumbStorageKey: string | null
  variantIds: string[]
}

export type SignedProductImage = { fileId: string; position: number; url: string; thumbUrl: string }

/** Groups active product photos by product with signed URLs, primary first. */
export async function signProductImages(
  images: StoredImageKey[],
  signer: FileUrlSigner,
  nowSeconds: number,
): Promise<Map<string, SignedProductImage[]>> {
  const expiresAt = productImageExpiry(nowSeconds)
  const grouped = new Map<string, SignedProductImage[]>()
  for (const image of [...images].sort((a, b) => a.position - b.position)) {
    const url = await signer.sign(image.storageKey, expiresAt)
    const thumbUrl = image.thumbStorageKey ? await signer.sign(image.thumbStorageKey, expiresAt) : url
    const list = grouped.get(image.productId) ?? []
    list.push({ fileId: image.fileId, position: image.position, url, thumbUrl })
    grouped.set(image.productId, list)
  }
  return grouped
}
