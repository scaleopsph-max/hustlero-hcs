import { describe, expect, it, vi } from 'vitest'

import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPushPayload,
  importEcdhKeyPair,
  sendPush,
  vapidAuthorization,
} from './web-push'

// RFC 8291, Appendix A.
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_' +
    'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('web push', () => {
  it('reproduces the RFC 8291 encrypted message exactly', async () => {
    const body = await encryptPushPayload(
      new TextEncoder().encode(rfc.plaintext),
      { p256dh: rfc.uaPublic, auth: rfc.authSecret },
      { salt: base64UrlDecode(rfc.salt), serverKeys: await importEcdhKeyPair(rfc.asPublic, rfc.asPrivate) },
    )
    expect(base64UrlEncode(body)).toBe(rfc.body)
  })

  it('signs a VAPID token the public key verifies, scoped to the push service origin', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const publicKey = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
    const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d!
    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      { publicKey, privateKey },
      'https://example.test',
      Date.parse('2026-10-30T00:00:00Z'),
    )
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match?.[4]).toBe(publicKey)
    const [, head, claims, signature] = match!
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims!)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Date.parse('2026-10-30T12:00:00Z') / 1000,
      sub: 'https://example.test',
    })
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.publicKey,
      base64UrlDecode(signature!),
      new TextEncoder().encode(`${head}.${claims}`),
    )
    expect(valid).toBe(true)
  })

  it('reports sent, gone, and failed deliveries', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
    const vapid = {
      publicKey: base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
      privateKey: (await crypto.subtle.exportKey('jwk', keys.privateKey)).d!,
    }
    const target = { endpoint: 'https://push.example.test/sub/1', p256dh: rfc.uaPublic, auth: rfc.authSecret }
    const message = { title: 'Order RP-000001 is on the way', body: 'J&T', url: '/?order=x', tag: 'n1' }
    const send = vi.fn(async () => new Response(null, { status: 201 }))
    expect(await sendPush(target, message, vapid, 'https://example.test', send)).toBe('sent')
    const init = (send.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' })
    expect(
      await sendPush(target, message, vapid, 'https://example.test', async () => new Response(null, { status: 410 })),
    ).toBe('gone')
    expect(
      await sendPush(target, message, vapid, 'https://example.test', async () => new Response(null, { status: 500 })),
    ).toBe('failed')
    expect(
      await sendPush(target, message, vapid, 'https://example.test', async () => {
        throw new Error('offline')
      }),
    ).toBe('failed')
  })
})
