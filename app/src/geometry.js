// 図形の計算。座標はすべて mm、y は下向き。

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function polygonPerimeter(pts) {
  return pts.length < 2 ? 0 : polylineLength(pts) + dist(pts[pts.length - 1], pts[0]);
}

// 靴紐公式。向きによらず正の面積を返す。
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts) {
  const a = polygonArea(pts);
  if (a < 1e-9) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0, s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    s += f;
  }
  return [cx / (3 * s), cy / (3 * s)];
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function distToPolyline(p, pts, closed = false) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 1; i < n; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  if (closed && n > 2) d = Math.min(d, distToSegment(p, pts[n - 1], pts[0]));
  if (n === 1) d = dist(p, pts[0]);
  return d;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export const snapToGrid = (p, step) => [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];

// 直前の点から 45° 刻みの向きに寄せる。
export function orthoConstrain(prev, p) {
  const dx = p[0] - prev[0], dy = p[1] - prev[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [prev[0] + Math.cos(ang) * len, prev[1] + Math.sin(ang) * len];
}

// from から toward の向きへ len 進んだ点。
export function pointAtDistance(from, toward, len) {
  const d = dist(from, toward);
  if (d < 1e-9) return [from[0] + len, from[1]];
  return [from[0] + ((toward[0] - from[0]) / d) * len, from[1] + ((toward[1] - from[1]) / d) * len];
}

// 画面上の角度表示用。東を 0°、反時計回りを正（y 下向きなので符号を返す）。
export const angleDeg = (a, b) => (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

export const rectFromCorners = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

// ---------- 円弧の辺 ----------
// 辺 a→b のふくらみ bulge（DXF と同じ考え方）：b = tan(弧の中心角 / 4)。
// 0 は直線。正なら a→b の左手（(-dy, dx) の向き）へふくらむ。

export function arcOf(a, b, bulge) {
  const c = dist(a, b);
  const theta = 4 * Math.atan(Math.abs(bulge));
  const r = c / (2 * Math.sin(theta / 2));
  const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c;
  const s = (bulge * c) / 2; // 弦の中点から弧の中点までの、左手向きの距離
  const mid = [(a[0] + b[0]) / 2 + nx * s, (a[1] + b[1]) / 2 + ny * s];
  return { c, r, theta, mid, length: r * theta, segArea: (r * r * (theta - Math.sin(theta))) / 2 };
}

// 弧の上の点を n 等分で返す（a は含まず b を含む）。
export function arcPoints(a, b, bulge, n = 16) {
  if (!bulge) return [b];
  const { c, r, theta, mid } = arcOf(a, b, bulge);
  const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c;
  const sag = (bulge * c) / 2;
  // 中心は弧の中点から、弦の側へ r 戻った所。
  const toC = sag - Math.sign(bulge) * r;
  const ctr = [(a[0] + b[0]) / 2 + nx * toC, (a[1] + b[1]) / 2 + ny * toC];
  const a0 = Math.atan2(a[1] - ctr[1], a[0] - ctr[0]);
  const am = Math.atan2(mid[1] - ctr[1], mid[0] - ctr[0]);
  // 弧の中点（中心角の半分）を通る向きに回る。
  let d = am - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  const dir = Math.sign(d) || 1;
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = a0 + (dir * theta * i) / n;
    out.push([ctr[0] + Math.cos(t) * r, ctr[1] + Math.sin(t) * r]);
  }
  out[out.length - 1] = [b[0], b[1]];
  return out;
}

export const segCount = (pts, closed) => (closed ? pts.length : Math.max(pts.length - 1, 0));
export const bulgeAt = (bulges, i) => (bulges && bulges[i]) || 0;

// 円弧を細かな折れ線にした点列（当たり判定・塗り・印刷用）。
export function densify(pts, bulges, closed = false, n = 16) {
  if (!bulges || !bulges.some((b) => b)) return pts;
  const out = [pts[0]];
  const m = segCount(pts, closed);
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const bu = bulgeAt(bulges, i);
    if (bu) out.push(...arcPoints(a, b, bu, n));
    else out.push(b);
  }
  if (closed) out.pop(); // 最後は最初の点に戻るので除く
  return out;
}

// 円弧の辺を含む面積（向きによらず正）。
export function areaWithArcs(pts, bulges) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  let a = s / 2;
  for (let i = 0; i < pts.length; i++) {
    const bu = bulgeAt(bulges, i);
    if (bu) a -= Math.sign(bu) * arcOf(pts[i], pts[(i + 1) % pts.length], bu).segArea;
  }
  return Math.abs(a);
}

export function lengthWithArcs(pts, bulges, closed = false) {
  let len = 0;
  const m = segCount(pts, closed);
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const bu = bulgeAt(bulges, i);
    len += bu ? arcOf(a, b, bu).length : dist(a, b);
  }
  return len;
}

// 辺 a→b を、点 p を通る弧にするふくらみ。p が弦に近ければ 0（直線）。
export function bulgeThrough(a, b, p, straightTol = 0) {
  const c = dist(a, b);
  if (c < 1e-9) return 0;
  const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c;
  const s = (p[0] - (a[0] + b[0]) / 2) * nx + (p[1] - (a[1] + b[1]) / 2) * ny;
  if (Math.abs(s) <= straightTol) return 0;
  return Math.max(-3, Math.min(3, (2 * s) / c));
}

// 点列をまとめて回す・映す。
export function rotatePts(pts, center, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(([x, y]) => {
    const dx = x - center[0], dy = y - center[1];
    return [center[0] + dx * c - dy * s, center[1] + dx * s + dy * c];
  });
}

export function mirrorPts(pts, center, axis) {
  return pts.map(([x, y]) => (axis === 'x' ? [2 * center[0] - x, y] : [x, 2 * center[1] - y]));
}
