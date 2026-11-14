/**
 * Browser-side photo preparation. Phones take 4–12 MB photos; resizing before upload keeps
 * uploads fast on mobile data and gives every photo a small thumbnail for lists and the POS grid.
 */

export const PHOTO_MAX_SIDE = 1600
export const THUMB_MAX_SIDE = 400

/** Largest size that fits inside a square of `maxSide`, never upscaling. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function isImageFile(file: File): boolean {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

async function render(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const size = fitWithin(bitmap.width, bitmap.height, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot prepare photos.')
  // White matte so transparent PNG screenshots stay readable as JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('This browser cannot prepare photos.')
  return blob
}

/** Returns a resized JPEG and its thumbnail. Throws a readable error for files that are not photos. */
export async function preparePhoto(file: File): Promise<{ image: Blob; thumb: Blob; filename: string }> {
  if (!isImageFile(file)) throw new Error('Choose a JPEG, PNG or WebP photo.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This photo could not be opened. Try a JPEG or PNG.')
  }
  try {
    const image = await render(bitmap, PHOTO_MAX_SIDE, 0.85)
    const thumb = await render(bitmap, THUMB_MAX_SIDE, 0.8)
    const filename = `${file.name.replace(/\.[^.]+$/, '').slice(0, 180) || 'photo'}.jpg`
    return { image, thumb, filename }
  } finally {
    bitmap.close()
  }
}
