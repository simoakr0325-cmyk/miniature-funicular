import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SV from '../app/src/survey.js';

const sample = `地積測量図 座標一覧
点名   X座標        Y座標
K1  -45123.456   12345.678
K2  -45123.456   12357.678
K3  －45131.456  １２３５７．６７８
K4, -45131.456, 12345.678
`;

test('座標の一覧を読む（見出しは飛ばし、全角も読む）', () => {
  const { points, skipped } = SV.parseCoordText(sample);
  assert.deepEqual(points.map((p) => p.name), ['K1', 'K2', 'K3', 'K4']);
  assert.deepEqual(points[2], { name: 'K3', X: -45131.456, Y: 12357.678 });
  assert.deepEqual(skipped, [1, 2]);
  assert.deepEqual(SV.parseCoordText('100.5 200.25').points, [{ name: 'P1', X: 100.5, Y: 200.25 }]);
});

test('座標求積と辺の長さ', () => {
  const { points } = SV.parseCoordText(sample);
  assert.ok(Math.abs(SV.coordArea(points) - 96) < 1e-6); // 12m × 8m
  const e = SV.edgeLengths(points);
  assert.deepEqual(e.map((x) => Math.round(x.length * 1000) / 1000), [12, 8, 12, 8]);
  assert.equal(e[0].from + e[0].to, 'K1K2');
});

test('図の座標との行き来：北が上、東が右', () => {
  const { points } = SV.parseCoordText(sample);
  const geo = { origin: SV.originFor(points) };
  assert.deepEqual(geo.origin, [-45123, 12346]);
  const k1 = SV.toWorld(geo, points[0].X, points[0].Y);
  const k2 = SV.toWorld(geo, points[1].X, points[1].Y); // 東へ 12 m
  const k4 = SV.toWorld(geo, points[3].X, points[3].Y); // 南へ 8 m
  assert.ok(Math.abs(k2[0] - k1[0] - 12000) < 1e-6 && Math.abs(k2[1] - k1[1]) < 1e-6);
  assert.ok(Math.abs(k4[1] - k1[1] - 8000) < 1e-6); // 図は y 下向きなので南は +
  const back = SV.toSurvey(geo, k1);
  assert.ok(Math.abs(back.X - points[0].X) < 1e-6 && Math.abs(back.Y - points[0].Y) < 1e-6);
  assert.deepEqual(SV.dxfOffset(geo), [12346000, -45123000]);
});
