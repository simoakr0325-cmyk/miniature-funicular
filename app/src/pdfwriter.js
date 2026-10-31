// 一頁の PDF を直接組み立てる小さな書き手。
// 座標は紙の mm（左上原点・y 下向き）で受け取り、PDF の pt（左下原点）へ直す。
// 日本語は埋め込まない標準の日本語書体（HeiseiKakuGo-W5、Adobe-Japan1）で書く。
// 英数字は半角の字形（UniJIS-UCS2-HW-H）になるので、幅は半角 0.5、全角 1 で見積もれる。

const PT = 72 / 25.4;
const enc = new TextEncoder();
const n = (v) => (Math.round(v * 1000) / 1000).toString();

export const textWidth = (s, size) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) < 0x80 ? 0.5 : 1), 0) * size;

// 文字列を TJ の配列にする。空白は字形を置かず送り幅だけで空ける
// （空白の字形を持たない書体で代わりに描かれても、四角が出ないように）。
function tjArray(s) {
  const parts = [];
  let run = '';
  for (const ch of String(s)) {
    let c = ch.codePointAt(0);
    if (c === 0x20 || c === 0x3000) {
      if (run) parts.push(`<${run}>`);
      run = '';
      parts.push(c === 0x20 ? '-500' : '-1000');
      continue;
    }
    if (c > 0xffff) c = 0x3013; // 〓（基本面の外の字は書けない）
    run += c.toString(16).padStart(4, '0');
  }
  if (run) parts.push(`<${run}>`);
  return `[${parts.join(' ')}] TJ`;
}

export function rgb(hex) {
  const h = hex.replace('#', '');
  const v = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [v(0), v(2), v(4)];
}

export class Page {
  constructor(wMm, hMm) {
    this.W = wMm;
    this.H = hMm;
    this.ops = [];
    this.images = [];
    this.gstates = new Map();
  }

  X(x) { return n(x * PT); }
  Y(y) { return n((this.H - y) * PT); }
  raw(s) { this.ops.push(s); return this; }

  save() { return this.raw('q'); }
  restore() { return this.raw('Q'); }
  lineWidth(mm) { return this.raw(`${n(mm * PT)} w`); }
  dash(mms = []) { return this.raw(`[${mms.map((d) => n(d * PT)).join(' ')}] 0 d`); }
  stroke(hex) { const [r, g, b] = rgb(hex); return this.raw(`${n(r)} ${n(g)} ${n(b)} RG`); }
  fill(hex) { const [r, g, b] = rgb(hex); return this.raw(`${n(r)} ${n(g)} ${n(b)} rg`); }
  joins(cap = 0, join = 0) { return this.raw(`${cap} J ${join} j`); }

  // 透明度と重ね方。同じ組み合わせは一つにまとめる。
  alpha(a, blend = 'Normal') {
    const key = `${n(a)}/${blend}`;
    if (!this.gstates.has(key)) this.gstates.set(key, { name: `GS${this.gstates.size + 1}`, a, blend });
    return this.raw(`/${this.gstates.get(key).name} gs`);
  }

  moveTo([x, y]) { return this.raw(`${this.X(x)} ${this.Y(y)} m`); }
  lineTo([x, y]) { return this.raw(`${this.X(x)} ${this.Y(y)} l`); }
  curveTo([x1, y1], [x2, y2], [x3, y3]) {
    return this.raw(`${this.X(x1)} ${this.Y(y1)} ${this.X(x2)} ${this.Y(y2)} ${this.X(x3)} ${this.Y(y3)} c`);
  }
  close() { return this.raw('h'); }

  path(pts, closed = false) {
    if (!pts.length) return this;
    this.moveTo(pts[0]);
    for (let i = 1; i < pts.length; i++) this.lineTo(pts[i]);
    return closed ? this.close() : this;
  }

  rect(x, y, w, h) { return this.raw(`${this.X(x)} ${this.Y(y + h)} ${n(w * PT)} ${n(h * PT)} re`); }

  circle([cx, cy], r) {
    const k = 0.5522847498 * r;
    this.moveTo([cx + r, cy]);
    this.curveTo([cx + r, cy + k], [cx + k, cy + r], [cx, cy + r]);
    this.curveTo([cx - k, cy + r], [cx - r, cy + k], [cx - r, cy]);
    this.curveTo([cx - r, cy - k], [cx - k, cy - r], [cx, cy - r]);
    this.curveTo([cx + k, cy - r], [cx + r, cy - k], [cx + r, cy]);
    return this.close();
  }

  doStroke() { return this.raw('S'); }
  doFill() { return this.raw('f'); }
  doFillStroke() { return this.raw('B'); }
  clip() { return this.raw('W n'); }

  // 文字。(x, y) は基準線の左端。angle は度（紙の上で反時計回り）。align: start / middle / end
  text(s, [x, y], sizeMm, { angle = 0, align = 'start', hex = '#000000', halo = null } = {}) {
    if (s === '' || s == null) return this;
    const w = textWidth(s, sizeMm);
    const dx = align === 'middle' ? -w / 2 : align === 'end' ? -w : 0;
    const a = (angle * Math.PI) / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    // 文字の向きの原点を dx だけずらす（紙の y は下向きなので sin の符号に注意）。
    const ox = x + dx * c, oy = y - dx * sn;
    const tm = `${n(c)} ${n(sn)} ${n(-sn)} ${n(c)} ${this.X(ox)} ${this.Y(oy)} Tm`;
    const size = n(sizeMm * PT);
    if (halo) {
      const [r, g, b] = rgb(halo);
      this.raw(`q ${n(r)} ${n(g)} ${n(b)} RG ${n(sizeMm * 0.28 * PT)} w 1 j BT /F1 ${size} Tf 1 Tr ${tm} ${tjArray(s)} ET Q`);
    }
    const [r, g, b] = rgb(hex);
    return this.raw(`q ${n(r)} ${n(g)} ${n(b)} rg BT /F1 ${size} Tf 0 Tr ${tm} ${tjArray(s)} ET Q`);
  }

  // JPEG をそのまま置く。m は単位正方形を紙（pt）へ写す行列 [a b c d e f]。
  image(jpegBytes, pxW, pxH, m) {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, bytes: jpegBytes, w: pxW, h: pxH });
    return this.raw(`q ${m.map(n).join(' ')} cm /${name} Do Q`);
  }

  // 紙の mm の三点（画像の左下・右下・左上が来る所）から cm 行列を作る。
  imageMatrix(bl, br, tl) {
    const P = ([x, y]) => [x * PT, (this.H - y) * PT];
    const [ox, oy] = P(bl), [ax, ay] = P(br), [bx, by] = P(tl);
    return [ax - ox, ay - oy, bx - ox, by - oy, ox, oy];
  }
}

// 頁（一枚か、何枚かの並び）を PDF のバイト列にする。書体は全頁で一つを使う。
export function buildPdf(pageOrPages, { title = '', author = '', creator = '縄張り台' } = {}) {
  const list = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;

  const catalog = add(null);
  const pages = add(null);
  const desc = add('<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 737 /StemV 93 >>');
  const cid = add(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [231 389 500] >>`);
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5-UniJIS-UCS2-HW-H /Encoding /UniJIS-UCS2-HW-H /DescendantFonts [${cid} 0 R] >>`);
  const kids = list.map((page) => {
    const W = n(page.W * PT), H = n(page.H * PT);
    const pageObj = add(null);
    const contentBytes = enc.encode(page.ops.join('\n'));
    const content = add({ dict: `<< /Length ${contentBytes.length} >>`, stream: contentBytes });
    const xobjs = page.images.map((im) => `/${im.name} ${add({
      dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`,
      stream: im.bytes,
    })} 0 R`);
    const gs = [...page.gstates.values()].map((g) => `/${g.name} ${add(`<< /Type /ExtGState /ca ${n(g.a)} /CA ${n(g.a)} /BM /${g.blend} >>`)} 0 R`);
    objs[pageObj - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjs.join(' ')} >> /ExtGState << ${gs.join(' ')} >> >> >>`;
    return pageObj;
  });
  const info = add(`<< /Title ${hexUtf16(title)} /Author ${hexUtf16(author)} /Creator ${hexUtf16(creator)} /CreationDate (D:${pdfDate(new Date())}) >>`);

  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'); // 二行目は「バイナリを含む」印（128 以上のバイトなら何でもよい）
  objs.forEach((o, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n`);
    if (typeof o === 'string') push(o);
    else {
      push(o.dict + '\nstream\n');
      push(o.stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  });
  const xref = length;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function hexUtf16(s) {
  let out = 'FEFF';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) {
      const v = c - 0x10000;
      out += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else out += c.toString(16).padStart(4, '0');
  }
  return `<${out}>`;
}

function pdfDate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
