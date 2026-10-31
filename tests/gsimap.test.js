import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGsi, pixelToLonLat, lonLatToPixel, latLngToWorld } from '../app/src/gsimap.js';
import { toPlane } from '../app/src/latlng.js';
import { pixelToWorld } from '../app/src/underlay.js';

test('地理院タイルの画像の置き方：画像のどの画素も、図の上で 5cm 以内に重なる', () => {
  const { X, Y } = toPlane(36.6513, 138.181, 8);
  const geo = { origin: [Math.round(X), Math.round(Y)], zone: 8 };
  const plan = planGsi(geo, [0, 0], 150, 'std');
  assert.equal(plan.z, 18);
  assert.ok(plan.tiles.length >= 4 && plan.tiles.length <= 9, String(plan.tiles.length));
  assert.match(plan.tiles[0].url, /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/std\/18\/\d+\/\d+\.png$/);
  const ul = { ...plan.place, w: plan.w, h: plan.h };
  for (const [u, v] of [[0, 0], [plan.w, plan.h], [0, plan.h], [plan.w / 2, plan.h / 3]]) {
    const q = pixelToLonLat(plan.origin[0] + u, plan.origin[1] + v, plan.z);
    const exact = latLngToWorld(geo, q.lat, q.lng);
    const placed = pixelToWorld(ul, [u, v]);
    assert.ok(Math.hypot(exact[0] - placed[0], exact[1] - placed[1]) < 50, `${u},${v}: ${exact} vs ${placed}`);
  }
  // 子午線収差：第Ⅷ系の原点（東経 138.5°）より西なので、真北は図の上（座標の北）より少し東へ傾く。
  // 画像の上の辺（真東）も同じだけ回り、図の上で少し下向き＝ rot は正（画面で時計回り）。
  assert.ok(plan.place.rot > 0 && plan.place.rot < 0.5, String(plan.place.rot));
  assert.ok(plan.place.k > 0.99 && plan.place.k < 1, String(plan.place.k));
});

test('メルカトルの画素と緯度経度の行き来', () => {
  const [px, py] = lonLatToPixel(35.6812, 139.7671, 18);
  const q = pixelToLonLat(px, py, 18);
  assert.ok(Math.abs(q.lat - 35.6812) < 1e-10 && Math.abs(q.lng - 139.7671) < 1e-10);
});
