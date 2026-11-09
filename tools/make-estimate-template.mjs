// 晃さんの見積書（INVOY の形）から、アプリに同梱する既定の雛形を作る。
// 宛名・連絡先・作った人・保存場所・プリンタの設定を抜き、品目の行を空にする。
// 使い方：node tools/make-estimate-template.mjs 元の見積書.xlsx
import { readFileSync, writeFileSync } from 'node:fs';
import { fillEstimate, unzip } from '../app/src/xlsx.js';
import { makeZip } from '../app/src/zip.js';

const src = process.argv[2];
if (!src) throw new Error('元の見積書を指定してください');
const empty = { 税率: 0.1 };
const { bytes } = await fillEstimate(readFileSync(src), [], empty, { 宛名: '〇〇　様邸', 日付: new Date(2026, 0, 1) });
const files = await unzip(bytes);
const dec = new TextDecoder(), enc = new TextEncoder();
const edit = (name, fn) => files.set(name, enc.encode(fn(dec.decode(files.get(name)))));

const sst = dec.decode(files.get('xl/sharedStrings.xml'));
const swap = [
  [/山波ライフ[\s　]*下條[\s　]*晃/, '屋号　氏名'],
  [/〒\d{3}-\d{4}/, '〒000-0000'],
  [/長野県[^<]*/, '住所'],
  [/TEL：[\d-]+/, 'TEL：'],
  [/mail : [^<]+/, 'mail : '],
];
let t = sst;
for (const [re, to] of swap) t = t.replace(re, to);
files.set('xl/sharedStrings.xml', enc.encode(t));
if (/\d{3}-\d{4}-\d{4}|@|\d{3}-\d{4}(?!-)(?<!000-0000)/.test(t.replace('〒000-0000', ''))) throw new Error('連絡先が残っています');

edit('docProps/core.xml', (x) => x.replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator></dc:creator>').replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>'));
edit('xl/workbook.xml', (x) => x.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/, '').replace(/<xr:revisionPtr[^>]*\/>/, ''));
// プリンタの設定を外す
for (const k of [...files.keys()]) if (k.startsWith('xl/printerSettings/')) files.delete(k);
for (const k of [...files.keys()].filter((k) => /^xl\/worksheets\/_rels\/.*\.rels$/.test(k))) {
  edit(k, (x) => x.replace(/<Relationship [^>]*printerSettings[^>]*\/>/g, ''));
}
for (const k of [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))) {
  edit(k, (x) => x.replace(/\s*r:id="[^"]*"(?=[^>]*\/>)/g, (m) => m).replace(/<pageSetup([^>]*?)\s+r:id="[^"]*"/, '<pageSetup$1'));
}
edit('[Content_Types].xml', (x) => x.replace(/<Default Extension="bin"[^>]*\/>/, ''));

const order = ['[Content_Types].xml', ...[...files.keys()].filter((k) => k !== '[Content_Types].xml')];
const out = new URL('../app/templates/mitsumori.xlsx', import.meta.url);
writeFileSync(out, makeZip(order.map((name) => ({ name, data: files.get(name) }))));
console.log('作りました：app/templates/mitsumori.xlsx');
