// pdfwriter.js の Page と同じ呼び方で、SVG を組み立てる書き手。
// 図面と同じ絵を、Obsidian のノートに添える画像にするために使う。
// 座標は紙の mm（左上原点・y 下向き）のまま、viewBox も mm にする。下図の画像は描かない。

const n = (v) => (Math.round(v * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const FONT = "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo','Noto Sans JP',sans-serif";

export class SvgPage {
  constructor(wMm, hMm) {
    this.W = wMm;
    this.H = hMm;
    this.out = [];
    this.defs = [];
    this.d = '';
    this.gs = this.fresh();
    this.stack = [];
  }

  fresh() {
    return { stroke: '#000000', fill: '#000000', width: 1 / 2.835, dash: [], cap: 0, join: 0, alpha: 1, blend: 'Normal', groups: 0 };
  }

  raw(s) { this.out.push(s); return this; }
  save() { this.stack.push(this.gs); this.gs = { ...this.gs, groups: 0 }; return this; }
  restore() {
    this.out.push('</g>'.repeat(this.gs.groups));
    this.gs = this.stack.pop() || this.fresh();
    return this;
  }
  lineWidth(mm) { this.gs.width = mm; return this; }
  dash(mms = []) { this.gs.dash = mms; return this; }
  stroke(hex) { this.gs.stroke = hex; return this; }
  fill(hex) { this.gs.fill = hex; return this; }
  joins(cap = 0, join = 0) { this.gs.cap = cap; this.gs.join = join; return this; }
  alpha(a, blend = 'Normal') { this.gs.alpha = a; this.gs.blend = blend; return this; }

  moveTo([x, y]) { this.d += `M${n(x)} ${n(y)}`; return this; }
  lineTo([x, y]) { this.d += `L${n(x)} ${n(y)}`; return this; }
  curveTo([x1, y1], [x2, y2], [x3, y3]) { this.d += `C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x3)} ${n(y3)}`; return this; }
  close() { this.d += 'Z'; return this; }

  path(pts, closed = false) {
    if (!pts.length) return this;
    this.moveTo(pts[0]);
    for (let i = 1; i < pts.length; i++) this.lineTo(pts[i]);
    return closed ? this.close() : this;
  }

  rect(x, y, w, h) { return this.moveTo([x, y]).lineTo([x + w, y]).lineTo([x + w, y + h]).lineTo([x, y + h]).close(); }

  circle([cx, cy], r) {
    this.d += `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}Z`;
    return this;
  }

  strokeAttrs() {
    const g = this.gs;
    const caps = ['butt', 'round', 'square'], joins = ['miter', 'round', 'bevel'];
    let a = ` stroke="${g.stroke}" stroke-width="${n(g.width)}"`;
    if (g.cap) a += ` stroke-linecap="${caps[g.cap]}"`;
    if (g.join) a += ` stroke-linejoin="${joins[g.join]}"`;
    // 長さ 0 に近い破線（点々）は、丸い端で点に見せる。
    if (g.dash.length) a += ` stroke-dasharray="${g.dash.map((v) => n(Math.max(v, 0.001))).join(' ')}"`;
    return a;
  }

  common() {
    const g = this.gs;
    let a = '';
    if (g.alpha < 1) a += ` opacity="${n(g.alpha)}"`;
    if (g.blend === 'Multiply') a += ' style="mix-blend-mode:multiply"';
    return a;
  }

  emit(fill, stroke) {
    if (this.d) {
      const f = fill ? ` fill="${this.gs.fill}"` : ' fill="none"';
      this.out.push(`<path d="${this.d}"${f}${stroke ? this.strokeAttrs() : ''}${this.common()}/>`);
    }
    this.d = '';
    return this;
  }

  doStroke() { return this.emit(false, true); }
  doFill() { return this.emit(true, false); }
  doFillStroke() { return this.emit(true, true); }

  clip() {
    const id = `c${this.defs.length + 1}`;
    this.defs.push(`<clipPath id="${id}"><path d="${this.d}"/></clipPath>`);
    this.d = '';
    this.out.push(`<g clip-path="url(#${id})">`);
    this.gs.groups++;
    return this;
  }

  text(s, [x, y], sizeMm, { angle = 0, align = 'start', hex = '#000000', halo = null } = {}) {
    if (s === '' || s == null) return this;
    const anchor = align === 'middle' ? ' text-anchor="middle"' : align === 'end' ? ' text-anchor="end"' : '';
    const rot = angle ? ` transform="rotate(${n(-angle)} ${n(x)} ${n(y)})"` : '';
    const h = halo ? ` stroke="${halo}" stroke-width="${n(sizeMm * 0.28)}" stroke-linejoin="round" paint-order="stroke"` : '';
    this.out.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(sizeMm)}" fill="${hex}"${anchor}${rot}${h}>${esc(s)}</text>`);
    return this;
  }

  image() { return this; }
  imageMatrix() { return [1, 0, 0, 1, 0, 0]; }
}

export function buildSvg(page, { title = '' } = {}) {
  const W = n(page.W), H = n(page.H);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">
<title>${esc(title)}</title>
<defs>${page.defs.join('')}</defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${page.out.join('\n')}
</svg>
`;
}
