// AIRJOTTER_NOTES_V2301A
const VERSION = 'airjotter-pwa-v2301a-notes';
const NOTE_ASSETS=['/airjotter-notes.css','/airjotter-notes.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(NOTE_ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('airjotter-pwa-')&&k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin===self.location.origin&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/socket.io/')))return;
 if(NOTE_ASSETS.includes(url.pathname)){event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(r=>{const copy=r.clone();caches.open(VERSION).then(c=>c.put(event.request,copy));return r})));return}
 event.respondWith(fetch(event.request));
});
