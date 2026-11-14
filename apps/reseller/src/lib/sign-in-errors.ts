/** Explains why Supabase did not send a code, so a reseller knows whether to wait or fix the email. */
export function sendCodeError(error: { status?: number | undefined; message?: string | undefined }): string {
  const message = error.message ?? ''
  const seconds = /after (\d+) seconds?/i.exec(message)?.[1]
  if (seconds) return `Please wait ${seconds} seconds before requesting another code.`
  if (error.status === 429 || /rate limit/i.test(message))
    return 'Too many codes were requested. Please wait a few minutes and try again.'
  if (/invalid/i.test(message) && /email/i.test(message)) return 'Check the email address and try again.'
  if (/signups? not allowed/i.test(message))
    return 'Sign-ups are turned off for this portal. Ask the business to check its sign-in settings.'
  if (/not authorized/i.test(message))
    return 'This email cannot receive codes yet. Ask the business to set up its email sender.'
  if (/error sending/i.test(message))
    return 'The email service could not send the code. Ask the business to check its email sender.'
  return 'The code was not sent. Please try again in a moment.'
}
