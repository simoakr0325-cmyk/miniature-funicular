import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlane, toLatLng, parseLatLng, guessZone } from '../app/src/latlng.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('緯度経度 → 平面直角座標が、PROJ（pyproj）の値と 1mm 以内で合う', () => {
  // 第Ⅷ系（長野）と第Ⅸ系（東京）。値は pyproj の EPSG:6668 → 6676 / 6677。
  let p = toPlane(36.6513, 138.181, 8);
  near(p.X, 72311.70722453303, 0.001);
  near(p.Y, -28521.049178306042, 0.001);
  p = toPlane(35.6812, 139.7671, 9);
  near(p.X, -35367.230132542936, 0.001);
  near(p.Y, -5995.185165946433, 0.001);
  // 原点は (0, 0)
  p = toPlane(36, 138.5, 8);
  near(p.X, 0, 1e-6);
  near(p.Y, 0, 1e-6);
});

test('平面直角座標 → 緯度経度で元に戻る（1e-9 度以内）', () => {
  for (const [lat, lng, z] of [[36.6513, 138.181, 8], [43.0621, 141.3544, 12], [26.2124, 127.6809, 15]]) {
    const p = toPlane(lat, lng, z);
    const q = toLatLng(p.X, p.Y, z);
    near(q.lat, lat, 1e-9);
    near(q.lng, lng, 1e-9);
  }
});

test('緯度経度の書き方をいろいろ読む', () => {
  assert.deepEqual(parseLatLng('36.6513, 138.1810'), { lat: 36.6513, lng: 138.181 });
  assert.deepEqual(parseLatLng('１３８．１８１０，３６．６５１３'), { lat: 36.6513, lng: 138.181 });
  const d = parseLatLng('北緯36度39分4.68秒 東経138度10分51.6秒');
  near(d.lat, 36.6513, 1e-6);
  near(d.lng, 138.181, 1e-6);
  const e = parseLatLng(`36°39'4.68"N 138°10'51.6"E`);
  near(e.lat, 36.6513, 1e-6);
  assert.equal(parseLatLng('あいう'), null);
  assert.equal(guessZone(36.65, 138.18), 8);
  assert.equal(guessZone(35.68, 139.77), 9);
});
