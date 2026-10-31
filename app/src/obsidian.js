// 一現場を一つの Obsidian ノート（Markdown）として書き出し・読み込みする。
// 前書き（frontmatter）は Obsidian のプロパティとして読める項目だけ。
// 図の正本は末尾の ```nawabari ブロックの JSON で、ここだけを読み戻す。

import { normalizeDoc, quantities, formatQty, live, liveUnderlays } from './model.js';
import { blobFileName } from './underlay.js';

const BLOCK_OPEN = '```nawabari';
const yamlStr = (s) => JSON.stringify(String(s ?? ''));

export function noteFileName(doc) {
  const parts = [doc.siteId, doc.siteName].map((s) => String(s || '').trim()).filter(Boolean);
  const base = (parts.join('_') || '無題') + '_縄張り';
  return base.replace(/[\\/:*?"<>|#^[\]]/g, '-') + '.md';
}

// ノートに添える図の絵のファイル名。現場名を変えても変わらないよう、図ID から作る。
export const figureFileName = (doc) => `縄張り図_${String(doc.id).slice(0, 8)}.svg`;

// figure：添える図の絵のファイル名（無ければ載せない）
export function toNote(doc, { figure = null } = {}) {
  const rows = quantities(doc);
  const lines = [
    '---',
    'nawabari: 1',
    `図ID: ${yamlStr(doc.id)}`,
    `現場ID: ${yamlStr(doc.siteId)}`,
    `現場名: ${yamlStr(doc.siteName)}`,
    `更新: ${yamlStr(doc.updatedAt)}`,
    `部材数: ${live(doc).length}`,
    'tags:',
    '  - 縄張り台',
    '---',
    '',
    `# ${doc.siteName || doc.siteId || '無題'}　縄張り図`,
    '',
    '> 縄張り台で開いて直してください。末尾の nawabari ブロックが図の本体です。手で書き換えないでください。',
    '',
    '## 数量',
    '',
  ];
  if (rows.length) {
    lines.push('| 項目 | 数量 | 単位 |', '| --- | ---: | --- |');
    for (const r of rows) lines.push(`| ${r.label} | ${formatQty(r)} | ${r.unit} |`);
  } else {
    lines.push('（まだ部材がありません）');
  }
  if (figure) lines.push('', '## 図', '', `![[${figure}]]`);
  const uls = liveUnderlays(doc);
  if (uls.length) {
    lines.push('', '## 下図', '');
    for (const u of uls) lines.push(`- ${u.name}`, `  ![[${blobFileName(u)}|400]]`);
  }
  lines.push('', '## 図データ', '', BLOCK_OPEN, JSON.stringify(doc), '```', '');
  return lines.join('\n');
}

export function isNawabariNote(text) {
  return /^---\r?\n(?:[^\n]*\r?\n)*?nawabari:\s*\d/.test(text) || text.includes(BLOCK_OPEN);
}

export function fromNote(text) {
  const start = text.lastIndexOf(BLOCK_OPEN);
  if (start < 0) throw new Error('このノートには図データ（nawabari ブロック）がありません');
  const bodyStart = text.indexOf('\n', start);
  const end = text.indexOf('\n```', bodyStart);
  if (bodyStart < 0 || end < 0) throw new Error('図データのブロックが閉じていません');
  let raw;
  try {
    raw = JSON.parse(text.slice(bodyStart + 1, end));
  } catch {
    throw new Error('図データを読めません（JSON が壊れています）');
  }
  return normalizeDoc(raw);
}
