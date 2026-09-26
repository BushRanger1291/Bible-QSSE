'use strict';
const CACHE='bible-qsse-v8';
const SHELL=new URL('./index.html?v=8',self.registration.scope).href;
const ASSETS=['./index.html?v=8','./app.js?v=8','./local-tags.js?v=8','./bible-qsse-v8.webmanifest','./skull-192-v7.png','./skull-512-v7.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('bible-qsse-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.registration.scope))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(async()=>await caches.match(SHELL)||Response.error()));
    return;
  }
  const known=ASSETS.some(path=>new URL(path,self.registration.scope).href===event.request.url);
  if(!known)return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
