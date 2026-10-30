// 平面直角座標（測量の座標）。X は北、Y は東、単位は m。
// 図は mm・y 下向きなので、図の (x, y) = ((Y − Y0)·1000, −(X − X0)·1000)。原点 (X0, Y0) は図ごとに覚える。

export const ZONES = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX'];

const toHalf = (s) => s
  .replace(/[０-９．－＋，]/g, (c) => ({ '．': '.', '－': '-', '＋': '+', '，': ',' })[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/[−‐―ー]/g, (c, i, str) => (/[\d.]/.test(str[i + 1] || '') ? '-' : c)); // 数の前の長音・ダッシュはマイナスとみなす

// 「K1 -12345.678 23456.789」「-12345.678,23456.789」などを読む。一行一点。
// 数が二つ以上ある行は、最後の二つを X・Y とし、前の部分を点名とする。
export function parseCoordText(text) {
  const out = [];
  const skipped = [];
  String(text).split(/\r?\n/).forEach((raw, lineNo) => {
    const line = toHalf(raw).trim();
    if (!line) return;
    const tokens = line.split(/[\s,\t]+/).filter(Boolean);
    const nums = [];
    for (let i = tokens.length - 1; i >= 0 && nums.length < 2; i--) {
      if (/^[-+]?\d+(\.\d+)?$/.test(tokens[i])) nums.unshift({ i, v: Number(tokens[i]) });
      else break;
    }
    if (nums.length < 2) {
      skipped.push(lineNo + 1);
      return;
    }
    const name = tokens.slice(0, nums[0].i).join(' ') || `P${out.length + 1}`;
    out.push({ name, X: nums[0].v, Y: nums[1].v });
  });
  return { points: out, skipped };
}

// 原点は最初の点を m 単位に丸めた所（図の数が大きくなりすぎないように）。
export const originFor = (points) => [Math.round(points[0].X), Math.round(points[0].Y)];

export function toWorld(geo, X, Y) {
  const [X0, Y0] = geo.origin;
  return [Math.round((Y - Y0) * 1e4) / 10, Math.round(-(X - X0) * 1e4) / 10];
}

export function toSurvey(geo, [x, y]) {
  const [X0, Y0] = geo.origin;
  return { X: X0 - y / 1000, Y: Y0 + x / 1000 };
}

// 座標求積（m²）と辺の長さ（m）。
export function coordArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    s += a.X * b.Y - b.X * a.Y;
  }
  return Math.abs(s) / 2;
}

export function edgeLengths(points, closed = true) {
  const out = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    out.push({ from: a.name, to: b.name, length: Math.hypot(b.X - a.X, b.Y - a.Y) });
  }
  return out;
}

export const fmtCoord = (v) => v.toFixed(3);

// DXF を測量座標（mm、東が x・北が y）で書き出すためのずらし。
export const dxfOffset = (geo) => [geo.origin[1] * 1000, geo.origin[0] * 1000];
