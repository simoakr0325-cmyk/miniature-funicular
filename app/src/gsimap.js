// 地理院タイル（国土地理院）を継ぎ合わせて、下図の画像にする。電波のある所でだけ使える。
// タイルはウェブメルカトル図法なので、平面直角座標とは向きと縮尺が少し違う。
// 数百 m の範囲なら相似変換（位置・縮尺・向き）で十分に重なるので、画像の上の二隅を変換して置き方を決める。

import { toPlane, toLatLng } from './latlng.js';
import { toWorld, toSurvey } from './survey.js';

export const GSI_LAYERS = {
  std: { label: '標準地図', ext: 'png', zoom: 18 },
  pale: { label: '淡色地図', ext: 'png', zoom: 18 },
  seamlessphoto: { label: '写真', ext: 'jpg', zoom: 18 },
};

export const tileUrl = (layer, z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${z}/${x}/${y}.${GSI_LAYERS[layer].ext}`;

// 緯度経度 → 世界の画素（ズーム z、256 画素のタイル）
export function lonLatToPixel(lat, lng, z) {
  const size = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

export function pixelToLonLat(px, py, z) {
  const size = 256 * 2 ** z;
  const lng = (px / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / size))) * 180) / Math.PI;
  return { lat, lng };
}

// 図の点 (mm) の緯度経度。geo に系が無ければ null。
export function worldToLatLng(geo, p) {
  if (!geo?.zone) return null;
  const { X, Y } = toSurvey(geo, p);
  return toLatLng(X, Y, geo.zone);
}

export function latLngToWorld(geo, lat, lng) {
  const { X, Y } = toPlane(lat, lng, geo.zone);
  return toWorld(geo, X, Y);
}

// 取りに行く範囲と、画像の置き方を決める（タイルは取らない。試験しやすいように分けてある）。
// center：図の mm、half：中心から端までの m
export function planGsi(geo, center, half, layer = 'std') {
  const z = GSI_LAYERS[layer].zoom - (half > 250 ? 1 : 0);
  const c = worldToLatLng(geo, center);
  const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (256 * 2 ** z); // 1 画素の m
  const [cx, cy] = lonLatToPixel(c.lat, c.lng, z);
  const r = half / mpp;
  const x0 = Math.floor(cx - r), y0 = Math.floor(cy - r), x1 = Math.ceil(cx + r), y1 = Math.ceil(cy + r);
  const tiles = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 1) / 256); ty++) {
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 1) / 256); tx++) tiles.push({ x: tx, y: ty, url: tileUrl(layer, z, tx, ty) });
  }
  // 画像の左上と右上の画素が、図のどこに来るか
  const corner = (px, py) => {
    const q = pixelToLonLat(px, py, z);
    return latLngToWorld(geo, q.lat, q.lng);
  };
  const tl = corner(x0, y0), tr = corner(x1, y0), bl = corner(x0, y1);
  const w = x1 - x0, h = y1 - y0;
  const dx = tr[0] - tl[0], dy = tr[1] - tl[1];
  const s = Math.hypot(dx, dy) / w;
  // 地理院タイル（EPSG:3857）は楕円体の上では等角でなく、南北の 1 画素が東西より少し短い。
  return {
    z, tiles, w, h, origin: [x0, y0],
    place: { x: tl[0], y: tl[1], s, k: Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) / h / s, rot: (Math.atan2(dy, dx) * 180) / Math.PI },
    name: `地理院地図（${GSI_LAYERS[layer].label}）`,
  };
}

// タイルを取って一枚の JPEG にする（ブラウザでだけ使う）。
export async function fetchGsi(plan) {
  const canvas = document.createElement('canvas');
  canvas.width = plan.w;
  canvas.height = plan.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, plan.w, plan.h);
  let got = 0;
  await Promise.all(plan.tiles.map(async (t) => {
    try {
      const res = await fetch(t.url, { mode: 'cors' });
      if (!res.ok) return;
      const bmp = await createImageBitmap(await res.blob());
      ctx.drawImage(bmp, t.x * 256 - plan.origin[0], t.y * 256 - plan.origin[1]);
      bmp.close?.();
      got++;
    } catch {
      // 取れなかったタイルは白いまま
    }
  }));
  if (!got) throw new Error('地理院タイルを取れませんでした（電波を確かめてください）');
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('画像を作れませんでした'))), 'image/jpeg', 0.88));
  return { blob, got, total: plan.tiles.length };
}
