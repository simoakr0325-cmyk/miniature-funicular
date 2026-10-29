import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SH from '../app/src/sheet.js';
import { createDoc, createElement } from '../app/src/model.js';
import { plotSheet } from '../app/src/plot.js';
import { Page, buildPdf, textWidth } from '../app/src/pdfwriter.js';

const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

test('用紙と枠：A3 横・A4 縦', () => {
  const a3 = SH.layout({ ...SH.defaultSheet(), paper: 'A3', orient: 'landscape' });
  assert.deepEqual([a3.W, a3.H], [420, 297]);
  assert.deepEqual(a3.frame, { x: 10, y: 10, w: 400, h: 277 });
  assert.equal(a3.title.x + a3.title.w, 410);
  const a4 = SH.layout({ ...SH.defaultSheet(), paper: 'A4', orient: 'portrait' });
  assert.deepEqual([a4.W, a4.H], [210, 297]);
});

test('縮尺どおりに紙へ写す', () => {
  const s = { ...SH.defaultSheet(), scale: 100, cx: 5000, cy: 4000 };
  const L = SH.layout(s);
  const a = SH.worldToPaper(s, L, [0, 0]), b = SH.worldToPaper(s, L, [10000, 0]);
  assert.equal(b[0] - a[0], 100); // 10 m は 1/100 で 100 mm
  assert.deepEqual(SH.worldToPaper(s, L, [5000, 4000]), [210, 148.5]);
  const back = SH.paperToWorld(s, L, SH.worldToPaper(s, L, [1234, -567]));
  assert.ok(Math.abs(back[0] - 1234) < 1e-9 && Math.abs(back[1] + 567) < 1e-9);
});

test('全体が入る縮尺を選び、表題欄を避けて真ん中に置く', () => {
  const box = { x0: 0, y0: 0, x1: 12000, y1: 9000 };
  const s = SH.fitToBox({ ...SH.defaultSheet(), paper: 'A3' }, box);
  assert.equal(s.scale, 50);
  const small = SH.fitToBox({ ...SH.defaultSheet(), paper: 'A4' }, box);
  assert.equal(small.scale, 100);
  const L = SH.layout(s);
  const [x0, y0] = SH.worldToPaper(s, L, [0, 0]);
  const [x1, y1] = SH.worldToPaper(s, L, [12000, 9000]);
  assert.ok(x0 > L.frame.x && x1 < L.frame.x + L.frame.w);
  assert.ok(y0 > L.frame.y && y1 < L.title.y);
});

test('スケールバーと PDF の名前', () => {
  assert.equal(SH.scaleBarLength(100), 5000);
  assert.equal(SH.scaleBarLength(50), 2000);
  const d = createDoc({ siteId: 'Y-1', siteName: '春日邸' });
  assert.equal(SH.pdfFileName(d, { ...SH.defaultSheet(), paper: 'A3', scale: 100 }), 'Y-1_春日邸_平面図_A3_1-100.pdf');
});

test('PDF の構造：目次の位置が正しく、日本語は UCS-2 で書かれる', () => {
  const pg = new Page(420, 297);
  pg.text('山波 A1', [10, 20], 3);
  pg.save().alpha(0.5, 'Multiply').restore();
  const pdf = latin1(buildPdf(pg, { title: '試し' }));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.ok(pdf.includes('/MediaBox [0 0 1190.551 841.89]'));
  assert.ok(pdf.includes('[<5c716ce2> -500 <00410031>] TJ')); // 空白は字形を置かず送るだけ
  assert.ok(pdf.includes('/Encoding /UniJIS-UCS2-HW-H'));
  assert.ok(pdf.includes('/BM /Multiply'));
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(startxref).startsWith('xref'));
  const rows = pdf.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
  rows.forEach((row, i) => assert.ok(pdf.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `obj ${i + 1}`));
  assert.equal(textWidth('山A', 2), 3);
});

test('図を図面にする：部材が紙の上の正しい位置に来る', () => {
  const d = createDoc({ siteId: 'Y-1', siteName: '春日邸' });
  d.elements.push(createElement('shikichi', [[0, 0], [10000, 0], [10000, 8000], [0, 8000]]));
  d.elements.push(createElement('hoso', [[0, 0], [2000, 0], [2000, 2000]], { props: { 材料: '砂利' } }));
  d.elements.push(createElement('jumoku', [[5000, 4000]], { props: { 樹種: 'ヤマボウシ' } }));
  d.elements.push(createElement('sunpo', [[0, 0], [10000, 0], [5000, -500]]));
  const s = { ...SH.defaultSheet(), scale: 100, cx: 5000, cy: 4000 };
  const pdf = latin1(plotSheet(d, s, { date: new Date(2026, 9, 29) }));
  const PT = 72 / 25.4;
  // 敷地の左上 (0,0) は紙の (160, 108.5) mm、右上は 100mm 右。
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  assert.ok(pdf.includes(`${f(160 * PT)} ${f((297 - 108.5) * PT)} m`));
  assert.ok(pdf.includes(`${f(260 * PT)} ${f((297 - 108.5) * PT)} l`));
  assert.ok(pdf.includes('[<5c716ce2527582d1>] TJ')); // 山波創苑
  // 縮尺 1/100
  assert.ok(pdf.includes('<0031002f003100300030>'));
});
