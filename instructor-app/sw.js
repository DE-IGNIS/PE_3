const CACHE = 'instructor-cache-v1';
const ASSETS = [
	'/instructor/',
	'/instructor/index.html',
	'/instructor/manifest.webmanifest'
];
self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
	self.skipWaiting();
});
self.addEventListener('activate', (e) => {
	e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
	const url = new URL(e.request.url);
	if (url.pathname.startsWith('/api/')) {
		return e.respondWith(fetch(e.request));
	}
	e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
