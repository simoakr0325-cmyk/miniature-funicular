import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as UL from '../app/src/underlay.js';
import { createDoc, createUnderlay, mergeDocs, normalizeDoc, applySnapshot } from '../app/src/model.js';
import { toNote, fromNote } from '../app/src/obsidian.js';
import { dist } from '../app/src/geometry.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps, `${a} ≠ ${b}`);
const base = () => createUnderlay({ name: '測量図.pdf', blob: 'abc', mime: 'image/png', w: 2000, h: 1400, x: 100, y: 200, s: 2.5, rot: 30, paperMmPerPx: 0.1 });

// 図の上の点 p が、下図のどの画素に当たるか（試験用の逆変換）。
function worldToPixel(ul, p) {
  const r = (-ul.rot * Math.PI) / 180;
  const dx = p[0] - ul.x, dy = p[1] - ul.y;
  return [(dx * Math.cos(r) - dy * Math.sin(r)) / ul.s, (dx * Math.sin(r) + dy * Math.cos(r)) / ul.s];
}

test('画素から図への変換（回転なし・あり）', () => {
  const u = { ...base(), rot: 0 };
  close(UL.pixelToWorld(u, [10, 20]), [125, 250]);
  const r = { ...base(), rot: 90 };
  close(UL.pixelToWorld(r, [10, 0]), [100, 225]);
  close(worldToPixel(base(), UL.pixelToWorld(base(), [345, 678])), [345, 678]);
});

test('長さで合わせる：一点目は動かず、二点間が指定の長さになる', () => {
  const u = base();
  const p1 = UL.pixelToWorld(u, [100, 100]), p2 = UL.pixelToWorld(u, [900, 500]);
  const px1 = worldToPixel(u, p1), px2 = worldToPixel(u, p2);
  const v = UL.calibrateLength(u, p1, p2, 12345);
  close(UL.pixelToWorld(v, px1), p1);
  assert.ok(Math.abs(dist(UL.pixelToWorld(v, px1), UL.pixelToWorld(v, px2)) - 12345) < 1e-6);
  assert.equal(v.rot, u.rot);
  assert.throws(() => UL.calibrateLength(u, p1, p1, 100));
});

test('2点で合わせる：下図の二点が図の二点に重なる', () => {
  const u = base();
  const a = UL.pixelToWorld(u, [300, 200]), b = UL.pixelToWorld(u, [1500, 1100]);
  const pa = worldToPixel(u, a), pb = worldToPixel(u, b);
  const qa = [0, 0], qb = [8000, -3000];
  const v = UL.alignTwoPoints(u, a, b, qa, qb);
  close(UL.pixelToWorld(v, pa), qa);
  close(UL.pixelToWorld(v, pb), qb);
});

test('向きと縮尺を変えても中心は動かない', () => {
  const u = base();
  const c = UL.center(u);
  const r = UL.setRotation(u, -12.5);
  assert.equal(r.rot, -12.5);
  close(UL.center(r), c);
  const s = UL.setPaperScale(u, 200);
  assert.ok(Math.abs(UL.paperScaleOf(s) - 200) < 1e-9);
  assert.ok(Math.abs(s.s - 20) < 1e-9); // 紙の 0.1mm × 200 = 20mm
  close(UL.center(s), c);
  assert.throws(() => UL.setPaperScale({ ...u, paperMmPerPx: null }, 100));
});

test('下図も合わせ・元に戻す・ノートの往復に乗る', () => {
  const d = createDoc({ siteId: 'Y-1' });
  const u = base();
  d.underlays.push(u);
  const other = structuredClone(d);
  other.underlays[0] = { ...u, opacity: 0.3, updatedAt: new Date(Date.parse(u.updatedAt) + 1000).toISOString() };
  const { doc, changed } = mergeDocs(d, other);
  assert.equal(changed, 1);
  assert.equal(doc.underlays[0].opacity, 0.3);
  const undone = applySnapshot(d.underlays, []);
  assert.deepEqual(Object.keys(undone[0]).sort(), ['deleted', 'id', 'updatedAt']);
  const note = toNote(doc);
  assert.ok(note.includes('![[下図_abc.png|400]]'));
  assert.deepEqual(fromNote(note), normalizeDoc(doc));
});

test('壊れた下図の記録は読み込み時に捨てる', () => {
  const d = normalizeDoc({ format: 'nawabari', version: 1, id: 'x', elements: [], underlays: [
    { id: 'a', blob: 'h', w: 10, h: 10, s: 1 }, { id: 'b', blob: 'h', w: 0, h: 10, s: 1 }, { id: 'c', deleted: true },
  ] });
  assert.deepEqual(d.underlays.map((u) => u.id), ['a', 'c']);
  assert.equal(d.underlays[0].opacity, 0.6);
});
