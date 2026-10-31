// DXF を読み、下図として描ける線・円・文字にする（建築士の図などを線のまま敷くため）。
// 読むのは文字の DXF（R12〜2018）。バイナリ DXF・DWG は読めない。
// 弧・楕円・スプライン・ふくらみのある辺は細かい折れ線にする。ブロック（INSERT・寸法）は展開する。
// 座標は DXF のまま（y 上向き）。下図にするときに y を反転する（toUnderlayGeometry）。

import { densify } from './geometry.js';

// INSUNITS → 1 単位が何 mm か。0（指定なし）は mm とみなす。
const UNIT_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 25.4e-6, 9: 0.0254, 10: 914.4, 14: 100, 15: 1e4, 16: 1e5 };

// バイト列を文字にする。2007 以降（AC1021〜）は UTF-8、それより前は Shift_JIS（日本の図）とみなす。
export function decodeDxf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > 22 && String.fromCharCode(...u8.slice(0, 18)) === 'AutoCAD Binary DXF') {
    throw new Error('バイナリの DXF は読めません。文字（ASCII）の DXF で書き出してください');
  }
  const head = new TextDecoder('latin1').decode(u8.slice(0, 4096));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] || 'AC1009';
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1] || '';
  let enc = 'utf-8';
  if (ver < 'AC1021') enc = /ANSI_1252|ISO8859/i.test(cp) ? 'windows-1252' : 'shift_jis';
  let text;
  try {
    text = new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(u8);
  } catch {
    text = new TextDecoder('shift_jis').decode(u8);
  }
  return text;
}

// 文字の中の書式を素の文字に直す（\U+XXXX、%%c など、MTEXT の書式）。
export function cleanText(s, mtext = false) {
  let t = String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%');
  if (mtext) {
    t = t.replace(/\\[Pp]/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\[ACcFfHhQTWp][^;\\]*;/g, '')
      .replace(/\\[LlOoKk]/g, '')
      .replace(/\\S([^;^#\\/]*)[\^#/]([^;]*);/g, '$1/$2')
      .replace(/\\\\/g, '\\').replace(/\\\{/g, '{').replace(/\\\}/g, '}')
      .replace(/[{}]/g, '');
  }
  return t;
}

// 組（グループコードと値）の並びにする。
function pairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) {
      i -= 1; // 空行などでずれたら一行ずらして合わせ直す
      continue;
    }
    out.push([code, lines[i + 1].trim() === '' ? lines[i + 1] : lines[i + 1].replace(/^\s+|\s+$/g, '')]);
  }
  return out;
}

// 実体（0 で始まるまとまり）に分ける。
function entitiesOf(list) {
  const ents = [];
  let cur = null;
  for (const [c, v] of list) {
    if (c === 0) {
      cur = { type: v, g: [] };
      ents.push(cur);
    } else if (cur) cur.g.push([c, v]);
  }
  return ents;
}

const get = (e, code, def = null) => {
  const p = e.g.find(([c]) => c === code);
  return p ? p[1] : def;
};
const num = (e, code, def = 0) => {
  const v = parseFloat(get(e, code, def));
  return Number.isFinite(v) ? v : def;
};

// 2D の変換（ブロックの挿入）。[a, b, c, d, e, f]：x' = a x + c y + e、y' = b x + d y + f
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const angleOf = (m) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
const mirrored = (m) => m[0] * m[3] - m[1] * m[2] < 0;

// 弧を折れ線に（y 上向き、反時計回り、度）。
function arcPts([cx, cy], r, a0, a1) {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(4, Math.ceil(sweep / 6));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// DXF の文字を読み、線・円・文字の一覧にする。
export function parseDxf(text) {
  const list = pairs(text);
  if (!list.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error('DXF として読めません');
  // 区切り（SECTION）ごとに分ける
  const sections = {};
  let name = null, buf = null;
  for (let i = 0; i < list.length; i++) {
    const [c, v] = list[i];
    if (c === 0 && v === 'SECTION') {
      name = list[i + 1]?.[1];
      buf = [];
      i++;
    } else if (c === 0 && v === 'ENDSEC') {
      if (name) sections[name] = buf;
      name = null;
      buf = null;
    } else if (buf) buf.push(list[i]);
  }

  // 見出し：単位
  const header = sections.HEADER || [];
  const iu = header.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  const insunits = iu >= 0 ? parseInt(header[iu + 1]?.[1], 10) : 0;

  // 画層の色・表示
  const layers = {};
  for (const e of entitiesOf(sections.TABLES || [])) {
    if (e.type !== 'LAYER') continue;
    const color = num(e, 62, 7);
    layers[get(e, 2, '0')] = { color: Math.abs(color), off: color < 0 || (num(e, 70) & 1) === 1 };
  }

  // ブロック
  const blocks = {};
  let curBlock = null;
  for (const e of entitiesOf(sections.BLOCKS || [])) {
    if (e.type === 'BLOCK') {
      curBlock = { base: [num(e, 10), num(e, 20)], ents: [] };
      blocks[get(e, 2, '')] = curBlock;
    } else if (e.type === 'ENDBLK') curBlock = null;
    else if (curBlock) curBlock.ents.push(e);
  }

  const out = { paths: [], circles: [], texts: [], layers, unitMm: UNIT_MM[insunits] ?? 1, skipped: {} };
  const skip = (t) => { out.skipped[t] = (out.skipped[t] || 0) + 1; };

  const walk = (ents, m, parentLayer, depth) => {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      let layer = get(e, 8, '0');
      if (layer === '0' && parentLayer) layer = parentLayer; // ブロックの中の 0 画層は挿入した画層に従う
      if (layers[layer]?.off) {
        if (e.type === 'POLYLINE') while (i + 1 < ents.length && ents[i + 1].type !== 'SEQEND') i++;
        continue;
      }
      const P = (x, y) => ap(m, [x, y]);
      switch (e.type) {
        case 'LINE':
          out.paths.push({ layer, pts: [P(num(e, 10), num(e, 20)), P(num(e, 11), num(e, 21))], closed: false });
          break;
        case 'LWPOLYLINE': {
          const pts = [], bul = [];
          for (const [c, v] of e.g) {
            if (c === 10) { pts.push([parseFloat(v), 0]); bul.push(0); }
            else if (c === 20 && pts.length) pts.at(-1)[1] = parseFloat(v);
            else if (c === 42 && pts.length) bul[bul.length - 1] = parseFloat(v) || 0;
          }
          pushPoly(out, layer, pts, bul, (num(e, 70) & 1) === 1, m);
          break;
        }
        case 'POLYLINE': {
          const flags = num(e, 70);
          const pts = [], bul = [];
          while (i + 1 < ents.length && ents[i + 1].type === 'VERTEX') {
            const vx = ents[++i];
            if (num(vx, 70) & 16) continue; // スプラインの制御点
            pts.push([num(vx, 10), num(vx, 20)]);
            bul.push(num(vx, 42));
          }
          if (ents[i + 1]?.type === 'SEQEND') i++;
          if (flags & (16 | 64)) { skip('POLYLINE（面）'); break; }
          pushPoly(out, layer, pts, bul, (flags & 1) === 1, m);
          break;
        }
        case 'CIRCLE': {
          const c = P(num(e, 10), num(e, 20));
          const r = num(e, 40) * scaleOf(m);
          if (Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) > 1e-9 * Math.hypot(m[0], m[1])) {
            out.paths.push({ layer, pts: arcPts([num(e, 10), num(e, 20)], num(e, 40), 0, 360).map((p) => ap(m, p)), closed: true });
          } else out.circles.push({ layer, c, r });
          break;
        }
        case 'ARC': {
          const pts = arcPts([num(e, 10), num(e, 20)], num(e, 40), num(e, 50), num(e, 51)).map((p) => ap(m, p));
          out.paths.push({ layer, pts, closed: false });
          break;
        }
        case 'ELLIPSE': {
          const c = [num(e, 10), num(e, 20)], ax = [num(e, 11), num(e, 21)], ratio = num(e, 40, 1);
          let t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2);
          if (t1 <= t0) t1 += Math.PI * 2;
          const by = [-ax[1] * ratio, ax[0] * ratio];
          const n = Math.max(8, Math.ceil(((t1 - t0) * 180) / Math.PI / 6));
          const pts = [];
          for (let k = 0; k <= n; k++) {
            const t = t0 + ((t1 - t0) * k) / n;
            pts.push(ap(m, [c[0] + ax[0] * Math.cos(t) + by[0] * Math.sin(t), c[1] + ax[1] * Math.cos(t) + by[1] * Math.sin(t)]));
          }
          out.paths.push({ layer, pts, closed: false });
          break;
        }
        case 'SPLINE': {
          // 通過点があればそれを、無ければ制御点を結ぶ（おおまかな形）。
          const fit = [], ctrl = [];
          for (const [c, v] of e.g) {
            if (c === 11) fit.push([parseFloat(v), 0]);
            else if (c === 21 && fit.length) fit.at(-1)[1] = parseFloat(v);
            else if (c === 10) ctrl.push([parseFloat(v), 0]);
            else if (c === 20 && ctrl.length) ctrl.at(-1)[1] = parseFloat(v);
          }
          const pts = (fit.length >= 2 ? fit : ctrl).map((p) => ap(m, p));
          if (pts.length >= 2) out.paths.push({ layer, pts, closed: (num(e, 70) & 1) === 1 });
          break;
        }
        case 'SOLID':
        case 'TRACE':
        case '3DFACE': {
          const q = [[10, 20], [11, 21], [13, 23], [12, 22]].map(([a, b]) => P(num(e, a), num(e, b)));
          out.paths.push({ layer, pts: e.type === '3DFACE' ? [q[0], q[1], q[3], q[2]] : q, closed: true });
          break;
        }
        case 'TEXT':
        case 'ATTRIB':
        case 'MTEXT': {
          const s = cleanText(get(e, 1, '') + (e.type === 'MTEXT' ? e.g.filter(([c]) => c === 3).map(([, v]) => v).join('') : ''), e.type === 'MTEXT');
          if (!s.trim()) break;
          const h = num(e, 40, 1) * scaleOf(m);
          let rot = num(e, 50, 0);
          if (e.type === 'MTEXT' && (get(e, 11) !== null)) rot = (Math.atan2(num(e, 21), num(e, 11)) * 180) / Math.PI;
          // TEXT の揃え（72・73）が付いていれば 11・21 が基準点
          const hj = num(e, 72), vj = num(e, 73);
          const useAlign = e.type !== 'MTEXT' && (hj || vj) && get(e, 11) !== null;
          const p = useAlign ? P(num(e, 11), num(e, 21)) : P(num(e, 10), num(e, 20));
          let align = 'start';
          if (e.type === 'MTEXT') {
            const ap7 = num(e, 71, 1);
            align = [2, 5, 8].includes(ap7) ? 'middle' : [3, 6, 9].includes(ap7) ? 'end' : 'start';
            out.texts.push({ layer, p, h, rot: rot + angleOf(m), s, align, top: ap7 <= 3 ? 1 : ap7 <= 6 ? 0.5 : 0 });
          } else {
            if (useAlign) align = hj === 1 || hj === 4 ? 'middle' : hj === 2 ? 'end' : 'start';
            out.texts.push({ layer, p, h, rot: (mirrored(m) ? -rot : rot) + angleOf(m), s, align, top: vj === 3 ? 1 : vj === 2 ? 0.5 : 0 });
          }
          break;
        }
        case 'INSERT':
        case 'DIMENSION': {
          const b = blocks[get(e, 2, '')];
          if (!b || depth > 8) break;
          let t;
          if (e.type === 'DIMENSION') t = I; // 寸法のブロックは図の座標のまま
          else {
            const a = (num(e, 50) * Math.PI) / 180;
            const sx = num(e, 41, 1), sy = num(e, 42, 1);
            const c = Math.cos(a), s = Math.sin(a);
            // 挿入点へ移し、回し、拡大し、ブロックの基点を原点へ
            t = mul([c * sx, s * sx, -s * sy, c * sy, num(e, 10), num(e, 20)], [1, 0, 0, 1, -b.base[0], -b.base[1]]);
          }
          const arr = e.type === 'INSERT';
          const cols = arr ? Math.min(Math.max(1, num(e, 70, 1)), 100) : 1, rows = arr ? Math.min(Math.max(1, num(e, 71, 1)), 100) : 1;
          for (let ci = 0; ci < cols; ci++) {
            for (let ri = 0; ri < rows; ri++) {
              const off = [1, 0, 0, 1, ci * num(e, 44), ri * num(e, 45)];
              walk(b.ents, mul(m, mul(off, t)), layer, depth + 1);
            }
          }
          // 属性（ATTRIB）は INSERT の後ろに続く
          if (e.type === 'INSERT' && num(e, 66) === 1) {
            const attrs = [];
            while (i + 1 < ents.length && ents[i + 1].type === 'ATTRIB') attrs.push(ents[++i]);
            if (ents[i + 1]?.type === 'SEQEND') i++;
            walk(attrs, m, layer, depth + 1);
          }
          break;
        }
        case 'VIEWPORT':
        case 'POINT':
        case 'SEQEND':
        case 'ATTDEF':
          break;
        default:
          skip(e.type);
      }
    }
  };

  walk(entitiesOf(sections.ENTITIES || []), I, null, 0);

  // 範囲
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = ([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  out.paths.forEach((p) => p.pts.forEach(ext));
  out.circles.forEach(({ c, r }) => { ext([c[0] - r, c[1] - r]); ext([c[0] + r, c[1] + r]); });
  out.texts.forEach((t) => ext(t.p));
  if (x0 === Infinity) throw new Error('この DXF には描けるものがありません');
  out.ext = { x0, y0, x1, y1 };
  return out;
}

function pushPoly(out, layer, pts, bul, closed, m) {
  if (pts.length < 2) return;
  // DXF のふくらみ（y 上向きで正は反時計回り）は、この図の決まり（y 下向きで同じ符号）と
  // y の向きだけが違うので、y 上向きのまま折れ線にするときは符号を反す。
  const dense = densify(pts, bul.map((b) => -b), closed, 8);
  out.paths.push({ layer, pts: dense.map((p) => ap(m, p)), closed });
}

// 下図の「画素」の座標（左上原点・y 下向き、DXF の単位のまま）に直す。w・h は範囲の幅と高さ。
export function toUnderlayGeometry(parsed) {
  const { x0, y1 } = parsed.ext;
  const T = ([x, y]) => [x - x0, y1 - y];
  const w = Math.max(parsed.ext.x1 - x0, 1e-9), h = Math.max(y1 - parsed.ext.y0, 1e-9);
  return {
    w, h,
    paths: parsed.paths.map((p) => ({ ...p, pts: p.pts.map(T) })),
    circles: parsed.circles.map((c) => ({ ...c, c: T(c.c) })),
    texts: parsed.texts.map((t) => ({ ...t, p: T(t.p) })),
  };
}

// 吸着に使う点（線の端と頂点、円の中心）。
export function snapPointsOf(geo) {
  const out = [];
  for (const p of geo.paths) out.push(...p.pts.length > 40 ? [p.pts[0], p.pts.at(-1)] : p.pts);
  for (const c of geo.circles) out.push(c.c);
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r3 = (v) => Math.round(v * 1000) / 1000;

// 画面に敷く SVG の中身（下図の画素座標のまま。線の太さは拡大しても変わらない）。
export function geometryMarkup(geo) {
  const d = geo.paths.map((p) => 'M' + p.pts.map(([x, y]) => `${r3(x)} ${r3(y)}`).join('L') + (p.closed ? 'Z' : '')).join('');
  const circles = geo.circles.map(({ c, r }) => `<circle cx="${r3(c[0])}" cy="${r3(c[1])}" r="${r3(r)}"/>`).join('');
  const texts = geo.texts.map((t) => {
    const anchor = t.align === 'middle' ? ' text-anchor="middle"' : t.align === 'end' ? ' text-anchor="end"' : '';
    const dy = t.top ? ` dy="${r3(t.h * t.top)}"` : '';
    return String(t.s).split('\n').map((line, k) => `<text x="${r3(t.p[0])}" y="${r3(t.p[1] + k * t.h * 1.6)}"${dy} font-size="${r3(t.h)}"${anchor} transform="rotate(${r3(-t.rot)} ${r3(t.p[0])} ${r3(t.p[1])})">${esc(line)}</text>`).join('');
  }).join('');
  return `<path class="ul-vec" d="${d}"/><g class="ul-vec">${circles}</g><g class="ul-vec-txt">${texts}</g>`;
}
