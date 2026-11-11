import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JOMON } from '../app/src/jomon.js';
import { createDoc, createElement } from '../app/src/model.js';
import { plotSheets, figureSvg } from '../app/src/plot.js';
import { defaultSheet } from '../app/src/sheet.js';

const logo = { bytes: readFileSync(new URL('../app/assets/logo-sansoen.jpg', import.meta.url)), w: 420, h: 115 };
const doc = () => {
  const d = createDoc({ siteName: '春日邸' });
  d.elements.push(createElement('hoso', [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], { props: { 材料: '芝' } }));
  return d;
};

test('縁取りに使う文様（J-24・J-34・J-36・J-37）が形として入っている', () => {
  for (const id of ['J-24', 'J-34', 'J-36', 'J-37']) {
    const s = JOMON[id];
    assert.ok(s.w > 0 && s.h > 0, id);
    assert.ok(s.polys.length > 0, id);
    for (const p of s.polys) assert.equal(p.length % 2, 0, id);
  }
  assert.equal(JOMON['J-24'].circles.length, 6);
});

test('会社名が山波創苑なら筆文字のロゴを入れ、ほかの名前なら文字で書く', () => {
  const sh = { ...defaultSheet(), cx: 2000, cy: 1500, scale: 50 };
  for (const style of ['sekou', 'teian']) {
    const pdf = new TextDecoder('latin1').decode(plotSheets(doc(), [{ ...sh, style }], { logo }));
    assert.match(pdf, /\/Subtype \/Image \/Width 420 \/Height 115/, style);
    const other = new TextDecoder('latin1').decode(plotSheets(doc(), [{ ...sh, style, company: '山波ライフ' }], { logo }));
    assert.ok(!/\/Subtype \/Image/.test(other), style);
  }
  const svg = figureSvg(doc(), { logo });
  assert.match(svg, /<image href="data:image\/jpeg;base64,\/9j\//);
});
