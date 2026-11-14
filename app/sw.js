/* 📱 Service worker do app do Fliperama (13/11/2026).
 * · casca do app (html/js/css/ícones) e catálogo: REDE PRIMEIRO, cache se estiver sem internet → atualiza sozinho;
 * · motor e arquivos dos jogos (motor.js?v=…, phaser/, three/, hd/, 3d/, spec.json, capa.jpg): CACHE PRIMEIRO quando a
 *   URL tem versão (?v=) — o que já foi aberto joga sem internet; sem versão: rede primeiro;
 * · placar, recordes, salas, medição e estado: só rede, nunca guardados.
 * Só guarda arquivos públicos — nada de conta de criança (blueprint §5).
 */
var CACHE = 'fliperama-app-v2';
var CASCA = ['./', './index.html', './app.js?v=2', './app.css?v=2', './manifest.webmanifest', './icone-192.png', './icone-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CASCA).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('fliperama-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function soRede(u) {
  return /\/publico\/fliperama\/(placar|recordes|sala|ponte|metrica|estado|controle)/.test(u.pathname) ||
         u.hostname === 'challenges.cloudflare.com';
}
function guardavel(u) {
  return u.origin === self.location.origin &&
         (/\/estudio\/fliperama\//.test(u.pathname) || /\/jogos\//.test(u.pathname) || u.pathname.indexOf(new URL('./', self.location).pathname) === 0);
}
function redePrimeiro(req) {
  return fetch(req).then(function (r) {
    if (r && r.ok) { var c = r.clone(); caches.open(CACHE).then(function (k) { k.put(req, c); }); }
    return r;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('./index.html'); }); });
}
function cachePrimeiro(req) {
  return caches.match(req).then(function (r) {
    return r || fetch(req).then(function (x) {
      if (x && x.ok) { var c = x.clone(); caches.open(CACHE).then(function (k) { k.put(req, c); }); }
      return x;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }
  var u = new URL(req.url);
  if (soRede(u) || !guardavel(u)) { return; }
  var escopo = new URL('./', self.location).pathname;
  if (u.pathname.indexOf(escopo) === 0 || /\/jogos\/jogos\.json/.test(u.pathname)) { e.respondWith(redePrimeiro(req)); return; }   // casca: sempre a mais nova
  if (u.search.indexOf('v=') >= 0 || /\/estudio\/fliperama\/(phaser|three|hd|3d)\//.test(u.pathname)) { e.respondWith(cachePrimeiro(req)); return; }
  e.respondWith(redePrimeiro(req));
});
