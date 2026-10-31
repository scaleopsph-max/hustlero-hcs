'use client'

import type { ResellerAccentColor, ResellerBranding } from '@hcs/contracts'
import { Button, Glass, cn, preparePhoto, useToast } from '@hcs/ui'
import { ImagePlus, Palette, Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

import { fileUrl } from './ProductPhotos'

const accents: Array<{ value: ResellerAccentColor; label: string; swatch: string }> = [
  { value: 'gold', label: 'Gold', swatch: '#D4AF37' },
  { value: 'emerald', label: 'Emerald', swatch: '#10B981' },
  { value: 'sky', label: 'Sky', swatch: '#0EA5E9' },
  { value: 'rose', label: 'Rose', swatch: '#F43F5E' },
  { value: 'violet', label: 'Violet', swatch: '#8B5CF6' },
  { value: 'orange', label: 'Orange', swatch: '#F97316' },
]

/** How the business's reseller portal looks to resellers: name, accent color, and logo. */
export function BrandingCard({
  branding,
  businessName,
  busy,
  onSave,
  onUploadLogo,
}: {
  branding: ResellerBranding | undefined
  businessName: string
  busy: boolean
  onSave: (body: {
    portalName: string | null
    accentColor: ResellerAccentColor
    removeLogo?: boolean
  }) => Promise<boolean>
  onUploadLogo: (body: FormData) => Promise<void>
}) {
  const toast = useToast()
  const savedName = branding && branding.portalName !== businessName ? branding.portalName : ''
  const [name, setName] = useState(savedName)
  const [accent, setAccent] = useState<ResellerAccentColor>(branding?.accentColor ?? 'gold')
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const changed = name.trim() !== savedName || accent !== (branding?.accentColor ?? 'gold')
  const swatch = accents.find((entry) => entry.value === accent)?.swatch ?? '#D4AF37'

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed && (trimmed.length < 2 || trimmed.length > 60))
      return setProblem('Use 2 to 60 characters for the name.')
    setProblem(null)
    await onSave({ portalName: trimmed || null, accentColor: accent })
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const prepared = await preparePhoto(file)
      const body = new FormData()
      body.append('image', prepared.image, prepared.filename)
      await onUploadLogo(body)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The logo was not uploaded.')
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Glass variant="data" className="flex flex-col gap-4 rounded-panel p-5">
      <div className="flex items-start gap-3">
        <Palette size={20} className="mt-0.5 flex-none text-gold-700" />
        <div>
          <h3 className="font-semibold">Portal look</h3>
          <p className="text-sm text-ink-500">
            Your name, color, and logo on the reseller portal and the application page.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr,260px]">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Portal name
            <input
              className="min-h-10 rounded-control border border-ink-900/15 bg-white px-3 text-sm"
              placeholder={businessName}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <span className="text-xs font-normal text-ink-500">Leave blank to use {businessName}.</span>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold">Accent color</legend>
            <div className="flex flex-wrap gap-2">
              {accents.map((entry) => (
                <label
                  key={entry.value}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm',
                    accent === entry.value ? 'border-ink-900 bg-white font-semibold' : 'border-ink-900/15 bg-white/60',
                  )}
                >
                  <input
                    type="radio"
                    name="accent"
                    className="sr-only"
                    checked={accent === entry.value}
                    onChange={() => setAccent(entry.value)}
                  />
                  <span className="size-4 rounded-full" style={{ background: entry.swatch }} aria-hidden />
                  {entry.label}
                </label>
              ))}
            </div>
          </fieldset>
          {problem ? <p className="text-sm text-signal-light-critical-fg">{problem}</p> : null}
          {changed ? (
            <Button type="submit" variant="confirm" className="self-start" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
        </form>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Preview</p>
          <div className="flex flex-col gap-3 rounded-panel bg-ink-950 p-4 text-white">
            <div className="flex items-center gap-2">
              {branding?.logoUrl ? (
                <img src={fileUrl(branding.logoUrl)} alt="" className="size-8 rounded-[10px] object-cover" />
              ) : (
                <span className="size-8 rounded-[10px]" style={{ background: swatch }} aria-hidden />
              )}
              <span className="truncate font-semibold">{name.trim() || businessName}</span>
            </div>
            <span
              className="inline-flex min-h-9 items-center justify-center rounded-full px-4 text-sm font-bold text-ink-950"
              style={{ background: swatch }}
            >
              Place order
            </span>
          </div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            id="portal-logo"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={uploading || busy} onClick={() => input.current?.click()}>
              <ImagePlus size={16} className="mr-2" />
              {uploading ? 'Uploading…' : branding?.logoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            {branding?.logoUrl ? (
              <Button
                size="sm"
                disabled={uploading || busy}
                onClick={() =>
                  void onSave({ portalName: savedName || null, accentColor: branding.accentColor, removeLogo: true })
                }
              >
                <Trash2 size={16} className="mr-2" />
                Remove logo
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-ink-500">Square works best. PNG, JPG, or WebP.</p>
        </div>
      </div>
    </Glass>
  )
}
