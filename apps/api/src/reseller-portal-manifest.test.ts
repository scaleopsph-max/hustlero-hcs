import { describe, expect, it } from 'vitest'

import { buildPortalManifest } from './reseller-portal-manifest'

const portalOrigin = 'https://reseller.example.test/'

describe('buildPortalManifest', () => {
  it('names the installed app after the business and opens its own link', () => {
    const manifest = buildPortalManifest({
      portalOrigin,
      iconUrl: null,
      tenantSlug: 'pablo',
      portalName: 'PABLO Reseller',
    })
    expect(manifest).toMatchObject({
      id: 'https://reseller.example.test/?b=pablo',
      name: 'PABLO Reseller',
      short_name: 'PABLO',
      start_url: 'https://reseller.example.test/?b=pablo&source=pwa',
      scope: 'https://reseller.example.test/',
    })
    expect(manifest.icons[0]?.src).toBe('https://reseller.example.test/icon-192.png')
  })

  it('uses the business logo and shortens long names for the home screen', () => {
    const manifest = buildPortalManifest({
      portalOrigin,
      iconUrl: 'https://api.example.test/v1/public/reseller-portal/lokal/icon',
      tenantSlug: 'lokal',
      portalName: 'LOKAL RECIPE Reseller',
    })
    expect(manifest.short_name).toBe('LOKAL RECIPE')
    expect(manifest.icons[0]).toEqual({
      src: 'https://api.example.test/v1/public/reseller-portal/lokal/icon',
      sizes: '512x512',
      purpose: 'any',
    })
  })
})
