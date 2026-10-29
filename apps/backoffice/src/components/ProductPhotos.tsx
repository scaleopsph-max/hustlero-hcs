'use client'

import {
  productImageArchiveResponseSchema,
  productImageOrderResponseSchema,
  productImageUploadResponseSchema,
  type ProductImage,
} from '@hcs/contracts'
import { Button, Glass, cn, preparePhoto } from '@hcs/ui'
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

const apiUrl = process.env.NEXT_PUBLIC_API_URL
const MAX_PHOTOS = 8

/** Turns a signed API-relative file path into an absolute URL. */
export function fileUrl(path: string): string {
  return `${(apiUrl ?? '').replace(/\/$/, '')}${path}`
}

async function send(path: string, token: string, tenantId: string, init: RequestInit & { idempotencyKey?: string }) {
  if (!apiUrl) throw new Error('Back Office API URL is not configured.')
  const { idempotencyKey, ...rest } = init
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...rest.headers,
    },
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      (data as { error?: { message?: string } } | null)?.error?.message ?? 'The photo change was not saved.',
    )
  return data
}

/**
 * Product photos shared by Back Office, POS, and the reseller portal. The first photo is the
 * primary one shown on POS tiles and in the reseller catalog.
 */
export function ProductPhotos({
  productId,
  productName,
  images,
  token,
  tenantId,
  onChanged,
}: {
  productId: string
  productName: string
  images: ProductImage[]
  token: string
  tenantId: string
  onChanged: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    const room = MAX_PHOTOS - images.length
    const chosen = [...files].slice(0, room)
    setError(
      files.length > room ? `Only ${room} more photo${room === 1 ? '' : 's'} fit. The first ${room} were added.` : null,
    )
    for (const [index, file] of chosen.entries()) {
      setBusy(`Uploading ${index + 1} of ${chosen.length}…`)
      try {
        const prepared = await preparePhoto(file)
        const body = new FormData()
        body.append('image', prepared.image, prepared.filename)
        body.append('thumb', prepared.thumb, `thumb-${prepared.filename}`)
        productImageUploadResponseSchema.parse(
          await send(`/v1/catalog/products/${productId}/images`, token, tenantId, {
            method: 'POST',
            body,
            idempotencyKey: `photo-${crypto.randomUUID()}`,
          }),
        )
      } catch (cause) {
        setError(`${file.name}: ${cause instanceof Error ? cause.message : 'upload failed.'}`)
        break
      }
    }
    if (input.current) input.current.value = ''
    setBusy('Refreshing…')
    await onChanged()
    setBusy(null)
  }

  async function reorder(fileIds: string[]) {
    setBusy('Saving order…')
    setError(null)
    try {
      productImageOrderResponseSchema.parse(
        await send(`/v1/catalog/products/${productId}/images/order`, token, tenantId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIds }),
        }),
      )
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order was not saved.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(fileId: string) {
    setBusy('Removing…')
    setError(null)
    try {
      productImageArchiveResponseSchema.parse(
        await send(`/v1/catalog/products/${productId}/images/${fileId}/archive`, token, tenantId, { method: 'POST' }),
      )
      setConfirmRemove(null)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photo was not removed.')
    } finally {
      setBusy(null)
    }
  }

  const ids = images.map((image) => image.fileId)
  const move = (index: number, offset: number) => {
    const next = [...ids]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(index + offset, 0, moved)
    void reorder(next)
  }

  return (
    <Glass variant="light" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Photos</h2>
          <p className="text-sm text-ink-500">
            Shown on POS tiles and in the reseller catalog. The first photo is the main one.
          </p>
        </div>
        <span className="text-sm text-ink-500">
          {images.length}/{MAX_PHOTOS}
        </span>
      </div>

      {images.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <li key={image.fileId} className="flex flex-col gap-1.5">
              <div
                className={cn(
                  'relative aspect-square overflow-hidden rounded-control bg-ink-900/5',
                  index === 0 && 'ring-2 ring-gold-600',
                )}
              >
                <img
                  src={fileUrl(image.thumbUrl)}
                  alt={`${productName} photo ${index + 1}`}
                  className="size-full object-cover"
                  loading="lazy"
                />
                {index === 0 ? (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-ink-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star size={11} /> Main
                  </span>
                ) : null}
              </div>
              {confirmRemove === image.fileId ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="flex-1 rounded-control bg-signal-light-critical-bg py-1.5 text-xs font-semibold text-signal-light-critical-fg"
                    disabled={busy !== null}
                    onClick={() => void remove(image.fileId)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-control bg-ink-900/5 py-1.5 text-xs font-semibold"
                    onClick={() => setConfirmRemove(null)}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex justify-center gap-0.5">
                  <IconButton
                    label={`Move photo ${index + 1} left`}
                    disabled={busy !== null || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowLeft size={14} />
                  </IconButton>
                  <IconButton
                    label={`Make photo ${index + 1} the main photo`}
                    disabled={busy !== null || index === 0}
                    onClick={() => void reorder([image.fileId, ...ids.filter((id) => id !== image.fileId)])}
                  >
                    <Star size={14} />
                  </IconButton>
                  <IconButton
                    label={`Move photo ${index + 1} right`}
                    disabled={busy !== null || index === images.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowRight size={14} />
                  </IconButton>
                  <IconButton
                    label={`Remove photo ${index + 1}`}
                    disabled={busy !== null}
                    onClick={() => setConfirmRemove(image.fileId)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-control border border-dashed border-ink-900/20 px-4 py-6 text-center text-sm text-ink-500">
          No photos yet. Resellers and cashiers see the product name only.
        </p>
      )}

      <input
        ref={input}
        id={`photos-${productId}`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="sr-only"
        onChange={(event) => void upload(event.target.files)}
      />
      <Button
        variant="confirm"
        disabled={busy !== null || images.length >= MAX_PHOTOS}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={16} className="mr-2" />
        {busy ?? (images.length >= MAX_PHOTOS ? 'Photo limit reached' : 'Add photos')}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-signal-light-critical-fg">
          {error}
        </p>
      ) : null}
      <p className="text-caption text-ink-500">
        Photos are resized to 1600 px before upload. Removed photos are archived, not deleted.
      </p>
    </Glass>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-control text-ink-600 hover:bg-ink-900/5 disabled:opacity-30"
    >
      {children}
    </button>
  )
}
