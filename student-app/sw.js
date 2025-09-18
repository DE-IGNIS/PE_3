const CACHE = 'student-cache-v1';
const ASSETS = [
	'/student/',
	'/student/index.html',
	'/student/manifest.webmanifest',
	'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
	'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js'
];
self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
	self.skipWaiting();
});
self.addEventListener('activate', (e) => {
	e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
	e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
