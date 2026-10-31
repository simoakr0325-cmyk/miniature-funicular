// 図面（用紙・縮尺・枠・表題欄）の決まり。寸法はすべて紙の上の mm。

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] }; // 横置きの幅・高さ
export const SCALES = [20, 30, 50, 100, 150, 200, 250, 300, 500, 1000];
export const MARGIN = 10;

export function defaultSheet() {
  return {
    paper: 'A3',
    orient: 'landscape',
    scale: 100,
    cx: 6000,
    cy: 4500,
    title: '平面図',
    number: '',
    company: '山波創苑',
    north: 0, // 北の向き。図の上を 0°、時計回り。
    underlays: true,
  };
}

// 図面は一つの図に何枚でも持てる（全体の平面図と部分詳細図など）。
// 古い図は settings.sheet に一枚だけ持っていたので、それも一枚目として読む。
export const sheetsOf = (doc) => (doc.settings.sheets?.length ? doc.settings.sheets : doc.settings.sheet ? [doc.settings.sheet] : []);
export const sheetIndexOf = (doc) => Math.min(Math.max(doc.settings.sheetIndex || 0, 0), Math.max(sheetsOf(doc).length - 1, 0));
export const sheetOf = (doc, i = sheetIndexOf(doc)) => ({ ...defaultSheet(), ...(sheetsOf(doc)[i] || {}) });

// 部分詳細図の縮尺：今の縮尺より一段か二段細かいもの。
export function detailScale(scale) {
  const i = SCALES.indexOf(scale);
  return i > 0 ? SCALES[Math.max(i - 2, 0)] : SCALES[0];
}

export function layout(sheet) {
  let [W, H] = PAPERS[sheet.paper] || PAPERS.A3;
  if (sheet.orient === 'portrait') [W, H] = [H, W];
  const frame = { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: H - 2 * MARGIN };
  const tw = Math.min(120, frame.w * 0.55);
  const th = 30;
  const title = { x: frame.x + frame.w - tw, y: frame.y + frame.h - th, w: tw, h: th };
  return { W, H, frame, title };
}

// 図（mm）→ 紙（mm、y 下向き）。枠の中心に (cx, cy) が来る。
export function worldToPaper(sheet, L, [x, y]) {
  return [L.W / 2 + (x - sheet.cx) / sheet.scale, L.H / 2 + (y - sheet.cy) / sheet.scale];
}

export function paperToWorld(sheet, L, [px, py]) {
  return [(px - L.W / 2) * sheet.scale + sheet.cx, (py - L.H / 2) * sheet.scale + sheet.cy];
}

// 枠と表題欄が図の上でどこに来るか（画面に枠を描くため）。
export function worldRects(sheet) {
  const L = layout(sheet);
  const rect = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map((p) => paperToWorld(sheet, L, p));
  return { frame: rect(L.frame), title: rect(L.title) };
}

// 絵を描ける所（枠の内側から表題欄の帯を除いた所）に box が収まる、いちばん大きい縮尺を選び、中心を合わせる。
export function fitToBox(sheet, box) {
  const L = layout(sheet);
  const area = { x: L.frame.x, y: L.frame.y, w: L.frame.w, h: L.frame.h - L.title.h - 4 };
  const bw = Math.max(box.x1 - box.x0, 1), bh = Math.max(box.y1 - box.y0, 1);
  const need = Math.max(bw / (area.w * 0.9), bh / (area.h * 0.9));
  const scale = SCALES.find((s) => s >= need) || SCALES.at(-1);
  // box の中心を area の中心に置く。
  const acx = area.x + area.w / 2, acy = area.y + area.h / 2;
  const bcx = (box.x0 + box.x1) / 2, bcy = (box.y0 + box.y1) / 2;
  return { ...sheet, scale, cx: bcx - (acx - L.W / 2) * scale, cy: bcy - (acy - L.H / 2) * scale };
}

// スケールバーの長さ（図の mm）。紙の上で 40〜80mm 程度になるものを選ぶ。
export function scaleBarLength(scale) {
  const steps = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  return steps.find((m) => m / scale >= 40) || steps.at(-1);
}

export function pdfSetFileName(doc) {
  const parts = [doc.siteId, doc.siteName, '図面一式'].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.join('_').replace(/[\\/:*?"<>|#^[\]]/g, '-') + '.pdf';
}

export function pdfFileName(doc, sheet) {
  const parts = [doc.siteId, doc.siteName, sheet.title || '図面'].map((s) => String(s || '').trim()).filter(Boolean);
  return (parts.join('_') + `_${sheet.paper}_1-${sheet.scale}`).replace(/[\\/:*?"<>|#^[\]]/g, '-') + '.pdf';
}
