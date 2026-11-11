import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createElement } from '../app/src/model.js';
import { plantSchedule } from '../app/src/planting.js';
import { plotSheets } from '../app/src/plot.js';
import { defaultSheet, layout } from '../app/src/sheet.js';
import { BUILTIN, mergeLibrary, findSpecies } from '../app/src/species.js';

function doc() {
  const d = createDoc({ siteName: '春日邸' });
  const t = (name, h, r) => d.elements.push(createElement('jumoku', [[d.elements.length * 1000, 0]], { r, props: { 樹種: name, 樹高: h } }));
  t('ソヨゴ', 2500, 600); t('コナラ', 4500, 1100); t('ソヨゴ', 2500, 600); t('コナラ', 4000, 900); t('アオダモ', 3500, 650);
  return d;
}

test('植栽仕様表：樹種と大きさごとにまとめ、H の高い順に記号を振る', () => {
  const lib = mergeLibrary([{ ...findSpecies(BUILTIN, 'コナラ'), 規格C: 0.15, from: 'vault' }]);
  const { rows, numberOf } = plantSchedule(doc(), lib);
  assert.deepEqual(rows.map((r) => [r.記号, r.樹木名, r.H, r.C, r.W, r.数量]), [
    [1, 'コナラ', 4.5, 0.15, 2.2, 1],
    [2, 'コナラ', 4, 0.15, 1.8, 1],
    [3, 'アオダモ', 3.5, null, 1.3, 1],
    [4, 'ソヨゴ', 2.5, null, 1.2, 2],
  ]);
  assert.equal(numberOf.size, 5);
});

test('提案の描き方：題の帯は全幅、明朝の書体、記号の番号と表が PDF に入る', () => {
  const sh = { ...defaultSheet(), style: 'teian', cx: 2000, cy: 0, scale: 50 };
  const L = layout(sh);
  assert.equal(L.title.w, L.frame.w);
  const pdf = new TextDecoder('latin1').decode(plotSheets(doc(), [sh], { species: BUILTIN }));
  assert.match(pdf, /\/BaseFont \/HeiseiMin-W3-UniJIS-UCS2-HW-H/);
  assert.match(pdf, /\/F2 [\d.]+ Tf/);
  const sekou = new TextDecoder('latin1').decode(plotSheets(doc(), [{ ...sh, style: 'sekou' }], { species: BUILTIN }));
  assert.ok(!/\/F2 [\d.]+ Tf/.test(sekou.replace(/<?\/F2 \d+ 0 R/g, ''))); // 施工図は題に明朝を使わない（表題欄）
  const none = new TextDecoder('latin1').decode(plotSheets(doc(), [{ ...sh, plantTable: false }]));
  assert.ok(none.length < pdf.length);
});
