import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSjis } from '../app/src/sjis.js';
import { buildDxf, dxfFileName } from '../app/src/dxf.js';
import { createDoc, createElement, setBulge } from '../app/src/model.js';

test('Shift_JIS にする', () => {
  assert.deepEqual([...encodeSjis('A山')], [0x41, 0x8e, 0x52]);
  assert.deepEqual([...encodeSjis('ｱ')], [0xb1]);
  assert.equal(new TextDecoder('shift_jis').decode(encodeSjis('縄張り台 ㎡ ①')), '縄張り台 ㎡ ①');
  assert.deepEqual([...encodeSjis('😀')], [0x3f]); // 表せない字は ?
});

function groups(bytes) {
  const lines = new TextDecoder('shift_jis').decode(bytes).split('\r\n');
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]]);
  return out;
}

test('DXF：R12・Shift_JIS、y を反転、ふくらみ、画層', () => {
  const d = createDoc({ siteId: 'Y-1', siteName: '春日邸' });
  let h = createElement('hoso', [[0, 0], [2000, 0], [2000, 1000]], { props: { 材料: '砂利' } });
  h = setBulge(h, 0, -0.5);
  d.elements.push(h, createElement('jumoku', [[500, 600]], { props: { 樹種: 'ヤマボウシ' } }));
  const g = groups(buildDxf(d, { textHeight: 250 }));
  const val = (code, after = 0) => g.slice(after).find(([c]) => c === code)?.[1];
  assert.equal(g.at(-1)[1], 'EOF');
  const ver = g.findIndex(([c, v]) => c === 9 && v === '$ACADVER');
  assert.equal(g[ver + 1][1], 'AC1009');
  assert.ok(g.some(([c, v]) => c === 3 && v === 'ANSI_932'));
  // 舗装の画層と頂点（y は反転）
  const pl = g.findIndex(([c, v]) => c === 0 && v === 'POLYLINE');
  assert.equal(val(8, pl), '舗装');
  const vtx = g.findIndex(([c, v], i) => i > pl && c === 0 && v === 'VERTEX');
  assert.deepEqual([g[vtx + 2][1], g[vtx + 3][1]], ['0', '0']);
  assert.equal(g[vtx + 5][0], 42);
  assert.equal(g[vtx + 5][1], '-0.5');
  const v3 = g.filter(([c, v]) => c === 0 && v === 'VERTEX').length;
  assert.equal(v3, 3);
  // 三つ目の頂点 (2000, 1000) は DXF で (2000, -1000)
  const lastV = g.map(([c, v], i) => (c === 0 && v === 'VERTEX' ? i : -1)).filter((i) => i >= 0).at(-1);
  assert.deepEqual([g[lastV + 2][1], g[lastV + 3][1]], ['2000', '-1000']);
  // 樹木は円、樹種は注記の文字
  const ci = g.findIndex(([c, v]) => c === 0 && v === 'CIRCLE');
  assert.equal(val(40, ci), '750');
  assert.ok(g.some(([c, v]) => c === 1 && v === 'ヤマボウシ'));
  assert.ok(g.some(([c, v]) => c === 1 && v === '砂利'));
  assert.equal(dxfFileName(d), 'Y-1_春日邸_平面図.dxf');
});

test('DXF：座標をずらして書き出せる', () => {
  const d = createDoc();
  d.elements.push(createElement('enseki', [[100, 200], [300, 200]]));
  const g = groups(buildDxf(d, { offset: [1000000, 2000000] }));
  const vtx = g.findIndex(([c, v]) => c === 0 && v === 'VERTEX');
  assert.deepEqual([g[vtx + 2][1], g[vtx + 3][1]], ['1000100', '1999800']);
});
