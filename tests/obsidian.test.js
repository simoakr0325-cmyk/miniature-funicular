import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement } from '../app/src/model.js';
import { toNote, fromNote, noteFileName, isNawabariNote } from '../app/src/obsidian.js';

test('ノートに書いて読み戻すと同じ図になる', () => {
  const d = createDoc({ siteId: 'Y-2026-014', siteName: '春日邸 "前庭"' });
  d.elements.push(createElement('hoso', [[0, 0], [2000, 0], [2000, 2000]], { props: { 材料: '洗い出し' } }));
  d.elements.push(createElement('moji', [[0, 0]], { props: { 文字: '```と改行\nを含む' } }));
  const note = toNote(d);
  assert.ok(note.startsWith('---\nnawabari: 1\n'));
  assert.ok(note.includes('現場ID: "Y-2026-014"'));
  assert.ok(note.includes('現場名: "春日邸 \\"前庭\\""'));
  assert.ok(note.includes('| 舗装　洗い出し | 2.00 | m² |'));
  assert.ok(isNawabariNote(note));
  assert.deepEqual(fromNote(note), d);
});

test('Obsidian 側でノートの前後に書き足しても読める', () => {
  const d = createDoc({ siteId: 'A1' });
  const note = toNote(d).replace('## 数量', '施主との打合せメモ\n\n## 数量') + '\n\n追記：来週見積\n';
  assert.equal(fromNote(note).id, d.id);
});

test('図データのないノートは断る', () => {
  assert.throws(() => fromNote('# ふつうのノート'));
  assert.ok(!isNawabariNote('# ふつうのノート'));
});

test('ファイル名に使えない字を除く', () => {
  assert.equal(noteFileName(createDoc({ siteId: 'Y/01', siteName: '山田:邸' })), 'Y-01_山田-邸_縄張り.md');
  assert.equal(noteFileName(createDoc()), '無題_縄張り.md');
});
