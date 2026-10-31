import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement } from '../app/src/model.js';
import { figureSvg } from '../app/src/plot.js';
import { toNote, fromNote, figureFileName } from '../app/src/obsidian.js';

const sample = () => {
  const d = createDoc({ siteId: 'Y-1', siteName: '春日邸' });
  d.elements.push(createElement('shikichi', [[0, 0], [12000, 0], [12000, 9000], [0, 9000]]));
  d.elements.push(createElement('hoso', [[1000, 1000], [5000, 1000], [5000, 4000], [1000, 4000]], { props: { 材料: 'インターロッキング' } }));
  d.elements.push(createElement('jumoku', [[8000, 6000]], { r: 750, props: { 樹種: 'ヤマボウシ' } }));
  return d;
};

test('ノートに添える図の絵は、部材が全部入る縮尺の SVG になる', () => {
  const svg = figureSvg(sample(), { date: new Date(2026, 9, 31) });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm"'));
  assert.ok(svg.includes('>ヤマボウシ</text>'));
  assert.ok(svg.includes('>1/50</text>'));
  assert.ok(svg.includes('>2026.10.31</text>'));
  // 開いた g と閉じた g の数が合う
  assert.equal((svg.match(/<g[ >]/g) || []).length, (svg.match(/<\/g>/g) || []).length);
  assert.equal(figureSvg(createDoc()), null);
});

test('図の絵を添えたノートも、読み戻すと同じ図になる', () => {
  const d = sample();
  const note = toNote(d, { figure: figureFileName(d) });
  assert.ok(note.includes(`## 図\n\n![[縄張り図_${d.id.slice(0, 8)}.svg]]`));
  assert.deepEqual(fromNote(note), d);
  assert.ok(!toNote(d).includes('## 図\n'));
});
