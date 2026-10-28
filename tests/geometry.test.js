import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../app/src/geometry.js';

test('面積は向きによらず正', () => {
  const sq = [[0, 0], [2000, 0], [2000, 3000], [0, 3000]];
  assert.equal(g.polygonArea(sq), 6e6);
  assert.equal(g.polygonArea([...sq].reverse()), 6e6);
});

test('L字の面積と重心', () => {
  const L = [[0, 0], [2000, 0], [2000, 1000], [1000, 1000], [1000, 2000], [0, 2000]];
  assert.equal(g.polygonArea(L), 3e6);
  const [cx, cy] = g.centroid(L);
  assert.ok(Math.abs(cx - 833.33) < 0.01 && Math.abs(cy - 833.33) < 0.01);
});

test('線の長さと周長', () => {
  assert.equal(g.polylineLength([[0, 0], [3000, 0], [3000, 4000]]), 7000);
  assert.equal(g.polygonPerimeter([[0, 0], [3000, 0], [3000, 4000]]), 12000);
});

test('点と線分の距離・内外判定', () => {
  assert.equal(g.distToSegment([5, 5], [0, 0], [10, 0]), 5);
  assert.equal(g.distToSegment([-3, 4], [0, 0], [10, 0]), 5);
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(g.pointInPolygon([5, 5], sq));
  assert.ok(!g.pointInPolygon([15, 5], sq));
});

test('45° 寄せと長さ指定の点', () => {
  const p = g.orthoConstrain([0, 0], [1000, 80]);
  assert.ok(Math.abs(p[1]) < 1e-9 && Math.abs(p[0] - Math.hypot(1000, 80)) < 1e-9);
  assert.deepEqual(g.pointAtDistance([0, 0], [10, 0], 3000), [3000, 0]);
  assert.deepEqual(g.snapToGrid([149, 251], 100), [100, 300]);
});
