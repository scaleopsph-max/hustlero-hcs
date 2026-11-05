// Browser side of Web Push, shared by the Reseller Portal and the Back Office.

export type PushSupport = 'supported' | 'ios-needs-install' | 'unsupported'
export type PushState = 'on' | 'off' | 'blocked'

export interface SavedSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  expirationTime?: number | null
}

/** iPhones and iPads only allow push for sites added to the Home Screen (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (ios && !standalone) return 'ios-needs-install'
  return capable ? 'supported' : 'unsupported'
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

async function registration(scriptUrl: string): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (!existing) await navigator.serviceWorker.register(scriptUrl, { scope: '/', updateViaCache: 'none' })
  return navigator.serviceWorker.ready
}

/** Whether this browser is already receiving pushes. */
export async function pushState(): Promise<PushState> {
  if (pushSupport() !== 'supported') return 'off'
  if (Notification.permission === 'denied') return 'blocked'
  const current = await navigator.serviceWorker.getRegistration('/')
  return (await current?.pushManager.getSubscription()) ? 'on' : 'off'
}

/**
 * Asks permission, subscribes, and hands the subscription to `save` (the API call).
 * Returns the new state; 'blocked' when the person said no.
 */
export async function enablePush(
  scriptUrl: string,
  publicKey: string,
  save: (subscription: SavedSubscription) => Promise<unknown>,
): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const ready = await registration(scriptUrl)
  const subscription =
    (await ready.pushManager.getSubscription()) ??
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))
  await save(subscription.toJSON() as SavedSubscription)
  return 'on'
}

/** Stops pushes to this browser; `remove` tells the API first so nothing is sent meanwhile. */
export async function disablePush(remove: (endpoint: string) => Promise<unknown>): Promise<PushState> {
  const current = await navigator.serviceWorker.getRegistration('/')
  const subscription = await current?.pushManager.getSubscription()
  if (subscription) {
    await remove(subscription.endpoint)
    await subscription.unsubscribe()
  }
  return 'off'
}
