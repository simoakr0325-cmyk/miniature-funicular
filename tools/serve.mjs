// 手元で試すための小さな静的サーバ。node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../app/', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.jpg': 'image/jpeg', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// 合言葉（SYNC_KEY）を付けて起動すると、同期の保管庫（/api/）も手元で動く。SYNC_DIR を付ければファイルに残る。
//   SYNC_KEY=himitsu node tools/serve.mjs
let api = null;
if (process.env.SYNC_KEY) {
  const { handleApi } = await import('../server/worker.js');
  const { memKV } = await import('../server/memkv.js');
  const env = { SYNC_KEY: process.env.SYNC_KEY, STORE: memKV(process.env.SYNC_DIR || null) };
  api = async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await handleApi(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  };
}

createServer(async (req, res) => {
  if (api && req.url.startsWith('/api/')) return api(req, res).catch((err) => res.writeHead(500).end(String(err)));
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) throw new Error('forbidden');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`縄張り台: http://localhost:${port}/`));
