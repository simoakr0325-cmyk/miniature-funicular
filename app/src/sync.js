// オンラインの自動同期。縄張り台のサーバ（server/worker.js）に、図と下図の画像を預ける。
// 合言葉（鍵）は端末の中に覚える。図は部材ごとに新しい方を採って合わせるので、
// 電波が無い間に二台で別々に直しても、つながれば両方が残る。

import { getKV, setKV, getBlob, putBlob } from './storage.js';
import { mergeDocs, normalizeDoc, liveUnderlays } from './model.js';

let config = null; // { key, base }

export async function loadConfig() {
  config = (await getKV('sync').catch(() => null)) || null;
  return config;
}
export const isLinked = () => !!config?.key;
export const keyOf = () => config?.key || '';

async function api(path, { method = 'GET', body, type, key = config?.key, raw = false } = {}) {
  const res = await fetch((config?.base || '') + '/api' + path, {
    method, body, cache: 'no-store',
    headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(type ? { 'content-type': type } : {}) },
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `サーバの返事 ${res.status}`), { status: res.status });
  return data;
}

// サーバがあるか、合言葉が合うか。{ server, auth }
export async function ping(key = config?.key) {
  try {
    const r = await api('/ping', { key });
    return { server: r.name === 'nawabari', auth: !!r.auth };
  } catch {
    return { server: false, auth: false };
  }
}

// 合言葉を確かめて覚える
export async function link(key) {
  const k = String(key || '').trim();
  const p = await ping(k);
  if (!p.server) throw new Error('同期のサーバにつながりません');
  if (!p.auth) throw new Error('合言葉が違います');
  config = { key: k, base: '' };
  await setKV('sync', config);
}

export async function unlink() {
  config = null;
  await setKV('sync', null);
}

// 図を送り、サーバで合わせた結果を受け取って、手元の今の図とも合わせる。
// 返り値：{ doc, pulled }（pulled はサーバから取り込んだ部材の数）
export async function syncDoc(getLocal) {
  const sent = getLocal();
  const { doc: remote } = await api('/docs/' + sent.id, { method: 'PUT', body: JSON.stringify(sent), type: 'application/json' });
  // 送っている間に手元が変わっていても失わないよう、今の図と合わせ直す
  const { doc, changed } = mergeDocs(getLocal(), normalizeDoc(remote));
  await syncBlobs(doc);
  return { doc, pulled: changed };
}

// 下図の画像：手元にあってサーバに無ければ送り、サーバにあって手元に無ければ取る
async function syncBlobs(doc) {
  for (const u of liveUnderlays(doc)) {
    const local = await getBlob(u.blob).catch(() => null);
    if (local) {
      const head = await api('/blobs/' + u.blob, { method: 'HEAD', raw: true });
      if (head.status === 404) await api('/blobs/' + u.blob, { method: 'PUT', body: local, type: u.mime || local.type, raw: true });
    } else {
      const res = await api('/blobs/' + u.blob, { raw: true });
      if (res.ok) await putBlob(u.blob, await res.blob());
    }
  }
}

export const listRemote = async () => (await api('/docs')).docs;
export const fetchRemote = async (id) => normalizeDoc((await api('/docs/' + id)).doc);

// 新しい合言葉（端末で作るときの案）。英数 32 字。
export function newKey() {
  const a = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, (c) => ({ '+': 'k', '/': 'm', '=': '' })[c]);
}
