// 縄張り台のサーバ（Cloudflare Worker）。アプリの配信と、図の同期の保管庫を兼ねる。
// /api/ 以外はアプリ（app/）をそのまま返す。/api/ は合言葉（SYNC_KEY）が合うときだけ読み書きできる。
// 図は部材ごとに新しい方を採って合わせる（端末どうしと同じ mergeDocs）。同じ図を何度送っても結果は同じになる。
//
// 保管庫（KV、束ね名 STORE）の鍵：
//   doc:<図ID>     図の本体（JSON）。metadata に一覧用の見出し（現場ID・現場名・更新・部材数）
//   blob:<指紋>    下図の画像（値は中身、metadata に種類）

import { mergeDocs, normalizeDoc, live } from '../app/src/model.js';

const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEAD });
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const HASH_RE = /^[0-9a-f]{16}$/;
const MAX_DOC = 8 * 1024 * 1024;
const MAX_BLOB = 24 * 1024 * 1024;

// 合言葉の照らし合わせ（長さや一致した所で時間が変わらないように、指紋どうしを比べる）
async function sameKey(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const metaOf = (doc) => ({ id: doc.id, siteId: doc.siteId || '', siteName: doc.siteName || '', updatedAt: doc.updatedAt, count: live(doc).length });

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  // つながるかの確かめ（合言葉なしでも答える。図の中身は返さない）
  if (path === '/ping') {
    const ok = await sameKey((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.SYNC_KEY);
    return json({ ok: true, name: 'nawabari', auth: ok });
  }
  if (!env.SYNC_KEY) return json({ error: 'サーバに合言葉が設定されていません' }, 503);
  if (!(await sameKey((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.SYNC_KEY))) {
    return json({ error: '合言葉が違います' }, 401);
  }

  // 図の一覧
  if (path === '/docs' && method === 'GET') {
    const out = [];
    let cursor;
    do {
      const page = await env.STORE.list({ prefix: 'doc:', cursor });
      for (const k of page.keys) if (k.metadata) out.push(k.metadata);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return json({ docs: out });
  }

  const dm = /^\/docs\/([^/]+)$/.exec(path);
  if (dm) {
    const id = dm[1];
    if (!ID_RE.test(id)) return json({ error: '図ID の形が違います' }, 400);
    if (method === 'GET') {
      const doc = await env.STORE.get('doc:' + id, 'json');
      return doc ? json({ doc }) : json({ error: 'その図はありません' }, 404);
    }
    if (method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_DOC) return json({ error: '図が大きすぎます' }, 413);
      let incoming;
      try {
        incoming = normalizeDoc(JSON.parse(text));
      } catch (err) {
        return json({ error: '図を読めません：' + err.message }, 400);
      }
      if (incoming.id !== id) return json({ error: '図ID が合いません' }, 400);
      const stored = await env.STORE.get('doc:' + id, 'json');
      let result = incoming, pulled = 0;
      if (stored) ({ doc: result, changed: pulled } = mergeDocs(incoming, normalizeDoc(stored)));
      const body = JSON.stringify(result);
      // 中身が変わらなければ書かない（保管庫の書き込み回数を節約する）
      if (!stored || body !== JSON.stringify(stored)) {
        await env.STORE.put('doc:' + id, body, { metadata: metaOf(result) });
      }
      return json({ doc: result, pulled });
    }
    if (method === 'DELETE') {
      await env.STORE.delete('doc:' + id);
      return json({ ok: true });
    }
  }

  const bm = /^\/blobs\/([^/]+)$/.exec(path);
  if (bm) {
    const hash = bm[1];
    if (!HASH_RE.test(hash)) return json({ error: '指紋の形が違います' }, 400);
    if (method === 'HEAD' || method === 'GET') {
      const { value, metadata } = await env.STORE.getWithMetadata('blob:' + hash, 'arrayBuffer');
      if (!value) return new Response(null, { status: 404 });
      const headers = { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' };
      return new Response(method === 'HEAD' ? null : value, { headers });
    }
    if (method === 'PUT') {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BLOB) return json({ error: '画像が大きすぎます' }, 413);
      await env.STORE.put('blob:' + hash, buf, { metadata: { type: request.headers.get('content-type') || 'application/octet-stream' } });
      return json({ ok: true });
    }
  }
  return json({ error: 'その道はありません' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        return json({ error: 'サーバの中で失敗しました：' + err.message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
