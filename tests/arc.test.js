import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../app/src/geometry.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('半円の弧：ふくらみ 1 は半円', () => {
  const a = [0, 0], b = [2000, 0];
  const arc = g.arcOf(a, b, 1);
  near(arc.r, 1000);
  near(arc.length, Math.PI * 1000);
  // 左手 (-dy, dx) = (0, +) の向きにふくらむ
  assert.deepEqual(arc.mid.map(Math.round), [1000, 1000]);
  const ps = g.arcPoints(a, b, 1, 8);
  assert.equal(ps.length, 8);
  for (const p of ps) near(g.dist(p, [1000, 0]), 1000);
  assert.ok(ps[3][1] > 0);
  const neg = g.arcPoints(a, b, -1, 8);
  assert.ok(neg[3][1] < 0);
});

test('円弧の辺を含む面積と長さ', () => {
  // 2000 角の正方形の一辺を外へふくらむ半円にする。
  const sq = [[0, 0], [2000, 0], [2000, 2000], [0, 2000]];
  const half = (Math.PI * 1000 * 1000) / 2;
  // 辺0 (0,0)→(2000,0) の左手は +y＝内側。外へは負。
  near(g.areaWithArcs(sq, [-1, 0, 0, 0]), 4e6 + half, 1e-3);
  near(g.areaWithArcs(sq, [1, 0, 0, 0]), 4e6 - half, 1e-3);
  // 向きを逆にしても同じ
  const rev = [...sq].reverse();
  // 逆順では辺0 が (0,2000)→(2000,2000)。同じ下辺は辺2 で、向きも逆なので符号も逆。
  near(g.areaWithArcs(rev, [0, 0, 1, 0]), 4e6 + half, 1e-3);
  near(g.lengthWithArcs(sq, [-1, 0, 0, 0], true), 6000 + Math.PI * 1000, 1e-6);
  // 細かな折れ線にした面積とも合う
  const dense = g.densify(sq, [-1, 0, 0, 0], true, 400);
  near(g.polygonArea(dense), 4e6 + half, 50);
});

test('点を通るふくらみ', () => {
  near(g.bulgeThrough([0, 0], [2000, 0], [1000, 1000]), 1);
  near(g.bulgeThrough([0, 0], [2000, 0], [1000, -500]), -0.5);
  assert.equal(g.bulgeThrough([0, 0], [2000, 0], [1000, 5], 10), 0);
});

test('回す・映す', () => {
  const r = g.rotatePts([[10, 0]], [0, 0], 90);
  near(r[0][0], 0); near(r[0][1], 10);
  assert.deepEqual(g.mirrorPts([[3, 4]], [0, 0], 'x'), [[-3, 4]]);
  assert.deepEqual(g.mirrorPts([[3, 4]], [0, 0], 'y'), [[3, -4]]);
});

import { createElement, measure, removeVertex, insertVertex, setBulge, mirrorElement, rotateElement, normalizeDoc } from '../app/src/model.js';

test('部材：円弧の面積、頂点を消す・足す、映す', () => {
  let el = createElement('hoso', [[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
  el = setBulge(el, 0, -1);
  near(measure(el).area, 4e6 + (Math.PI * 1e6) / 2, 1e-3);
  const m = mirrorElement(el, [1000, 1000], 'x');
  near(measure(m).area, measure(el).area, 1e-3);
  assert.equal(m.b[0], 1);
  const r = rotateElement(el, [0, 0], 90);
  near(measure(r).area, measure(el).area, 1);
  const less = removeVertex(el, 2);
  assert.equal(less.pts.length, 3);
  assert.deepEqual(less.b, [-1, 0, 0]);
  assert.equal(removeVertex(less, 0), null); // 面は 3 点を切れない
  const more = insertVertex(el, 0, [1000, -200]);
  assert.equal(more.pts.length, 5);
  assert.equal(more.b, undefined); // 曲げていた辺を分けると直線になり、曲げは残らない
  const line = createElement('hei', [[0, 0], [1000, 0], [2000, 0]]);
  assert.equal(removeVertex(line, 1).pts.length, 2);
  assert.equal(removeVertex(removeVertex(line, 1), 0), null);
});

test('読み込み時：ふくらみの数を辺の数に合わせる', () => {
  const d = normalizeDoc({ format: 'nawabari', version: 1, id: 'x', elements: [
    { id: 'a', kind: 'hoso', pts: [[0, 0], [10, 0], [10, 10]], b: [0.5] },
    { id: 'c', kind: 'hei', pts: [[0, 0], [10, 0]], b: [0, 0, 0] },
  ] });
  assert.deepEqual(d.elements[0].b, [0.5, 0, 0]);
  assert.equal(d.elements[1].b, undefined);
});
