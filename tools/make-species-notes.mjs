// 内蔵の樹種一覧から、vault に置く植木ノートを vault/10_辞書/植木/ に作る（既にあるファイルは書き換えない）。
// 使い方：node tools/make-species-notes.mjs
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { BUILTIN, KUBUN, toSpeciesNote, speciesFileName } from '../app/src/species.js';

const dir = new URL('../vault/10_辞書/植木/', import.meta.url);
mkdirSync(dir, { recursive: true });
let made = 0;
for (const s of BUILTIN) {
  const f = new URL(speciesFileName(s), dir);
  if (existsSync(f)) continue;
  writeFileSync(f, toSpeciesNote(s));
  made++;
}
// 一覧のノート（区分ごとにリンク）。これは毎回作り直す。
const index = ['---', '分類: 索引', 'tags:', '  - 植木', '---', '', '# 植木の一覧', '', '縄張り台の樹種ライブラリの元。各ノートの規格（H・W・C）と単価は山波創苑の仕入れの決まりで埋める。', ''];
for (const k of KUBUN) {
  index.push(`## ${k}`, '');
  for (const s of BUILTIN.filter((x) => x.区分 === k)) index.push(`- [[${s.和名}]]　${s.常落}・${s.科}`);
  index.push('');
}
writeFileSync(new URL('植木の一覧.md', dir), index.join('\n'));
console.log(`${made} 件作りました（全 ${BUILTIN.length} 種）`);
