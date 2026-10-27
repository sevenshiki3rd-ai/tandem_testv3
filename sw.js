const CACHE='tandem-v3-assets-v1';
const SHELL=['./','./index.html','./style.css','./app.js','./config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{let req=e.request,u=new URL(req.url);if(req.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(fetch(req).catch(()=>caches.match(req)));});
