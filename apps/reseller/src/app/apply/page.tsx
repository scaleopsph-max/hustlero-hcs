import type { Metadata } from 'next'

import { ApplicationForm } from '@/components/ApplicationForm'

export const metadata: Metadata = { title: 'Maging reseller' }

export default function ApplyPage() {
  return <ApplicationForm />
}
