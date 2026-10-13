import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Topbar } from './Topbar'

vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('@hcs/ui', () => ({
  Glass: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('header', { className }, children),
}))

describe('Topbar account indicator', () => {
  it('does not fabricate a person or owner role', () => {
    const markup = renderToStaticMarkup(React.createElement(Topbar, { title: 'Reports' }))
    expect(markup).toContain('aria-label="Account"')
    expect(markup).toContain('title="Account"')
    expect(markup).not.toContain('Ana Reyes')
    expect(markup).not.toContain('Owner')
    expect(markup).not.toContain('>AR<')
    expect(markup).not.toContain('href="/setup"')
  })
})
