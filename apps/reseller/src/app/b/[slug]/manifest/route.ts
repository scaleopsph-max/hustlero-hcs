import { businessSlugPattern } from '@/lib/business-link'

const apiUrl = process.env.NEXT_PUBLIC_API_URL

/**
 * The business's installed-app manifest, served from the portal's own address so phones accept it.
 * Built by the API; the icon is pointed at this portal's icon route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!apiUrl || !businessSlugPattern.test(slug) || slug.length > 63) return new Response('Not found', { status: 404 })
  const api = apiUrl.replace(/\/$/, '')
  const response = await fetch(`${api}/v1/public/reseller-portal/${encodeURIComponent(slug)}/manifest.webmanifest`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  if (!response?.ok) return new Response('Not found', { status: 404 })
  const origin = new URL(request.url).origin
  const apiIcon = `${api}/v1/public/reseller-portal/${encodeURIComponent(slug)}/icon`
  const ownIcon = `${origin}/b/${encodeURIComponent(slug)}/icon`
  const body = (await response.text()).split(apiIcon).join(ownIcon)
  return new Response(body, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' },
  })
}
