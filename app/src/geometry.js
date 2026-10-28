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
