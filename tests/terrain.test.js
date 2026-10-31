import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delaunay, buildTin, heightAt, contours, earthwork, surfacePoints, earthworkOf, contoursOf } from '../app/src/terrain.js';
import { createDoc, createElement } from '../app/src/model.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('三角網：どの三角形の外接円にも、ほかの点が入らない', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: 150 }, () => [rnd() * 20000, rnd() * 15000, rnd() * 1000]);
  const { pts: P, tris } = delaunay(pts);
  assert.ok(tris.length > 250 && tris.length < 300, String(tris.length)); // 2n − 2 − 外周の点の数
  for (const [a, b, c] of tris) {
    const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
    for (let i = 0; i < P.length; i++) {
      if (i === a || i === b || i === c) continue;
      assert.ok((P[i][0] - ux) ** 2 + (P[i][1] - uy) ** 2 >= r2 * (1 - 1e-9));
    }
  }
});

test('傾いた面の高さと等高線', () => {
  // z = x / 10（10m で 1000mm 上がる）
  const tin = buildTin([[0, 0, 0], [10000, 0, 1000], [10000, 10000, 1000], [0, 10000, 0], [5000, 5000, 500]]);
  near(heightAt(tin, [2500, 7000]), 250, 1e-6);
  assert.ok(Number.isNaN(heightAt(tin, [-10, 0])));
  const cs = contours(tin, 100);
  for (let h = 100; h <= 900; h += 100) assert.ok(cs.some((c) => c.h === h), String(h)); // 縁（0・1000）はどちらでもよい
  const c5 = cs.find((c) => c.h === 500);
  assert.equal(c5.major, true);
  assert.equal(c5.lines.length, 1); // つながって一本
  for (const [x] of c5.lines[0]) near(x, 5000, 1e-3);
  const ys = c5.lines[0].map((p) => p[1]);
  near(Math.min(...ys), 0, 1e-6);
  near(Math.max(...ys), 10000, 1e-6);
});

test('土量：平らな面を 100mm 盛ると、10m 四方で 10m³。傾いた面を平らにすると切土と盛土が半分ずつ', () => {
  const sq = [[0, 0], [10000, 0], [10000, 10000], [0, 10000]];
  const big = (z) => buildTin([[-1000, -1000, z], [11000, -1000, z], [11000, 11000, z], [-1000, 11000, z]]);
  let r = earthwork(big(0), big(100), sq, { cell: 100 });
  near(r.fill, 10, 1e-9);
  near(r.cut, 0, 1e-9);
  near(r.area, 100, 1e-9);
  near(r.covered, 1, 1e-12);
  // 現況 z = x/10（0〜1000）、計画は 500 で平ら → 切土・盛土ともに 100m² × 平均 0.25m / 2 = 12.5m³
  const slope = buildTin([[-1000, -1000, -100], [11000, -1000, 1100], [11000, 11000, 1100], [-1000, 11000, -100]]);
  r = earthwork(slope, big(500), sq, { cell: 100 });
  near(r.cut, 12.5, 0.01);
  near(r.fill, 12.5, 0.01);
  near(r.net, 0, 0.01);
});

test('図から：計画の高さ点と、天端の入った舗装が計画の面になる', () => {
  const d = createDoc();
  for (const [x, y, h] of [[0, 0, 0], [10000, 0, 0], [10000, 10000, 0], [0, 10000, 0]]) d.elements.push(createElement('takasa', [[x, y]], { props: { 高さ: h } }));
  d.elements.push(createElement('takasa', [[0, 0]], { props: { 高さ: 200, 区分: '計画' } }));
  d.elements.push(createElement('hoso', [[0, 0], [10000, 0], [10000, 10000], [0, 10000]], { props: { 材料: '土間コンクリート', 天端: 200 } }));
  assert.equal(surfacePoints(d, '現況').length, 4);
  assert.equal(surfacePoints(d, '計画').length, 5);
  const site = createElement('shikichi', [[0, 0], [10000, 0], [10000, 10000], [0, 10000]]);
  const r = earthworkOf(d, site);
  near(r.fill, 20, 0.01);
  const c = contoursOf(d);
  assert.equal(c.existing.length, 0); // 平らなので等高線なし
});

test('ノート・DXF・PDF にも土量と等高線が入る', async () => {
  const { toNote } = await import('../app/src/obsidian.js');
  const { buildDxf } = await import('../app/src/dxf.js');
  const { decodeDxf, parseDxf } = await import('../app/src/dxfread.js');
  const { figureSvg } = await import('../app/src/plot.js');
  const d = createDoc();
  // 現況：x 方向に 1/10 の傾き、計画：300 で平ら
  for (const [x, y] of [[0, 0], [10000, 0], [10000, 10000], [0, 10000]]) {
    d.elements.push(createElement('takasa', [[x, y]], { props: { 高さ: x / 10 } }));
    d.elements.push(createElement('takasa', [[x, y]], { props: { 高さ: 300, 区分: '計画' } }));
  }
  d.elements.push(createElement('shikichi', [[0, 0], [10000, 0], [10000, 10000], [0, 10000]]));
  const note = toNote(d);
  assert.match(note, /## 土量\n\n\| 項目 \| 数量 \| 単位 \|\n\| --- \| ---: \| --- \|\n\| 切土 \| 24\.50 \| m³ \|/);
  const p = parseDxf(decodeDxf(buildDxf(d)));
  assert.ok(p.paths.filter((x) => x.layer === '等高線（現況）').length >= 9);
  assert.ok(p.texts.some((t) => t.layer === '等高線（現況）' && t.s === 'GL+500'));
  assert.ok(p.texts.some((t) => t.s === 'FH+300'));
  const svg = figureSvg(d);
  assert.ok(svg.includes('>GL+500</text>'));
});
