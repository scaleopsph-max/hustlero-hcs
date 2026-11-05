import { businessSlugPattern } from '@/lib/business-link'

const apiUrl = process.env.NEXT_PUBLIC_API_URL

/**
 * The business logo as the app icon, from the portal's own address (iPhone and Android fetch it when the
 * app is added to the home screen). Falls back to the default icon when the business has no logo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const fallback = Response.redirect(new URL('/apple-touch-icon.png', request.url), 302)
  if (!apiUrl || !businessSlugPattern.test(slug) || slug.length > 63) return fallback
  const response = await fetch(
    `${apiUrl.replace(/\/$/, '')}/v1/public/reseller-portal/${encodeURIComponent(slug)}/icon`,
    { signal: AbortSignal.timeout(5000) },
  ).catch(() => null)
  const type = response?.headers.get('content-type') ?? ''
  if (!response?.ok || !type.startsWith('image/')) return fallback
  return new Response(response.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}
