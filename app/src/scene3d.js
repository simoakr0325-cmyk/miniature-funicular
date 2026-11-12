// 図を 3D の部品（三角形を作る前の、素の形）に直す。three.js を使わないので試験しやすい。
// 図は mm・y 下向き（南が +y）。3D は m で、x = 東、z = 南、y = 上。
// 地面の高さは、計画の面 → 現況の面 → 0 の順に、ある方を使う。

import { KINDS, live } from './model.js';
import { centroid, densify, polygonArea, pointInPolygon } from './geometry.js';
import { terrainOf, heightAt } from './terrain.js';

export const COLORS = {
  ground: '#b9c7a0',
  site: '#6b5d4f',
  bldg: '#e9e4da',
  roof: '#7d7a73',
  plant: '#6e8f4e',
  mulch: '#5a4a3a',
  stone: '#a59f92',
  wall: '#c9c6bd',
  curb: '#bdb8ad',
  trunk: '#6b4f3a',
  crown: '#4f7d3a',
  crownDeciduous: '#6f9a45',
  crownEvergreen: '#3d6631',
  hoso: {
    土間コンクリート: '#cfccc4',
    洗い出し: '#c2b39a',
    インターロッキング: '#b58f73',
    平板: '#c9c2b4',
    砂利: '#d8d2c4',
    芝: '#7fa75a',
    人工芝: '#6fae4c',
    タイル: '#c8b8a2',
    防草シート砂利敷: '#cfc8b8',
    ウッドデッキ: '#a07a55',
  },
};

const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));

// 地面の高さ（mm）を返す関数。三角網の外は、現況の点（無ければ計画の点）から距離の重みで均す。
export function groundOf(doc) {
  const t = terrainOf(doc);
  const far = t.existing.pts.length ? t.existing.pts : t.planned.pts;
  return (p) => {
    let h = t.planned.tris.length ? heightAt(t.planned, p) : NaN;
    if (!Number.isFinite(h) && t.existing.tris.length) h = heightAt(t.existing, p);
    if (Number.isFinite(h)) return h;
    if (!far.length) return 0;
    let sw = 0, sh = 0;
    for (const q of far) {
      const d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + 1;
      sw += 1 / d2;
      sh += q[2] / d2;
    }
    return sh / sw;
  };
}

// 部品の一覧。prism：多角形を z0〜z1 に押し出したもの。wall：線に沿った壁。tree：幹と樹冠。
// library：樹種ライブラリ（あれば、常落と葉形で樹冠の色と形を変える）
export function buildParts(doc, { library = [] } = {}) {
  const hidden = new Set(doc.settings.hiddenLayers || []);
  const els = live(doc).filter((e) => !hidden.has(KINDS[e.kind].layer));
  const g = groundOf(doc);
  const parts = [];
  for (const el of els) {
    const poly = () => densify(el.pts, el.b, true, 12);
    switch (el.kind) {
      case 'tatemono': {
        const pts = poly();
        if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1) break;
        const z0 = g(centroid(pts)) + 300; // 基礎の分だけ上げる
        parts.push({ type: 'prism', kind: 'bldg', pts, z0: z0 - 300, z1: z0 + num(el.props.高さ, 6000), color: COLORS.bldg, roof: COLORS.roof, rect: rectOf(el.pts) });
        break;
      }
      case 'hoso': {
        const pts = poly();
        if (pts.length < 3) break;
        const top = num(el.props.天端, g(centroid(pts)) + 30);
        parts.push({ type: 'prism', kind: 'hoso', pts, z0: top - 120, z1: top, color: COLORS.hoso[el.props.材料] || COLORS.hoso.土間コンクリート, material: el.props.材料 || '土間コンクリート' });
        break;
      }
      case 'shokusaitai': {
        const pts = poly();
        if (pts.length < 3) break;
        const top = g(centroid(pts)) + 60;
        parts.push({ type: 'prism', kind: 'plant', pts, z0: top - 200, z1: top, color: COLORS.mulch, shrubs: true });
        break;
      }
      case 'keiseki': {
        const pts = poly();
        if (pts.length < 3) break;
        const base = g(centroid(pts));
        parts.push({ type: 'prism', kind: 'stone', pts, z0: base - 100, z1: num(el.props.天端, base + 450), color: COLORS.stone, rough: true });
        break;
      }
      case 'hei':
      case 'enseki': {
        const pts = densify(el.pts, el.b, false, 12);
        const wall = el.kind === 'hei';
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const base = Math.min(g(a), g(b));
          parts.push({
            type: 'wall', kind: el.kind, a, b,
            thickness: wall ? 150 : 120,
            z0: base - 100,
            z1: base + (wall ? num(el.props.高さ, 1200) : 120),
            color: wall ? COLORS.wall : COLORS.curb,
            material: wall ? String(el.props.種類 || '') : '縁石',
          });
        }
        break;
      }
      case 'jumoku': {
        const c = el.pts[0];
        const h = Math.max(num(el.props.樹高, 2500), 300);
        const r = Math.max(el.r || 750, 150);
        const cv = Math.min(r * 1.1, h * 0.45); // 樹冠の縦の半径
        const sp = library.find((s) => s.和名 === String(el.props.樹種 || '').trim());
        const needle = sp?.葉形 === '針葉';
        const color = sp?.常落 === '落葉' ? COLORS.crownDeciduous : sp ? COLORS.crownEvergreen : COLORS.crown;
        parts.push({ type: 'tree', c, z: g(c), h, r, crownZ: h - cv, crownR: [r, cv], trunkR: Math.min(Math.max(h / 60, 40), 200), color, trunk: COLORS.trunk, needle, seed: seedOf(c, el.props.樹種) });
        break;
      }
      case 'shikichi': {
        const pts = poly();
        parts.push({ type: 'outline', pts: pts.map((p) => [p[0], p[1], g(p) + 20]), color: COLORS.site });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

// 地面：範囲を格子にして、各点の高さを入れる。step は mm。
// 舗装・建物・植栽帯の下は、その部品の下端より少し上にならす（傾いた地面が突き抜けないように）。
export function groundGrid(doc, box, step, parts = buildParts(doc)) {
  const g0 = groundOf(doc);
  const flats = parts.filter((p) => p.type === 'prism' && p.kind !== 'stone')
    .map((p) => ({ pts: p.pts, h: p.kind === 'bldg' ? p.z0 + 200 : p.z1 - 15 }));
  const g = (q) => {
    for (const f of flats) if (pointInPolygon(q, f.pts)) return f.h;
    return g0(q);
  };
  const nx = Math.max(1, Math.ceil((box.x1 - box.x0) / step));
  const ny = Math.max(1, Math.ceil((box.y1 - box.y0) / step));
  const hs = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = g([box.x0 + (i * (box.x1 - box.x0)) / nx, box.y0 + (j * (box.y1 - box.y0)) / ny]);
  }
  return { nx, ny, hs, box };
}

// 部材の範囲（mm）。何も無ければ null。
export function sceneBox(doc) {
  const pts = live(doc).flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

// 位置と名前から決まる乱数の種（同じ図はいつも同じ絵になるように）
export function seedOf([x, y], name = '') {
  let h = (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663);
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) | 0;
  return (h >>> 0) || 1;
}

// 種から 0〜1 の乱数の列を作る
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// 四角い建物なら、中心・長い方の向き（度）・半分の長さを返す（切妻屋根を載せるため）。四角でなければ null。
export function rectOf(pts) {
  if (pts.length !== 4) return null;
  const e = pts.map((p, i) => [pts[(i + 1) % 4][0] - p[0], pts[(i + 1) % 4][1] - p[1]]);
  const len = e.map(([x, y]) => Math.hypot(x, y));
  for (let i = 0; i < 4; i++) {
    const a = e[i], b = e[(i + 1) % 4];
    if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.02 * len[i] * len[(i + 1) % 4]) return null; // 直角でない
  }
  if (Math.abs(len[0] - len[2]) > 0.02 * len[0] || Math.abs(len[1] - len[3]) > 0.02 * len[1]) return null;
  const long = len[0] >= len[1] ? 0 : 1;
  const c = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
  return { c, angle: Math.atan2(e[long][1], e[long][0]), a: len[long] / 2, b: len[1 - long] / 2 };
}

// 太陽の位置。日付と時刻（時、小数可）と緯度から、高さ（度）と、図の向きに合わせた 3D の単位ベクトルを出す。
// 赤緯は日付から近似（±23.44°）。north は図の上を 0° とした北の向き（時計回り）。夜は地平線の少し上に留める。
export function sunAt({ north = 0, hour = 10.5, date = new Date(), lat = 36 } = {}) {
  const rad = Math.PI / 180;
  const start = new Date(date.getFullYear(), 0, 0);
  const N = Math.floor((date - start) / 86400000);
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (N + 10)) * rad;
  const H = 15 * (hour - 12) * rad;
  const phi = lat * rad;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const elevation = Math.max(Math.asin(sinEl) / rad, 9);
  // 南から西回りの方位
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const n = north * rad;
  const south = [-Math.sin(n), Math.cos(n)], west = [-Math.cos(n), -Math.sin(n)];
  const e = elevation * rad;
  const hx = south[0] * Math.cos(az) + west[0] * Math.sin(az), hz = south[1] * Math.cos(az) + west[1] * Math.sin(az);
  return { elevation, azimuth: az / rad, dir: [hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)] };
}

// 太陽の向き（3D の単位ベクトル）。北の向き（図の上を 0°、時計回り）から、南の空・高さ 50° に置く。
export function sunDirection(northDeg = 0, { elevation = 50, azimuthFromSouth = -25 } = {}) {
  const a = ((northDeg + 180 + azimuthFromSouth) * Math.PI) / 180; // 図の上から時計回りの角度
  const e = (elevation * Math.PI) / 180;
  // 図の上（-z）から時計回りに a：x = sin a、z = -cos a
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
