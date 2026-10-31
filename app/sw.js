// 電波のない現場でも開けるよう、アプリ一式を端末に置いておく。
// 中身を変えたら VERSION を上げる。
const VERSION = 'nawabari-v9';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
  'src/main.js', 'src/model.js', 'src/geometry.js', 'src/render.js', 'src/hit.js', 'src/storage.js', 'src/vault.js', 'src/obsidian.js',
  'src/underlay.js', 'src/sheet.js', 'src/plot.js', 'src/pdfwriter.js', 'src/svgwriter.js', 'src/dxf.js', 'src/dxfread.js', 'src/sjis.js', 'src/survey.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  // 日本語の PDF でよく使う文字の対応表。ほかは使ったときに端末へ置いていく。
  'vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap', 'vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap', 'vendor/pdfjs/cmaps/90ms-RKSJ-H.bcmap',
  'vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 先に手元を返し、つながっていれば裏で新しいものに入れ替える。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
