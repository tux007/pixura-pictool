// Minimal local typings: the DOM lib is used project-wide, so worker globals are declared by hand.
interface ExtendableEvt extends Event {
  waitUntil(p: Promise<unknown>): void
}
interface FetchEvt extends ExtendableEvt {
  request: Request
  respondWith(r: Promise<Response>): void
}
interface WorkerScope {
  addEventListener(type: 'install' | 'activate', cb: (e: ExtendableEvt) => void): void
  addEventListener(type: 'fetch', cb: (e: FetchEvt) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
}

const sw = self as unknown as WorkerScope
const PREFIX = 'pixura-'
const CACHE = PREFIX + '__VERSION__'
// Replaced at build time with the list of files to precache.
const FILES: string[] = JSON.parse('__PRECACHE__')

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => sw.skipWaiting()))
})

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return
  const key = request.mode === 'navigate' ? '/index.html' : url.pathname
  e.respondWith(caches.match(key, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)))
})
