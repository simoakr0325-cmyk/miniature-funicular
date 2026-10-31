// 下図（測量図 PDF・写真）。画像は端末の中に別に置き、図には置き方だけを持つ。
// 置き方：画像の左上の画素が図の (x, y) mm に来て、1 画素が s mm、rot 度（画面で時計回り）回る。
// k は縦の伸び（地理院タイルのように縦と横で 1 画素の大きさが違う画像のため。ふつうは無い＝1）。

import { dist } from './geometry.js';
import { decodeDxf, parseDxf, toUnderlayGeometry } from './dxfread.js';

const rad = (d) => (d * Math.PI) / 180;
const rot = ([x, y], deg) => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
};

// 画像の画素 (u, v) が図のどこに来るか。
export function pixelToWorld(ul, [u, v]) {
  const [dx, dy] = rot([u * ul.s, v * ul.s * (ul.k || 1)], ul.rot);
  return [ul.x + dx, ul.y + dy];
}

export function corners(ul) {
  return [[0, 0], [ul.w, 0], [ul.w, ul.h], [0, ul.h]].map((p) => pixelToWorld(ul, p));
}

export const center = (ul) => pixelToWorld(ul, [ul.w / 2, ul.h / 2]);

// 図の上の相似変換 p → q1 + k·R(θ)(p − p1) を置き方に掛ける。
function applySimilarity(ul, p1, q1, k, thetaDeg) {
  const [ox, oy] = rot([(ul.x - p1[0]) * k, (ul.y - p1[1]) * k], thetaDeg);
  return { ...ul, x: q1[0] + ox, y: q1[1] + oy, s: ul.s * k, rot: normDeg(ul.rot + thetaDeg) };
}

const normDeg = (d) => {
  let r = ((d % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
};

// 下図の上の二点 p1, p2 の間が、実際には len mm になるように大きさを直す。p1 は動かない。
export function calibrateLength(ul, p1, p2, len) {
  const d = dist(p1, p2);
  if (!(d > 0) || !(len > 0)) throw new Error('二点が近すぎるか、長さが正しくありません');
  return applySimilarity(ul, p1, p1, len / d, 0);
}

// 下図の上の二点 p1, p2 を、図の上の二点 q1, q2 に重ねる（大きさ・向き・位置）。
export function alignTwoPoints(ul, p1, p2, q1, q2) {
  const dp = dist(p1, p2), dq = dist(q1, q2);
  if (!(dp > 0) || !(dq > 0)) throw new Error('二点が近すぎます');
  const theta = (Math.atan2(q2[1] - q1[1], q2[0] - q1[0]) - Math.atan2(p2[1] - p1[1], p2[0] - p1[0])) * (180 / Math.PI);
  return applySimilarity(ul, p1, q1, dq / dp, theta);
}

// 中心を軸に、向きを deg 度にする。
export function setRotation(ul, deg) {
  const c = center(ul);
  return applySimilarity(ul, c, c, 1, deg - ul.rot);
}

// PDF の縮尺 1/n に合わせる。中心は動かさない。
export function setPaperScale(ul, n) {
  if (!ul.paperMmPerPx || !(n > 0)) throw new Error('縮尺を使えるのは PDF の下図だけです');
  const c = center(ul);
  return applySimilarity(ul, c, c, (ul.paperMmPerPx * n) / ul.s, 0);
}

export const paperScaleOf = (ul) => (ul.paperMmPerPx ? ul.s / ul.paperMmPerPx : null);

export const moveBy = (ul, dx, dy) => ({ ...ul, x: ul.x + dx, y: ul.y + dy });

// DXF の下図は、元の DXF をそのまま持ち、開くたびに線にする。
export const DXF_MIME = 'application/dxf';
export const isVector = (ul) => ul.mime === DXF_MIME;

export function blobFileName(ul) {
  const ext = ul.mime === 'image/png' ? 'png' : ul.mime === DXF_MIME ? 'dxf' : 'jpg';
  return `下図_${ul.blob}.${ext}`;
}

// ---------- ここから下はブラウザでだけ使う ----------

const MAX_SIDE = 4000;
const MAX_PIXELS = 16e6; // iPhone の canvas の上限に収める

export async function hashOf(blob) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
  }
}

function fitSize(w, h) {
  let k = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (w * h * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (w * h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function canvasToBlob(canvas, mime, q) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), mime, q));
}

// 写真：大きすぎれば縮め、JPEG に直す（位置情報などの付帯情報もここで落ちる）。
async function readImage(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('この画像は読めません（HEIC の場合は JPEG で書き出してください）');
  }
  const [w, h] = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { blob: await canvasToBlob(canvas, 'image/jpeg', 0.88), mime: 'image/jpeg', w, h, paperMmPerPx: null };
}

let pdfjsP;
function pdfjs() {
  pdfjsP ??= import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return pdfjsP;
}

export async function pdfPageCount(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument(pdfParams(await file.arrayBuffer())).promise;
  const n = doc.numPages;
  doc.destroy();
  return n;
}

const pdfParams = (data) => ({
  data,
  cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
});

// PDF：一頁を画像にする。線が読めるよう最大 300dpi 相当まで。紙の上の 1 画素の大きさも返す。
async function readPdf(file, pageNo = 1) {
  const lib = await pdfjs();
  const doc = await lib.getDocument(pdfParams(await file.arrayBuffer())).promise;
  try {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 }); // 1 = 72dpi
    let scale = 300 / 72;
    const [w0] = fitSize(base.width * scale, base.height * scale);
    scale *= w0 / (base.width * scale);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return {
      blob: await canvasToBlob(canvas, 'image/png'),
      mime: 'image/png',
      w: canvas.width,
      h: canvas.height,
      paperMmPerPx: 25.4 / (72 * scale),
    };
  } finally {
    doc.destroy();
  }
}

export const isDxf = (file) => /\.dxf$/i.test(file.name) || file.type === DXF_MIME;

// DXF の中身を下図の線にする（端末に置いた DXF を開くたびに使う）。
export async function dxfGeometry(blob) {
  const parsed = parseDxf(decodeDxf(new Uint8Array(await blob.arrayBuffer())));
  return { ...toUnderlayGeometry(parsed), unitMm: parsed.unitMm, ext: parsed.ext, skipped: parsed.skipped };
}

async function readDxf(file) {
  const blob = new Blob([await file.arrayBuffer()], { type: DXF_MIME });
  const geo = await dxfGeometry(blob);
  return { blob, mime: DXF_MIME, w: geo.w, h: geo.h, paperMmPerPx: null, geo };
}

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

// ファイルを読み、画像の中身と大きさを返す。置き方は呼ぶ側で決める。
export async function readUnderlayFile(file, pageNo = 1) {
  const out = isDxf(file) ? await readDxf(file) : isPdf(file) ? await readPdf(file, pageNo) : await readImage(file);
  return { ...out, hash: await hashOf(out.blob), name: file.name + (isPdf(file) && pageNo > 1 ? ` (${pageNo}頁)` : '') };
}
