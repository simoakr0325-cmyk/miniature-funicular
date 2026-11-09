// 見積。図の数量を、工種ノート（工事の組み立てと単価）に当てて、見積書の行にする。
// 工種ノートは vault の「10_辞書/工種」に置く。frontmatter に 分類: 工種・工事名・対象・単位、
// 本文の表に内訳（品目・数量の出し方・係数・単位・単価）。
// 樹木は植木ノートの単価で「植栽工事」の行にする。工種の無い部材は、単価を空けた行にして知らせる。

import { KINDS, live, measure } from './model.js';
import { parseFrontmatter, findSpecies } from './species.js';

// 数量の出し方
export const BASES = ['面積', '面積×厚み', '周長', '長さ', '本数', '一式'];

// ---------- 工種ノート ----------

export function parseKoushuNote(text, fileName = '') {
  const fm = parseFrontmatter(text);
  if (!fm || fm.分類 !== '工種') return null;
  const 工事名 = fm.工事名 || String(fileName).replace(/\.md$/i, '').trim();
  const [kindLabel, sub = ''] = String(fm.対象 || '').split(/[／/]/).map((s) => s.trim());
  const lines = [];
  // 本文の表：| 品目 | 数量 | 係数 | 単位 | 単価 |
  for (const row of String(text).split(/\r?\n/)) {
    const m = /^\s*\|(.+)\|\s*$/.exec(row);
    if (!m) continue;
    const cells = m[1].split('|').map((s) => s.trim());
    if (cells.length < 5 || cells[0] === '品目' || /^:?-{3,}:?$/.test(cells[0])) continue;
    const [品目, 出し方, 係数, 単位, 単価] = cells;
    if (!品目) continue;
    lines.push({ 品目, 出し方: BASES.includes(出し方) ? 出し方 : '一式', 係数: num(係数) ?? 1, 単位: 単位 || '式', 単価: num(単価) });
  }
  return { 工事名, kindLabel, sub, 単位: fm.単位 || '', lines, from: 'vault' };
}

function num(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[０-９．，－]/g, (c) => ({ '．': '.', '，': '', '－': '-' })[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,¥\s円]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const cell = (v) => (v === null || v === undefined ? '' : String(v));

export function toKoushuNote(k) {
  return [
    '---',
    '分類: 工種',
    `工事名: ${k.工事名}`,
    `対象: ${k.kindLabel}${k.sub ? '／' + k.sub : ''}`,
    `単位: ${k.単位 || ''}`,
    'tags:',
    '  - 工種',
    '---',
    '',
    `# ${k.工事名}`,
    '',
    '> 対象の部材（「舗装／人工芝」なら材料が人工芝の舗装）の数量から、下の内訳を作ります。数量の出し方は 面積・面積×厚み（係数が厚み m）・周長・長さ・本数・一式。単価は円（税抜）。空の単価は見積で空欄になります。',
    '',
    '| 品目 | 数量 | 係数 | 単位 | 単価 |',
    '| --- | --- | ---: | --- | ---: |',
    ...k.lines.map((l) => `| ${l.品目} | ${l.出し方} | ${cell(l.係数)} | ${l.単位} | ${cell(l.単価)} |`),
    '',
    k.memo ? `## メモ\n\n${k.memo}\n` : '## メモ\n',
  ].join('\n');
}

// 初めの工種：晃さんの見積（2025 年 3 月）の内訳と単価から。単価と金額が合わなかった品目は単価を空けた。
export const BUILTIN_KOUSHU = [
  {
    工事名: '人工芝施工工事', kindLabel: '舗装', sub: '人工芝', 単位: '平米',
    lines: [
      { 品目: '砕石転圧ｔ100㎜', 出し方: '面積×厚み', 係数: 0.1, 単位: '立米', 単価: 8100 },
      { 品目: '洗い砂ｔ10㎜', 出し方: '面積×厚み', 係数: 0.01, 単位: '立米', 単価: 6500 },
      { 品目: '人工芝用ピン・テープ・ジョイント', 出し方: '周長', 係数: 1, 単位: 'ｍ', 単価: 500 },
      { 品目: '人工芝施工費', 出し方: '面積', 係数: 1, 単位: '平米', 単価: null },
      { 品目: '人工芝見切り材', 出し方: '周長', 係数: 1, 単位: 'ｍ', 単価: null },
    ],
    memo: '元の見積では、人工芝施工費は単価 3,000 円・70 平米で金額 245,000 円（平米 3,500 円相当）、見切り材は単価 7,100 円・30ｍで金額 35,500 円でした。どちらが正しいか分からないので単価を空けています。',
  },
  {
    工事名: 'タイルテラス施工工事', kindLabel: '舗装', sub: 'タイル', 単位: '平米',
    lines: [
      { 品目: '砕石転圧ｔ100㎜', 出し方: '面積×厚み', 係数: 0.1, 単位: '立米', 単価: 8100 },
      { 品目: 'タイル材料費', 出し方: '面積', 係数: 1, 単位: '平米', 単価: null },
      { 品目: '施工諸経費', 出し方: '面積', 係数: 1, 単位: '平米', 単価: 1600 },
    ],
    memo: '元の見積では、タイル材料費は単価 1,880 円・13 平米で金額 135,360 円（1,880 円 × 72）でした。単位が枚かもしれないので単価を空けています。',
  },
  {
    工事名: '防草シート砂利敷工事', kindLabel: '舗装', sub: '防草シート砂利敷', 単位: '平米',
    lines: [
      { 品目: '鋤土残土処分ｔ80㎜', 出し方: '面積×厚み', 係数: 0.08, 単位: '立米', 単価: 3500 },
      { 品目: '砕石転圧ｔ50㎜', 出し方: '面積×厚み', 係数: 0.05, 単位: '立米', 単価: 8100 },
      { 品目: '防草シート施工費', 出し方: '面積', 係数: 1, 単位: '平米', 単価: 1480 },
      { 品目: '単粒砕石ｔ30㎜', 出し方: '面積×厚み', 係数: 0.03, 単位: '立米', 単価: 11700 },
    ],
  },
  {
    工事名: '砂利敷工事', kindLabel: '舗装', sub: '砂利', 単位: '平米',
    lines: [
      { 品目: '鋤土残土処分ｔ150㎜', 出し方: '面積×厚み', 係数: 0.15, 単位: '立米', 単価: 3500 },
      { 品目: '砕石転圧ｔ150㎜', 出し方: '面積×厚み', 係数: 0.15, 単位: '立米', 単価: 8100 },
    ],
    memo: '元の見積の「進入路砂利敷工事」から。',
  },
].map((k) => ({ ...k, from: 'builtin' }));

export const koushuFileName = (k) => `${k.工事名.replace(/[\\/:*?"<>|#^[\]]/g, '-')}.md`;

export function mergeKoushu(vaultList = [], builtin = BUILTIN_KOUSHU) {
  const map = new Map(builtin.map((k) => [k.工事名, k]));
  for (const k of vaultList) map.set(k.工事名, k);
  return [...map.values()];
}

// ---------- 数量を集める ----------

const LABEL_TO_KIND = Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [d.label, k]));
const subOf = (el) => el.props.材料 ?? el.props.種類 ?? el.props.内容 ?? el.props.石種 ?? '';

function koushuFor(el, koushu) {
  return koushu.find((k) => LABEL_TO_KIND[k.kindLabel] === el.kind && (!k.sub || k.sub === subOf(el))) || null;
}

// 数の丸め：立米・平米・ｍは 0.1、ほかは整数（一式は 1）
export function roundQty(q, unit) {
  if (/立米|平米|ｍ|m/.test(unit)) return Math.max(Math.round(q * 10) / 10, q > 0 ? 0.1 : 0);
  return Math.max(Math.round(q), q > 0 ? 1 : 0);
}

// 見積の組み立て。返り値の groups：[{ 名前, 数量, 単位, lines: [{ 品目, 数量, 単位, 単価, 金額 }], 金額 }]
export function buildEstimate(doc, { koushu = BUILTIN_KOUSHU, species = [], 諸経費率 = 0, 値引き = 0, 税率 = 0.1 } = {}) {
  const groups = [];
  const missing = [];
  const byK = new Map(); // 工種 → 集めた数量
  const loose = new Map(); // 工種の無い部材

  for (const el of live(doc)) {
    const def = KINDS[el.kind];
    const m = measure(el);
    if (el.kind === 'jumoku' || def.layer === '注記' || el.kind === 'shikichi' || el.kind === 'tatemono') continue;
    const k = koushuFor(el, koushu);
    const area = (m.area || 0) / 1e6, peri = (m.perimeter || 0) / 1000, len = (m.length || 0) / 1000;
    if (k) {
      const a = byK.get(k) || { area: 0, peri: 0, len: 0, count: 0 };
      a.area += area; a.peri += peri; a.len += len; a.count += 1;
      byK.set(k, a);
    } else {
      const sub = subOf(el);
      const key = `${def.label}　${sub || ''}`.trim();
      const geom = def.geom;
      const unit = geom === 'polygon' ? (el.kind === 'keiseki' ? '石' : '平米') : geom === 'polyline' ? 'ｍ' : '式';
      const qty = geom === 'polygon' ? (el.kind === 'keiseki' ? 1 : area) : geom === 'polyline' ? len : 1;
      const a = loose.get(key) || { unit, qty: 0 };
      a.qty += qty;
      loose.set(key, a);
    }
  }

  for (const [k, a] of byK) {
    const main = a.area > 0 ? { q: a.area, u: k.単位 || '平米' } : a.len > 0 ? { q: a.len, u: k.単位 || 'ｍ' } : { q: a.count, u: k.単位 || '箇所' };
    const lines = k.lines.map((l) => {
      const base = { 面積: a.area, '面積×厚み': a.area, 周長: a.peri, 長さ: a.len, 本数: a.count, 一式: 1 }[l.出し方] ?? 1;
      const qty = roundQty(base * (l.係数 ?? 1), l.単位);
      if (l.単価 === null) missing.push(`${k.工事名}　${l.品目}`);
      return { 品目: l.品目, 数量: qty, 単位: l.単位, 単価: l.単価, 金額: l.単価 === null ? 0 : Math.round(qty * l.単価) };
    });
    groups.push({ 名前: k.工事名, 数量: roundQty(main.q, main.u), 単位: main.u, lines, 金額: lines.reduce((s, l) => s + l.金額, 0) });
  }

  // 樹木：樹種ごと
  const trees = new Map();
  for (const el of live(doc).filter((e) => e.kind === 'jumoku')) {
    const name = String(el.props.樹種 || '').trim() || '樹種未定';
    const sp = findSpecies(species, name);
    const spec = sp ? [sp.規格H && `H${sp.規格H}`, sp.規格C && `C${sp.規格C}`, sp.規格W && `W${sp.規格W}`].filter(Boolean).join(' ') : '';
    const key = name + spec;
    const t = trees.get(key) || { 品目: spec ? `${name}　${spec}` : name, 数量: 0, 単位: '本', 単価: sp?.単価 ?? null };
    t.数量 += 1;
    trees.set(key, t);
  }
  if (trees.size) {
    const lines = [...trees.values()].map((t) => {
      if (t.単価 === null) missing.push(`植栽工事　${t.品目}`);
      return { ...t, 金額: t.単価 === null ? 0 : t.単価 * t.数量 };
    });
    groups.push({ 名前: '植栽工事', 数量: lines.reduce((s, l) => s + l.数量, 0), 単位: '本', lines, 金額: lines.reduce((s, l) => s + l.金額, 0) });
  }

  // 工種の無い部材：単価なしの一行ずつ
  for (const [key, a] of loose) {
    missing.push(`${key}（工種ノートがありません）`);
    groups.push({ 名前: key, 数量: roundQty(a.qty, a.unit), 単位: a.unit, lines: [], 金額: 0, noKoushu: true });
  }

  const 工事計 = groups.reduce((s, g) => s + g.金額, 0);
  const extras = [];
  if (諸経費率 > 0) extras.push({ 品目: '施工諸経費（運搬、消耗品、工事保険等）', 数量: 1, 単位: '一式', 単価: null, 金額: Math.round(工事計 * 諸経費率), 率: 諸経費率 });
  if (値引き > 0) extras.push({ 品目: '−お値引き', 数量: null, 単位: '', 単価: null, 金額: -Math.round(値引き) });
  const 税抜 = 工事計 + extras.reduce((s, e) => s + e.金額, 0);
  const 税 = Math.floor(税抜 * 税率);
  return { groups, extras, 工事計, 税抜, 税, 税込: 税抜 + 税, 税率, missing };
}

// 見積書の行に並べる。工事の見出し（金額＝内訳の合計）、内訳、空行の順。
export function estimateRows(est, { details = true } = {}) {
  const rows = [];
  for (const g of est.groups) {
    rows.push({ type: 'group', 品目: g.名前, 数量: g.数量, 単位: g.単位, 単価: null, 金額: g.金額, children: details ? g.lines.length : 0 });
    if (details) for (const l of g.lines) rows.push({ type: 'line', ...l });
    if (details && g.lines.length) rows.push({ type: 'blank' });
  }
  for (const e of est.extras) rows.push({ type: 'extra', ...e });
  while (rows.length && rows.at(-1).type === 'blank') rows.pop();
  return rows;
}
