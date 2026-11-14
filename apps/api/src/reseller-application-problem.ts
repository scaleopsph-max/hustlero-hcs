import type { z } from 'zod'

/**
 * One plain sentence naming what is wrong with a reseller application, so the applicant knows which field
 * to fix. An application from an older copy of the form (it still sends "city") is told to refresh.
 */
export function applicationProblem(issues: readonly z.core.$ZodIssue[]): string {
  if (issues.some((issue) => issue.code === 'unrecognized_keys'))
    return 'This form is out of date. Refresh the page, or close and reopen the app, then apply again.'
  const first = issues[0]
  const [field, part] = first?.path ?? []
  if (field === 'fullName') return 'Enter your full name (at least 2 characters).'
  if (field === 'businessName') return 'Enter a store name of at least 2 characters, or leave it blank.'
  if (field === 'email') return 'Enter a valid email address.'
  if (field === 'phone') return 'Enter a Philippine mobile number, like 0917 123 4567.'
  if (field === 'address' && part === 'line') return 'Enter your house number and street (at least 5 characters).'
  if (field === 'address' && part === undefined)
    return 'Add your delivery address: province, city or municipality, barangay, and house number and street.'
  if (field === 'address') return 'Choose your province, city or municipality, and barangay.'
  if (field === 'message') return 'Keep your message under 1,000 characters.'
  return 'Check your details and try again.'
}
