import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN, parseSpeciesNote, toSpeciesNote, mergeLibrary, findSpecies, parseFrontmatter, KUBUN } from '../app/src/species.js';
import { makeZip, crc32 } from '../app/src/zip.js';
import { createDoc, createElement } from '../app/src/model.js';
import { buildParts } from '../app/src/scene3d.js';

test('内蔵の一覧：名前が重ならず、項目がそろっている', () => {
  assert.ok(BUILTIN.length >= 80);
  assert.equal(new Set(BUILTIN.map((s) => s.和名)).size, BUILTIN.length);
  for (const s of BUILTIN) {
    assert.ok(s.読み && s.学名 && s.科.endsWith('科'), s.和名);
    assert.ok(['落葉', '常緑', '半常緑'].includes(s.常落), s.和名);
    assert.ok(['広葉', '針葉'].includes(s.葉形), s.和名);
    assert.ok(KUBUN.includes(s.区分), s.和名);
    assert.match(s.読み, /^[ぁ-んー]+$/, s.和名);
  }
});

test('ノートに書いて読み戻すと同じ樹種。規格を埋めると数で読む', () => {
  const s = findSpecies(BUILTIN, 'ソメイヨシノ');
  const note = toSpeciesNote(s);
  assert.ok(note.startsWith('---\n分類: 植木\n和名: ソメイヨシノ\n'));
  assert.ok(note.includes(`学名: "Prunus × yedoensis 'Somei-yoshino'"`));
  const back = parseSpeciesNote(note, 'ソメイヨシノ.md');
  for (const k of ['和名', '読み', '学名', '科', '常落', '葉形', '区分']) assert.equal(back[k], s[k], k);
  assert.equal(back.規格H, null);
  const filled = note.replace('規格H:', '規格H: 3.0').replace('規格W:', '規格W: １．２').replace('単価:', '単価: 18000');
  const f = parseSpeciesNote(filled);
  assert.equal(f.規格H, 3);
  assert.equal(f.規格W, 1.2);
  assert.equal(f.単価, 18000);
  assert.equal(parseSpeciesNote('---\n分類: 道具\n---\n'), null);
  assert.equal(parseSpeciesNote('# 見出しだけ'), null);
});

test('frontmatter の書き方の揺れ（引用符・並び・角括弧）', () => {
  const fm = parseFrontmatter('---\n分類: "植木"\ntags: [植木, 高木]\naliases:\n  - 山法師\n---\n本文');
  assert.equal(fm.分類, '植木');
  assert.deepEqual(fm.tags, ['植木', '高木']);
  assert.deepEqual(fm.aliases, ['山法師']);
});

test('vault のノートは内蔵より優先し、内蔵に無い樹種も足す', () => {
  const lib = mergeLibrary([
    { ...findSpecies(BUILTIN, 'ヤマボウシ'), 規格H: 3, 規格W: 1.2, from: 'vault' },
    { 分類: '植木', 和名: 'ジューンベリー', 読み: 'じゅーんべりー', 区分: '高木', from: 'vault' },
  ]);
  assert.equal(lib.length, BUILTIN.length + 1);
  assert.equal(findSpecies(lib, 'ヤマボウシ').規格H, 3);
  assert.equal(lib[0].区分, '高木');
  assert.equal(lib.at(-1).区分, '地被');
});

test('3D：落葉と常緑で色が違い、針葉樹は円すい', () => {
  const d = createDoc();
  d.elements.push(createElement('jumoku', [[0, 0]], { props: { 樹種: 'ヤマボウシ', 樹高: 3000 } }));
  d.elements.push(createElement('jumoku', [[3000, 0]], { props: { 樹種: 'アカマツ', 樹高: 5000 } }));
  const [a, b] = buildParts(d, { library: BUILTIN }).filter((p) => p.type === 'tree');
  assert.notEqual(a.color, b.color);
  assert.equal(a.needle, false);
  assert.equal(b.needle, true);
});

test('ZIP：CRC と、ファイルの並び', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const z = makeZip([{ name: '植木/ヤマボウシ.md', data: 'abc' }, { name: 'b.md', data: 'xyz' }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 2);
});
