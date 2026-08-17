/* Minimal service worker.
   Two jobs, and deliberately nothing more:

   1. Chrome only treats a site as a genuinely INSTALLABLE app if it has a
      service worker with a fetch handler. Being installed is what earns
      persistent storage, which is what stops Chrome deleting the attendance
      data when the phone runs low on space. That is the whole reason this
      file exists.

   2. Network-first caching, so the app opens with no signal.

   NETWORK-FIRST, never cache-first. Cache-first is the classic trap: it pins
   users to a stale version and a deploy silently never arrives. Here the
   network always wins when it is reachable, and the cache is only a fallback. */

var CACHE = "attendance-v8";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL).catch(function(){}); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return k===CACHE?null:caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;                                  // never touch writes
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;                   // never touch Firebase traffic
  e.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy).catch(function(){}); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){ return hit || caches.match("./index.html"); });
    })
  );
});
