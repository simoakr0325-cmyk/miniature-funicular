import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement, mergeDocs, applySnapshot, quantities, normalizeDoc, live } from '../app/src/model.js';

const later = (iso, ms = 1000) => new Date(Date.parse(iso) + ms).toISOString();

test('部材ごとに新しい方を採って合わせる', () => {
  const base = createDoc({ siteId: 'Y-001', siteName: '春日邸' });
  const a = createElement('hoso', [[0, 0], [1000, 0], [1000, 1000]]);
  const b = createElement('jumoku', [[500, 500]]);
  base.elements = [a, b];
  const pc = structuredClone(base);
  const phone = structuredClone(base);
  // PC で舗装の材料を直し、スマホで樹木を消して新しく石を置く。
  pc.elements[0].props.材料 = '砂利';
  pc.elements[0].updatedAt = later(a.updatedAt);
  pc.updatedAt = later(base.updatedAt);
  phone.elements[1] = { ...phone.elements[1], deleted: true, pts: [], props: {}, updatedAt: later(b.updatedAt, 2000) };
  const stone = createElement('keiseki', [[0, 0], [300, 0], [200, 300]]);
  phone.elements.push(stone);
  phone.updatedAt = later(base.updatedAt, 2000);

  const { doc, changed } = mergeDocs(pc, phone);
  assert.equal(changed, 2);
  assert.equal(doc.elements.find((e) => e.id === a.id).props.材料, '砂利');
  assert.ok(doc.elements.find((e) => e.id === b.id).deleted);
  assert.ok(doc.elements.find((e) => e.id === stone.id));
  assert.equal(live(doc).length, 2);
  // 逆向きに合わせても同じ結果になる。
  const rev = mergeDocs(phone, pc).doc;
  const key = (d) => JSON.stringify(d.elements.map((e) => [e.id, e.deleted || false, e.props]).sort());
  assert.equal(key(rev), key(doc));
});

test('別の図どうしは合わせない', () => {
  assert.throws(() => mergeDocs(createDoc(), createDoc()));
});

test('元に戻すと、消えた部材は tombstone として残る', () => {
  const el = createElement('hei', [[0, 0], [1000, 0]]);
  const res = applySnapshot([el], []);
  assert.equal(res.length, 1);
  assert.ok(res[0].deleted);
  const back = applySnapshot(res, [el], later(el.updatedAt, 5000));
  assert.ok(!back[0].deleted);
  assert.ok(back[0].updatedAt > el.updatedAt);
});

test('数量表', () => {
  const d = createDoc();
  d.elements = [
    createElement('hoso', [[0, 0], [2000, 0], [2000, 1500], [0, 1500]], { props: { 材料: '砂利' } }),
    createElement('hoso', [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], { props: { 材料: '砂利' } }),
    createElement('hei', [[0, 0], [3000, 0], [3000, 2500]]),
    createElement('jumoku', [[0, 0]], { props: { 樹種: 'ヤマボウシ' } }),
    createElement('jumoku', [[0, 0]], { props: { 樹種: 'ヤマボウシ' } }),
  ];
  const q = Object.fromEntries(quantities(d).map((r) => [r.label, r.value]));
  assert.equal(q['舗装　砂利'], 4);
  assert.equal(q['塀・擁壁　ブロック塀'], 5.5);
  assert.equal(q['樹木　ヤマボウシ'], 2);
});

test('読み込み時の確かめ', () => {
  assert.throws(() => normalizeDoc({ format: 'other' }));
  assert.throws(() => normalizeDoc({ format: 'nawabari', version: 99, id: 'x', elements: [] }));
  const d = normalizeDoc({ format: 'nawabari', version: 1, id: 'x', elements: [
    { id: 'a', kind: 'takasa', pts: [['10', '20']], props: { 高さ: '150' } },
    { id: 'b', kind: 'unknown', pts: [] },
  ] });
  assert.equal(d.elements.length, 1);
  assert.deepEqual(d.elements[0].pts, [[10, 20]]);
  assert.equal(d.elements[0].props.高さ, 150);
  assert.equal(d.settings.grid, 100);
});
