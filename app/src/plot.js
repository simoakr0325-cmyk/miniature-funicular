// 図を図面（PDF）にする。紙の上の寸法は縮尺どおり。

import { KINDS, live, sortedForDraw, measure, liveUnderlays } from './model.js';
import { centroid, dist, bbox, polygonArea } from './geometry.js';
import { layout, worldToPaper, scaleBarLength } from './sheet.js';
import { pixelToWorld } from './underlay.js';
import { Page, buildPdf } from './pdfwriter.js';

const C = {
  ink: '#1c211e',
  muted: '#4a524d',
  bldg: '#dcdcd6',
  pave: '#ece9e1',
  paveInk: '#8c8676',
  plant: '#dbe9d4',
  plantInk: '#4f7a43',
  tree: '#d3e4cc',
  treeInk: '#3e6b35',
  stone: '#cbc4b5',
  stoneInk: '#5b5345',
  wall: '#3a3f3b',
  curb: '#6c716d',
  note: '#2c4a6b',
  white: '#ffffff',
};

const TXT = 2.2; // 注記の文字の高さ（紙の mm）

// 平行線で塗る。spacing は紙の mm。細かすぎて潰れるときは描かない。
function hatch(pg, poly, angle, spacing, { hex = C.muted, width = 0.1, dash = null } = {}) {
  if (spacing < 0.7 || poly.length < 3) return;
  const b = bbox(poly);
  const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + spacing;
  const a = (angle * Math.PI) / 180;
  const d = [Math.cos(a), Math.sin(a)], nr = [-Math.sin(a), Math.cos(a)];
  pg.save().path(poly, true).clip();
  pg.stroke(hex).lineWidth(width).joins(1, 1);
  if (dash) pg.dash(dash);
  for (let t = -R; t <= R; t += spacing) {
    pg.moveTo([c[0] + nr[0] * t - d[0] * R, c[1] + nr[1] * t - d[1] * R]);
    pg.lineTo([c[0] + nr[0] * t + d[0] * R, c[1] + nr[1] * t + d[1] * R]);
  }
  pg.doStroke().restore();
}

function paveHatch(pg, poly, material, scale) {
  const w = (mm) => mm / scale; // 図の mm を紙の mm に
  switch (material) {
    case '洗い出し': return hatch(pg, poly, 45, 1.2, { width: 0.08 });
    case 'インターロッキング': hatch(pg, poly, 0, w(100)); return hatch(pg, poly, 90, w(200));
    case '平板': hatch(pg, poly, 0, w(300)); return hatch(pg, poly, 90, w(300));
    case '砂利': return hatch(pg, poly, 135, 1.0, { width: 0.25, dash: [0.01, 1.1], hex: C.paveInk });
    case '芝': return hatch(pg, poly, 90, 1.6, { width: 0.12, dash: [0.6, 1.2], hex: C.plantInk });
    case 'ウッドデッキ': return hatch(pg, poly, 0, w(120), { width: 0.12 });
    default: return null;
  }
}

// 樹冠：円を十二の小さな弧で波打たせる。
function crown(pg, [cx, cy], r) {
  const k = 12;
  const at = (ang, rr) => [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  pg.moveTo(at(0, r));
  for (let i = 0; i < k; i++) {
    const a0 = (i / k) * Math.PI * 2, a1 = ((i + 1) / k) * Math.PI * 2;
    const p0 = at(a0, r), p1 = at(a1, r), q = at((a0 + a1) / 2, r * 1.16);
    pg.curveTo(
      [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
      [p1[0] + (2 / 3) * (q[0] - p1[0]), p1[1] + (2 / 3) * (q[1] - p1[1])],
      p1,
    );
  }
  return pg.close();
}

function drawElement(pg, el, P, sheet) {
  const g = KINDS[el.kind].geom;
  const pts = el.pts.map(P);
  switch (el.kind) {
    case 'shikichi':
      pg.save().stroke(C.ink).lineWidth(0.35).dash([4, 0.8, 0.6, 0.8]).path(pts, true).doStroke().restore();
      return;
    case 'tatemono':
      pg.save().fill(C.bldg).stroke(C.ink).lineWidth(0.5).path(pts, true).doFillStroke().restore();
      hatch(pg, pts, 45, 2.5, { width: 0.1 });
      pg.save().stroke(C.ink).lineWidth(0.5).path(pts, true).doStroke().restore();
      return;
    case 'hoso': {
      const green = el.props.材料 === '芝';
      pg.save().fill(green ? C.plant : C.pave).path(pts, true).doFill().restore();
      paveHatch(pg, pts, el.props.材料, sheet.scale);
      pg.save().stroke(green ? C.plantInk : C.paveInk).lineWidth(0.25).path(pts, true).doStroke().restore();
      return;
    }
    case 'shokusaitai':
      pg.save().fill(C.plant).stroke(C.plantInk).lineWidth(0.25).path(pts, true).doFillStroke().restore();
      return;
    case 'keiseki':
      pg.save().fill(C.stone).stroke(C.stoneInk).lineWidth(0.4).joins(1, 1).path(pts, true).doFillStroke().restore();
      return;
    case 'hei':
      pg.save().stroke(C.wall).lineWidth(0.8).joins(0, 0).path(pts).doStroke().restore();
      return;
    case 'enseki':
      pg.save().stroke(C.curb).lineWidth(0.4).joins(1, 1).path(pts).doStroke().restore();
      return;
    case 'jumoku': {
      const c = pts[0], r = el.r / sheet.scale;
      pg.save().alpha(0.85).fill(C.tree).stroke(C.treeInk).lineWidth(0.2);
      crown(pg, c, r).doFillStroke().restore();
      const t = Math.min(0.8, r * 0.3);
      pg.save().stroke(C.treeInk).lineWidth(0.15).moveTo([c[0] - t, c[1]]).lineTo([c[0] + t, c[1]]).moveTo([c[0], c[1] - t]).lineTo([c[0], c[1] + t]).doStroke().restore();
      return;
    }
    case 'takasa': {
      const [x, y] = pts[0];
      pg.save().stroke(C.note).lineWidth(0.15).moveTo([x - 1.2, y]).lineTo([x + 1.2, y]).moveTo([x, y - 1.2]).lineTo([x, y + 1.2]).doStroke().restore();
      return;
    }
    case 'sunpo':
      return drawDim(pg, pts);
    case 'moji':
      pg.text(el.props.文字, pts[0], 3, { hex: C.ink, halo: C.white });
      return;
    default:
      if (g === 'polygon') pg.save().stroke(C.ink).lineWidth(0.25).path(pts, true).doStroke().restore();
  }
}

function drawDim(pg, [a, b, o]) {
  if (!a || !b) return;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const off = o ? (o[0] - a[0]) * nx + (o[1] - a[1]) * ny : 0;
  const a2 = [a[0] + nx * off, a[1] + ny * off], b2 = [b[0] + nx * off, b[1] + ny * off];
  const tick = (p) => pg.moveTo([p[0] - 0.8, p[1] + 0.8]).lineTo([p[0] + 0.8, p[1] - 0.8]);
  pg.save().stroke(C.note).lineWidth(0.13);
  pg.moveTo(a).lineTo(a2).moveTo(b).lineTo(b2).moveTo(a2).lineTo(b2);
  tick(a2);
  tick(b2);
  pg.doStroke().restore();
}

function drawLabels(pg, el, P, sheet) {
  const pts = el.pts.map(P);
  const g = KINDS[el.kind].geom;
  if (g === 'polygon' && pts.length >= 3 && ['hoso', 'shokusaitai', 'tatemono', 'keiseki'].includes(el.kind)) {
    if (polygonArea(pts) < 120) return;
    const c = centroid(pts);
    const name = el.kind === 'hoso' ? el.props.材料 : el.kind === 'tatemono' ? el.props.名前 || '建物' : el.kind === 'keiseki' ? el.props.石種 || '景石' : el.props.内容 || '植栽帯';
    pg.text(name, [c[0], c[1]], TXT, { align: 'middle', halo: C.white });
    if (el.kind !== 'keiseki') pg.text(`${(measure(el).area / 1e6).toFixed(2)}㎡`, [c[0], c[1] + TXT * 1.3], TXT * 0.85, { align: 'middle', hex: C.muted, halo: C.white });
  } else if (el.kind === 'jumoku' && el.props.樹種) {
    const [x, y] = pts[0];
    pg.text(el.props.樹種, [x, y + el.r / sheet.scale + TXT * 1.1], TXT * 0.9, { align: 'middle', hex: C.treeInk, halo: C.white });
  } else if (el.kind === 'takasa') {
    const [x, y] = pts[0];
    const h = Number(el.props.高さ) || 0;
    pg.text((h >= 0 ? '+' : '') + h, [x + 1.4, y - 0.8], TXT, { hex: C.note, halo: C.white });
  } else if (el.kind === 'hei' && pts.length >= 2 && dist(pts[0], pts[1]) > 15) {
    const [a, b] = pts;
    pg.text(`${el.props.種類 || ''} H${el.props.高さ}`, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 1.2], TXT * 0.9, { align: 'middle', angle: uprightAngle(a, b), hex: C.muted, halo: C.white });
  } else if (el.kind === 'sunpo' && pts.length >= 2) {
    const [a, b, o] = pts;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const off = o ? (o[0] - a[0]) * nx + (o[1] - a[1]) * ny : 0;
    const mid = [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off];
    const ang = uprightAngle(a, b);
    const r = (ang * Math.PI) / 180;
    // 寸法線の少し上（文字の向きで見た上）に置く。
    const pos = [mid[0] - Math.sin(r) * 0.8, mid[1] - Math.cos(r) * 0.8];
    pg.text(String(Math.round(dist(el.pts[0], el.pts[1]))), pos, TXT, { align: 'middle', angle: ang, hex: C.note, halo: C.white });
  }
}

// 紙の上で a→b の向き（反時計回りの度）。文字が逆さにならないよう ±90° に収める。
function uprightAngle(a, b) {
  let ang = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  return ang;
}

function drawUnderlays(pg, doc, sheet, L, images) {
  if (!sheet.underlays) return;
  for (const u of liveUnderlays(doc)) {
    const img = images.get(u.blob);
    if (!u.visible || !img) continue;
    const P = (px) => worldToPaper(sheet, L, pixelToWorld(u, px));
    const m = pg.imageMatrix(P([0, u.h]), P([u.w, u.h]), P([0, 0]));
    pg.save().alpha(u.opacity, 'Multiply').image(img.bytes, img.w, img.h, m).restore();
  }
}

function northArrow(pg, [cx, cy], deg) {
  const r = 6;
  const a = (deg * Math.PI) / 180;
  const R = ([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
  pg.save().stroke(C.ink).lineWidth(0.2).circle([cx, cy], r).doStroke().restore();
  pg.save().fill(C.ink).path([R([0, -r + 0.6]), R([2, r * 0.45]), R([0, r * 0.15]), R([-2, r * 0.45])], true).doFill().restore();
  const t = R([0, -r - 2.2]);
  pg.text('N', [t[0], t[1] + 1.2], 3, { align: 'middle' });
}

function scaleBar(pg, [x, y], scale) {
  const lenW = scaleBarLength(scale);
  const lenP = lenW / scale;
  const seg = lenP / 4;
  pg.save().stroke(C.ink).lineWidth(0.15);
  for (let i = 0; i < 4; i++) {
    pg.fill(i % 2 ? C.white : C.ink).rect(x + i * seg, y, seg, 1.5).doFillStroke();
  }
  pg.restore();
  const lbl = (v) => (lenW >= 1000 ? `${v / 1000}` : `${v}`);
  pg.text('0', [x, y + 4.4], 2, { align: 'middle' });
  pg.text(lbl(lenW / 2), [x + lenP / 2, y + 4.4], 2, { align: 'middle' });
  pg.text(lbl(lenW) + (lenW >= 1000 ? 'm' : 'mm'), [x + lenP, y + 4.4], 2, { align: 'middle' });
}

function titleBlock(pg, doc, sheet, L, dateText) {
  const t = L.title;
  pg.save().fill(C.white).stroke(C.ink).lineWidth(0.5).rect(t.x, t.y, t.w, t.h).doFillStroke().restore();
  const rowH = t.h / 4;
  const labelW = 16, rightLabelW = 13, rightW = 30;
  const xr = t.x + t.w - rightW; // 右の値の欄
  pg.save().stroke(C.ink).lineWidth(0.15);
  for (let i = 1; i < 4; i++) pg.moveTo([t.x, t.y + rowH * i]).lineTo([t.x + t.w, t.y + rowH * i]);
  pg.moveTo([t.x + labelW, t.y + rowH]).lineTo([t.x + labelW, t.y + t.h]);
  pg.moveTo([xr - rightLabelW, t.y + rowH]).lineTo([xr - rightLabelW, t.y + t.h]);
  pg.moveTo([xr, t.y + rowH]).lineTo([xr, t.y + t.h]);
  pg.doStroke().restore();
  const base = (row) => t.y + rowH * row + rowH * 0.68;
  const label = (s, x, row) => pg.text(s, [x + 1.5, base(row)], 2.2, { hex: C.muted });
  const value = (s, x, row, size = 2.8) => pg.text(fitText(s, size, (row === 0 ? t.w : x >= xr ? rightW : xr - rightLabelW - x) - 3), [x + 1.5, base(row)], size);
  pg.text(sheet.company || '', [t.x + t.w / 2, base(0)], 3.6, { align: 'middle' });
  const site = [doc.siteName, doc.siteId && `（${doc.siteId}）`].filter(Boolean).join('');
  label('現場', t.x, 1); value(site || '—', t.x + labelW, 1);
  label('図番', xr - rightLabelW, 1); value(sheet.number || '—', xr, 1);
  label('図名', t.x, 2); value(sheet.title || '—', t.x + labelW, 2);
  label('縮尺', xr - rightLabelW, 2); value(`1/${sheet.scale}`, xr, 2);
  label('日付', t.x, 3); value(dateText, t.x + labelW, 3);
  label('用紙', xr - rightLabelW, 3); value(sheet.paper, xr, 3);
}

// 欄に収まらない文字は末尾を「…」にする。
function fitText(s, size, maxW) {
  const chars = [...String(s)];
  const w = (cs) => cs.reduce((a, c) => a + (c.charCodeAt(0) < 0x80 ? 0.5 : 1), 0) * size;
  if (w(chars) <= maxW) return s;
  while (chars.length && w(chars) + size > maxW) chars.pop();
  return chars.join('') + '…';
}

// images: Map(blob の指紋 → { bytes: JPEG の Uint8Array, w, h })
export function plotSheet(doc, sheet, { images = new Map(), date = new Date() } = {}) {
  const L = layout(sheet);
  const pg = new Page(L.W, L.H);
  const P = (p) => worldToPaper(sheet, L, p);
  const f = L.frame;
  const hidden = new Set(doc.settings.hiddenLayers || []);
  const els = sortedForDraw(live(doc)).filter((e) => !hidden.has(KINDS[e.kind].layer));

  pg.save().rect(f.x, f.y, f.w, f.h).clip();
  drawUnderlays(pg, doc, sheet, L, images);
  for (const el of els) drawElement(pg, el, P, sheet);
  for (const el of els) drawLabels(pg, el, P, sheet);
  pg.restore();

  pg.save().stroke(C.ink).lineWidth(0.7).rect(f.x, f.y, f.w, f.h).doStroke().restore();
  northArrow(pg, [f.x + f.w - 12, f.y + 14], sheet.north || 0);
  scaleBar(pg, [f.x + 8, f.y + f.h - 10], sheet.scale);
  const p2 = (v) => String(v).padStart(2, '0');
  const dateText = `${date.getFullYear()}.${p2(date.getMonth() + 1)}.${p2(date.getDate())}`;
  titleBlock(pg, doc, sheet, L, dateText);

  return buildPdf(pg, { title: `${doc.siteName || doc.siteId || '無題'} ${sheet.title || ''}`, author: sheet.company || '' });
}
