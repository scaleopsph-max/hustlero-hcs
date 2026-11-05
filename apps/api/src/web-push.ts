// Web Push with WebCrypto only (runs in Cloudflare Workers): VAPID (RFC 8292) and aes128gcm payloads (RFC 8291).

const encoder = new TextEncoder()

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). Shared with browsers as applicationServerKey. */
  publicKey: string
  /** P-256 private scalar `d`, base64url (32 bytes). Worker secret. */
  privateKey: string
}

export interface PushTarget {
  endpoint: string
  /** Browser public key, base64url (65 bytes). */
  p256dh: string
  /** Browser auth secret, base64url (16 bytes). */
  auth: string
}

export type PushOutcome = 'sent' | 'gone' | 'failed'

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function privateJwk(publicKey: Uint8Array, d: string): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4)
    throw new Error('A P-256 public key must be 65 uncompressed bytes.')
  return {
    kty: 'EC',
    crv: 'P-256',
    d,
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    ext: true,
  }
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** The `Authorization` header value for one push service origin; valid for 12 hours. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: number = Date.now(),
): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }),
    ),
  )
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(base64UrlDecode(keys.publicKey), keys.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  // WebCrypto returns the raw r||s signature that JWS ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)),
  )
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${keys.publicKey}`
}

/**
 * Encrypts one push message for one browser (RFC 8291, single aes128gcm record).
 * `salt` and `serverKeys` are only passed by tests to reproduce the RFC example.
 */
export async function encryptPushPayload(
  plaintext: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  options: { salt?: Uint8Array<ArrayBuffer>; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > 3800) throw new Error('Push payload is too large.')
  const uaPublic = base64UrlDecode(target.p256dh)
  const authSecret = base64UrlDecode(target.auth)
  const serverKeys =
    options.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256),
  )
  const ikm = await hkdf(authSecret, ecdhSecret, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // A single record: the plaintext followed by the last-record delimiter 0x02.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))),
  )
  const recordSize = new Uint8Array([0, 0, 0x10, 0]) // 4096
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

/** Imports an ECDH key pair from base64url raw public key and private `d` (tests and tooling). */
export async function importEcdhKeyPair(publicKey: string, d: string): Promise<CryptoKeyPair> {
  const raw = base64UrlDecode(publicKey)
  return {
    publicKey: await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', privateJwk(raw, d), { name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]),
  }
}

export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
}

/** Sends one notification to one browser. 404/410 mean the browser unsubscribed. */
export async function sendPush(
  target: PushTarget,
  message: PushMessage,
  keys: VapidKeys,
  subject: string,
  send: typeof fetch = fetch,
): Promise<PushOutcome> {
  try {
    const body = await encryptPushPayload(encoder.encode(JSON.stringify(message)), target)
    const response = await send(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(target.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
    })
    if (response.ok) return 'sent'
    return response.status === 404 || response.status === 410 ? 'gone' : 'failed'
  } catch {
    return 'failed'
  }
}
