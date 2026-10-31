// 地形：高さ点から三角網（TIN）を作り、等高線と土量（切土・盛土）を出す。
// 高さは mm。現況（GL）と計画（FH）の二つの面を持つ。
// 計画の面には、計画の高さ点に加えて、天端の入った舗装の頂点も使う（舗装は天端で平らとみなす）。

import { KINDS, live } from './model.js';
import { pointInPolygon, densify } from './geometry.js';

// ---------- 面の点 ----------

export const SURFACES = { 現況: 'GL', 計画: 'FH' };

const num = (v) => (v === '' || v == null ? NaN : Number(v));

export function surfacePoints(doc, which) {
  const hidden = new Set(doc.settings.hiddenLayers || []);
  const out = [];
  for (const el of live(doc)) {
    if (el.kind === 'takasa' && (el.props.区分 || '現況') === which) {
      const h = num(el.props.高さ);
      if (Number.isFinite(h)) out.push([el.pts[0][0], el.pts[0][1], h]);
    }
    if (which === '計画' && el.kind === 'hoso' && !hidden.has(KINDS.hoso.layer)) {
      const h = num(el.props.天端);
      if (Number.isFinite(h)) for (const p of densify(el.pts, el.b, true, 4)) out.push([p[0], p[1], h]);
    }
  }
  return out;
}

// ---------- 三角網（Bowyer–Watson） ----------

export function delaunay(points) {
  // 同じ位置の点は一つにする（後のものを採る）
  const map = new Map();
  for (const p of points) map.set(`${Math.round(p[0])},${Math.round(p[1])}`, p);
  const pts = [...map.values()];
  if (pts.length < 3) return { pts, tris: [] };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const d = Math.max(x1 - x0, y1 - y0) * 20 || 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = [...pts.map((p) => [p[0], p[1]]), [cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]];
  const n = pts.length;
  const circ = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [qx, qy] = P[c];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    if (Math.abs(D) < 1e-12) return { x: 0, y: 0, r2: Infinity };
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = qx * qx + qy * qy;
    const ux = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / D;
    const uy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / D;
    return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    for (const t of tris) ((px - t.c.x) ** 2 + (py - t.c.y) ** 2 < t.c.r2 * (1 + 1e-12) ? bad : keep).push(t);
    // 穴の縁（悪い三角形の辺のうち、一度しか出てこないもの）
    const edges = new Map();
    for (const t of bad) {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k], b = t.v[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, edges.has(key) ? null : [a, b]);
      }
    }
    for (const e of edges.values()) if (e) keep.push({ v: [e[0], e[1], i], c: circ(e[0], e[1], i) });
    tris = keep;
  }
  return { pts, tris: tris.filter((t) => t.v.every((k) => k < n)).map((t) => t.v) };
}

export function buildTin(points) {
  const { pts, tris } = delaunay(points);
  return { pts, tris };
}

// 点の高さ（三角網の外なら NaN）
export function heightAt(tin, [x, y]) {
  for (const [a, b, c] of tin.tris) {
    const h = baryHeight(tin.pts[a], tin.pts[b], tin.pts[c], x, y);
    if (Number.isFinite(h)) return h;
  }
  return NaN;
}

function baryHeight(A, B, C, x, y) {
  const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(det) < 1e-9) return NaN;
  const l1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / det;
  const l2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / det;
  const l3 = 1 - l1 - l2;
  const e = -1e-9;
  if (l1 < e || l2 < e || l3 < e) return NaN;
  return l1 * A[2] + l2 * B[2] + l3 * C[2];
}

// ---------- 等高線 ----------

// interval（mm）ごとの等高線。返すのは [{ h, major, lines: [[x, y], ...][] }]。
export function contours(tin, interval, { majorEvery = 5 } = {}) {
  if (!tin.tris.length || !(interval > 0)) return [];
  const byLevel = new Map();
  for (const [a, b, c] of tin.tris) {
    const T = [tin.pts[a], tin.pts[b], tin.pts[c]];
    const hs = T.map((p) => p[2]);
    const lo = Math.ceil(Math.min(...hs) / interval), hi = Math.floor(Math.max(...hs) / interval);
    for (let k = lo; k <= hi; k++) {
      const h = k * interval;
      const cross = [];
      for (let i = 0; i < 3; i++) {
        const p = T[i], q = T[(i + 1) % 3];
        // 高さがちょうど h の頂点は、少し上とみなして二重に数えない
        const hp = p[2] === h ? h + 1e-7 : p[2], hq = q[2] === h ? h + 1e-7 : q[2];
        if ((hp - h) * (hq - h) < 0) {
          const t = (h - hp) / (hq - hp);
          cross.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      if (cross.length === 2) {
        if (!byLevel.has(k)) byLevel.set(k, []);
        byLevel.get(k).push(cross);
      }
    }
  }
  return [...byLevel.entries()].sort((x, y) => x[0] - y[0]).map(([k, segs]) => ({
    h: k * interval,
    major: k % majorEvery === 0,
    lines: joinSegments(segs),
  }));
}

// 線分をつないで折れ線にする。
function joinSegments(segs) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const ends = new Map();
  const used = new Array(segs.length).fill(false);
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const next = (p) => {
    for (const j of ends.get(key(p)) || []) if (!used[j]) return j;
    return -1;
  };
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [segs[i][0], segs[i][1]];
    for (const atEnd of [true, false]) {
      for (;;) {
        const tip = atEnd ? line.at(-1) : line[0];
        const j = next(tip);
        if (j < 0) break;
        used[j] = true;
        const [a, b] = segs[j];
        const other = key(a) === key(tip) ? b : a;
        atEnd ? line.push(other) : line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---------- 土量 ----------

// 範囲（多角形、mm）の中で、計画 − 現況 を格子で足し合わせる。
// 返り値の体積は m³、面積は m²。covered は両方の面がある所の割合。
export function earthwork(existing, planned, polygon, { cell = null } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of polygon) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const W = x1 - x0, H = y1 - y0;
  if (!(W > 0 && H > 0)) return null;
  // 格子は 5 万〜20 万目に収まる大きさ（50mm より細かくはしない）
  const c = cell || Math.max(50, Math.sqrt((W * H) / 120000));
  const nx = Math.ceil(W / c), ny = Math.ceil(H / c);
  const ge = rasterize(existing, x0, y0, c, nx, ny);
  const gp = rasterize(planned, x0, y0, c, nx, ny);
  let cut = 0, fill = 0, inside = 0, both = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = [x0 + (i + 0.5) * c, y0 + (j + 0.5) * c];
      if (!pointInPolygon(p, polygon)) continue;
      inside++;
      const e = ge[j * nx + i], q = gp[j * nx + i];
      if (!Number.isFinite(e) || !Number.isFinite(q)) continue;
      both++;
      const d = q - e;
      if (d > 0) fill += d;
      else cut -= d;
    }
  }
  const k = (c * c) / 1e9; // mm × mm² → m³
  return { cut: cut * k, fill: fill * k, net: (fill - cut) * k, area: (inside * c * c) / 1e6, covered: inside ? both / inside : 0, cell: c };
}

// 三角網の高さを格子の目ごとに入れる（目の中心で）。
function rasterize(tin, x0, y0, c, nx, ny) {
  const g = new Float64Array(nx * ny).fill(NaN);
  for (const [a, b, cc] of tin.tris) {
    const A = tin.pts[a], B = tin.pts[b], C = tin.pts[cc];
    const i0 = Math.max(0, Math.floor((Math.min(A[0], B[0], C[0]) - x0) / c));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(A[0], B[0], C[0]) - x0) / c));
    const j0 = Math.max(0, Math.floor((Math.min(A[1], B[1], C[1]) - y0) / c));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(A[1], B[1], C[1]) - y0) / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (Number.isFinite(g[j * nx + i])) continue;
        const h = baryHeight(A, B, C, x0 + (i + 0.5) * c, y0 + (j + 0.5) * c);
        if (Number.isFinite(h)) g[j * nx + i] = h;
      }
    }
  }
  return g;
}

// ---------- 図から ----------

export function terrainSettings(doc) {
  return { existing: true, planned: true, interval: 100, ...(doc.settings.terrain || {}) };
}

// 図の地形をまとめて計算する（同じ図なら結果を使い回す）。
const cache = new WeakMap();
export function terrainOf(doc) {
  const key = JSON.stringify([doc.elements.filter((e) => !e.deleted && (e.kind === 'takasa' || e.kind === 'hoso')).map((e) => [e.pts, e.props, e.b]), doc.settings.hiddenLayers]);
  const hit = cache.get(doc);
  if (hit && hit.key === key) return hit.value;
  const value = {
    existing: buildTin(surfacePoints(doc, '現況')),
    planned: buildTin(surfacePoints(doc, '計画')),
  };
  cache.set(doc, { key, value });
  return value;
}

const contourCache = new WeakMap();
export function contoursOf(doc) {
  const s = terrainSettings(doc);
  const t = terrainOf(doc);
  const hit = contourCache.get(t);
  if (hit && hit.interval === s.interval && hit.existingOn === s.existing && hit.plannedOn === s.planned) return hit.value;
  const value = {
    existing: s.existing ? contours(t.existing, s.interval) : [],
    planned: s.planned ? contours(t.planned, s.interval) : [],
  };
  contourCache.set(t, { interval: s.interval, existingOn: s.existing, plannedOn: s.planned, value });
  return value;
}

// 等高線の数字を置く所：主曲線の一番長い線の真ん中あたり。
export function labelSpot(line) {
  if (line.length < 2) return null;
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + d >= total / 2) {
      const t = d ? (total / 2 - acc) / d : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle: Math.atan2(b[1] - a[1], b[0] - a[0]), length: total };
    }
    acc += d;
  }
  return null;
}

export const fmtH = (h) => (h >= 0 ? '+' : '') + Math.round(h);

// 面（多角形の部材）の中の土量。面が無ければ null。
export function earthworkOf(doc, el) {
  const t = terrainOf(doc);
  if (!t.existing.tris.length || !t.planned.tris.length) return null;
  return earthwork(t.existing, t.planned, densify(el.pts, el.b, true));
}
