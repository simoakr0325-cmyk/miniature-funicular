// 縄文文様50 カタログ（HTML）から、使う文様の形を app/src/jomon.js に書き出す。
// 形は直線（M・L・Z）と円だけなので、点の並びと円にして持つ。
// 使い方：node tools/make-jomon.mjs カタログ.html
import { readFileSync, writeFileSync } from 'node:fs';

const USE = {
  'J-24': '平行沈線+刻列帯（横リピート。本文に最も干渉しない罫）',
  'J-34': '隆帯結節コーナー（角。左上の角の形）',
  'J-36': '帯の起点飾り（終端。J-37 と対）',
  'J-37': '帯の終点飾り（終端。J-36 と対）',
};

const html = readFileSync(process.argv[2], 'utf8');
const r1 = (v) => Math.round(Number(v) * 10) / 10;
const out = {};
for (const [id, note] of Object.entries(USE)) {
  const m = new RegExp(`<symbol id="${id}" viewBox="([^"]+)">([\\s\\S]*?)</symbol>`).exec(html);
  if (!m) throw new Error(id + ' がありません');
  const [, , w, h] = m[1].split(/\s+/).map(Number);
  const polys = [];
  for (const [, d] of m[2].matchAll(/<path d="([^"]+)"/g)) {
    let cur = null;
    for (const tok of d.match(/[MLZ]|-?[\d.]+/g)) {
      if (tok === 'M') { cur = []; polys.push(cur); }
      else if (tok === 'Z' || tok === 'L') continue;
      else cur.push(r1(tok));
    }
  }
  const circles = [...m[2].matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)].map((c) => [r1(c[1]), r1(c[2]), r1(c[3])]);
  out[id] = { note, w, h, polys: polys.filter((p) => p.length >= 6), circles };
}

const body = Object.entries(out).map(([id, s]) => `  '${id}': { // ${s.note}
    w: ${s.w}, h: ${s.h},
    polys: [${s.polys.map((p) => `[${p.join(',')}]`).join(',\n      ')}],
    circles: ${JSON.stringify(s.circles)},
  },`).join('\n');

writeFileSync(new URL('../app/src/jomon.js', import.meta.url), `// 山波創苑の縄文文様（縄文文様50 カタログから、tools/make-jomon.mjs で書き出したもの）。
// 形は塗りの多角形（x, y を交互に並べた点列）と円。座標は各文様の viewBox の単位、y は下向き。
// 縁取りに使う文様だけを持つ。しつこくならないよう、図面では細く・淡く・少なく使う。

export const JOMON = {
${body}
};

// 文様を描く。pg：PDF か SVG の頁。place(x, y) で文様の座標を紙の座標に移す。
export function drawJomon(pg, id, place, hex) {
  const s = JOMON[id];
  pg.save().fill(hex);
  for (const p of s.polys) {
    const pts = [];
    for (let i = 0; i + 1 < p.length; i += 2) pts.push(place(p[i], p[i + 1]));
    pg.path(pts, true);
  }
  pg.doFill();
  for (const [cx, cy, r] of s.circles) {
    const c = place(cx, cy), e = place(cx + r, cy);
    pg.circle(c, Math.hypot(e[0] - c[0], e[1] - c[1]));
  }
  pg.doFill().restore();
}

// 横リピートの帯を、紙の (x0, y) から長さ len・高さ h で並べる（最後の一つは切る代わりに、収まる数だけ）。
export function jomonStrip(pg, id, [x0, y], len, h, hex) {
  const s = JOMON[id];
  const k = h / s.h, uw = s.w * k;
  const n = Math.max(1, Math.floor(len / uw));
  const pad = (len - n * uw) / 2;
  for (let i = 0; i < n; i++) {
    const ox = x0 + pad + i * uw;
    drawJomon(pg, id, (x, yy) => [ox + x * k, y + yy * k], hex);
  }
  return { start: x0 + pad, end: x0 + pad + n * uw };
}

// 角の文様（左上の形）を、四隅に向きを変えて置く。corner：'tl' | 'tr' | 'bl' | 'br'
export function jomonCorner(pg, id, [x, y], size, corner, hex) {
  const s = JOMON[id];
  const k = size / s.w;
  const fx = corner === 'tr' || corner === 'br' ? -1 : 1;
  const fy = corner === 'bl' || corner === 'br' ? -1 : 1;
  drawJomon(pg, id, (px, py) => [x + fx * px * k, y + fy * py * k], hex);
}
`);
console.log('書き出しました：app/src/jomon.js', Object.keys(out).join(' '));
