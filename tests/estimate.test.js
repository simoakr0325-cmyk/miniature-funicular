import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDoc, createElement } from '../app/src/model.js';
import { BUILTIN_KOUSHU, buildEstimate, estimateRows, parseKoushuNote, toKoushuNote, mergeKoushu, roundQty } from '../app/src/estimate.js';
import { BUILTIN, mergeLibrary, findSpecies } from '../app/src/species.js';
import { fillEstimate, unzip, inspectTemplate } from '../app/src/xlsx.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// 晃さんの見積（2025 年 3 月）と同じ数量の図
function sample() {
  const d = createDoc({ siteName: '春日邸' });
  d.elements.push(createElement('hoso', rect(0, 0, 13000, 4000), { props: { 材料: '防草シート砂利敷' } })); // 52 平米
  d.elements.push(createElement('hoso', rect(0, 5000, 3250, 4000), { props: { 材料: 'タイル' } })); // 13 平米
  d.elements.push(createElement('jumoku', [[0, 0]], { props: { 樹種: 'ヤマボウシ' } }));
  d.elements.push(createElement('jumoku', [[1, 0]], { props: { 樹種: 'ヤマボウシ' } }));
  d.elements.push(createElement('hei', [[0, 0], [5000, 0]], { props: { 種類: 'ブロック塀', 高さ: 1200 } }));
  return d;
}

test('元の見積と同じ数量なら、同じ内訳と金額になる（防草シート砂利敷 52 平米 = 131,440 円）', () => {
  const est = buildEstimate(sample(), { koushu: BUILTIN_KOUSHU });
  const g = est.groups.find((x) => x.名前 === '防草シート砂利敷工事');
  assert.equal(g.数量, 52);
  assert.deepEqual(g.lines.map((l) => [l.数量, l.金額]), [[4.2, 14700], [2.6, 21060], [52, 76960], [1.6, 18720]]);
  assert.equal(g.金額, 131440);
  const t = est.groups.find((x) => x.名前 === 'タイルテラス施工工事');
  assert.deepEqual(t.lines.map((l) => l.金額), [10530, 0, 20800]);
  assert.ok(est.missing.includes('タイルテラス施工工事　タイル材料費'));
  assert.ok(est.missing.some((m) => m.startsWith('塀・擁壁　ブロック塀')));
});

test('樹木は植木ノートの単価で本数を掛ける。税は 10% 切り捨て、諸経費と値引き', () => {
  const species = mergeLibrary([{ ...findSpecies(BUILTIN, 'ヤマボウシ'), 規格H: 3, 規格W: 1.2, 単価: 18000, from: 'vault' }]);
  const est = buildEstimate(sample(), { species, 諸経費率: 0.1, 値引き: 1000 });
  const p = est.groups.find((x) => x.名前 === '植栽工事');
  assert.deepEqual(p.lines.map((l) => [l.品目, l.数量, l.金額]), [['ヤマボウシ　H3 W1.2', 2, 36000]]);
  assert.equal(est.工事計, 131440 + 31330 + 36000);
  assert.equal(est.extras[0].金額, Math.round(est.工事計 * 0.1));
  assert.equal(est.税抜, est.工事計 + est.extras[0].金額 - 1000);
  assert.equal(est.税, Math.floor(est.税抜 * 0.1));
  assert.equal(est.税込, est.税抜 + est.税);
});

test('工種ノートを書いて読み戻すと同じ。vault の方が優先', () => {
  const k = BUILTIN_KOUSHU[0];
  const back = parseKoushuNote(toKoushuNote(k));
  assert.equal(back.工事名, k.工事名);
  assert.equal(back.kindLabel, '舗装');
  assert.equal(back.sub, '人工芝');
  assert.deepEqual(back.lines.map((l) => [l.品目, l.出し方, l.係数, l.単位, l.単価]), k.lines.map((l) => [l.品目, l.出し方, l.係数, l.単位, l.単価]));
  const edited = toKoushuNote(k).replace('| 人工芝施工費 | 面積 | 1 | 平米 |  |', '| 人工芝施工費 | 面積 | 1 | 平米 | 3,500 |');
  const merged = mergeKoushu([parseKoushuNote(edited)]);
  assert.equal(merged.find((x) => x.工事名 === '人工芝施工工事').lines[3].単価, 3500);
  assert.equal(roundQty(1.05, '立米'), 1.1);
  assert.equal(roundQty(0.01, '立米'), 0.1);
});

test('同梱の雛形に流し込むと、品目・式・合計が入り、行が足りなければ足す', async () => {
  const tpl = readFileSync(new URL('../app/templates/mitsumori.xlsx', import.meta.url));
  const info = await inspectTemplate(tpl);
  assert.equal(info.ok, true);
  assert.equal(info.rows, 26);
  const species = mergeLibrary([{ ...findSpecies(BUILTIN, 'ヤマボウシ'), 単価: 18000, from: 'vault' }]);
  const d = sample();
  for (let i = 0; i < 12; i++) d.elements.push(createElement('jumoku', [[i * 100, 9000]], { props: { 樹種: BUILTIN[i + 20].和名 } }));
  const est = buildEstimate(d, { species });
  const rows = estimateRows(est);
  assert.ok(rows.length > 26);
  const r = await fillEstimate(tpl, rows, est, { 宛名: '春日　様邸', 日付: new Date(2026, 10, 9) });
  assert.equal(r.added, rows.length - 26);
  const files = await unzip(r.bytes);
  const sheet = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /<c r="C12"[^>]*t="inlineStr"><is><t xml:space="preserve">防草シート砂利敷工事<\/t>/);
  assert.match(sheet, /<c r="M12"[^>]*><f>SUM\(M13:M16\)<\/f><v>131440<\/v><\/c>/);
  assert.match(sheet, /<f>ROUND\(J13\*K13,0\)<\/f><v>14700<\/v>/);
  const taxRow = 38 + r.added;
  assert.match(sheet, new RegExp(`<c r="M${taxRow}"[^>]*><f>ROUNDDOWN\\(M${taxRow + 1}\\*0.1,0\\)</f><v>${r.tax}</v>`));
  assert.match(sheet, new RegExp(`<c r="C8"[^>]*><f>M${taxRow + 1}\\+M${taxRow}</f><v>${r.total + r.tax}</v>`));
  assert.match(sheet, /春日　様邸/);
  const wb = new TextDecoder().decode(files.get('xl/workbook.xml'));
  assert.match(wb, /fullCalcOnLoad="1"/);
  assert.match(wb, new RegExp(`\\$P\\$${43 + r.added}`));
  const styles = new TextDecoder().decode(files.get('xl/styles.xml'));
  assert.match(styles, /formatCode="General&quot;立米&quot;"/);
});
