'use client'

import { LogOut, Settings, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { createClient } from '../lib/supabase-browser'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** The account button in the page header: who is signed in, business setup, and sign out. */
export function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return
    void createClient(supabaseUrl, supabaseKey)
      .auth.getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null))
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  async function signOut() {
    if (!supabaseUrl || !supabaseKey) return
    setSigningOut(true)
    // Local scope: signing out here does not end this person's sessions on other devices.
    await createClient(supabaseUrl, supabaseKey).auth.signOut({ scope: 'local' })
    window.location.assign('/setup')
  }

  return (
    <div ref={box} className="relative ml-0.5 flex-none sm:ml-1.5">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account"
        onClick={() => setOpen((value) => !value)}
        className="flex size-10 items-center justify-center rounded-full bg-ink-900 text-gold-300"
      >
        <UserRound size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-64 rounded-[16px] border border-ink-900/10 bg-white p-2 shadow-lg"
        >
          {email ? <p className="truncate px-3 pb-2 pt-1 text-xs text-ink-500">Signed in as {email}</p> : null}
          <Link
            role="menuitem"
            href="/setup"
            className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-ink-900 hover:bg-ink-900/5"
            onClick={() => setOpen(false)}
          >
            <Settings size={17} aria-hidden="true" />
            Business setup
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void signOut()}
            className="flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-sm font-medium text-ink-900 hover:bg-ink-900/5 disabled:opacity-60"
          >
            <LogOut size={17} aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
