import { describe, expect, it } from 'vitest'

import { sendCodeError } from './sign-in-errors'

describe('sendCodeError', () => {
  it('tells the reseller how long to wait between codes', () => {
    expect(
      sendCodeError({ status: 429, message: 'For security purposes, you can only request this after 42 seconds.' }),
    ).toBe('Please wait 42 seconds before requesting another code.')
  })

  it('explains the hourly email limit', () => {
    expect(sendCodeError({ status: 429, message: 'email rate limit exceeded' })).toMatch(/Too many codes/)
  })

  it('flags an invalid email and falls back to a retry message', () => {
    expect(sendCodeError({ status: 400, message: 'Unable to validate email address: invalid format' })).toBe(
      'Check the email address and try again.',
    )
    expect(sendCodeError({ status: 500, message: 'Something unexpected' })).toMatch(/not sent/)
  })

  it('names sender and sign-up problems the business must fix', () => {
    expect(sendCodeError({ status: 500, message: 'Error sending magic link email' })).toMatch(/email service/)
    expect(sendCodeError({ status: 422, message: 'Signups not allowed for otp' })).toMatch(/Sign-ups are turned off/)
    expect(sendCodeError({ status: 400, message: 'Email address "a@b.co" not authorized' })).toMatch(/email sender/)
  })
})
