import { resellerPortalPublicSchema, type ResellerPortalPublic } from '@hcs/contracts'
import type { Metadata } from 'next'

import { pickBusinessSlug } from './business-link'

/** Cookie the portal sets when it remembers a business, so a plain link still renders that business's name. */
export const businessCookie = 'hcs_business'

const apiUrl = process.env.NEXT_PUBLIC_API_URL

export const defaultMetadata: Metadata = {
  title: 'HCS Reseller Portal',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Reseller', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
}

/** The business's public portal details, or null when it cannot be loaded in time. */
export async function loadPublicPortal(slug: string): Promise<ResellerPortalPublic | null> {
  if (!apiUrl) return null
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/public/reseller-portal/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return resellerPortalPublicSchema.parse(await response.json())
  } catch {
    return null
  }
}

export function portalDisplayName(portal: ResellerPortalPublic): string {
  return portal.branding?.portalName ?? `${portal.businessName} Reseller`
}

/**
 * Page metadata for the business in the link (or the one this phone remembered): its name and icon in the
 * HTML itself, because iPhone's "Add to Home Screen" reads the page as the server sent it.
 */
export async function businessMetadata(
  fromLink: string | string[] | undefined,
  remembered: string | undefined,
  title?: (name: string) => string,
): Promise<Metadata> {
  const slug = pickBusinessSlug(typeof fromLink === 'string' ? fromLink : undefined, remembered)
  const portal = slug ? await loadPublicPortal(slug) : null
  if (!portal) return defaultMetadata
  const name = portalDisplayName(portal)
  const base = `/b/${encodeURIComponent(portal.tenantSlug)}`
  const icon = portal.branding?.logoUrl ? `${base}/icon` : '/apple-touch-icon.png'
  return {
    title: title ? title(name) : name,
    manifest: `${base}/manifest`,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'black-translucent' },
    icons: { icon: portal.branding?.logoUrl ? `${base}/icon` : '/icon-192.png', apple: icon },
  }
}
