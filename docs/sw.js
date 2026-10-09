/* 레슨 수첩 서비스워커: 오프라인 화면 캐시 + 아침 알림(푸시) 표시 */
const SHELL = 'lesson-shell-v5';
const CFG = 'lesson-cfg';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './badge-96.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== CFG).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 화면 파일은 네트워크 우선, 안 되면 캐시. API(script.google.com)는 건드리지 않는다.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
// 페이지가 알려 준 API 주소·토큰을 보관 (알림 내용을 가져올 때 사용)
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'config') {
    e.waitUntil(caches.open(CFG).then((c) => c.put('./__cfg', new Response(JSON.stringify({ api: e.data.api, token: e.data.token })))));
  }
});
async function cfg() { const r = await (await caches.open(CFG)).match('./__cfg'); return r ? r.json() : null; }

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = '레슨 수첩', body = '오늘 레슨 일정을 확인해 보세요.', tag = 'lesson-digest';
    try {
      const c = await cfg();
      if (c) {
        const d = await (await fetch(c.api + '?action=digest&token=' + encodeURIComponent(c.token))).json();
        if (d && !d.error) {
          title = d.title || title; tag = 'lesson-' + (d.date || '');
          body = d.count ? d.body : '알림이 잘 연결됐어요. 오늘·내일·다음 주에 예정된 레슨은 없어요.';
        }
      }
    } catch (err) { /* 내용을 못 가져오면 기본 문구로 알린다 */ }
    await self.registration.showNotification(title, { body, tag, icon: './icon-192.png', badge: './badge-96.png', data: { url: './#cal' }, renotify: true });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope)) { w.navigate(target); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
