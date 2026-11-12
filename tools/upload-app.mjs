// app/ のファイルを Cloudflare の保管庫（KV、束ね名 STORE）に入れる。
// Worker（server/worker.js）は、/api/ 以外をここから返す。
// 使い方： CLOUDFLARE_API_TOKEN=… node tools/upload-app.mjs
//   変わったファイルだけ送り、app/ から消えたファイルは保管庫からも消す。
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../app/', import.meta.url).pathname;
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const nsId = /binding\s*=\s*"STORE"\s*\nid\s*=\s*"([0-9a-f]+)"/.exec(toml)?.[1];
if (!nsId) throw new Error('wrangler.toml に STORE の id がありません');

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(ROOT).filter((p) => !p.split(sep).some((s) => s.startsWith('.')));

const wrangler = (args, opts = {}) => execFileSync('npx', ['--yes', 'wrangler', ...args], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...opts });

// 保管庫に今あるファイルと指紋
const listed = JSON.parse(wrangler(['kv', 'key', 'list', '--namespace-id', nsId, '--prefix', 'file:', '--remote'], { stdio: ['ignore', 'pipe', 'ignore'] }));
const have = new Map(listed.map((k) => [k.name, k.metadata?.hash]));

const puts = [];
const want = new Set();
for (const p of files) {
  const key = 'file:/' + relative(ROOT, p).split(sep).join('/');
  const buf = readFileSync(p);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 20);
  want.add(key);
  if (have.get(key) === hash) continue;
  puts.push({ key, value: buf.toString('base64'), base64: true, metadata: { hash } });
}
const dels = [...have.keys()].filter((k) => !want.has(k));

const tmp = mkdtempSync(join(tmpdir(), 'nawabari-'));
try {
  // 一度に送る量を抑えて分ける
  let batch = [], size = 0, n = 0;
  const flush = () => {
    if (!batch.length) return;
    const f = join(tmp, `put${n++}.json`);
    writeFileSync(f, JSON.stringify(batch));
    wrangler(['kv', 'bulk', 'put', f, '--namespace-id', nsId, '--remote'], { stdio: 'inherit' });
    batch = []; size = 0;
  };
  for (const e of puts) {
    if (size + e.value.length > 40e6) flush();
    batch.push(e); size += e.value.length;
  }
  flush();
  if (dels.length) {
    const f = join(tmp, 'del.json');
    writeFileSync(f, JSON.stringify(dels));
    wrangler(['kv', 'bulk', 'delete', f, '--namespace-id', nsId, '--remote', '--force'], { stdio: 'inherit' });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`送った ${puts.length}・消した ${dels.length}・そのまま ${files.length - puts.length}`);
