/**
 * The installed-app manifest for one business's reseller portal, so a reseller's home screen shows
 * "PABLO Reseller" with PABLO's logo instead of a generic app. The portal page links to it with ?b=<slug>.
 */
export interface PortalManifestInput {
  /** Reseller portal origin, e.g. https://hustlero-hcs-reseller-staging.scaleopsph.workers.dev */
  portalOrigin: string
  /** Absolute URL of this business's icon route, or null when the business has no logo. */
  iconUrl: string | null
  tenantSlug: string
  portalName: string
}

const background = '#08080A'

export function buildPortalManifest({ portalOrigin, iconUrl, tenantSlug, portalName }: PortalManifestInput) {
  const origin = portalOrigin.replace(/\/$/, '')
  const business = encodeURIComponent(tenantSlug)
  const defaults = [
    { src: `${origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${origin}/icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${origin}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
  return {
    id: `${origin}/?b=${business}`,
    name: portalName,
    short_name:
      portalName.length <= 12
        ? portalName
        : portalName
            .replace(/\s+Reseller$/i, '')
            .slice(0, 12)
            .trim(),
    description: 'Order at your reseller price and track every order.',
    start_url: `${origin}/?b=${business}&source=pwa`,
    scope: `${origin}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: background,
    theme_color: background,
    lang: 'en',
    icons: iconUrl
      ? [
          { src: iconUrl, sizes: '512x512', purpose: 'any' },
          { src: iconUrl, sizes: '192x192', purpose: 'any' },
          defaults[2],
        ]
      : defaults,
  }
}
