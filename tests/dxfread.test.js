import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement } from '../app/src/model.js';
import { buildDxf } from '../app/src/dxf.js';
import { decodeDxf, parseDxf, cleanText, toUnderlayGeometry } from '../app/src/dxfread.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const dxf = (entities, { blocks = '', header = '' } = {}) => ['0', 'SECTION', '2', 'HEADER', header, '0', 'ENDSEC',
  '0', 'SECTION', '2', 'BLOCKS', blocks, '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', entities, '0', 'ENDSEC', '0', 'EOF'].filter((x) => x !== '').join('\n');

test('書き出した DXF を読み戻すと、同じ形と日本語の文字になる', () => {
  const d = createDoc({ siteName: '春日邸' });
  d.elements.push(Object.assign(createElement('hoso', [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], { props: { 材料: '洗い出し' } }), { b: [0.4, 0, 0, 0] }));
  d.elements.push(createElement('jumoku', [[6000, 1000]], { r: 600, props: { 樹種: 'ヤマボウシ' } }));
  const bytes = buildDxf(d);
  const p = parseDxf(decodeDxf(bytes));
  // 舗装：y を反転して書き出しているので、読むと y 上向きの (0,0)-(4000,0)-(4000,-3000)-(0,-3000)
  const pave = p.paths.find((x) => x.layer === '舗装');
  assert.ok(pave.closed);
  // 曲げた辺の中点：図（y 下向き）では弧の中点が y = +800。DXF の y 上向きでは -800。
  const mid = pave.pts.reduce((best, q) => (Math.abs(q[0] - 2000) < Math.abs(best[0] - 2000) ? q : best));
  near(mid[0], 2000, 1);
  near(mid[1], -800, 1);
  const tree = p.circles.find((c) => c.layer === '樹木');
  near(tree.c[0], 6000); near(tree.c[1], -1000); near(tree.r, 600);
  assert.ok(p.texts.some((t) => t.s === 'ヤマボウシ'));
  assert.ok(p.texts.some((t) => t.s.includes('洗い出し')));
});

test('ふくらみ 1 は y 上向きで反時計回りの半円', () => {
  const p = parseDxf(dxf(['0', 'LWPOLYLINE', '8', 'A', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '2', '20', '0'].join('\n')));
  const ys = p.paths[0].pts.map((q) => q[1]);
  near(Math.min(...ys), -1, 1e-3);
  near(Math.max(...ys), 0);
});

test('ブロックの挿入（位置・回転・拡大）と、弧・単位・画層の非表示', () => {
  const blocks = ['0', 'BLOCK', '8', '0', '2', 'DOOR', '70', '0', '10', '0', '20', '0',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1000', '21', '0', '0', 'ENDBLK'].join('\n');
  const ents = ['0', 'INSERT', '8', '建具', '2', 'DOOR', '10', '5000', '20', '5000', '41', '2', '42', '2', '50', '90',
    '0', 'ARC', '8', 'A', '10', '0', '20', '0', '40', '10', '50', '0', '51', '90',
    '0', 'LINE', '8', 'HIDDEN', '10', '0', '20', '0', '11', '1', '21', '1'].join('\n');
  const tables = ''; // 画層の表なし
  const p = parseDxf(dxf(ents, { blocks, header: ['9', '$INSUNITS', '70', '6'].join('\n') }).replace('0\nSECTION\n2\nBLOCKS', ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'HIDDEN', '70', '0', '62', '-7', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'BLOCKS'].join('\n') + tables));
  assert.equal(p.unitMm, 1000);
  const door = p.paths.find((x) => x.layer === '建具');
  near(door.pts[0][0], 5000); near(door.pts[0][1], 5000);
  near(door.pts[1][0], 5000); near(door.pts[1][1], 7000);
  const arc = p.paths.find((x) => x.layer === 'A');
  near(arc.pts[0][0], 10); near(arc.pts.at(-1)[1], 10);
  assert.ok(!p.paths.some((x) => x.layer === 'HIDDEN'));
  const g = toUnderlayGeometry(p);
  assert.ok(g.w > 0 && g.h > 0);
});

test('文字の書式を素の文字に直す', () => {
  assert.equal(cleanText('%%c600 \\U+5C71'), 'Ø600 山');
  assert.equal(cleanText('{\\fMS Gothic|b0;1階}\\P平面図', true), '1階\n平面図');
});
