// 保管庫（Cloudflare KV）の代わり。手元で試すときと試験で使う。dir を渡すとファイルに残す。
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';

export function memKV(dir = null) {
  const map = new Map();
  const file = (k) => `${dir}/${encodeURIComponent(k)}`;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.meta'))) {
      const k = decodeURIComponent(f.slice(0, -5));
      map.set(k, { value: readFileSync(file(k)), metadata: JSON.parse(readFileSync(file(k) + '.meta', 'utf8')) });
    }
  }
  const bytes = (v) => (typeof v === 'string' ? Buffer.from(v) : Buffer.from(v));
  const as = (buf, type) => (type === 'json' ? JSON.parse(buf.toString('utf8')) : type === 'arrayBuffer' ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf.toString('utf8'));
  return {
    writes: 0,
    async get(k, type = 'text') { const e = map.get(k); return e ? as(e.value, type) : null; },
    async getWithMetadata(k, type = 'text') { const e = map.get(k); return e ? { value: as(e.value, type), metadata: e.metadata } : { value: null, metadata: null }; },
    async put(k, v, { metadata = null } = {}) {
      this.writes++;
      map.set(k, { value: bytes(v), metadata });
      if (dir) { writeFileSync(file(k), bytes(v)); writeFileSync(file(k) + '.meta', JSON.stringify(metadata)); }
    },
    async delete(k) { map.delete(k); if (dir && existsSync(file(k))) { unlinkSync(file(k)); unlinkSync(file(k) + '.meta'); } },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: map.get(name).metadata })), list_complete: true };
    },
  };
}
