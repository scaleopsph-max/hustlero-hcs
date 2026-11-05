import type { Metadata } from 'next'

import { ApplicationForm } from '@/components/ApplicationForm'
import { businessMetadata } from '@/lib/business-meta'

// Rendered per request: the business in the link decides the page's name and icon.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  return businessMetadata((await searchParams).b, undefined, (name) => `Become a reseller · ${name}`)
}

export default function ApplyPage() {
  return <ApplicationForm />
}
