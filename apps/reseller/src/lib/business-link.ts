/**
 * Which business a reseller portal link belongs to. A link like /?b=pablo opens PABLO's portal: its name,
 * logo and color on the sign-in page, and "PABLO Reseller" as the installed app. The phone remembers the
 * last business so the portal stays branded when opened without the link.
 */
const storageKey = 'hcs.reseller.business'
export const businessSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The business named in the link wins; otherwise the one this phone opened last. */
export function pickBusinessSlug(
  fromLink: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const link = fromLink?.trim().toLowerCase() ?? ''
  if (businessSlugPattern.test(link) && link.length <= 63) return link
  const saved = stored?.trim().toLowerCase() ?? ''
  return businessSlugPattern.test(saved) && saved.length <= 63 ? saved : null
}

function storedSlug(): string | null {
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

export function readBusinessSlug(): string | null {
  if (typeof window === 'undefined') return null
  return pickBusinessSlug(new URLSearchParams(window.location.search).get('b'), storedSlug())
}

export function rememberBusinessSlug(slug: string): void {
  try {
    window.localStorage.setItem(storageKey, slug)
  } catch {
    // Without storage the portal is branded only when opened from the business link.
  }
}

export function forgetBusinessSlug(): void {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Nothing stored.
  }
}

function headElement(selector: string, create: () => HTMLElement): HTMLElement {
  const found = document.head.querySelector<HTMLElement>(selector)
  if (found) return found
  const element = create()
  document.head.appendChild(element)
  return element
}

/**
 * Points the page at the business's installed-app manifest and icon, so "Add to Home Screen" saves
 * "PABLO Reseller" with PABLO's logo. iPhone reads the title and touch icon; Android reads the manifest.
 */
export function applyBusinessHead(
  apiBase: string | undefined,
  business: { slug: string; portalName: string; hasLogo: boolean },
): void {
  if (typeof document === 'undefined' || !apiBase) return
  const base = `${apiBase.replace(/\/$/, '')}/v1/public/reseller-portal/${encodeURIComponent(business.slug)}`
  document.title = business.portalName
  const manifest = headElement('link[rel="manifest"]', () => {
    const link = document.createElement('link')
    link.rel = 'manifest'
    return link
  })
  manifest.setAttribute('href', `${base}/manifest.webmanifest`)
  const title = headElement('meta[name="apple-mobile-web-app-title"]', () => {
    const meta = document.createElement('meta')
    meta.name = 'apple-mobile-web-app-title'
    return meta
  })
  title.setAttribute('content', business.portalName)
  if (business.hasLogo) {
    const icon = headElement('link[rel="apple-touch-icon"]', () => {
      const link = document.createElement('link')
      link.rel = 'apple-touch-icon'
      return link
    })
    icon.setAttribute('href', `${base}/icon`)
  }
}
