// sw.js — the shell, kept so the atlas opens without a network.
// Pages stay network first. Exact files from this release's shell are already
// immutable by address, so they come straight from the offline copy.

const V = 'v=rf157';
const CACHE_PREFIX = 'resonate-shell-';
const CACHE = `${CACHE_PREFIX}${V}`;

// everything the first paint needs, at the exact URLs the page asks for
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  `./css/style.css?${V}`,
  `./js/app.js?${V}`,
  `./js/library.js?${V}`,
  `./js/agent.js?${V}`,
  `./js/store.js?${V}`,
  `./js/canonical.js?${V}`,
  `./js/map.js?${V}`,
  `./js/share.js?${V}`,
  `./js/schema.js?${V}`,
  `./js/route.js?${V}`,
  `./js/kinship.js?${V}`,
  `./js/geocode.js?${V}`,
  `./js/exif.js?${V}`,
  `./js/club.js?${V}`,
  `./js/pairing.js?${V}`,
  `./js/letters.js?${V}`,
  `./js/photos.js?${V}`,
  `./js/capture.js?${V}`,
  `./js/find.js?${V}`,
  `./js/evening.js?${V}`,
  './read.html',
  `./js/read.js?${V}`,
  `./js/marks.js?${V}`,
  // the documents travel with the app: a person offline deciding whether to
  // trust it should not be told to come back when they have a connection
  './SPEC.md',
  './THREATS.md',
  './METHOD.md',
  './SECURITY.md',
  './ASSISTANT-ACCESS.md',
  './llms.txt',
  './TERMS.md',
  './PRIVACY.md',
  './SUPPORT.md',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/markercluster/leaflet.markercluster.js',
  './vendor/markercluster/MarkerCluster.css',
  './vendor/lz/lz-string.min.js',
  './vendor/argon2/argon2.umd.min.js',
  './fonts/bricolage-latin.woff2',
  './fonts/bricolage-latin-ext.woff2',
  './fonts/bricolage-vietnamese.woff2',
  './fonts/fragment-latin.woff2',
  './fonts/fragment-latin-ext.woff2',
  './fonts/fragment-cyrillic-ext.woff2',
  // No film. assets/intro.mp4 was deliberately kept out of this list, because
  // precaching a first-visit welcome cost a hundred and fifty kilobytes to
  // every device including the ones that had asked for less movement and would
  // never see it. The evening is drawn now, by code already in this list, so
  // there is nothing to leave out and nothing to fetch late either.
];

// Search is part of a release address. A request for app.js?v=rf147 is not a
// request for app.js?v=rf157, and must not be answered with whichever copy a
// broad ignoreSearch lookup happens to find. Navigations are excluded below:
// even ./ and index.html go to the network first when they are documents.
const CURRENT_SHELL_URLS = new Set(SHELL.map(u => new URL(u, self.location.href).href));

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Promise.all, not allSettled. A shell that cannot be cached whole must not
    // install: activate deletes every other cache, so a half filled one throws
    // away the last copy that worked and leaves the app broken with no network.
    // Better to keep the old worker and try again on the next visit.
    .then(c => Promise.all(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A place shared into the app is the one thing a share target must not put on
// the wire. The form posts to this worker, which keeps it here and answers
// with the app itself: the title, the text and the address never leave the
// device, not even as a request the host could log.
const INBOX_DB = 'resonate-share';

// A share is a title, a note and a link, and each of those has a real ceiling.
// 2048 is what an address bar carries in practice; 300 outruns any page title
// worth keeping, since the app clips a name to 140 anyway; 2000 holds a
// generous selection of text. The sum is bounded as well, because the sum is
// what lands in the store, and the link is served first: the coordinates live
// there. A body past a megabyte is not a share, so it is never parsed at all.
const CAP = { url: 2048, title: 300, text: 2000 };
const CAP_TOTAL = 4096;
const CAP_BODY = 1024 * 1024;

// Each field cut to its own ceiling and then to whatever is left of the total.
// `shortened` travels with the record so the app can say a share was kept in
// part rather than pretend it arrived whole.
function boundShare(form) {
  const kept = { title: '', text: '', url: '', shortened: false };
  let budget = CAP_TOTAL;
  for (const field of ['url', 'title', 'text']) {
    const raw = String(form.get(field) ?? '');
    kept[field] = raw.slice(0, Math.min(CAP[field], budget));
    if (kept[field].length < raw.length) kept.shortened = true;
    budget -= kept[field].length;
  }
  return kept;
}

function inboxPut(item) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(INBOX_DB, 1); } catch { return resolve(false); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { autoIncrement: true });
    };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('shared', 'readwrite');
        tx.objectStore('shared').add(item);
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    };
    req.onerror = () => resolve(false);
  });
}

self.addEventListener('fetch', (e) => {
  const shareUrl = new URL(e.request.url);
  if (e.request.method === 'POST' && shareUrl.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const home = shareUrl.origin + shareUrl.pathname.replace(/share-target$/, '');
      let kept = false;
      try {
        const size = Number(e.request.headers.get('content-length') || 0);
        if (!(size > CAP_BODY)) {
          const share = boundShare(await e.request.formData());
          // three blank fields are not a share, and the write itself can fail:
          // either way nothing is waiting, and the app must not be told it is.
          // blank is measured the way the app's parser measures it, on the
          // trimmed field, so the two never disagree about what arrived.
          if (share.title.trim() || share.text.trim() || share.url.trim()) {
            kept = await inboxPut({ ...share, at: new Date().toISOString() });
          }
        }
      } catch { /* nothing legible arrived */ }
      // straight back into the app, with nothing of the share in the address:
      // one digit for whether anything is waiting, and not a word of the place
      return Response.redirect(home + (kept ? '?shared=1' : '?shared=0'), 303);
    })());
    return;
  }
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // tiles and geocoding belong to the network; only our own shell is ours
  if (url.origin !== self.location.origin) return;
  // and only this app's path: the origin carries other sites
  const scope = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return;

  const storeResponse = (res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      return caches.open(CACHE).then(c => c.put(req, copy));
    }
    return Promise.resolve();
  };

  const remember = (res) => {
    storeResponse(res).catch(() => {});
    return res;
  };

  // This is deliberately exact: only an address installed by this worker can
  // skip the wire. It removes a revalidation from every warm module, style,
  // typeface and icon without making a document or a future local endpoint
  // stale. A missing cache entry is repaired from the network.
  if (req.mode !== 'navigate' && CURRENT_SHELL_URLS.has(url.href)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { return remember(await fetch(req)); }
      catch { return Response.error(); }
    })());
    return;
  }

  // Documents and same-origin addresses not in this release remain network
  // first. Their exact last good response is useful offline, but a query from
  // another release is never silently exchanged for the current file.
  const network = fetch(req, { cache: 'no-cache' });
  // The response need not wait for the cache write, but the worker must. This
  // keeps the exact last good response durable if the browser suspends the
  // worker as soon as the response is handed back.
  e.waitUntil(network.then(storeResponse).catch(() => {}));
  e.respondWith((async () => {
    try { return await network; }
    catch {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      // the shell stands in for a page, never for a script, a style, or an
      // image: those must fail honestly so the app can say so
      if (req.mode === 'navigate') {
        // Reader routes carry the document name in their query. Keep that
        // query strict while online, but offline open the cached reader rather
        // than exchanging a help or policy page for the atlas.
        const reader = new URL('./read.html', self.location.href);
        const fallback = url.pathname === reader.pathname
          ? reader.href
          : new URL('./index.html', self.location.href).href;
        const shell = await cache.match(fallback);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
