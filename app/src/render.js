// 図を SVG に描く。毎回、画面座標（px）で組み直す。

import { KINDS, live, sortedForDraw, measure } from './model.js';
import { centroid, dist, densify, arcOf, bulgeAt, segCount } from './geometry.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (v) => Math.round(v * 10) / 10;

export const MATERIAL_PATTERN = {
  土間コンクリート: 'pat-conc',
  洗い出し: 'pat-arai',
  インターロッキング: 'pat-ilb',
  平板: 'pat-hira',
  砂利: 'pat-jari',
  芝: 'pat-shiba',
  ウッドデッキ: 'pat-deck',
};

export function makeView(cx, cy, scale, w, h) {
  return {
    cx, cy, scale, w, h,
    toS: (p) => [(p[0] - cx) * scale + w / 2, (p[1] - cy) * scale + h / 2],
    toW: (s) => [(s[0] - w / 2) / scale + cx, (s[1] - h / 2) / scale + cy],
  };
}

const ptsAttr = (v, pts) => pts.map((p) => v.toS(p).map(f).join(',')).join(' ');

// 辺が円弧のこともある線の SVG パス。画面は y 下向きなので、左手へふくらむ（正）弧は反時計回り＝sweep 0。
export function pathD(v, pts, bulges, closed) {
  if (!pts.length) return '';
  const S = (p) => v.toS(p).map(f).join(' ');
  let d = 'M' + S(pts[0]);
  const m = segCount(pts, closed);
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const bu = bulgeAt(bulges, i);
    if (bu && dist(a, b) > 0) {
      const r = f(arcOf(a, b, bu).r * v.scale);
      d += `A${r} ${r} 0 ${Math.abs(bu) > 1 ? 1 : 0} ${bu > 0 ? 0 : 1} ${S(b)}`;
    } else d += 'L' + S(b);
  }
  return closed ? d + 'Z' : d;
}

function defs(v) {
  const [ox, oy] = v.toS([0, 0]).map(f);
  const t = `patternUnits="userSpaceOnUse" patternTransform="translate(${ox},${oy})"`;
  return `<defs>
  <pattern id="pat-conc" ${t} width="10" height="10"><circle cx="2" cy="3" r="0.8" class="pt"/><circle cx="7" cy="8" r="0.6" class="pt"/></pattern>
  <pattern id="pat-arai" ${t} width="6" height="6"><circle cx="1.5" cy="1.5" r="1" class="pt"/><circle cx="4.5" cy="4.5" r="1" class="pt"/></pattern>
  <pattern id="pat-ilb" ${t} width="16" height="8"><path d="M0 0H16M0 8H16M0 0V8M8 0V8" class="pl"/></pattern>
  <pattern id="pat-hira" ${t} width="24" height="24"><path d="M0 0H24M0 0V24" class="pl"/></pattern>
  <pattern id="pat-jari" ${t} width="12" height="12"><circle cx="2" cy="2" r="1.4" class="pc"/><circle cx="8" cy="5" r="1.1" class="pc"/><circle cx="4" cy="9" r="1.2" class="pc"/><circle cx="10" cy="10.5" r="0.9" class="pc"/></pattern>
  <pattern id="pat-shiba" ${t} width="12" height="10"><path d="M2 8l1-4M3 8l1.5-3.5M8 4l1-3M9 4l1.5-3" class="pg"/></pattern>
  <pattern id="pat-deck" ${t} width="10" height="10"><path d="M0 0H10" class="pl"/></pattern>
  <pattern id="pat-bldg" ${t} width="10" height="10" patternTransform="translate(${ox},${oy}) rotate(45)"><path d="M0 0V10" class="pl"/></pattern>
</defs>`;
}

function grid(v, step) {
  let px = step * v.scale;
  let s = step;
  while (px < 8) { s *= 5; px *= 5; }
  const [x0, y0] = v.toW([0, 0]);
  const [x1, y1] = v.toW([v.w, v.h]);
  const minor = [], major = [];
  for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
    const sx = f(v.toS([x, 0])[0]);
    (Math.round(x / s) % 5 === 0 ? major : minor).push(`M${sx} 0V${v.h}`);
  }
  for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
    const sy = f(v.toS([0, y])[1]);
    (Math.round(y / s) % 5 === 0 ? major : minor).push(`M0 ${sy}H${v.w}`);
  }
  return `<path class="grid" d="${minor.join('')}"/><path class="grid major" d="${major.join('')}"/>`;
}

function label(x, y, text, cls = '') {
  return `<text class="lbl ${cls}" x="${f(x)}" y="${f(y)}">${esc(text)}</text>`;
}

function dimShape(v, el, cls = '') {
  const [a, b, o] = el.pts;
  if (!a || !b) return '';
  // 寸法線は a-b に平行で、o を通る位置に引く。
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const off = o ? (o[0] - a[0]) * nx + (o[1] - a[1]) * ny : 0;
  const a2 = [a[0] + nx * off, a[1] + ny * off];
  const b2 = [b[0] + nx * off, b[1] + ny * off];
  const [sa, sb, sa2, sb2] = [a, b, a2, b2].map((p) => v.toS(p).map(f));
  const mid = [(sa2[0] + sb2[0]) / 2, (sa2[1] + sb2[1]) / 2];
  let ang = (Math.atan2(sb2[1] - sa2[1], sb2[0] - sa2[0]) * 180) / Math.PI;
  if (ang > 90 || ang < -90) ang += 180;
  const tick = (p) => `M${p[0] - 4} ${p[1] + 4}L${p[0] + 4} ${p[1] - 4}`;
  return `<g class="dim ${cls}" data-id="${el.id}">
  <path d="M${sa.join(' ')}L${sa2.join(' ')}M${sb.join(' ')}L${sb2.join(' ')}" class="ext"/>
  <path d="M${sa2.join(' ')}L${sb2.join(' ')}${tick(sa2)}${tick(sb2)}"/>
  <text class="lbl dimtxt" transform="translate(${f(mid[0])},${f(mid[1])}) rotate(${f(ang)})" y="-5">${Math.round(len)}</text></g>`;
}

export function elementShape(v, el, opts = {}) {
  const def = KINDS[el.kind];
  const cls = `el k-${el.kind} ${opts.cls || ''}`;
  const id = `data-id="${el.id}"`;
  switch (def.geom) {
    case 'polygon': {
      if (el.pts.length < 2) return '';
      let fill = '';
      const d = pathD(v, el.pts, el.b, true);
      if (el.kind === 'hoso') fill = `<path class="hatch" d="${d}" fill="url(#${MATERIAL_PATTERN[el.props.材料] || 'pat-conc'})"/>`;
      if (el.kind === 'tatemono') fill = `<path class="hatch" d="${d}" fill="url(#pat-bldg)"/>`;
      const mat = el.kind === 'hoso' ? ` m-${MATERIAL_PATTERN[el.props.材料] || 'pat-conc'}` : '';
      return `<g class="${cls}${mat}" ${id}><path class="body" d="${d}"/>${fill}</g>`;
    }
    case 'polyline':
      if (el.pts.length < 2) return '';
      return `<g class="${cls}" ${id}><path class="body" d="${pathD(v, el.pts, el.b, false)}"/></g>`;
    case 'circle': {
      const [x, y] = v.toS(el.pts[0]);
      const r = Math.max(el.r * v.scale, 3);
      // 樹冠は少し波打たせて描く。
      const n = 12, d = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        d.push(`${i ? 'A' + f(r * 0.32) + ' ' + f(r * 0.32) + ' 0 0 1 ' : 'M'}${f(x + Math.cos(a) * r)} ${f(y + Math.sin(a) * r)}`);
      }
      return `<g class="${cls}" ${id}><path class="body" d="${d.join('')}"/><path class="trunk" d="M${f(x - 3)} ${f(y)}H${f(x + 3)}M${f(x)} ${f(y - 3)}V${f(y + 3)}"/></g>`;
    }
    case 'point': {
      const [x, y] = v.toS(el.pts[0]).map(f);
      return `<g class="${cls}" ${id}><path class="body" d="M${x - 6} ${y}H${x + 6}M${x} ${y - 6}V${y + 6}"/><circle class="ring" cx="${x}" cy="${y}" r="3"/></g>`;
    }
    case 'dim':
      return dimShape(v, el, cls);
    case 'text': {
      const [x, y] = v.toS(el.pts[0]).map(f);
      return `<g class="${cls}" ${id}><text class="lbl moji" x="${x}" y="${y}">${esc(el.props.文字 || '')}</text></g>`;
    }
    default:
      return '';
  }
}

function elementLabel(v, el) {
  const def = KINDS[el.kind];
  if (def.geom === 'polygon' && el.pts.length >= 3 && ['hoso', 'shokusaitai', 'tatemono', 'keiseki'].includes(el.kind)) {
    const c = v.toS(centroid(densify(el.pts, el.b, true)));
    const a = measure(el).area / 1e6;
    const name = el.kind === 'hoso' ? el.props.材料 : el.kind === 'tatemono' ? el.props.名前 || '建物' : el.kind === 'keiseki' ? el.props.石種 || '景石' : el.props.内容 || '植栽帯';
    if (a * 1e6 * v.scale * v.scale < 2500) return '';
    return label(c[0], c[1], name, 'area-name') + (el.kind === 'keiseki' ? '' : label(c[0], c[1] + 15, `${a.toFixed(2)} m²`, 'area-val'));
  }
  if (el.kind === 'jumoku' && el.r * v.scale > 10) {
    const [x, y] = v.toS(el.pts[0]);
    return el.props.樹種 ? label(x, y + el.r * v.scale + 14, el.props.樹種, 'tree-name') : '';
  }
  if (el.kind === 'takasa') {
    const [x, y] = v.toS(el.pts[0]);
    const h = Number(el.props.高さ) || 0;
    return label(x + 8, y - 6, (h >= 0 ? '+' : '') + h, 'spot');
  }
  if (el.kind === 'hei' && el.pts.length >= 2) {
    const [a, b] = [v.toS(el.pts[0]), v.toS(el.pts[1])];
    if (dist(a, b) < 60) return '';
    return label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 8, `${el.props.種類 || ''} H${el.props.高さ}`, 'line-name');
  }
  return '';
}

function scaleBar(v) {
  const target = 120 / v.scale;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const len = steps.find((s) => s >= target) || steps.at(-1);
  const px = len * v.scale;
  const x = 16, y = v.h - 20;
  const txt = len >= 1000 ? `${len / 1000} m` : `${len} mm`;
  return `<g class="scalebar"><path d="M${x} ${y - 5}V${y}H${f(x + px)}V${y - 5}"/><text class="lbl" x="${f(x + px / 2)}" y="${y - 8}">${txt}</text></g>`;
}

export function renderScene(state, v) {
  const { doc } = state;
  const hidden = new Set(doc.settings.hiddenLayers || []);
  const els = sortedForDraw(live(doc)).filter((e) => !hidden.has(KINDS[e.kind].layer));
  const out = [defs(v)];
  if (doc.settings.gridOn) out.push(grid(v, doc.settings.grid));
  const sel = new Set(state.sel);
  out.push('<g class="shapes">', ...els.map((e) => elementShape(v, e, { cls: sel.has(e.id) ? 'sel' : '' })), '</g>');
  out.push('<g class="labels">', ...els.map((e) => elementLabel(v, e)), '</g>');
  out.push(scaleBar(v));
  return out.join('');
}

// 選んだ部材のつまみ、描きかけの線、吸着の印。
export function renderOverlay(state, v) {
  const out = [];
  const sel = state.sel.length === 1 && state.doc.elements.find((e) => e.id === state.sel[0] && !e.deleted);
  if (sel) {
    for (const h of handlesOf(sel)) {
      const [x, y] = v.toS(h.p).map(f);
      const picked = state.vsel && state.vsel.id === sel.id && state.vsel.i === h.i && !h.mid && !h.radius;
      out.push(h.mid
        ? `<circle class="handle mid${state.bend ? ' bend' : ''}" cx="${x}" cy="${y}" r="${state.bend ? 5 : 4}"/>`
        : `<rect class="handle${picked ? ' picked' : ''}" x="${x - 5}" y="${y - 5}" width="10" height="10"/>`);
    }
  }
  if (state.box) {
    const [a, b] = state.box;
    const crossing = b[0] < a[0];
    out.push(`<rect class="box${crossing ? ' crossing' : ''}" x="${f(Math.min(a[0], b[0]))}" y="${f(Math.min(a[1], b[1]))}" width="${f(Math.abs(b[0] - a[0]))}" height="${f(Math.abs(b[1] - a[1]))}"/>`);
  }
  const d = state.draft;
  if (d) {
    const pts = d.cursor ? [...d.pts, d.cursor] : d.pts;
    const geom = KINDS[d.kind].geom;
    if (d.shape === 'rect' && pts.length === 2) {
      const [a, b] = pts;
      out.push(`<polygon class="draft" points="${ptsAttr(v, [a, [b[0], a[1]], b, [a[0], b[1]]])}"/>`);
    } else if (geom === 'dim') {
      if (pts.length >= 2) out.push(dimShape(v, { id: 'draft', pts }, 'draft'));
    } else if (pts.length >= 2) {
      out.push(geom === 'polygon'
        ? `<polygon class="draft" points="${ptsAttr(v, pts)}"/>`
        : `<polyline class="draft" points="${ptsAttr(v, pts)}"/>`);
    }
    for (const p of d.pts) {
      const [x, y] = v.toS(p).map(f);
      out.push(`<circle class="draft-pt" cx="${x}" cy="${y}" r="3"/>`);
    }
    if (d.cursor && d.pts.length) {
      const last = d.pts.at(-1);
      const len = Math.round(dist(last, d.cursor));
      const [x, y] = v.toS(d.cursor);
      out.push(label(x + 14, y - 12, `${len}`, 'live-len'));
    }
  }
  if (state.snap) {
    const [x, y] = v.toS(state.snap.p).map(f);
    out.push(state.snap.type === 'vertex'
      ? `<rect class="snap" x="${x - 6}" y="${y - 6}" width="12" height="12"/>`
      : `<path class="snap grid-snap" d="M${x - 5} ${y}H${x + 5}M${x} ${y - 5}V${y + 5}"/>`);
  }
  return out.join('');
}

// つまみ：頂点（動かす）と辺の中点（引くと頂点が増える）。樹木は縁で大きさを変える。
export function handlesOf(el) {
  const def = KINDS[el.kind];
  const hs = el.pts.map((p, i) => ({ p, i }));
  if (def.geom === 'polygon' || def.geom === 'polyline') {
    const n = el.pts.length;
    const segs = def.geom === 'polygon' ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = el.pts[i], b = el.pts[(i + 1) % n];
      const bu = bulgeAt(el.b, i);
      hs.push({ p: bu && dist(a, b) > 0 ? arcOf(a, b, bu).mid : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], i, mid: true });
    }
  }
  if (def.geom === 'circle') hs.push({ p: [el.pts[0][0] + el.r, el.pts[0][1]], radius: true });
  return hs;
}

// 下図は大きな画像なので、毎回作り直さず置き方だけ更新する。
export function syncUnderlays(g, uls, v, urls, activeId) {
  const NS = 'http://www.w3.org/2000/svg';
  const keep = new Set();
  for (const u of uls) {
    if (!u.visible) continue;
    keep.add(u.id);
    let node = g.querySelector(`[data-ul="${u.id}"]`);
    const url = urls.get(u.blob);
    const want = url ? 'image' : 'missing';
    if (node && node.dataset.kind !== want) {
      node.remove();
      node = null;
    }
    if (!node) {
      if (url) {
        node = document.createElementNS(NS, 'image');
        node.setAttribute('href', url);
        node.setAttribute('preserveAspectRatio', 'none');
      } else {
        node = document.createElementNS(NS, 'g');
        node.innerHTML = `<rect class="ul-missing"/><text class="lbl ul-missing-txt">下図の画像がこの端末にありません</text>`;
      }
      node.dataset.ul = u.id;
      node.dataset.kind = want;
      node.classList.add('ul');
      g.append(node);
    }
    const [sx, sy] = v.toS([u.x, u.y]);
    const k = u.s * v.scale;
    node.setAttribute('transform', `translate(${f(sx)},${f(sy)}) rotate(${u.rot}) scale(${k})`);
    node.classList.toggle('active', u.id === activeId);
    if (url) {
      node.setAttribute('width', u.w);
      node.setAttribute('height', u.h);
      node.setAttribute('opacity', u.opacity);
    } else {
      const r = node.querySelector('rect');
      r.setAttribute('width', u.w);
      r.setAttribute('height', u.h);
      r.setAttribute('stroke-width', 1.5 / k);
      const t = node.querySelector('text');
      t.setAttribute('x', u.w / 2);
      t.setAttribute('y', u.h / 2);
      t.setAttribute('font-size', 13 / k);
      t.setAttribute('stroke-width', 3 / k);
    }
  }
  for (const node of [...g.children]) if (!keep.has(node.dataset.ul)) node.remove();
  // 並び順を図の並びに合わせる（後に敷いたものが上）。
  for (const u of uls) {
    const node = g.querySelector(`[data-ul="${u.id}"]`);
    if (node) g.append(node);
  }
}
