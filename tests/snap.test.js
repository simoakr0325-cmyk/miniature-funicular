import test from 'node:test';
import assert from 'node:assert/strict';
import { findSnap } from '../app/src/hit.js';
import { createDoc } from '../app/src/model.js';

// 画面 = 世界（1 mm = 1 px）の簡単な見え方
const v = { scale: 1, toW: (p) => p, toS: (p) => p };
const els = [{ id: 'a', kind: 'hoso', pts: [[100, 100], [200, 100], [200, 200]] }];

test('既定は方眼に吸着しない・角には吸着する', () => {
  const s = createDoc().settings;
  assert.equal(s.snapGrid, false);
  assert.equal(s.snapPts, true);
  assert.equal(s.gridOn, true);
});

test('吸着を切れば押した所にそのまま置く', () => {
  assert.deepEqual(findSnap(els, v, [37, 41], { grid: 100, gridOn: false }).p, [37, 41]);
  assert.deepEqual(findSnap(els, v, [37, 41], { grid: 100, gridOn: true }).p, [0, 0]);
  assert.deepEqual(findSnap(els, v, [104, 97], { grid: 100, gridOn: false }).p, [100, 100]);
  assert.deepEqual(findSnap(els, v, [104, 97], { grid: 100, gridOn: false, pts: false }).p, [104, 97]);
});

test('角の吸着を切っても、描いている図形の始点には吸い付く（閉じられる）', () => {
  const s = findSnap(els, v, [303, 298], { grid: 100, gridOn: false, pts: false, draft: [[300, 300], [400, 300]] });
  assert.deepEqual(s.p, [300, 300]);
  assert.equal(s.type, 'vertex');
});
