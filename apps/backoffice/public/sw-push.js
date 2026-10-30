// HCS Back Office push notifications. This worker only shows notifications; it caches nothing.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let message = { title: 'HUSTLERO Back Office', body: '', url: '/notifications', tag: undefined }
  try {
    message = { ...message, ...event.data.json() }
  } catch {
    // Keep the generic message.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      data: { url: message.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) return open.focus().then((client) => client.navigate(target))
      return self.clients.openWindow(target)
    }),
  )
})
