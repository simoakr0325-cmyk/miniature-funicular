// 内蔵の工種から、vault に置く工種ノートを vault/10_辞書/工種/ に作る（既にあるファイルは書き換えない）。
// 使い方：node tools/make-koushu-notes.mjs
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { BUILTIN_KOUSHU, toKoushuNote, koushuFileName } from '../app/src/estimate.js';

const dir = new URL('../vault/10_辞書/工種/', import.meta.url);
mkdirSync(dir, { recursive: true });
let made = 0;
for (const k of BUILTIN_KOUSHU) {
  const f = new URL(koushuFileName(k), dir);
  if (existsSync(f)) continue;
  writeFileSync(f, toKoushuNote(k));
  made++;
}
console.log(`${made} 件作りました（全 ${BUILTIN_KOUSHU.length} 件）`);
