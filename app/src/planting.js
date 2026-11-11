// 植栽仕様表。樹木を、樹種と大きさ（H 樹高・C 幹周・W 葉張、m）が同じものごとにまとめ、記号の番号を振る。
// 並びは H の高い順、同じなら読みの順。C は植木ノートの規格C（無ければ —）。

import { live } from './model.js';
import { findSpecies } from './species.js';

const m1 = (mm) => Math.round(mm / 100) / 10; // mm → m（0.1 m 刻み）

export function plantSchedule(doc, library = []) {
  const groups = new Map();
  for (const el of live(doc).filter((e) => e.kind === 'jumoku')) {
    const name = String(el.props.樹種 || '').trim() || '樹種未定';
    const sp = findSpecies(library, name);
    const H = m1(Number(el.props.樹高) || 0);
    const W = m1((el.r || 0) * 2);
    const C = sp?.規格C ?? null;
    const key = `${name}|${H}|${C}|${W}`;
    const g = groups.get(key) || { 樹木名: name, 読み: sp?.読み || name, H, C, W, 数量: 0, 備考: '', ids: [] };
    g.数量 += 1;
    g.ids.push(el.id);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.H - a.H || a.読み.localeCompare(b.読み, 'ja') || b.W - a.W);
  const numberOf = new Map();
  rows.forEach((r, i) => {
    r.記号 = i + 1;
    for (const id of r.ids) numberOf.set(id, r.記号);
  });
  return { rows, numberOf };
}

export const fmtM = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(v < 1 && String(v).split('.')[1]?.length > 1 ? 2 : 1));
