// SokoPay service worker — cache-first for static assets, network-only for API.
//
// Strategy:
//  - /api/*  → always network (payments must never serve stale data)
//  - everything else → cache-first with network fallback, cache updates on miss

const CACHE_NAME = 'sokopay-v4'

// Pre-cache the shell on install so the app loads offline.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add('/')),
  )
  // Activate immediately — don't wait for old tabs to close.
  self.skipWaiting()
})

// Clean up old caches on activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  )
  // Take control of all clients immediately.
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never cache API calls, Daraja webhooks, or non-GET requests.
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/')
  ) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          // Only cache same-origin successful responses.
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => cached ?? new Response('Offline', { status: 503 }))

      // Return cached version immediately; update cache in background.
      return cached ?? networkFetch
    }),
  )
})
