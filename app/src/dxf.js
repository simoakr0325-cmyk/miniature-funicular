// 図を DXF（AutoCAD R12 形式、文字は Shift_JIS）にする。Jw_cad・AutoCAD・Vectorworks で開ける形を狙う。
// 単位は mm。図は y 下向きなので、DXF では y を反転する（北が上）。
// 円弧の辺は POLYLINE の頂点のふくらみ（bulge）でそのまま渡す。

import { KINDS, live, sortedForDraw, measure } from './model.js';
import { centroid, densify, dist } from './geometry.js';
import { encodeSjis } from './sjis.js';
import { contoursOf, fmtH, labelSpot } from './terrain.js';

// 部材の種類ごとの画層と色（AutoCAD の色番号）。
const LAYER_OF = {
  shikichi: ['敷地境界', 7, 'DASHDOT'],
  tatemono: ['建物', 8],
  hoso: ['舗装', 33],
  shokusaitai: ['植栽帯', 3],
  keiseki: ['景石', 31],
  hei: ['塀・擁壁', 7],
  enseki: ['縁石・見切', 9],
  jumoku: ['樹木', 94],
  takasa: ['高さ', 5],
  sunpo: ['寸法', 5],
  moji: ['文字', 7],
};
const LABEL_LAYER = ['注記', 2];
const CONTOUR_LAYERS = { existing: ['等高線（現況）', 32, 'DASHED'], planned: ['等高線（計画）', 1] };

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

class Writer {
  constructor() { this.lines = []; }
  g(code, value) { this.lines.push(String(code), typeof value === 'number' ? num(value) : String(value)); return this; }
}

// options.offset：DXF の座標に足す値（図の mm、y は反転後）。測量座標で書き出すときに使う。
export function buildDxf(doc, { textHeight = 250, offset = [0, 0] } = {}) {
  const hidden = new Set(doc.settings.hiddenLayers || []);
  const els = sortedForDraw(live(doc)).filter((e) => !hidden.has(KINDS[e.kind].layer));
  const X = (p) => p[0] + offset[0];
  const Y = (p) => -p[1] + offset[1];
  const w = new Writer();

  // 範囲
  const pts = els.flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
  const xs = pts.map(X), ys = pts.map(Y);
  const ext = pts.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1000, 1000];

  w.g(0, 'SECTION').g(2, 'HEADER');
  w.g(9, '$ACADVER').g(1, 'AC1009');
  w.g(9, '$DWGCODEPAGE').g(3, 'ANSI_932');
  w.g(9, '$INSBASE').g(10, 0).g(20, 0).g(30, 0);
  w.g(9, '$EXTMIN').g(10, ext[0]).g(20, ext[1]).g(30, 0);
  w.g(9, '$EXTMAX').g(10, ext[2]).g(20, ext[3]).g(30, 0);
  w.g(9, '$LTSCALE').g(40, 1);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION').g(2, 'TABLES');
  w.g(0, 'TABLE').g(2, 'LTYPE').g(70, 3);
  w.g(0, 'LTYPE').g(2, 'CONTINUOUS').g(70, 0).g(3, 'Solid line').g(72, 65).g(73, 0).g(40, 0);
  // 一点鎖線（敷地境界）。図の mm で 1200 の線・300 の間・点・300 の間。
  w.g(0, 'LTYPE').g(2, 'DASHDOT').g(70, 0).g(3, '__ . __ . __').g(72, 65).g(73, 4).g(40, 1800)
    .g(49, 1200).g(49, -300).g(49, 0).g(49, -300);
  w.g(0, 'LTYPE').g(2, 'DASHED').g(70, 0).g(3, '__ __ __').g(72, 65).g(73, 2).g(40, 900).g(49, 600).g(49, -300);
  w.g(0, 'ENDTAB');
  const layers = [...new Map([...Object.values(LAYER_OF), LABEL_LAYER, ...Object.values(CONTOUR_LAYERS)].map((l) => [l[0], l])).values()];
  w.g(0, 'TABLE').g(2, 'LAYER').g(70, layers.length);
  for (const [name, color, lt] of layers) w.g(0, 'LAYER').g(2, name).g(70, 0).g(62, color).g(6, lt || 'CONTINUOUS');
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE').g(2, 'STYLE').g(70, 1);
  w.g(0, 'STYLE').g(2, 'STANDARD').g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, textHeight).g(3, 'txt').g(4, 'extfont2.shx');
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION').g(2, 'ENTITIES');
  const line = (layer, a, b) => w.g(0, 'LINE').g(8, layer).g(10, X(a)).g(20, Y(a)).g(30, 0).g(11, X(b)).g(21, Y(b)).g(31, 0);
  const text = (layer, s, p, h, { rot = 0, center = false } = {}) => {
    if (s === '' || s == null) return;
    // R12 の中央揃えは開く側で崩れることがあるので、左下基準に直して置く。
    const width = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) < 0x80 ? 0.5 : 1), 0) * h;
    const r = (rot * Math.PI) / 180;
    let [x, y] = [X(p), Y(p)];
    if (center) {
      x -= (Math.cos(r) * width) / 2;
      y -= (Math.sin(r) * width) / 2;
    }
    w.g(0, 'TEXT').g(8, layer).g(10, x).g(20, y).g(30, 0).g(40, h).g(1, String(s).replace(/[\r\n]+/g, ' ')).g(50, rot);
  };
  const polyline = (layer, el, closed) => {
    w.g(0, 'POLYLINE').g(8, layer).g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, closed ? 1 : 0);
    el.pts.forEach((p, i) => {
      w.g(0, 'VERTEX').g(8, layer).g(10, X(p)).g(20, Y(p)).g(30, 0);
      const b = el.b && el.b[i];
      // 図（y 下向き）で左手へのふくらみは、y を反転した DXF では反時計回り＝正のまま。
      if (b) w.g(42, b);
    });
    w.g(0, 'SEQEND').g(8, layer);
  };

  for (const el of els) {
    const [layer] = LAYER_OF[el.kind];
    const g = KINDS[el.kind].geom;
    if (g === 'polygon') polyline(layer, el, true);
    else if (g === 'polyline') polyline(layer, el, false);
    else if (g === 'circle') w.g(0, 'CIRCLE').g(8, layer).g(10, X(el.pts[0])).g(20, Y(el.pts[0])).g(30, 0).g(40, el.r);
    else if (g === 'point') {
      const [x, y] = el.pts[0];
      const c = textHeight * 0.5;
      line(layer, [x - c, y], [x + c, y]);
      line(layer, [x, y - c], [x, y + c]);
      const h = Number(el.props.高さ) || 0;
      text(layer, (el.props.区分 === '計画' ? 'FH' : 'GL') + (h >= 0 ? '+' : '') + h, [x + c, y - c * 0.4], textHeight);
    } else if (g === 'dim' && el.pts.length >= 2) {
      const [a, b, o] = el.pts;
      const len = dist(a, b) || 1;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const off = o ? (o[0] - a[0]) * nx + (o[1] - a[1]) * ny : 0;
      const a2 = [a[0] + nx * off, a[1] + ny * off], b2 = [b[0] + nx * off, b[1] + ny * off];
      line(layer, a, a2);
      line(layer, b, b2);
      line(layer, a2, b2);
      const t = textHeight * 0.4;
      for (const p of [a2, b2]) line(layer, [p[0] - t, p[1] + t], [p[0] + t, p[1] - t]);
      let rot = (Math.atan2(-(b2[1] - a2[1]), b2[0] - a2[0]) * 180) / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot <= -90) rot += 180;
      const r = (rot * Math.PI) / 180;
      // 寸法線の少し上（文字の向きで見た上）。図は y 下向きなので上は -y。
      const mid = [(a2[0] + b2[0]) / 2 - Math.sin(r) * t, (a2[1] + b2[1]) / 2 - Math.cos(r) * t];
      text(layer, String(Math.round(len)), mid, textHeight, { rot, center: true });
    } else if (g === 'text') text(layer, el.props.文字, el.pts[0], textHeight * 1.2);
  }

  // 等高線（主曲線に高さの文字）
  const cs = contoursOf(doc);
  for (const [key, list, pre] of [['existing', cs.existing, 'GL'], ['planned', cs.planned, 'FH']]) {
    const layer = CONTOUR_LAYERS[key][0];
    for (const lv of list) {
      for (const line of lv.lines) {
        polyline(layer, { pts: line }, false);
        const s = lv.major && labelSpot(line);
        if (!s || s.length < textHeight * 8) continue;
        let rot = (-s.angle * 180) / Math.PI;
        if (rot > 90) rot -= 180;
        if (rot <= -90) rot += 180;
        text(layer, pre + fmtH(lv.h), s.p, textHeight * 0.8, { rot, center: true });
      }
    }
  }

  // 面積と名前の注記
  for (const el of els) {
    const g = KINDS[el.kind].geom;
    if (g === 'polygon' && ['hoso', 'shokusaitai', 'tatemono', 'keiseki'].includes(el.kind) && el.pts.length >= 3) {
      const c = centroid(densify(el.pts, el.b, true));
      const name = el.kind === 'hoso' ? el.props.材料 : el.kind === 'tatemono' ? el.props.名前 || '建物' : el.kind === 'keiseki' ? el.props.石種 || '景石' : el.props.内容 || '植栽帯';
      text(LABEL_LAYER[0], name, c, textHeight, { center: true });
      if (el.kind !== 'keiseki') text(LABEL_LAYER[0], `${(measure(el).area / 1e6).toFixed(2)}㎡`, [c[0], c[1] + textHeight * 1.5], textHeight * 0.85, { center: true });
    } else if (el.kind === 'jumoku' && el.props.樹種) {
      text(LABEL_LAYER[0], el.props.樹種, [el.pts[0][0], el.pts[0][1] + el.r + textHeight * 1.2], textHeight * 0.9, { center: true });
    } else if (el.kind === 'hei' && el.pts.length >= 2) {
      const [a, b] = el.pts;
      text(LABEL_LAYER[0], `${el.props.種類 || ''} H${el.props.高さ}`, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - textHeight * 0.5], textHeight * 0.9, { center: true });
    }
  }
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return encodeSjis(w.lines.join('\r\n') + '\r\n');
}

export function dxfFileName(doc) {
  const parts = [doc.siteId, doc.siteName, '平面図'].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.join('_').replace(/[\\/:*?"<>|#^[\]]/g, '-') + '.dxf';
}
