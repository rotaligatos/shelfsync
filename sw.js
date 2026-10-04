// ShelfSync service worker: the app and its libraries work offline; data calls always go to the network.
// A new version installs in the background and takes over at once; the page offers "Reload" to use the new screens.
const VERSION = "shelfsync-v23";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/co-wcli.png", "./icons/co-wcli-mark.png",
  "./icons/co-cwli.png", "./icons/co-cwli-mark.png", "./icons/rtmo.png"];
// libraries: the copy published with the app (vendor/), else the CDN — same list as LIBS in src/20-data.js.
// Stored at install when reachable; never allowed to break the install. The Excel reader is left to load on use.
const LIBS = [
  ["./vendor/supabase.min.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"],
  ["./vendor/simplewebauthn-browser.umd.min.js", "https://unpkg.com/@simplewebauthn/browser@13.1.0/dist/bundle/index.umd.min.js"],
  ["./vendor/html5-qrcode.min.js", "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"],
  ["./vendor/chart.umd.min.js", "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"]];
const isScript = r => r && r.ok && !/text\/html/i.test(r.headers.get("content-type") || "");
// a new version takes over at once (notifications depend on it); the open page keeps running until the person taps Reload
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(async ([own, cdn]) => {
      try { const r = await fetch(own, { cache: "no-cache" }); if (isScript(r)) return c.put(own, r); } catch (e) {}
      try { const r = await fetch(cdn, { mode: "cors" }); if (r.ok) return c.put(cdn, r); } catch (e) {}
    }));
  }));
});
self.addEventListener("message", e => { if (e.data === "skip-waiting") self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shelfsync-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co") || url.pathname.includes("/functions/") || url.hostname === "accounts.google.com") return; // never cache data/API/sign-in
  // the page: network first so updates arrive, but give up after 4 s on a weak signal and use the saved copy
  if (e.request.mode === "navigate") {
    e.respondWith(timeout(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }), 4000)
      .then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put("./index.html", c)); } return r.ok ? r : caches.match("./index.html").then(h => h || r); })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // icons, libraries: from the phone first, network otherwise (good responses only are kept)
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && (url.origin === location.origin || /cdnjs|jsdelivr|unpkg|sheetjs|fonts\.(googleapis|gstatic)/.test(url.hostname))
        && !(e.request.destination === "script" && !isScript(r))) {
      const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c));
    }
    return r;
  })));
});

// notifications: a depot request needs this person (sent by the shelfsync-push function)
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "ShelfSync", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ShelfSync", {
    body: d.body || "", tag: d.tag || "shelfsync", renotify: true, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png",
    data: { url: d.url || "./index.html", request_id: d.request_id || null, go: d.go || null } }));
});
// a tap opens the request: in the ShelfSync window already open if there is one, else a new one
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.url || "./index.html", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const mine = list.find(c => c.url.startsWith(self.registration.scope));
    if (mine) { if (d.request_id) mine.postMessage({ type: "open-request", id: d.request_id }); else if (d.go) mine.postMessage({ type: "open-go", go: d.go }); return mine.focus(); }
    return self.clients.openWindow(url);
  }));
});
