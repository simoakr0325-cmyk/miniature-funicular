// 緯度経度（JGD2011）と平面直角座標（第Ⅰ〜XIX 系）の変換。
// 国土地理院の計算式（河瀬 2011、ガウス・クリューゲル図法、GRS80、縮尺係数 0.9999）による。
// 平面直角座標は X が北・Y が東、単位 m（survey.js と同じ）。

const a = 6378137;
const F = 298.257222101;
const m0 = 0.9999;
const n = 1 / (2 * F - 1);
const RAD = Math.PI / 180;

// 系の原点（緯度・経度、度）。
const dm = (d, m = 0) => d + m / 60;
export const ZONE_ORIGINS = [
  [33, dm(129, 30)], [33, 131], [36, dm(132, 10)], [33, dm(133, 30)], [36, dm(134, 20)],
  [36, 136], [36, dm(137, 10)], [36, dm(138, 30)], [36, dm(139, 50)], [40, dm(140, 50)],
  [44, dm(140, 15)], [44, dm(142, 15)], [44, dm(144, 15)], [26, 142], [26, dm(127, 30)],
  [26, 124], [26, 131], [20, 136], [26, 154],
];

const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const A = [
  1 + n2 / 4 + n4 / 64,
  (-3 / 2) * (n - n3 / 8 - n5 / 64),
  (15 / 16) * (n2 - n4 / 4),
  (-35 / 48) * (n3 - (5 / 16) * n5),
  (315 / 512) * n4,
  (-693 / 1280) * n5,
];
const alpha = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5,
  (49561 / 161280) * n4 - (179 / 168) * n5,
  (34729 / 80640) * n5,
];
const beta = [
  0,
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5,
  (4397 / 161280) * n4 - (11 / 504) * n5,
  (4583 / 161280) * n5,
];
const delta = [
  0,
  2 * n - (2 / 3) * n2 - 2 * n3 + (116 / 45) * n4 + (26 / 45) * n5 - (2854 / 675) * n6,
  (7 / 3) * n2 - (8 / 5) * n3 - (227 / 45) * n4 + (2704 / 315) * n5 + (2323 / 945) * n6,
  (56 / 15) * n3 - (136 / 35) * n4 - (1262 / 105) * n5 + (73814 / 2835) * n6,
  (4279 / 630) * n4 - (332 / 35) * n5 - (399572 / 14175) * n6,
  (4174 / 315) * n5 - (144838 / 6237) * n6,
  (601676 / 22275) * n6,
];
const Abar = ((m0 * a) / (1 + n)) * A[0];

function Sphi0(phi0) {
  let s = A[0] * phi0;
  for (let j = 1; j <= 5; j++) s += A[j] * Math.sin(2 * j * phi0);
  return ((m0 * a) / (1 + n)) * s;
}

function origin(zone) {
  const o = ZONE_ORIGINS[zone - 1];
  if (!o) throw new Error('座標系の番号は 1〜19 です');
  return [o[0] * RAD, o[1] * RAD];
}

// 緯度経度（度）→ 平面直角座標 { X, Y }（m）
export function toPlane(lat, lng, zone) {
  const [phi0, lam0] = origin(zone);
  const phi = lat * RAD, lam = lng * RAD;
  const k = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - k * Math.atanh(k * Math.sin(phi)));
  const tb = Math.sqrt(1 + t * t);
  const lc = Math.cos(lam - lam0), ls = Math.sin(lam - lam0);
  const xi = Math.atan(t / lc), eta = Math.atanh(ls / tb);
  let x = xi, y = eta;
  for (let j = 1; j <= 5; j++) {
    x += alpha[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    y += alpha[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { X: Abar * x - Sphi0(phi0), Y: Abar * y };
}

// 平面直角座標（m）→ 緯度経度 { lat, lng }（度）
export function toLatLng(X, Y, zone) {
  const [phi0, lam0] = origin(zone);
  const xi = (X + Sphi0(phi0)) / Abar, eta = Y / Abar;
  let xi2 = xi, eta2 = eta;
  for (let j = 1; j <= 5; j++) {
    xi2 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta2 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
  let phi = chi;
  for (let j = 1; j <= 6; j++) phi += delta[j] * Math.sin(2 * j * chi);
  const lam = lam0 + Math.atan(Math.sinh(eta2) / Math.cos(xi2));
  return { lat: phi / RAD, lng: lam / RAD };
}

// 緯度経度の文字を読む。「36.6513, 138.1810」「36°39′4.7″N 138°10′51.6″E」「北緯36度39分4.7秒 東経138度10分51.6秒」など。
export function parseLatLng(text) {
  const s = String(text)
    .replace(/[０-９．，－]/g, (c) => ({ '．': '.', '，': ',', '－': '-' })[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[度°]/g, '°').replace(/[分′']/g, "'").replace(/[秒″"]/g, '"');
  const parts = [];
  const re = /(-?\d+(?:\.\d+)?)\s*(?:°\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?)?/g;
  let m;
  while ((m = re.exec(s)) && parts.length < 2) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const deg = Math.abs(Number(m[1])) + (Number(m[2]) || 0) / 60 + (Number(m[3]) || 0) / 3600;
    parts.push(Number(m[1]) < 0 ? -deg : deg);
  }
  if (parts.length < 2) return null;
  let [lat, lng] = parts;
  // 経度・緯度の順に書いてあれば入れ替える（日本付近なら緯度は 20〜46、経度は 122〜154）
  if (Math.abs(lat) > 90 || (lat > 100 && lng < 60)) [lat, lng] = [lng, lat];
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return { lat, lng };
}

// 緯度経度から、いちばん近い原点の系（目安）。系は本来、都道府県で決まる。
export function guessZone(lat, lng) {
  let best = 1, bd = Infinity;
  ZONE_ORIGINS.forEach(([la, lo], i) => {
    if (i >= 13) return; // 離島の系（XIV〜XIX）は選ばない
    const d = Math.abs(lng - lo) * Math.cos(lat * RAD) * 2 + Math.abs(lat - la) * 0.2;
    if (d < bd) { bd = d; best = i + 1; }
  });
  return best;
}

export const fmtDeg = (v) => v.toFixed(7);
