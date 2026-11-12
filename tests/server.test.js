import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
import { memKV } from '../server/memkv.js';
import { createDoc, createElement, tombstone } from '../app/src/model.js';

const env = () => ({ SYNC_KEY: 'aikotoba-123', STORE: memKV(), ASSETS: { fetch: async () => new Response('app') } });
const call = (e, method, path, { key = 'aikotoba-123', body, type } = {}) => worker.fetch(new Request('https://x.test' + path, {
  method, body, headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(type ? { 'content-type': type } : {}) },
}), e);

test('合言葉が無い・違うと読み書きできない。アプリの配信と ping は通る', async () => {
  const e = env();
  assert.equal((await call(e, 'GET', '/api/docs', { key: null })).status, 401);
  assert.equal((await call(e, 'GET', '/api/docs', { key: 'chigau' })).status, 401);
  assert.equal((await call(e, 'GET', '/api/docs')).status, 200);
  assert.deepEqual(await (await call(e, 'GET', '/api/ping', { key: null })).json(), { ok: true, name: 'nawabari', auth: false });
  assert.equal((await (await call(e, 'GET', '/api/ping')).json()).auth, true);
  assert.equal(await (await call(e, 'GET', '/index.html', { key: null })).text(), 'app');
  assert.equal((await call({ ...e, SYNC_KEY: '' }, 'GET', '/api/docs')).status, 503);
});

test('二台が別々に直した図を送ると、部材ごとに新しい方で合わさる', async () => {
  const e = env();
  const base = createDoc({ siteName: '春日邸' });
  base.elements.push(createElement('hoso', [[0, 0], [1000, 0], [1000, 1000]]));
  await call(e, 'PUT', '/api/docs/' + base.id, { body: JSON.stringify(base) });
  // PC は樹木を足し、iPhone は舗装を消す
  const pc = structuredClone(base);
  pc.elements.push(createElement('jumoku', [[500, 500]], { props: { 樹種: 'ソヨゴ' } }));
  pc.updatedAt = new Date(Date.now() + 1000).toISOString();
  const phone = structuredClone(base);
  phone.elements[0] = { ...tombstone(phone.elements[0]), updatedAt: new Date(Date.now() + 2000).toISOString() };
  phone.updatedAt = new Date(Date.now() + 2000).toISOString();
  const r1 = await (await call(e, 'PUT', '/api/docs/' + base.id, { body: JSON.stringify(pc) })).json();
  assert.equal(r1.doc.elements.filter((x) => !x.deleted).length, 2);
  const r2 = await (await call(e, 'PUT', '/api/docs/' + base.id, { body: JSON.stringify(phone) })).json();
  assert.equal(r2.pulled, 1); // iPhone に樹木が届く
  const liveEls = r2.doc.elements.filter((x) => !x.deleted);
  assert.deepEqual(liveEls.map((x) => x.kind), ['jumoku']);
  // 同じものをもう一度送っても書き込みは増えない
  const w = e.STORE.writes;
  await call(e, 'PUT', '/api/docs/' + base.id, { body: JSON.stringify(r2.doc) });
  assert.equal(e.STORE.writes, w);
  const list = await (await call(e, 'GET', '/api/docs')).json();
  assert.deepEqual(list.docs.map((d) => [d.siteName, d.count]), [['春日邸', 1]]);
  assert.equal((await call(e, 'PUT', '/api/docs/' + base.id, { body: JSON.stringify({ ...pc, id: 'betsu-no-zu-0001' }) })).status, 400);
  assert.equal((await call(e, 'GET', '/api/docs/nai-zu-00000001')).status, 404);
});

test('下図の画像を預けて取り出す', async () => {
  const e = env();
  const bytes = new Uint8Array([1, 2, 3, 250, 251]);
  assert.equal((await call(e, 'HEAD', '/api/blobs/0123456789abcdef')).status, 404);
  assert.equal((await call(e, 'PUT', '/api/blobs/0123456789abcdef', { body: bytes, type: 'image/jpeg' })).status, 200);
  const r = await call(e, 'GET', '/api/blobs/0123456789abcdef');
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  assert.equal((await call(e, 'PUT', '/api/blobs/NOT-A-HASH', { body: bytes })).status, 400);
});
