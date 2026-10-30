// 画面上の一点がどの部材に当たるか。tol は px。

import { KINDS } from './model.js';
import { dist, distToPolyline, pointInPolygon, densify } from './geometry.js';

export function hitElement(els, v, sp, tol = 8) {
  const w = v.toW(sp);
  const tw = tol / v.scale;
  // 上に描いたものから順に見る。面の内側より、線・点に近いものを優先する。
  let insideHit = null;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    const g = KINDS[el.kind].geom;
    if (g === 'polygon') {
      const pts = densify(el.pts, el.b, true);
      if (pts.length >= 2 && distToPolyline(w, pts, true) <= tw) return el;
      if (!insideHit && pts.length >= 3 && pointInPolygon(w, pts)) insideHit = el;
    } else if (g === 'polyline') {
      if (distToPolyline(w, densify(el.pts, el.b, false), false) <= tw * 1.2) return el;
    } else if (g === 'circle') {
      const d = dist(w, el.pts[0]);
      if (d <= el.r + tw) return el;
    } else if (g === 'point') {
      if (dist(w, el.pts[0]) <= tw * 1.5) return el;
    } else if (g === 'text') {
      const s = v.toS(el.pts[0]);
      const width = String(el.props.文字 || '').length * 14 + 8;
      if (sp[0] >= s[0] - 4 && sp[0] <= s[0] + width && sp[1] >= s[1] - 18 && sp[1] <= s[1] + 6) return el;
    } else if (g === 'dim') {
      if (el.pts.length >= 2 && distToPolyline(w, el.pts.slice(0, 2)) <= tw) return el;
      if (el.pts[2] && dist(w, el.pts[2]) <= tw * 2) return el;
    }
  }
  return insideHit;
}

// 吸着先：近くの頂点 → なければ方眼。
export function findSnap(els, v, sp, { grid, gridOn, extra = [], exclude = null }) {
  const w = v.toW(sp);
  const tw = 10 / v.scale;
  let best = null;
  const consider = (p) => {
    const d = dist(w, p);
    if (d <= tw && (!best || d < best.d)) best = { p: [p[0], p[1]], d, type: 'vertex' };
  };
  for (const el of els) {
    if (el.id === exclude) continue;
    for (const p of el.pts) consider(p);
  }
  for (const p of extra) consider(p);
  if (best) return best;
  if (gridOn) return { p: [Math.round(w[0] / grid) * grid, Math.round(w[1] / grid) * grid], type: 'grid' };
  return { p: w, type: 'free' };
}

// 範囲で選ぶ。window（左から右へ引いた）は全部が中に入るもの、crossing（右から左）は掛かるもの。
export function elementsInBox(els, x0, y0, x1, y1, crossing) {
  const inside = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  return els.filter((el) => {
    const g = KINDS[el.kind].geom;
    let pts = g === 'polygon' || g === 'polyline' ? densify(el.pts, el.b, g === 'polygon') : el.pts;
    if (g === 'circle') {
      const [cx, cy] = el.pts[0];
      pts = [[cx - el.r, cy - el.r], [cx + el.r, cy - el.r], [cx + el.r, cy + el.r], [cx - el.r, cy + el.r]];
    }
    if (!pts.length) return false;
    if (!crossing) return pts.every(inside);
    if (pts.some(inside)) return true;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [x, y] of pts) {
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
    return bx0 <= x1 && bx1 >= x0 && by0 <= y1 && by1 >= y0;
  });
}
