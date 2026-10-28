// 画面上の一点がどの部材に当たるか。tol は px。

import { KINDS } from './model.js';
import { dist, distToPolyline, pointInPolygon } from './geometry.js';

export function hitElement(els, v, sp, tol = 8) {
  const w = v.toW(sp);
  const tw = tol / v.scale;
  // 上に描いたものから順に見る。面の内側より、線・点に近いものを優先する。
  let insideHit = null;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    const g = KINDS[el.kind].geom;
    if (g === 'polygon') {
      if (el.pts.length >= 2 && distToPolyline(w, el.pts, true) <= tw) return el;
      if (!insideHit && el.pts.length >= 3 && pointInPolygon(w, el.pts)) insideHit = el;
    } else if (g === 'polyline') {
      if (distToPolyline(w, el.pts) <= tw * 1.2) return el;
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
