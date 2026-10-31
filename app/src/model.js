// 図の正本となるデータの形と、その操作。
// 部材ごとに通し番号（id）と更新時刻（updatedAt）を持たせ、消した部材も
// deleted で残す。これで二台の端末の図を部材単位で突き合わせられる。

import { dist, areaWithArcs, lengthWithArcs, rotatePts, mirrorPts, segCount } from './geometry.js';

export const FORMAT = 'nawabari';
export const FORMAT_VERSION = 1;

// 画層は描く順（下から上）。
export const LAYERS = ['敷地', '建物', '舗装', '植栽', '石', '構造物', '注記'];

// geom: polygon（面）/ polyline（線）/ circle（中心と半径）/ point / dim（寸法）/ text
export const KINDS = {
  shikichi: { label: '敷地境界', layer: '敷地', geom: 'polygon', props: {} },
  tatemono: { label: '建物', layer: '建物', geom: 'polygon', props: { 名前: '' } },
  hoso: {
    label: '舗装', layer: '舗装', geom: 'polygon',
    props: { 材料: '土間コンクリート', 天端: '' },
    choices: { 材料: ['土間コンクリート', '洗い出し', 'インターロッキング', '平板', '砂利', '芝', 'ウッドデッキ'] },
  },
  shokusaitai: { label: '植栽帯', layer: '植栽', geom: 'polygon', props: { 内容: '' } },
  keiseki: { label: '景石', layer: '石', geom: 'polygon', props: { 石種: '', 天端: '' } },
  enseki: { label: '縁石・見切', layer: '構造物', geom: 'polyline', props: { 種類: '' } },
  hei: { label: '塀・擁壁', layer: '構造物', geom: 'polyline', props: { 種類: 'ブロック塀', 高さ: 1200 } },
  jumoku: { label: '樹木', layer: '植栽', geom: 'circle', props: { 樹種: '', 樹高: 2500 } },
  takasa: { label: '高さ点', layer: '注記', geom: 'point', props: { 区分: '現況', 高さ: 0 }, choices: { 区分: ['現況', '計画'] } },
  sunpo: { label: '寸法', layer: '注記', geom: 'dim', props: {} },
  moji: { label: '文字', layer: '注記', geom: 'text', props: { 文字: '文字' } },
};

// 数値として扱う属性（入力欄を数値にし、読み込み時に数へ直す）。単位は mm。
export const NUMERIC_PROPS = new Set(['高さ', '樹高', '天端']);

export const DEFAULT_TREE_RADIUS = 750;

export const now = () => new Date().toISOString();

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createDoc({ siteId = '', siteName = '' } = {}) {
  const t = now();
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: newId(),
    siteId,
    siteName,
    createdAt: t,
    updatedAt: t,
    settings: { grid: 100, gridOn: true, hiddenLayers: [] },
    elements: [],
    underlays: [],
  };
}

// 下図の置き方。画像そのものは blob（中身の指紋）で引く。
export function createUnderlay({ name, blob, mime, w, h, x = 0, y = 0, s = 1, rot = 0, paperMmPerPx = null }) {
  return {
    id: newId(), name, blob, mime, w, h, x, y, s, rot, paperMmPerPx,
    opacity: 0.6, visible: true, updatedAt: now(),
  };
}

export const liveUnderlays = (doc) => (doc.underlays || []).filter((u) => !u.deleted);

export function createElement(kind, pts, extra = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error('知らない部材の種類: ' + kind);
  const el = {
    id: newId(),
    kind,
    pts: pts.map((p) => [round(p[0]), round(p[1])]),
    props: { ...def.props, ...(extra.props || {}) },
    updatedAt: now(),
  };
  if (def.geom === 'circle') el.r = round(extra.r ?? DEFAULT_TREE_RADIUS);
  return el;
}

// 0.1 mm より細かい値は持たない（ファイルを読みやすく保つ）。
export const round = (v) => Math.round(v * 10) / 10;

export const live = (doc) => doc.elements.filter((e) => !e.deleted);

export const layerOf = (el) => KINDS[el.kind]?.layer ?? '注記';

// 描く順（下から上）。面 → 線 → 樹木 → 注記。同じ種類の中では描いた順。
const DRAW_ORDER = Object.keys(KINDS);

export function sortedForDraw(elements) {
  return elements
    .map((e, i) => ({ e, i }))
    .sort((a, b) => DRAW_ORDER.indexOf(a.e.kind) - DRAW_ORDER.indexOf(b.e.kind) || a.i - b.i)
    .map((x) => x.e);
}

export function touch(el, t = now()) {
  el.updatedAt = t;
  return el;
}

// 消した印。部材は形を空にして種類だけ残す。下図は id だけ残す。
export function tombstone(el, t = now()) {
  if (!el.kind) return { id: el.id, deleted: true, updatedAt: t };
  return { id: el.id, kind: el.kind, pts: [], props: {}, deleted: true, updatedAt: t };
}

const sameContent = (a, b) => {
  const strip = ({ updatedAt, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

// 元に戻す・やり直しで target の状態へ移る。消えた部材は tombstone に、
// 中身の変わった部材は時刻を今に更新する（同期で古い版に負けないように）。
export function applySnapshot(currentEls, targetEls, t = now()) {
  const target = new Map(targetEls.map((e) => [e.id, e]));
  const result = [];
  for (const cur of currentEls) {
    const tg = target.get(cur.id);
    if (!tg) {
      result.push(cur.deleted ? cur : tombstone(cur, t));
    } else {
      const copy = structuredClone(tg);
      if (!sameContent(copy, cur)) copy.updatedAt = t;
      result.push(copy);
      target.delete(cur.id);
    }
  }
  for (const tg of target.values()) result.push({ ...structuredClone(tg), updatedAt: t });
  return result;
}

// 二つの並びを id ごとに合わせる。新しい時刻の方を採り、
// 時刻が同じで中身が違うときは incoming を採る。
function mergeList(localList = [], incomingList = []) {
  const byId = new Map(localList.map((e) => [e.id, e]));
  const order = localList.map((e) => e.id);
  let changed = 0;
  for (const inc of incomingList) {
    const loc = byId.get(inc.id);
    if (!loc) {
      byId.set(inc.id, inc);
      order.push(inc.id);
      changed++;
    } else if (inc.updatedAt > loc.updatedAt || (inc.updatedAt === loc.updatedAt && !sameContent(inc, loc))) {
      byId.set(inc.id, inc);
      changed++;
    }
  }
  return { list: order.map((id) => structuredClone(byId.get(id))), changed };
}

// 同じ現場の二つの版を、部材・下図の単位で合わせる。
export function mergeDocs(local, incoming) {
  if (local.id !== incoming.id) throw new Error('別の図どうしは合わせられません');
  const els = mergeList(local.elements, incoming.elements);
  const uls = mergeList(local.underlays, incoming.underlays);
  const changed = els.changed + uls.changed;
  const metaFrom = incoming.updatedAt > local.updatedAt ? incoming : local;
  const merged = {
    ...local,
    siteId: metaFrom.siteId,
    siteName: metaFrom.siteName,
    settings: { ...local.settings, ...metaFrom.settings },
    createdAt: local.createdAt < incoming.createdAt ? local.createdAt : incoming.createdAt,
    updatedAt: local.updatedAt > incoming.updatedAt ? local.updatedAt : incoming.updatedAt,
    elements: els.list,
    underlays: uls.list,
  };
  return { doc: merged, changed };
}

// 読み込んだデータを確かめ、足りない項目を補う。壊れていれば例外。
export function normalizeDoc(raw) {
  if (!raw || raw.format !== FORMAT) throw new Error('縄張り台の図ではありません');
  if (raw.version > FORMAT_VERSION) throw new Error(`新しい版（${raw.version}）の図です。アプリを更新してください`);
  if (typeof raw.id !== 'string' || !Array.isArray(raw.elements)) throw new Error('図のデータが壊れています');
  const base = createDoc();
  const doc = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  doc.elements = raw.elements
    .filter((e) => e && typeof e.id === 'string' && KINDS[e.kind])
    .map((e) => {
      if (e.deleted) return { ...e, pts: [], props: {} };
      const props = { ...KINDS[e.kind].props, ...(e.props || {}) };
      for (const k of Object.keys(props)) if (NUMERIC_PROPS.has(k) && props[k] !== '') props[k] = Number(props[k]) || 0;
      const out = { ...e, pts: (e.pts || []).map((p) => [Number(p[0]), Number(p[1])]), props, updatedAt: e.updatedAt || doc.updatedAt };
      const g = KINDS[e.kind].geom;
      if (Array.isArray(e.b) && (g === 'polygon' || g === 'polyline')) {
        const m = segCount(out.pts, g === 'polygon');
        out.b = Array.from({ length: m }, (_, i) => Number(e.b[i]) || 0);
        if (!out.b.some((v) => v)) delete out.b;
      } else delete out.b;
      return out;
    });
  doc.underlays = (Array.isArray(raw.underlays) ? raw.underlays : [])
    .filter((u) => u && typeof u.id === 'string' && (u.deleted || (typeof u.blob === 'string' && u.w > 0 && u.h > 0 && u.s > 0)))
    .map((u) => (u.deleted ? { id: u.id, deleted: true, updatedAt: u.updatedAt || doc.updatedAt } : {
      ...u,
      x: Number(u.x) || 0, y: Number(u.y) || 0, s: Number(u.s), rot: Number(u.rot) || 0,
      opacity: u.opacity >= 0 && u.opacity <= 1 ? Number(u.opacity) : 0.6,
      visible: u.visible !== false,
      updatedAt: u.updatedAt || doc.updatedAt,
    }));
  return doc;
}

export function measure(el) {
  const g = KINDS[el.kind].geom;
  if (g === 'polygon') return { area: areaWithArcs(el.pts, el.b), perimeter: lengthWithArcs(el.pts, el.b, true) };
  if (g === 'polyline') return { length: lengthWithArcs(el.pts, el.b) };
  if (g === 'dim') return { length: el.pts.length >= 2 ? dist(el.pts[0], el.pts[1]) : 0 };
  if (g === 'circle') return { diameter: el.r * 2 };
  return {};
}

// 数量表。面は m²、線は m、樹木・景石は数。
export function quantities(doc) {
  const rows = new Map();
  const add = (key, label, unit, v) => {
    const r = rows.get(key) || { label, unit, value: 0, count: 0 };
    r.value += v;
    r.count += 1;
    rows.set(key, r);
  };
  for (const el of live(doc)) {
    const def = KINDS[el.kind];
    const m = measure(el);
    switch (el.kind) {
      case 'shikichi': add('shikichi', '敷地', 'm²', m.area / 1e6); break;
      case 'tatemono': add('tatemono', '建物', 'm²', m.area / 1e6); break;
      case 'hoso': add('hoso:' + el.props.材料, `舗装　${el.props.材料 || '材料未定'}`, 'm²', m.area / 1e6); break;
      case 'shokusaitai': add('shokusaitai', '植栽帯', 'm²', m.area / 1e6); break;
      case 'keiseki': add('keiseki', '景石', '石', 1); break;
      case 'hei': add('hei:' + el.props.種類, `${def.label}　${el.props.種類 || '種類未定'}`, 'm', m.length / 1000); break;
      case 'enseki': add('enseki:' + el.props.種類, `${def.label}　${el.props.種類 || '種類未定'}`, 'm', m.length / 1000); break;
      case 'jumoku': add('jumoku:' + el.props.樹種, `樹木　${el.props.樹種 || '樹種未定'}`, '本', 1); break;
      default: break;
    }
  }
  return [...rows.values()].map((r) => ({ ...r, value: r.unit === '石' || r.unit === '本' ? r.count : r.value }));
}

export function formatQty(r) {
  if (r.unit === 'm²') return r.value.toFixed(2);
  if (r.unit === 'm') return r.value.toFixed(2);
  return String(r.value);
}

// ---------- 部材の形を変える ----------

const hasBulges = (el) => Array.isArray(el.b) && el.b.some((v) => v);

export function moveElement(el, dx, dy) {
  return { ...el, pts: el.pts.map(([x, y]) => [round(x + dx), round(y + dy)]) };
}

export function rotateElement(el, center, deg) {
  return { ...el, pts: rotatePts(el.pts, center, deg).map(([x, y]) => [round(x), round(y)]) };
}

// 映すと辺の回る向きが逆になるので、ふくらみの符号も逆にする。
export function mirrorElement(el, center, axis) {
  const out = { ...el, pts: mirrorPts(el.pts, center, axis).map(([x, y]) => [round(x), round(y)]) };
  if (hasBulges(el)) out.b = el.b.map((v) => -v);
  return out;
}

// 頂点 i を消す。形が保てない（面は 3 点、線は 2 点を切る）ときは null。
export function removeVertex(el, i) {
  const g = KINDS[el.kind].geom;
  const min = g === 'polygon' ? 3 : g === 'polyline' ? 2 : Infinity;
  if (el.pts.length - 1 < min) return null;
  const out = { ...el, pts: el.pts.filter((_, k) => k !== i) };
  if (hasBulges(el)) {
    // 消した頂点の前後の辺は一本の直線になる。
    const b = [...el.b];
    const prev = (i - 1 + el.pts.length) % el.pts.length;
    if (g === 'polygon') {
      b[prev] = 0;
      b.splice(i, 1);
    } else if (i === 0) b.splice(0, 1);
    else if (i === el.pts.length - 1) b.splice(i - 1, 1);
    else {
      b[i - 1] = 0;
      b.splice(i, 1);
    }
    out.b = b;
    if (!out.b.some((v) => v)) delete out.b;
  }
  return out;
}

// 辺 i の後ろに頂点を足す。分けた二本の辺は直線にする。
export function insertVertex(el, i, p) {
  const out = { ...el, pts: [...el.pts.slice(0, i + 1), [round(p[0]), round(p[1])], ...el.pts.slice(i + 1)] };
  if (hasBulges(el)) {
    const b = [...el.b];
    b.splice(i, 1, 0, 0);
    out.b = b;
    if (!out.b.some((v) => v)) delete out.b;
  }
  return out;
}

export function setBulge(el, i, v) {
  const g = KINDS[el.kind].geom;
  const m = segCount(el.pts, g === 'polygon');
  const b = Array.from({ length: m }, (_, k) => (el.b && el.b[k]) || 0);
  b[i] = Math.round(v * 1e4) / 1e4;
  const out = { ...el, b };
  if (!b.some((x) => x)) delete out.b;
  return out;
}
