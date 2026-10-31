import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement } from '../app/src/model.js';
import { buildParts, groundOf, sunDirection, groundGrid, sceneBox } from '../app/src/scene3d.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('部材が 3D の部品になる（建物の高さ・舗装の天端・塀・樹木）', () => {
  const d = createDoc();
  d.elements.push(createElement('tatemono', [[0, 0], [8000, 0], [8000, 6000], [0, 6000]], { props: { 名前: '母屋', 高さ: 7000 } }));
  d.elements.push(createElement('hoso', [[9000, 0], [12000, 0], [12000, 5000], [9000, 5000]], { props: { 材料: 'インターロッキング', 天端: 150 } }));
  d.elements.push(createElement('hei', [[0, 8000], [6000, 8000], [6000, 11000]], { props: { 種類: 'ブロック塀', 高さ: 1200 } }));
  d.elements.push(createElement('jumoku', [[10000, 9000]], { r: 900, props: { 樹種: 'ヤマボウシ', 樹高: 4000 } }));
  d.elements.push(createElement('takasa', [[0, 0]], { props: { 高さ: 100 } }));
  const parts = buildParts(d);
  const b = parts.find((p) => p.kind === 'bldg');
  near(b.z1 - b.z0, 7300, 1e-9);
  const h = parts.find((p) => p.kind === 'hoso');
  assert.equal(h.z1, 150);
  assert.equal(h.color, '#b58f73');
  assert.equal(parts.filter((p) => p.type === 'wall').length, 2);
  const t = parts.find((p) => p.type === 'tree');
  assert.equal(t.h, 4000);
  assert.ok(t.crownZ + t.crownR[1] <= 4000 + 1e-9);
  assert.equal(parts.some((p) => p.kind === 'takasa'), false);
});

test('地面の高さは計画 → 現況 → 0 の順', () => {
  const d = createDoc();
  for (const [x, y] of [[0, 0], [10000, 0], [10000, 10000], [0, 10000]]) d.elements.push(createElement('takasa', [[x, y]], { props: { 高さ: 500 } }));
  let g = groundOf(d);
  near(g([5000, 5000]), 500, 1e-9);
  near(g([20000, 5000]), 500, 1e-9); // 三角網の外は点から均す
  for (const [x, y] of [[2000, 2000], [8000, 2000], [5000, 8000]]) d.elements.push(createElement('takasa', [[x, y]], { props: { 高さ: 800, 区分: '計画' } }));
  g = groundOf(d);
  near(g([5000, 4000]), 800, 1e-9); // 計画の三角形の中
  near(g([500, 9500]), 500, 1e-9); // 計画の外は現況
  const gg = groundGrid(d, sceneBox(d), 1000);
  assert.equal(gg.hs.length, (gg.nx + 1) * (gg.ny + 1));
});

test('太陽は南の空にある（北が図の上なら、z が負＝北ではなく正＝南）', () => {
  const s = sunDirection(0);
  assert.ok(s[1] > 0.7 && s[2] > 0.3, String(s));
  near(Math.hypot(...s), 1, 1e-12);
  // 北が図の右（90°）なら、南は図の左（x が負）
  assert.ok(sunDirection(90)[0] < -0.3);
});
