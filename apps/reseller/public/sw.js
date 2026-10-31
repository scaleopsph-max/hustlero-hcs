// HCS Reseller Portal service worker.
// Caches only the public app shell and hashed build assets. API responses are never cached:
// catalogs, prices, and orders belong to a signed-in reseller and phones are often shared.
const VERSION = 'hcs-reseller-v2'
const SHELL = ['/', '/apply', '/manifest.webmanifest', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network first so a deploy is picked up immediately; the cached shell covers no signal.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(VERSION).then((cache) => cache.put(url.pathname === '/apply' ? '/apply' : '/', copy))
          return response
        })
        .catch(() => caches.match(url.pathname === '/apply' ? '/apply' : '/')),
    )
    return
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(png|svg|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(VERSION).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})

// Push notifications: order updates sent by the API. Tapping one opens that order.
self.addEventListener('push', (event) => {
  let message = { title: 'Order update', body: '', url: '/', tag: undefined }
  try {
    message = { ...message, ...event.data.json() }
  } catch {
    // Keep the generic message.
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(message.title, {
        body: message.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: message.tag,
        data: { url: message.url },
      }),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({ type: 'push-received' }))),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) return open.focus().then((client) => client.navigate(target))
      return self.clients.openWindow(target)
    }),
  )
})
