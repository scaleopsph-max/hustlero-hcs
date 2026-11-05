import { describe, expect, it } from 'vitest'

import { fitWithin, isImageFile } from './image-upload'

describe('photo preparation', () => {
  it('fits large photos inside the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 400)).toEqual({ width: 300, height: 400 })
  })

  it('never upscales small photos', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(0, 600, 1600)).toEqual({ width: 0, height: 0 })
  })

  it('recognises photos by type or extension', () => {
    expect(isImageFile(new File([''], 'receipt.png', { type: 'image/png' }))).toBe(true)
    expect(isImageFile(new File([''], 'IMG_0001.HEIC', { type: '' }))).toBe(true)
    expect(isImageFile(new File([''], 'notes.txt', { type: 'text/plain' }))).toBe(false)
  })
})
