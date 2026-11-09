// リポジトリの vault/ を、そのまま vault に展開できる ZIP にする。
// 使い方：node tools/zip-vault.mjs 出力先.zip
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../app/src/zip.js';

const root = fileURLToPath(new URL('../vault/', import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ name: relative(root, p).split('\\').join('/'), data: readFileSync(p) });
  }
};
walk(root);
const out = process.argv[2] || 'vault.zip';
writeFileSync(out, makeZip(files));
console.log(`${files.length} 件を ${out} にまとめました`);
