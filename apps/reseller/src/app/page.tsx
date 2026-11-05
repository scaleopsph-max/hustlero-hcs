import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { PortalApp } from '@/components/PortalApp'
import { businessCookie, businessMetadata } from '@/lib/business-meta'

// Rendered per request: the business in the link decides the page's name and icon.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const [params, jar] = await Promise.all([searchParams, cookies()])
  return businessMetadata(params.b, jar.get(businessCookie)?.value)
}

export default function ResellerHome() {
  return <PortalApp />
}
