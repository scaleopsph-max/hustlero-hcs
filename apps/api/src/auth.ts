import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

import { type Bindings, readSupabaseUrl } from './env'

export interface AuthenticatedUser {
  userId: string
  assuranceLevel?: 'aal1' | 'aal2'
}

export type AccessTokenVerifier = (accessToken: string, bindings: Bindings) => Promise<AuthenticatedUser | null>

const keySets = new Map<string, JWTVerifyGetKey>()

function readKeySet(supabaseUrl: URL): JWTVerifyGetKey {
  const keySetUrl = new URL('/auth/v1/.well-known/jwks.json', supabaseUrl)
  const cacheKey = keySetUrl.toString()
  const cached = keySets.get(cacheKey)

  if (cached) {
    return cached
  }

  const keySet = createRemoteJWKSet(keySetUrl)
  keySets.set(cacheKey, keySet)
  return keySet
}

export const verifySupabaseAccessToken: AccessTokenVerifier = async (accessToken, bindings) => {
  const supabaseUrl = readSupabaseUrl(bindings)

  try {
    const { payload } = await jwtVerify(accessToken, readKeySet(supabaseUrl), {
      audience: 'authenticated',
      issuer: new URL('/auth/v1', supabaseUrl).toString(),
    })

    if (!payload.sub) return null
    return {
      userId: payload.sub,
      assuranceLevel: payload.aal === 'aal2' ? 'aal2' : 'aal1',
    }
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return null
    }

    throw error
  }
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  return match?.[1] ?? null
}
