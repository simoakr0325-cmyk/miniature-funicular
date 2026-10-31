// 縄張り台：画面と操作。

import {
  KINDS, LAYERS, NUMERIC_PROPS, createDoc, createElement, live, sortedForDraw, applySnapshot,
  mergeDocs, normalizeDoc, measure, quantities, formatQty, now, round, touch, tombstone, newId,
  createUnderlay, liveUnderlays, moveElement, rotateElement, mirrorElement, removeVertex, insertVertex, setBulge,
} from './model.js';
import { dist, orthoConstrain, pointAtDistance, rectFromCorners, bbox } from './geometry.js';
import { makeView, renderScene, renderOverlay, handlesOf, syncUnderlays } from './render.js';
import * as UL from './underlay.js';
import { geometryMarkup, snapPointsOf } from './dxfread.js';
import * as SH from './sheet.js';
import { plotSheet, plotSheets } from './plot.js';
import { buildDxf, dxfFileName } from './dxf.js';
import * as SV from './survey.js';
import { pointInPolygon, bulgeThrough, densify } from './geometry.js';
import { hitElement, findSnap, elementsInBox } from './hit.js';
import * as store from './storage.js';
import * as vault from './vault.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const ulG = $('underlays');
const sceneG = $('scene');
const overlayG = $('overlay');

const TOOLS = [
  { id: 'select', label: '選ぶ', key: 'V' },
  { id: 'shikichi' }, { id: 'tatemono' }, { id: 'hoso' }, { id: 'shokusaitai' }, { id: 'jumoku' },
  { id: 'keiseki' }, { id: 'hei' }, { id: 'enseki' }, { id: 'takasa' }, { id: 'sunpo' }, { id: 'moji' },
  { id: 'coord', label: '座標', action: true, title: '座標で入力（平面直角座標）' },
  { id: 'underlay', label: '下図', action: true, title: '下図を敷く（測量図 PDF・写真）' },
];

const HINTS = {
  polygon: '角を順に押す。最初の点か Enter で閉じる',
  rect: '向かい合う二つの角を押す',
  polyline: '点を順に押す。Enter かダブルクリックで終わる',
  circle: '幹の位置を押す',
  point: '位置を押して、右で高さを入れる',
  dim: '始点・終点を押し、最後に寸法線の位置を押す',
  text: '置く位置を押す',
};

const state = {
  doc: createDoc(),
  tool: 'select',
  shape: 'poly',
  draft: null,
  sel: [], // 選んでいる部材の id
  vsel: null, // 選んでいる頂点 { id, i }
  bend: false, // 辺の丸を引くと、頂点を足さずに辺を曲げる
  box: null, // 範囲選択の枠（画面の px）
  snap: null,
  lastTreeR: 750,
  ulMode: null, // 下図の調整中：{ type: 'move' | 'length' | 'align', id, pts }
  sheetMode: false, // 図面の枠を決めている間
};
const blobUrls = new Map();
let view = { cx: 0, cy: 0, scale: 0.1 };
let undoStack = [];
let redoStack = [];

// ---------- 表示 ----------

function currentView() {
  const r = svg.getBoundingClientRect();
  return makeView(view.cx, view.cy, view.scale, r.width, r.height);
}

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const v = currentView();
    syncUnderlays(ulG, liveUnderlays(state.doc), v, blobUrls, state.ulMode?.id);
    sceneG.innerHTML = renderScene(state, v);
    overlayG.innerHTML = sheetOverlay(v) + renderOverlay(state, v) + ulOverlay(v);
    $('empty-hint').hidden = live(state.doc).length > 0 || liveUnderlays(state.doc).length > 0 || !!state.draft || !!state.ulMode || state.sheetMode;
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  });
}

function renderOverlayOnly() {
  const v = currentView();
  overlayG.innerHTML = sheetOverlay(v) + renderOverlay(state, v) + ulOverlay(v);
}

// 図面の枠。枠の外を薄く覆い、表題欄の所を示す。
function sheetOverlay(v) {
  if (!state.sheetMode) return '';
  const { frame, title } = SH.worldRects(SH.sheetOf(state.doc));
  const pts = (ps) => ps.map((p) => v.toS(p).map((n) => Math.round(n * 10) / 10).join(',')).join(' ');
  const f = frame.map((p) => v.toS(p));
  const mask = `M-99999 -99999H99999V99999H-99999Z M${f.map((p) => p.join(' ')).join('L')}Z`;
  const cur = SH.sheetIndexOf(state.doc);
  const others = SH.sheetsOf(state.doc).map((_, i) => {
    if (i === cur) return '';
    const sh = SH.sheetOf(state.doc, i);
    const fr = SH.worldRects(sh).frame;
    const [x, y] = v.toS(fr[0]);
    return `<polygon class="sheet-other" points="${pts(fr)}"/><text class="lbl sheet-other-no" x="${Math.round(x + 6)}" y="${Math.round(y + 16)}">${i + 1}. ${escapeHtml(sh.title || '図面')}</text>`;
  }).join('');
  return `${others}<path class="sheet-mask" fill-rule="evenodd" d="${mask}"/>
    <polygon class="sheet-frame" points="${pts(frame)}"/>
    <polygon class="sheet-title" points="${pts(title)}"/>`;
}

// 下図を合わせるときに押した点。下図の上の点は〇、図の上の点は□。
function ulOverlay(v) {
  const m = state.ulMode;
  if (!m || !m.pts.length) return '';
  const out = [];
  m.pts.forEach((p, i) => {
    const [x, y] = v.toS(p).map((n) => Math.round(n * 10) / 10);
    const onImage = m.type === 'length' || i % 2 === 0;
    out.push(onImage
      ? `<circle class="ul-pick" cx="${x}" cy="${y}" r="7"/><path class="ul-pick" d="M${x - 11} ${y}H${x + 11}M${x} ${y - 11}V${y + 11}"/>`
      : `<rect class="ul-pick target" x="${x - 7}" y="${y - 7}" width="14" height="14"/>`);
    out.push(`<text class="lbl ul-pick-no" x="${x + 12}" y="${y - 10}">${m.type === 'length' ? i + 1 : ['A', 'A′', 'B', 'B′'][i]}</text>`);
  });
  if (m.type === 'length' && m.pts.length === 2) {
    const [a, b] = m.pts.map((p) => v.toS(p));
    out.push(`<path class="ul-pick" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/>`);
  }
  if (m.type === 'align') {
    for (let i = 0; i + 1 < m.pts.length; i += 2) {
      const [a, b] = [m.pts[i], m.pts[i + 1]].map((p) => v.toS(p));
      out.push(`<path class="ul-pick dashed" d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}"/>`);
    }
  }
  return out.join('');
}

function fitView() {
  const els = live(state.doc);
  const pts = els.flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
  for (const u of liveUnderlays(state.doc)) if (u.visible) pts.push(...UL.corners(u));
  const r = svg.getBoundingClientRect();
  if (!pts.length) {
    view = { cx: 6000, cy: 4500, scale: Math.min(r.width / 16000, r.height / 12000) || 0.05 };
  } else {
    const b = bbox(pts);
    const w = Math.max(b.x1 - b.x0, 1000), h = Math.max(b.y1 - b.y0, 1000);
    view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.min((r.width - 80) / w, (r.height - 80) / h) };
  }
  render();
}

function zoomAt(sp, factor) {
  const v = currentView();
  const w = v.toW(sp);
  const scale = Math.min(Math.max(view.scale * factor, 0.002), 20);
  view.scale = scale;
  // 指した点が画面上で動かないように中心をずらす。
  view.cx = w[0] - (sp[0] - v.w / 2) / scale;
  view.cy = w[1] - (sp[1] - v.h / 2) / scale;
  render();
}

// ---------- 編集と履歴 ----------

const byId = (id) => state.doc.elements.find((e) => e.id === id && !e.deleted);
const ulById = (id) => state.doc.underlays.find((u) => u.id === id && !u.deleted);

// 履歴は部材と下図をまとめて持つ。
const snapshot = () => structuredClone({ elements: state.doc.elements, underlays: state.doc.underlays });
function restore(snap) {
  state.doc.elements = snap.elements;
  state.doc.underlays = snap.underlays;
}
function moveTo(target) {
  state.doc.elements = applySnapshot(state.doc.elements, target.elements);
  state.doc.underlays = applySnapshot(state.doc.underlays, target.underlays);
}

function pushHistory(before) {
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

function changed({ panel = true } = {}) {
  state.doc.updatedAt = now();
  scheduleSave();
  render();
  if (panel) renderPanel();
}

function commit(fn, opts) {
  const before = snapshot();
  fn();
  pushHistory(before);
  changed(opts);
}

function undo() {
  if (!undoStack.length) return;
  cancelDraft();
  exitUlMode();
  redoStack.push(snapshot());
  moveTo(undoStack.pop());
  pruneSelection();
  changed();
}

function redo() {
  if (!redoStack.length) return;
  exitUlMode();
  undoStack.push(snapshot());
  moveTo(redoStack.pop());
  pruneSelection();
  changed();
}

function addElement(el) {
  commit(() => state.doc.elements.push(el));
  select(el.id);
}

const selectedEls = () => state.sel.map(byId).filter(Boolean);

function pruneSelection() {
  state.sel = state.sel.filter((id) => byId(id));
  if (state.vsel && (!byId(state.vsel.id) || state.vsel.i >= byId(state.vsel.id).pts.length)) state.vsel = null;
}

// 部材を差し替える（同じ id の新しい中身へ）。
function replaceEl(next) {
  const i = state.doc.elements.findIndex((e) => e.id === next.id);
  state.doc.elements[i] = touch(next);
  return state.doc.elements[i];
}

function deleteSelected() {
  if (state.vsel) return deleteVertex();
  const els = selectedEls();
  if (!els.length) return;
  commit(() => {
    for (const el of els) state.doc.elements[state.doc.elements.indexOf(el)] = tombstone(el);
    state.sel = [];
  });
}

function deleteVertex() {
  const { id, i } = state.vsel;
  const el = byId(id);
  const next = el && removeVertex(el, i);
  if (!next) return toast('これ以上頂点を減らすと形が保てません');
  state.vsel = null;
  commit(() => replaceEl(next));
}

function duplicateSelected() {
  const els = selectedEls();
  if (!els.length) return;
  const off = state.doc.settings.grid * 5;
  const copies = els.map((el) => ({ ...moveElement(structuredClone(el), off, off), id: newId(), updatedAt: now() }));
  commit(() => state.doc.elements.push(...copies));
  select(copies.map((c) => c.id));
}

// 選んだ部材の真ん中（回す・映す軸）。
function selectionCenter(els) {
  const pts = els.flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
  const b = bbox(pts);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

function transformSelected(fn) {
  const els = selectedEls();
  if (!els.length) return;
  const c = selectionCenter(els);
  commit(() => els.forEach((el) => replaceEl(fn(el, c))));
}

const rotateSelected = (deg) => transformSelected((el, c) => rotateElement(el, c, deg));
const mirrorSelected = (axis) => transformSelected((el, c) => mirrorElement(el, c, axis));

// id（一つか配列）を選ぶ。add なら今の選択に足し引きする。
function select(ids, { add = false } = {}) {
  const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
  if (add) {
    const set = new Set(state.sel);
    for (const id of list) set.has(id) ? set.delete(id) : set.add(id);
    state.sel = [...set];
  } else state.sel = list;
  state.vsel = null;
  render();
  renderPanel();
}

// ---------- 道具 ----------

function geomOf(kind) {
  return KINDS[kind].geom;
}

function setTool(id) {
  exitUlMode();
  exitSheetMode();
  state.draft = null;
  cancelDraft();
  state.tool = id;
  if (id !== 'select') state.draft = { kind: id, pts: [], cursor: null, shape: geomOf(id) === 'polygon' ? state.shape : 'poly' };
  for (const b of $('tools').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
  updateCmd();
  render();
}

function cancelDraft() {
  if (state.draft) state.draft = state.tool === 'select' ? null : { ...state.draft, pts: [], cursor: null };
  state.snap = null;
  $('len').value = '';
  updateCmd();
  render();
}

function updateCmd() {
  if (state.sheetMode) return updateSheetCmd();
  if (state.ulMode) return updateUlCmd();
  $('cmd-done').textContent = '確定';
  $('cmd-cancel').textContent = '取消';
  $('len').placeholder = '長さ mm';
  const d = state.draft;
  $('cmd').hidden = !d;
  if (!d) return;
  const g = geomOf(d.kind);
  $('cmd-hint').textContent = `${KINDS[d.kind].label}：${HINTS[g === 'polygon' && d.shape === 'rect' ? 'rect' : g]}`;
  $('shape-switch').hidden = g !== 'polygon';
  for (const b of $('shape-switch').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.shape === d.shape));
  const multi = (g === 'polygon' && d.shape === 'poly') || g === 'polyline';
  $('cmd-done').hidden = !multi;
  $('cmd-done').disabled = d.pts.length < (g === 'polygon' ? 3 : 2);
  $('len').closest('label').hidden = !(multi || g === 'dim' || (g === 'polygon' && d.shape === 'rect'));
  $('cmd-cancel').hidden = !d.pts.length;
}

function placePoint(p) {
  const d = state.draft;
  if (!d) return;
  const g = geomOf(d.kind);
  p = [round(p[0]), round(p[1])];
  if (g === 'circle') {
    addElement(createElement(d.kind, [p], { r: state.lastTreeR }));
    return;
  }
  if (g === 'point' || g === 'text') {
    addElement(createElement(d.kind, [p]));
    focusFirstField();
    return;
  }
  if (g === 'polygon' && d.pts.length >= 3 && dist(p, d.pts[0]) < 1e-6) {
    finishDraft();
    return;
  }
  if (d.pts.length && dist(p, d.pts.at(-1)) < 1e-6) return;
  d.pts.push(p);
  if (g === 'polygon' && d.shape === 'rect' && d.pts.length === 2) {
    d.pts = rectFromCorners(d.pts[0], d.pts[1]);
    finishDraft();
    return;
  }
  if (g === 'dim' && d.pts.length === 3) {
    finishDraft();
    return;
  }
  updateCmd();
  render();
}

function finishDraft() {
  const d = state.draft;
  if (!d) return;
  const g = geomOf(d.kind);
  const need = g === 'polygon' ? 3 : 2;
  if (d.pts.length >= need) {
    const el = createElement(d.kind, d.pts);
    d.pts = [];
    d.cursor = null;
    addElement(el);
  }
  updateCmd();
  render();
}

// 「3000」または「3000,90」（長さ mm, 角度°・東から左回り）で次の点を打つ。
function placeByLength(text) {
  const d = state.draft;
  if (!d || !d.pts.length) return false;
  const m = text.trim().replace(/[，、]/g, ',').replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).match(/^(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?$/);
  if (!m) return false;
  const len = Number(m[1]);
  const last = d.pts.at(-1);
  let p;
  if (m[2] !== undefined) {
    const a = (Number(m[2]) * Math.PI) / 180;
    p = [last[0] + Math.cos(a) * len, last[1] - Math.sin(a) * len];
  } else {
    const toward = d.cursor && dist(d.cursor, last) > 1e-6 ? d.cursor : d.pts.length >= 2 ? pointAtDistance(d.pts.at(-2), last, dist(d.pts.at(-2), last) + 1) : [last[0] + 1, last[1]];
    p = pointAtDistance(last, toward, len);
  }
  placePoint(p);
  return true;
}

// ---------- ポインタ ----------

const pointers = new Map();
let gesture = null;
let spaceDown = false;

const spOf = (e) => {
  const r = svg.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

const visibleEls = () => sortedForDraw(live(state.doc)).filter((x) => !(state.doc.settings.hiddenLayers || []).includes(KINDS[x.kind].layer));

function snapAt(sp, e, exclude) {
  const d = state.draft;
  const s = e.altKey
    ? { p: currentView().toW(sp), type: 'free' }
    : findSnap(live(state.doc), currentView(), sp, {
        grid: state.doc.settings.grid,
        gridOn: state.doc.settings.gridOn,
        extra: d ? [...d.pts, ...underlaySnapPoints()] : underlaySnapPoints(),
        exclude,
      });
  if (e.shiftKey && d && d.pts.length && s.type !== 'vertex') s.p = orthoConstrain(d.pts.at(-1), s.p);
  return s;
}

svg.addEventListener('pointerdown', (e) => {
  svg.setPointerCapture(e.pointerId);
  const sp = spOf(e);
  pointers.set(e.pointerId, sp);
  if (pointers.size === 2) {
    clearTimeout(gesture?.hold);
    if (gesture?.type === 'box') state.box = null;
    if (gesture?.before) {
      restore(gesture.before);
      render();
    }
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', d0: dist(a, b), mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view0: { ...view } };
    return;
  }
  if (pointers.size > 2) return;
  const v = currentView();
  if (e.button === 1 || e.button === 2 || spaceDown) {
    gesture = { type: 'pan', start: sp, view0: { ...view } };
    return;
  }
  if (e.button !== 0) return;
  if (state.sheetMode) {
    const w = v.toW(sp);
    if (!pointInPolygon(w, SH.worldRects(SH.sheetOf(state.doc)).frame)) {
      // ほかの図面の枠の中を押したら、その図面に切り替える。
      const j = SH.sheetsOf(state.doc).findIndex((_, i) => pointInPolygon(w, SH.worldRects(SH.sheetOf(state.doc, i)).frame));
      if (j >= 0) {
        state.doc.settings.sheetIndex = j;
        changed();
      }
    }
    const { frame } = SH.worldRects(SH.sheetOf(state.doc));
    const sh = SH.sheetOf(state.doc);
    gesture = pointInPolygon(w, frame)
      ? { type: 'sheetmove', start: sp, orig: [sh.cx, sh.cy], moved: false }
      : { type: 'pan', start: sp, view0: { ...view } };
    return;
  }
  if (state.ulMode) {
    const ul = ulById(state.ulMode.id);
    gesture = state.ulMode.type === 'move' && ul
      ? { type: 'ulmove', start: sp, orig: { ...ul }, before: snapshot(), moved: false }
      : { type: 'place', start: sp, view0: { ...view } };
    return;
  }
  if (state.tool === 'select') {
    const sel = state.sel.length === 1 && byId(state.sel[0]);
    if (sel) {
      const h = handlesOf(sel).find((h) => dist(v.toS(h.p), sp) <= (e.pointerType === 'touch' ? 16 : 9));
      if (h) {
        gesture = { type: 'vertex', el: sel, h, before: snapshot(), moved: false, start: sp, bend: h.mid && (state.bend || e.shiftKey) };
        return;
      }
    }
    const els = visibleEls();
    const hit = hitElement(els, v, sp, e.pointerType === 'touch' ? 14 : 8);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) select(hit.id, { add: true });
      else if (!state.sel.includes(hit.id)) select(hit.id);
      else if (state.vsel) { state.vsel = null; render(); }
      const group = selectedEls();
      if (!group.includes(hit)) return;
      gesture = { type: 'move', els: group, hitId: hit.id, keepGroup: e.shiftKey || e.ctrlKey || e.metaKey, startW: v.toW(sp), orig: group.map((g) => structuredClone(g)), before: snapshot(), moved: false, start: sp };
    } else if (e.pointerType === 'mouse') {
      gesture = { type: 'box', start: sp, add: e.shiftKey || e.ctrlKey || e.metaKey };
    } else {
      // 指：何もない所を引けば画面が動く。動かさずに長押しすると範囲選択になる。
      const g = { type: 'pan', start: sp, view0: { ...view }, clickClears: true };
      g.hold = setTimeout(() => {
        if (gesture !== g || pointers.size !== 1) return;
        view = g.view0;
        gesture = { type: 'box', start: sp, add: state.sel.length > 0, touch: true };
        state.box = [sp, sp];
        render();
        toast(state.sel.length ? '範囲で足す（引いて広げる）' : '範囲で選ぶ（引いて広げる）');
      }, 450);
      gesture = g;
    }
    return;
  }
  gesture = { type: 'place', start: sp, view0: { ...view } };
});

svg.addEventListener('pointermove', (e) => {
  const sp = spOf(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
  const v = currentView();
  if (gesture?.type === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const g = gesture;
    const scale = Math.min(Math.max(g.view0.scale * (dist(a, b) / (g.d0 || 1)), 0.002), 20);
    const v0 = makeView(g.view0.cx, g.view0.cy, g.view0.scale, v.w, v.h);
    const w = v0.toW(g.mid0);
    view = { scale, cx: w[0] - (mid[0] - v.w / 2) / scale, cy: w[1] - (mid[1] - v.h / 2) / scale };
    render();
    return;
  }
  if (gesture?.type === 'place' && dist(sp, gesture.start) > 6) {
    gesture = { type: 'pan', start: gesture.start, view0: gesture.view0 };
  }
  if (gesture?.type === 'pan') {
    view.cx = gesture.view0.cx - (sp[0] - gesture.start[0]) / view.scale;
    view.cy = gesture.view0.cy - (sp[1] - gesture.start[1]) / view.scale;
    if (dist(sp, gesture.start) > 4) gesture.clickClears = false;
    if (dist(sp, gesture.start) > 8) clearTimeout(gesture.hold);
    render();
    return;
  }
  if (gesture?.type === 'box') {
    if (dist(sp, gesture.start) < 4 && !state.box) return;
    state.box = [gesture.start, sp];
    renderOverlayOnly();
    return;
  }
  if (gesture?.type === 'sheetmove') {
    gesture.moved = true;
    const g = state.doc.settings.gridOn ? state.doc.settings.grid : 1;
    const snap = (val) => Math.round(val / g) * g;
    setSheet({
      cx: snap(gesture.orig[0] + (sp[0] - gesture.start[0]) / view.scale),
      cy: snap(gesture.orig[1] + (sp[1] - gesture.start[1]) / view.scale),
    }, { save: false });
    return;
  }
  if (gesture?.type === 'ulmove') {
    if (!gesture.moved && dist(sp, gesture.start) < 4) return;
    gesture.moved = true;
    const o = gesture.orig;
    const i = state.doc.underlays.findIndex((u) => u.id === o.id);
    state.doc.underlays[i] = UL.moveBy(o, (sp[0] - gesture.start[0]) / view.scale, (sp[1] - gesture.start[1]) / view.scale);
    render();
    return;
  }
  if (gesture?.type === 'move') {
    if (!gesture.moved && dist(sp, gesture.start) < 4) return;
    gesture.moved = true;
    const w = v.toW(sp);
    let dx = w[0] - gesture.startW[0], dy = w[1] - gesture.startW[1];
    if (state.doc.settings.gridOn && !e.altKey) {
      const g = state.doc.settings.grid;
      dx = Math.round(dx / g) * g;
      dy = Math.round(dy / g) * g;
    }
    gesture.els.forEach((el, k) => { el.pts = gesture.orig[k].pts.map((p) => [round(p[0] + dx), round(p[1] + dy)]); });
    render();
    return;
  }
  if (gesture?.type === 'vertex') {
    const { h } = gesture;
    if (!gesture.moved && dist(sp, gesture.start) < 4) return;
    const el = byId(gesture.el.id);
    const s = snapAt(sp, e, el.id);
    gesture.moved = true;
    if (h.radius) {
      el.r = Math.max(round(dist(el.pts[0], v.toW(sp))), 50);
    } else if (h.mid && gesture.bend) {
      // 辺を、指した点を通る弧にする。弦に近ければまっすぐに戻す。
      const n = el.pts.length;
      const a = el.pts[h.i], b = el.pts[(h.i + 1) % n];
      replaceEl(setBulge(el, h.i, bulgeThrough(a, b, v.toW(sp), 6 / view.scale)));
      state.snap = null;
      render();
      return;
    } else if (h.mid) {
      replaceEl(insertVertex(el, h.i, s.p));
      gesture.h = { i: h.i + 1 };
    } else {
      el.pts[h.i] = [round(s.p[0]), round(s.p[1])];
    }
    state.snap = s.type === 'vertex' ? s : null;
    render();
    return;
  }
  updateReadout(e.pointerType === 'touch' ? null : v.toW(sp));
  if (state.draft && !gesture && e.pointerType !== 'touch') {
    const s = snapAt(sp, e);
    state.draft.cursor = s.p;
    state.snap = s.type === 'free' ? null : s;
    updateReadout(v.toW(sp));
    renderOverlayOnly();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    if (pointers.size === 0) gesture = null;
    else gesture = { type: 'idle' };
    return;
  }
  if (pointers.size) return;
  clearTimeout(g.hold);
  gesture = null;
  if (e.type === 'pointercancel') {
    if (state.box) {
      state.box = null;
      renderOverlayOnly();
    }
    if (g.before) {
      restore(g.before);
      render();
    }
    return;
  }
  if (g.type === 'pan' && g.clickClears && state.sel.length) select(null);
  if (g.type === 'box') {
    let box = state.box;
    state.box = null;
    if (box && g.touch && dist(box[0], box[1]) < 8) {
      // 長押しして離しただけなら何もしない。
      renderOverlayOnly();
      box = null;
    } else if (!box) {
      if (!g.add && (state.sel.length || state.vsel)) select(null);
      else renderOverlayOnly();
    } else {
      const v = currentView();
      const [a, b] = [v.toW(box[0]), v.toW(box[1])];
      const hits = elementsInBox(visibleEls(), Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), box[1][0] < box[0][0]);
      const ids = hits.map((x) => x.id);
      select(g.add ? [...new Set([...state.sel, ...ids])] : ids);
    }
  }
  if (g.type === 'vertex' && !g.moved && !g.h.mid && !g.h.radius) {
    // 頂点を押しただけなら、その頂点を選ぶ（Delete で消せる）。
    state.vsel = { id: g.el.id, i: g.h.i };
    renderOverlayOnly();
    renderPanel();
  }
  if (g.type === 'sheetmove' && g.moved) setSheet({});
  if (g.type === 'ulmove' && g.moved) {
    touch(ulById(g.orig.id));
    pushHistory(g.before);
    changed();
  }
  if (g.type === 'move' && !g.moved && !g.keepGroup && state.sel.length > 1) select(g.hitId);
  if (g.type === 'move' && g.moved) {
    g.els.forEach((el) => touch(el));
    pushHistory(g.before);
    changed();
  }
  if (g.type === 'vertex' && g.moved) {
    const el = byId(g.el.id);
    touch(el);
    state.snap = null;
    if (el.r) state.lastTreeR = el.r;
    pushHistory(g.before);
    changed();
  }
  if (g.type === 'place' && state.ulMode) {
    ulPick(spOf(e), e);
  } else if (g.type === 'place') {
    const s = snapAt(spOf(e), e);
    state.snap = null;
    placePoint(s.p);
  }
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('pointerleave', () => {
  if (state.draft && !gesture) {
    state.draft.cursor = null;
    state.snap = null;
    renderOverlayOnly();
  }
});
svg.addEventListener('dblclick', (e) => {
  if (state.draft) {
    e.preventDefault();
    finishDraft();
  }
});
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = e.ctrlKey ? 0.01 : 0.0015;
  zoomAt(spOf(e), Math.exp(-e.deltaY * k));
}, { passive: false });
svg.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- キー ----------

const inField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    if (inField(e.target)) return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    if (inField(e.target)) return;
    e.preventDefault();
    redo();
    return;
  }
  if (e.target === $('len')) {
    if (e.key === 'Enter' && state.ulMode) {
      e.preventDefault();
      applyLengthCalibration($('len').value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = $('len').value;
      if (!t.trim()) finishDraft();
      else if (placeByLength(t)) $('len').value = '';
      else toast('「3000」または「3000,90」の形で入れてください');
    } else if (e.key === 'Escape') {
      $('len').value = '';
      $('len').blur();
    }
    return;
  }
  if (inField(e.target)) return;
  if (e.key === ' ') {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (state.draft && state.draft.pts.length && /^[0-9０-９]$/.test(e.key)) {
    $('len').focus();
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (mod && e.key.toLowerCase() === 'a' && state.tool === 'select') {
    e.preventDefault();
    select(visibleEls().map((x) => x.id));
    return;
  }
  if (mod) return;
  switch (e.key) {
    case 'Escape':
      if (state.sheetMode) exitSheetMode();
      else if (state.ulMode) exitUlMode();
      else if (state.draft?.pts.length) cancelDraft();
      else if (state.tool !== 'select') setTool('select');
      else if (state.vsel) { state.vsel = null; renderOverlayOnly(); renderPanel(); }
      else select(null);
      break;
    case 'Enter':
      finishDraft();
      break;
    case 'Backspace':
    case 'Delete':
      if (state.draft?.pts.length) {
        state.draft.pts.pop();
        updateCmd();
        render();
      } else deleteSelected();
      e.preventDefault();
      break;
    case 'v': case 'V': setTool('select'); break;
    case 'f': case 'F': fitView(); break;
    case 'g': case 'G':
      state.doc.settings.gridOn = !state.doc.settings.gridOn;
      changed();
      break;
    default:
      break;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
});

// ---------- 右の欄 ----------

const fmtLen = (mm) => (mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`);

function field(name, value, { numeric, choices, unit } = {}) {
  const id = 'f-' + name;
  let input;
  if (choices) {
    input = `<select id="${id}" data-prop="${name}">${choices.map((c) => `<option${c === value ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
  } else {
    input = `<input id="${id}" data-prop="${name}" type="text" ${numeric ? 'inputmode="decimal" data-num="1"' : ''} value="${String(value ?? '').replace(/"/g, '&quot;')}">`;
  }
  return `<label class="field" for="${id}"><span>${name}${unit ? `<small>${unit}</small>` : ''}</span>${input}</label>`;
}

function renderPanel() {
  const p = $('panel');
  if (state.sheetMode) return renderSheetPanel(p);
  const many = selectedEls();
  if (many.length > 1) return renderMultiPanel(p, many);
  const el = many[0];
  if (el) {
    const def = KINDS[el.kind];
    const m = measure(el);
    const fields = Object.entries(el.props).map(([k, v]) =>
      field(k, v, { numeric: NUMERIC_PROPS.has(k), choices: def.choices?.[k], unit: NUMERIC_PROPS.has(k) ? 'mm' : '' }));
    if (def.geom === 'circle') fields.push(field('葉張', el.r * 2, { numeric: true, unit: 'mm' }));
    const facts = [];
    if (m.area !== undefined) facts.push(['面積', `${(m.area / 1e6).toFixed(2)} m²`]);
    if (m.perimeter !== undefined) facts.push(['周長', fmtLen(m.perimeter)]);
    if (m.length !== undefined) facts.push(['長さ', fmtLen(m.length)]);
    const shaped = def.geom === 'polygon' || def.geom === 'polyline';
    if (shaped) facts.push(['頂点', `${el.pts.length}`]);
    const vsel = state.vsel && state.vsel.id === el.id ? state.vsel.i : null;
    p.innerHTML = `
      <section class="psec">
        <h2>${def.label}<small>${def.layer}</small></h2>
        <form id="props" class="fields" onsubmit="return false">${fields.join('')}</form>
        ${facts.length ? `<dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>` : ''}
        ${vsel !== null ? `<div class="vsel-box"><span>頂点 ${vsel + 1} を選んでいます</span><button type="button" id="p-vdel" class="danger">頂点を消す</button></div>` : ''}
        ${shaped ? `<p class="muted small">頂点の四角を引くと動き、押すと選べます（Delete で消す）。辺の丸を引くと${state.bend ? '辺が曲がります' : '頂点が増えます'}。</p>
        <div class="row">
          <button type="button" id="p-bend" aria-pressed="${state.bend}">辺を曲げる</button>
          ${el.b ? '<button type="button" id="p-straight">曲げを消す</button>' : ''}
        </div>` : ''}
        ${transformTools()}
        <div class="row">
          <button type="button" id="p-dup">複製</button>
          <button type="button" id="p-del" class="danger">削除</button>
          <button type="button" id="p-close">選択を外す</button>
        </div>
      </section>
      ${coordTable(el)}`;
    p.querySelector('#props').addEventListener('change', (ev) => {
      const t = ev.target;
      const name = t.dataset.prop;
      let val = t.value;
      if (t.dataset.num) {
        val = Number(val.replace(/[０-９．－]/g, (c) => (c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
        if (!Number.isFinite(val)) return toast('数で入れてください');
      }
      commit(() => {
        if (name === '葉張') {
          el.r = Math.max(round(val / 2), 50);
          state.lastTreeR = el.r;
        } else el.props[name] = val;
        touch(el);
      }, { panel: false });
    });
    $('p-dup').onclick = duplicateSelected;
    $('p-del').onclick = () => { state.vsel = null; deleteSelected(); };
    $('p-close').onclick = () => select(null);
    if ($('p-vdel')) $('p-vdel').onclick = deleteVertex;
    if ($('p-bend')) $('p-bend').onclick = () => { state.bend = !state.bend; renderPanel(); renderOverlayOnly(); };
    if ($('p-straight')) $('p-straight').onclick = () => commit(() => { const x = { ...el }; delete x.b; replaceEl(x); });
    bindTransformTools(p);
    if ($('p-copy-coords')) $('p-copy-coords').onclick = () => copyCoords(el);
    return;
  }
  const d = state.doc;
  const rows = quantities(d);
  const hidden = new Set(d.settings.hiddenLayers || []);
  p.innerHTML = `
    <section class="psec">
      <h2>現場</h2>
      <form id="site-form" class="fields" onsubmit="return false">
        ${field('現場ID', d.siteId)}
        ${field('現場名', d.siteName)}
      </form>
    </section>
    ${underlayPanel()}
    <section class="psec">
      <h2>数量</h2>
      ${rows.length ? `<table class="qty"><tbody>${rows.map((r) => `<tr><th>${r.label}</th><td>${formatQty(r)}</td><td>${r.unit}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">部材を描くとここに出ます。</p>'}
    </section>
    <section class="psec">
      <h2>方眼</h2>
      <div class="row">
        <label class="check"><input type="checkbox" id="grid-on" ${d.settings.gridOn ? 'checked' : ''}> 方眼に吸着</label>
        <select id="grid-step" aria-label="方眼の間隔">${[10, 50, 100, 250, 500, 1000].map((g) => `<option value="${g}"${g === d.settings.grid ? ' selected' : ''}>${g} mm</option>`).join('')}</select>
      </div>
      <p class="muted small">Alt を押しながらだと吸着しません。Shift で 45° 刻み。</p>
    </section>
    <section class="psec">
      <h2>画層</h2>
      <div class="layers">${LAYERS.map((l) => `<label class="check"><input type="checkbox" data-layer="${l}" ${hidden.has(l) ? '' : 'checked'}> ${l}</label>`).join('')}</div>
    </section>`;
  p.querySelector('#site-form').addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.prop === '現場ID') d.siteId = t.value.trim();
    if (t.dataset.prop === '現場名') d.siteName = t.value.trim();
    updateSiteLabel();
    changed({ panel: false });
  });
  bindUnderlayPanel(p);
  $('grid-on').onchange = (ev) => { d.settings.gridOn = ev.target.checked; changed({ panel: false }); };
  $('grid-step').onchange = (ev) => { d.settings.grid = Number(ev.target.value); changed({ panel: false }); };
  for (const cb of p.querySelectorAll('[data-layer]')) {
    cb.onchange = () => {
      const set = new Set(d.settings.hiddenLayers || []);
      cb.checked ? set.delete(cb.dataset.layer) : set.add(cb.dataset.layer);
      d.settings.hiddenLayers = [...set];
      changed({ panel: false });
    };
  }
}

function focusFirstField() {
  openPanelOnNarrow();
  requestAnimationFrame(() => {
    const f = $('panel').querySelector('#props input, #props select');
    f?.focus();
    f?.select?.();
  });
}

function openPanelOnNarrow() {
  if (matchMedia('(max-width: 760px)').matches) togglePanel(true);
}

function togglePanel(open) {
  const isOpen = open ?? !document.body.classList.contains('panel-open');
  document.body.classList.toggle('panel-open', isOpen);
  $('btn-panel').setAttribute('aria-expanded', String(isOpen));
  render();
}

function updateSiteLabel() {
  $('site-id').textContent = state.doc.siteId;
  $('site-name').textContent = state.doc.siteName || (state.doc.siteId ? '' : '無題の現場');
  document.title = `${state.doc.siteName || state.doc.siteId || '無題'}　縄張り台`;
}

// ---------- 保存 ----------

let saveTimer = 0;
function scheduleSave() {
  $('save-state').textContent = '保存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(saveTimer);
  try {
    await store.saveDoc(state.doc);
    await store.setKV('lastDoc', state.doc.id);
    $('save-state').textContent = '端末に保存済み';
  } catch (err) {
    $('save-state').textContent = '保存できません';
    toast('端末に保存できませんでした：' + err.message);
  }
  updateUnsynced();
}

async function updateUnsynced() {
  const synced = await store.getKV('synced:' + state.doc.id).catch(() => null);
  $('unsynced').hidden = synced === state.doc.updatedAt || live(state.doc).length === 0;
  $('btn-vault').title = $('unsynced').hidden ? 'Obsidian と受け渡す' : 'Obsidian にまだ渡していない変更があります';
}

async function markSynced() {
  await store.setKV('synced:' + state.doc.id, state.doc.updatedAt);
  updateUnsynced();
}

function openDoc(doc, { fit = true } = {}) {
  state.doc = doc;
  state.sel = [];
  state.vsel = null;
  undoStack = [];
  redoStack = [];
  setTool('select');
  updateSiteLabel();
  renderPanel();
  if (fit) fitView();
  saveNow();
  ensureBlobUrls();
}

// ---------- 下図 ----------

// 画像は blob の URL、DXF は線にした中身（{ geo, markup }）を blobUrls に置く。
async function ensureBlobUrls() {
  let added = false;
  for (const u of liveUnderlays(state.doc)) {
    if (blobUrls.has(u.blob)) continue;
    const blob = await store.getBlob(u.blob).catch(() => null);
    if (!blob) continue;
    if (UL.isVector(u)) {
      try {
        blobUrls.set(u.blob, vecEntry(await UL.dxfGeometry(blob)));
      } catch (err) {
        toast(`${u.name} を読めません：${err.message}`);
        continue;
      }
    } else blobUrls.set(u.blob, URL.createObjectURL(blob));
    added = true;
  }
  if (added) {
    render();
    if (!state.sel.length) renderPanel();
  }
}

const vecEntry = (geo) => ({ geo, markup: geometryMarkup(geo), snaps: snapPointsOf(geo) });

// 吸着に使う DXF の下図の点（図の mm）。置き方が変わったときだけ計算し直す。
const vecSnapCache = new Map();
function underlaySnapPoints() {
  const out = [];
  for (const u of liveUnderlays(state.doc)) {
    const e = blobUrls.get(u.blob);
    if (!u.visible || !e || typeof e === 'string') continue;
    const key = `${u.x},${u.y},${u.s},${u.rot}`;
    let c = vecSnapCache.get(u.id);
    if (!c || c.key !== key) {
      c = { key, pts: e.snaps.map((p) => UL.pixelToWorld(u, p)) };
      vecSnapCache.set(u.id, c);
    }
    out.push(...c.pts);
  }
  return out;
}

function updateUnderlay(id, fn, opts) {
  const i = state.doc.underlays.findIndex((u) => u.id === id && !u.deleted);
  if (i < 0) return;
  try {
    const next = fn(state.doc.underlays[i]);
    commit(() => { state.doc.underlays[i] = touch({ ...next }); }, opts);
  } catch (err) {
    toast(err.message);
  }
}

async function addUnderlayFromFile(file) {
  try {
    let page = 1;
    if (UL.isDxf(file)) {
      toast('DXF を読んでいます…');
    } else if (UL.isPdf(file)) {
      toast('PDF を読んでいます…');
      const n = await UL.pdfPageCount(file);
      if (n > 1) {
        const a = prompt(`この PDF は ${n} 頁あります。何頁目を敷きますか。`, '1');
        if (a === null) return;
        page = Math.min(Math.max(parseInt(a, 10) || 1, 1), n);
      }
    } else {
      toast('写真を読んでいます…');
    }
    const r = await UL.readUnderlayFile(file, page);
    await store.putBlob(r.hash, r.blob);
    if (!blobUrls.has(r.hash)) blobUrls.set(r.hash, r.geo ? vecEntry(r.geo) : URL.createObjectURL(r.blob));
    const v = currentView();
    // DXF は実寸、PDF は仮に 1/250、写真は画面の幅の八割で敷く。あとで合わせる。
    const sc = r.geo ? r.geo.unitMm : r.paperMmPerPx ? r.paperMmPerPx * 250 : (v.w * 0.8) / view.scale / r.w;
    let x = view.cx - (r.w * sc) / 2, y = view.cy - (r.h * sc) / 2;
    let onSurvey = false;
    const geo = state.doc.settings.geo;
    if (r.geo && geo) {
      // 測量座標（東が x・北が y）で描かれた DXF なら、図の座標に重ねる。図の原点から 1 km 以内に来るときだけ。
      const k = r.geo.unitMm;
      const sx = r.geo.ext.x0 * k - geo.origin[1] * 1000, sy = -r.geo.ext.y1 * k + geo.origin[0] * 1000;
      if (Math.abs(sx) < 1e6 && Math.abs(sy) < 1e6) {
        [x, y] = [sx, sy];
        onSurvey = true;
      }
    }
    const ul = createUnderlay({
      name: r.name, blob: r.hash, mime: r.mime, w: r.w, h: r.h, s: sc, x, y, paperMmPerPx: r.paperMmPerPx,
    });
    const first = live(state.doc).length === 0;
    setTool('select');
    state.sel = [];
    commit(() => state.doc.underlays.push(ul));
    if (first) fitView();
    const skipped = r.geo ? Object.entries(r.geo.skipped).map(([t, n]) => `${t} ${n}`).join('・') : '';
    if (r.geo) {
      toast((onSurvey ? '測量座標の位置に実寸で敷きました' : `実寸（1 単位 = ${r.geo.unitMm} mm）で敷きました。違えば「長さで合わせる」を使ってください`)
        + (skipped ? `。読めなかったもの：${skipped}` : ''));
      if (!first) fitView();
      openPanelOnNarrow();
      return;
    }
    toast(r.paperMmPerPx
      ? '縮尺 1/250 で敷きました。違えば右の欄で縮尺を直すか「長さで合わせる」を使ってください'
      : '写真を敷きました。「長さで合わせる」か「2点で合わせる」で大きさを合わせてください');
    openPanelOnNarrow();
  } catch (err) {
    toast('下図を敷けませんでした：' + err.message);
  }
}

function underlayPanel() {
  const uls = liveUnderlays(state.doc);
  const items = uls.map((u) => {
    const n = UL.paperScaleOf(u);
    return `<div class="ul-item${state.ulMode?.id === u.id ? ' active' : ''}" data-ul="${u.id}">
      <label class="check ul-name"><input type="checkbox" data-act="visible" ${u.visible ? 'checked' : ''}><span>${escapeHtml(u.name)}</span></label>
      ${blobUrls.has(u.blob) ? '' : '<p class="small warn">この端末に画像がありません。Obsidian から画像と一緒に読み込んでください。</p>'}
      <label class="field"><span>濃さ</span><input type="range" min="0.1" max="1" step="0.05" value="${u.opacity}" data-act="opacity"></label>
      ${n ? `<label class="field"><span>縮尺</span><span class="ratio">1 /<input type="text" inputmode="decimal" data-act="scale" value="${Math.round(n * 100) / 100}"></span></label>` : ''}
      <label class="field"><span>向き<small>°</small></span><input type="text" inputmode="decimal" data-act="rot" value="${Math.round(u.rot * 100) / 100}"></label>
      <div class="row">
        <button type="button" data-act="move">動かす</button>
        <button type="button" data-act="length">長さで合わせる</button>
        <button type="button" data-act="align">2点で合わせる</button>
        <button type="button" data-act="delete" class="danger">外す</button>
      </div>
    </div>`;
  });
  return `<section class="psec">
    <h2>下図</h2>
    ${items.join('')}
    <button type="button" id="ul-add" class="${uls.length ? '' : 'primary'}">下図を敷く（測量図 PDF・写真）</button>
    ${uls.length ? '<p class="muted small">下図は押しても選ばれません。「動かす」を押してから引きます。</p>' : ''}
  </section>`;
}

function bindUnderlayPanel(p) {
  $('ul-add').onclick = () => $('ul-input').click();
  for (const item of p.querySelectorAll('.ul-item')) {
    const id = item.dataset.ul;
    item.addEventListener('click', (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'delete') updateUnderlay(id, (u) => tombstone(u));
      else if (act) startUlMode(act, id);
    });
    item.addEventListener('input', (ev) => {
      if (ev.target.dataset.act !== 'opacity') return;
      const u = ulById(id);
      u.opacity = Number(ev.target.value);
      touch(u);
      changed({ panel: false });
    });
    item.addEventListener('change', (ev) => {
      const t = ev.target;
      const num = Number(String(t.value).replace(/[０-９．－]/g, (c) => (c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
      if (t.dataset.act === 'visible') updateUnderlay(id, (u) => ({ ...u, visible: t.checked }), { panel: false });
      if (t.dataset.act === 'scale') {
        if (!(num > 0)) return toast('縮尺は正の数で入れてください');
        updateUnderlay(id, (u) => UL.setPaperScale(u, num), { panel: false });
      }
      if (t.dataset.act === 'rot') {
        if (!Number.isFinite(num)) return toast('向きは数で入れてください');
        updateUnderlay(id, (u) => UL.setRotation(u, num), { panel: false });
      }
    });
  }
}

const UL_HINTS = {
  move: () => '下図を引いて動かす。終わったら「終わる」',
  length: (n) => (n < 2 ? `下図の上で、長さの分かる二点を押す（${n + 1} 点目）` : '二点の間の実際の長さ（mm）を入れて Enter'),
  align: (n) => [
    '下図の上の点 A を押す',
    'A を重ねたい図の上の位置（A′）を押す。部材の角に吸い付きます',
    '下図の上の点 B を押す（A から離れた点ほど正確）',
    'B を重ねたい図の上の位置（B′）を押す',
  ][n],
};

function startUlMode(type, id) {
  setTool('select');
  select(null);
  const u = ulById(id);
  if (!u) return;
  if (!u.visible) updateUnderlay(id, (x) => ({ ...x, visible: true }));
  state.ulMode = { type, id, pts: [], undoDepth: undoStack.length };
  if (matchMedia('(max-width: 760px)').matches) togglePanel(false);
  updateCmd();
  renderPanel();
  render();
}

function exitUlMode() {
  if (!state.ulMode) return;
  state.ulMode = null;
  state.snap = null;
  $('len').value = '';
  updateCmd();
  renderPanel();
  render();
}

function updateUlCmd() {
  const m = state.ulMode;
  $('cmd').hidden = false;
  $('cmd-hint').textContent = `下図：${UL_HINTS[m.type](m.pts.length)}`;
  $('shape-switch').hidden = true;
  const askLen = m.type === 'length' && m.pts.length === 2;
  $('len').closest('label').hidden = !askLen;
  $('len').placeholder = '実際の長さ mm';
  $('cmd-done').hidden = m.type !== 'move';
  $('cmd-done').disabled = false;
  $('cmd-done').textContent = '終わる';
  $('cmd-cancel').hidden = false;
  $('cmd-cancel').textContent = m.type === 'move' ? '戻す' : 'やめる';
  if (askLen) requestAnimationFrame(() => $('len').focus());
}

// 合わせるための点を打つ。下図の上の点は吸着させず、図の上の点は部材の角と方眼に吸い付ける。
function ulPick(sp, e) {
  const m = state.ulMode;
  const onImage = m.type === 'length' || m.pts.length % 2 === 0;
  const p = onImage ? currentView().toW(sp) : snapAt(sp, e).p;
  if (m.type === 'length' && m.pts.length >= 2) return;
  m.pts.push(p);
  if (m.type === 'align' && m.pts.length === 4) {
    const [a, a2, b, b2] = m.pts;
    const id = m.id;
    state.ulMode = null;
    updateUnderlay(id, (u) => UL.alignTwoPoints(u, a, b, a2, b2));
    updateCmd();
    toast('下図を二点で合わせました');
    return;
  }
  updateCmd();
  renderOverlayOnly();
}

function applyLengthCalibration(text) {
  const m = state.ulMode;
  if (!m || m.type !== 'length' || m.pts.length < 2) return;
  const len = Number(String(text).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  if (!(len > 0)) return toast('長さは mm の数で入れてください');
  const [a, b] = m.pts;
  const id = m.id;
  state.ulMode = null;
  $('len').value = '';
  updateUnderlay(id, (u) => UL.calibrateLength(u, a, b, len));
  updateCmd();
  toast('下図の大きさを合わせました');
}

// ---------- 現場の切り替え ----------

async function showSites() {
  await saveNow();
  const docs = (await store.listDocs()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const ul = $('site-list');
  ul.innerHTML = docs.map((d) => `
    <li${d.id === state.doc.id ? ' class="current"' : ''}>
      <button type="button" class="pick" data-open="${d.id}">
        <b>${escapeHtml(d.siteName || '無題')}</b><span>${escapeHtml(d.siteId || '')}</span>
        <small>${new Date(d.updatedAt).toLocaleString('ja-JP')}・部材 ${live(d).length}</small>
      </button>
      ${d.id === state.doc.id ? '<span class="tag">開いている</span>' : `<button type="button" class="danger small-btn" data-del="${d.id}">消す</button>`}
    </li>`).join('');
  ul.onclick = async (ev) => {
    const o = ev.target.closest('[data-open]');
    const del = ev.target.closest('[data-del]');
    if (o) {
      openDoc(normalizeDoc(await store.loadDoc(o.dataset.open)));
      $('dlg-site').close();
    } else if (del && confirm('この端末からこの現場の図を消します。Obsidian に書き出したノートは残ります。よろしいですか。')) {
      await store.deleteDoc(del.dataset.del);
      showSites();
    }
  };
  showBlobUsage();
  if (!$('dlg-site').open) $('dlg-site').showModal();
}

// 端末の中の下図の画像のうち、どの現場の図（元に戻す履歴も含む）からも使われていないものを消す。
async function blobsInUse() {
  const used = new Set();
  const add = (d) => liveUnderlays(d).forEach((u) => used.add(u.blob));
  (await store.listDocs()).forEach(add);
  add(state.doc);
  [...undoStack, ...redoStack].forEach((snap) => add({ underlays: snap.underlays }));
  return used;
}

async function showBlobUsage() {
  const used = await blobsInUse();
  const keys = await store.blobKeys();
  const unused = keys.filter((k) => !used.has(k)).length;
  $('blob-usage').textContent = `下図の画像 ${keys.length} 枚（使っていないもの ${unused} 枚）`;
  $('btn-clean-blobs').disabled = !unused;
}

$('btn-clean-blobs').onclick = async () => {
  await saveNow();
  const used = await blobsInUse();
  const unused = (await store.blobKeys()).filter((k) => !used.has(k));
  if (!unused.length) return;
  let bytes = 0;
  for (const k of unused) {
    bytes += (await store.getBlob(k))?.size || 0;
    await store.deleteBlob(k);
  }
  toast(`使っていない下図の画像 ${unused.length} 枚（${fmtBytes(bytes)}）を消しました`);
  showBlobUsage();
};

$('btn-clean-folder').onclick = async () => {
  const h = await vault.getFolder();
  if (!h) return;
  if (!confirm('フォルダの中の「下図_…」の画像のうち、どの縄張りノートからも使われていないものを消します。よろしいですか。')) return;
  try {
    const { count, bytes } = await vault.cleanFolderBlobs(h);
    toast(count ? `フォルダから ${count} 枚（${fmtBytes(bytes)}）を消しました` : '消すものはありませんでした');
  } catch (err) {
    toast('掃除できませんでした：' + err.message);
  }
};

const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

$('btn-new-site').onclick = () => {
  openDoc(createDoc());
  $('dlg-site').close();
  togglePanel(true);
  requestAnimationFrame(() => $('panel').querySelector('input')?.focus());
};

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- Obsidian ----------

async function showVault() {
  await saveNow();
  const canFolder = vault.canUseFolder();
  $('vault-folder').hidden = !canFolder;
  $('files-note').textContent = canFolder
    ? 'フォルダを使わずに、ノートのファイルを手で運ぶこともできます。'
    : 'ノートのファイルを手で運びます。iPhone では「ファイルに保存」で iCloud Drive › Obsidian › vault の中へ保存し、読み込みもそこから選びます。下図があるときは、ノートと一緒に「下図_…」の画像も選んでください。';
  if (canFolder) {
    const h = await vault.getFolder();
    $('folder-name').textContent = h ? h.name : '未選択';
    $('btn-sync').disabled = !h;
    $('btn-clean-folder').disabled = !h;
    $('note-list').innerHTML = '';
    if (h) refreshNoteList(h, false);
  }
  if (!$('dlg-vault').open) $('dlg-vault').showModal();
}

async function refreshNoteList(handle, ask = true) {
  const ul = $('note-list');
  try {
    if (!ask && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      ul.innerHTML = '<li class="muted">「揃える」か「選ぶ」を押すと一覧が出ます（許可が要ります）。</li>';
      return;
    }
    const notes = await vault.listNotes(handle);
    ul.innerHTML = notes.length ? notes.map((n, i) => `
      <li>
        <button type="button" class="pick" data-note="${i}" ${n.error ? 'disabled' : ''}>
          <b>${escapeHtml(n.doc ? n.doc.siteName || '無題' : n.name)}</b><span>${escapeHtml(n.doc?.siteId || '')}</span>
          <small>${n.error ? '読めません：' + escapeHtml(n.error) : escapeHtml(n.name)}</small>
        </button>
        ${n.doc?.id === state.doc.id ? '<span class="tag">開いている図</span>' : ''}
      </li>`).join('') : '<li class="muted">まだありません。</li>';
    ul.onclick = (ev) => {
      const b = ev.target.closest('[data-note]');
      if (b) importDocs([notes[Number(b.dataset.note)]], handle).then(() => $('dlg-vault').close());
    };
  } catch (err) {
    ul.innerHTML = `<li class="muted">${escapeHtml(err.message)}</li>`;
  }
}

// 読み込んだ図を開く。同じ図が端末にあれば合わせる。
async function importDocs(items, folder = null) {
  const good = items.filter((i) => i.doc);
  for (const bad of items.filter((i) => i.error)) toast(`${bad.name}：${bad.error}`);
  let missing = good.flatMap((i) => i.missing || []);
  if (folder) for (const i of good) missing.push(...(await vault.pullBlobs(folder, i.doc)));
  missing = [...new Set(missing)];
  if (!good.length) return;
  let last = null;
  let msg = '';
  for (const { doc } of good) {
    const local = doc.id === state.doc.id ? state.doc : await store.loadDoc(doc.id);
    if (local) {
      const { doc: merged, changed: n } = mergeDocs(normalizeDoc(local), doc);
      await store.saveDoc(merged);
      last = merged;
      msg = n ? `ノートから ${n} 件の変更を取り込みました` : 'ノートと端末の図は同じでした';
    } else {
      await store.saveDoc(doc);
      last = doc;
      msg = '新しい現場として読み込みました';
    }
  }
  openDoc(normalizeDoc(last));
  await store.setKV('synced:' + last.id, last.updatedAt);
  updateUnsynced();
  toast((good.length > 1 ? `${good.length} 件のノートを読み込みました` : msg)
    + (missing.length ? `。下図の画像 ${missing.length} 枚が見つかりません（ノートと一緒に選んでください）` : ''));
}

$('btn-pick-folder').onclick = async () => {
  try {
    const h = await vault.pickFolder();
    $('folder-name').textContent = h.name;
    $('btn-sync').disabled = false;
    $('btn-clean-folder').disabled = false;
    refreshNoteList(h);
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message);
  }
};

$('btn-sync').onclick = async () => {
  const h = await vault.getFolder();
  if (!h) return;
  try {
    await saveNow();
    const { doc, name, pulled } = await vault.syncToFolder(h, state.doc);
    if (pulled) {
      openDoc(normalizeDoc(doc), { fit: false });
      ensureBlobUrls();
    } else {
      state.doc = doc;
      await saveNow();
    }
    await markSynced();
    toast(pulled ? `${name} と揃えました（ノートから ${pulled} 件取り込み）` : `${name} に書き込みました`);
    refreshNoteList(h);
  } catch (err) {
    toast('揃えられませんでした：' + err.message);
  }
};

$('btn-export').onclick = async () => {
  await saveNow();
  const r = await vault.exportNote(state.doc);
  if (r !== 'cancelled') {
    await markSynced();
    toast(r === 'shared' ? 'ノートを渡しました' : 'ノートを書き出しました');
  }
};

$('file-import').onchange = async (ev) => {
  const items = await vault.readNoteFiles([...ev.target.files]);
  ev.target.value = '';
  await importDocs(items);
  $('dlg-vault').close();
};

// ---------- 回す・映す ----------

const transformTools = () => `
  <div class="row tight" role="group" aria-label="回す・映す">
    <button type="button" data-x="ccw" title="左へ 90° 回す">⟲ 90°</button>
    <button type="button" data-x="cw" title="右へ 90° 回す">⟳ 90°</button>
    <button type="button" data-x="mx">左右反転</button>
    <button type="button" data-x="my">上下反転</button>
  </div>
  <label class="field"><span>回す<small>°</small></span><input type="text" inputmode="decimal" id="p-rot" placeholder="左回りが正。Enter"></label>`;

function bindTransformTools(p) {
  p.querySelectorAll('[data-x]').forEach((b) => {
    b.onclick = () => ({ ccw: () => rotateSelected(-90), cw: () => rotateSelected(90), mx: () => mirrorSelected('x'), my: () => mirrorSelected('y') })[b.dataset.x]();
  });
  const rot = p.querySelector('#p-rot');
  rot.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const deg = Number(String(rot.value).replace(/[０-９．－]/g, (c) => (c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
    if (!Number.isFinite(deg) || !deg) return toast('角度を数で入れてください（左回りが正）');
    rotateSelected(-deg); // 画面は y 下向きなので、左回りは負の向き
  });
}

function renderMultiPanel(p, els) {
  let area = 0, length = 0;
  for (const el of els) {
    const m = measure(el);
    area += m.area || 0;
    length += m.length || 0;
  }
  const facts = [['部材', `${els.length}`]];
  if (area) facts.push(['面積の計', `${(area / 1e6).toFixed(2)} m²`]);
  if (length) facts.push(['長さの計', fmtLen(length)]);
  p.innerHTML = `
    <section class="psec">
      <h2>${els.length} 個を選んでいます</h2>
      <dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <p class="muted small">どれか一つを引くと、まとめて動きます。Shift を押しながら押すと、足したり外したりできます。</p>
      ${transformTools()}
      <div class="row">
        <button type="button" id="p-dup">複製</button>
        <button type="button" id="p-del" class="danger">削除</button>
        <button type="button" id="p-close">選択を外す</button>
      </div>
    </section>`;
  $('p-dup').onclick = duplicateSelected;
  $('p-del').onclick = deleteSelected;
  $('p-close').onclick = () => select(null);
  bindTransformTools(p);
}

// ---------- 平面直角座標 ----------

function updateReadout(w) {
  const geo = state.doc.settings.geo;
  const el = $('coord-readout');
  if (!geo || !w) {
    el.hidden = true;
    return;
  }
  const p = state.snap?.p || w;
  const { X, Y } = SV.toSurvey(geo, p);
  el.hidden = false;
  el.textContent = `X ${SV.fmtCoord(X)}　Y ${SV.fmtCoord(Y)}${geo.zone ? `　第${SV.ZONES[geo.zone - 1]}系` : ''}`;
}

function coordTable(el) {
  const geo = state.doc.settings.geo;
  if (!geo || !el.pts.length) return '';
  const rows = el.pts.map((p, i) => {
    const { X, Y } = SV.toSurvey(geo, p);
    return `<tr><th>${i + 1}</th><td>${SV.fmtCoord(X)}</td><td>${SV.fmtCoord(Y)}</td></tr>`;
  });
  return `<section class="psec">
    <h2>座標<small>m${geo.zone ? `・第${SV.ZONES[geo.zone - 1]}系` : ''}</small></h2>
    <table class="qty coords"><thead><tr><th></th><th>X（北）</th><th>Y（東）</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <button type="button" id="p-copy-coords">座標をコピー</button>
  </section>`;
}

async function copyCoords(el) {
  const geo = state.doc.settings.geo;
  const text = el.pts.map((p, i) => {
    const { X, Y } = SV.toSurvey(geo, p);
    return `${i + 1}\t${SV.fmtCoord(X)}\t${SV.fmtCoord(Y)}`;
  }).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('座標をコピーしました（番号・X・Y、タブ区切り）');
  } catch {
    toast('コピーできませんでした');
  }
}

function showCoordDialog() {
  const geo = state.doc.settings.geo;
  $('coord-zone').innerHTML = `<option value="">未設定</option>` + SV.ZONES.map((z, i) => `<option value="${i + 1}"${geo?.zone === i + 1 ? ' selected' : ''}>第${z}系</option>`).join('');
  updateCoordPreview();
  $('dlg-coord').showModal();
  $('coord-text').focus();
}

function updateCoordPreview() {
  const { points, skipped } = SV.parseCoordText($('coord-text').value);
  const kind = $('coord-kind').value;
  const out = [];
  if (points.length) {
    out.push(`<p><b>${points.length} 点</b>${skipped.length ? `（${skipped.length} 行は数が読めないので飛ばします）` : ''}</p>`);
    if (kind === 'shikichi' && points.length >= 3) {
      const a = SV.coordArea(points);
      out.push(`<p>座標求積 <b>${a.toFixed(2)} m²</b>（${a.toFixed(6)}）　周長 ${SV.edgeLengths(points).reduce((s, e) => s + e.length, 0).toFixed(3)} m</p>`);
    }
    const edges = kind === 'none' ? [] : SV.edgeLengths(points, kind === 'shikichi');
    if (edges.length) out.push(`<table class="qty"><tbody>${edges.map((e) => `<tr><th>${escapeHtml(e.from)} → ${escapeHtml(e.to)}</th><td>${e.length.toFixed(3)}</td><td>m</td></tr>`).join('')}</tbody></table>`);
    if (!state.doc.settings.geo) out.push('<p class="muted small">最初の点の近くを図の原点にします。以後この図は、この座標で読み書きします。</p>');
  } else if ($('coord-text').value.trim()) out.push('<p class="warn">座標が読めません。一行に「点名 X Y」の形で入れてください。</p>');
  $('coord-preview').innerHTML = out.join('');
  const need = kind === 'shikichi' ? 3 : kind === 'enseki' ? 2 : 1;
  $('coord-ok').disabled = points.length < need;
}

function createFromCoords() {
  const { points } = SV.parseCoordText($('coord-text').value);
  const kind = $('coord-kind').value;
  const zone = Number($('coord-zone').value) || null;
  const geo = state.doc.settings.geo || { origin: SV.originFor(points) };
  state.doc.settings.geo = { ...geo, zone: zone ?? geo.zone ?? null };
  const pts = points.map((p) => SV.toWorld(state.doc.settings.geo, p.X, p.Y));
  const made = [];
  if (kind === 'shikichi') made.push(createElement('shikichi', pts));
  if (kind === 'enseki') made.push(createElement('enseki', pts));
  if ($('coord-names').checked || kind === 'none') {
    pts.forEach((p, i) => made.push(createElement('moji', [[p[0] + 150, p[1] - 150]], { props: { 文字: points[i].name } })));
  }
  setTool('select');
  commit(() => state.doc.elements.push(...made));
  select(made[0].id);
  fitView();
  $('dlg-coord').close();
  toast(`${points.length} 点から作りました`);
}

$('coord-text').addEventListener('input', updateCoordPreview);
$('coord-kind').addEventListener('change', updateCoordPreview);
$('coord-ok').onclick = createFromCoords;

// ---------- 図面（印刷・PDF） ----------

function contentBox() {
  const pts = live(state.doc).flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
  if (!pts.length) for (const u of liveUnderlays(state.doc)) if (u.visible) pts.push(...UL.corners(u));
  return pts.length ? bbox(pts) : null;
}

function setSheet(patch, { save = true, panel = false } = {}) {
  const s = state.doc.settings;
  const list = [...SH.sheetsOf(state.doc)];
  const i = SH.sheetIndexOf(state.doc);
  list[i] = { ...SH.sheetOf(state.doc), ...patch };
  s.sheets = list;
  delete s.sheet;
  if (save) changed({ panel });
  else render();
}

function pickSheet(i) {
  state.doc.settings.sheetIndex = i;
  changed();
  fitSheet();
}

// 図面を一枚足す。今見ている所を中心に、細かい縮尺の部分詳細図として。
function addSheet() {
  const cur = SH.sheetOf(state.doc);
  const list = [...SH.sheetsOf(state.doc)];
  list.push({ ...cur, title: '部分詳細図', number: '', scale: SH.detailScale(cur.scale), cx: Math.round(view.cx), cy: Math.round(view.cy) });
  state.doc.settings.sheets = list;
  delete state.doc.settings.sheet;
  pickSheet(list.length - 1);
  toast(`図面を足しました（${list.length} 枚目）。枠を引いて範囲を決めてください`);
}

function removeSheet() {
  const list = [...SH.sheetsOf(state.doc)];
  if (list.length < 2) return;
  const i = SH.sheetIndexOf(state.doc);
  if (!confirm(`「${list[i].title || '図面'}」（${i + 1} 枚目）を消します。よろしいですか。`)) return;
  list.splice(i, 1);
  state.doc.settings.sheets = list;
  pickSheet(Math.min(i, list.length - 1));
}

function startSheetMode() {
  setTool('select');
  select(null);
  if (!SH.sheetsOf(state.doc).length) {
    const box = contentBox();
    state.doc.settings.sheets = [box ? SH.fitToBox(SH.defaultSheet(), box) : { ...SH.defaultSheet(), cx: view.cx, cy: view.cy }];
    state.doc.settings.sheetIndex = 0;
  }
  state.sheetMode = true;
  $('btn-sheet').setAttribute('aria-pressed', 'true');
  if (matchMedia('(max-width: 760px)').matches) togglePanel(false);
  fitSheet();
  updateCmd();
  renderPanel();
}

function exitSheetMode() {
  if (!state.sheetMode) return;
  state.sheetMode = false;
  $('btn-sheet').setAttribute('aria-pressed', 'false');
  updateCmd();
  renderPanel();
  render();
}

// 画面に用紙全体が収まるように寄る。
function fitSheet() {
  const { frame } = SH.worldRects(SH.sheetOf(state.doc));
  const b = bbox(frame);
  const r = svg.getBoundingClientRect();
  view = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.min((r.width - 60) / (b.x1 - b.x0), (r.height - 140) / (b.y1 - b.y0)) };
  render();
}

function updateSheetCmd() {
  $('cmd').hidden = false;
  $('cmd-hint').textContent = '図面：枠を引いて、紙に入れる範囲を決める';
  $('shape-switch').hidden = true;
  $('len').closest('label').hidden = true;
  $('cmd-done').hidden = false;
  $('cmd-done').disabled = false;
  $('cmd-done').textContent = 'PDF を書き出す';
  $('cmd-cancel').hidden = false;
  $('cmd-cancel').textContent = '終わる';
}

function renderSheetPanel(p) {
  const sh = SH.sheetOf(state.doc);
  const opt = (list, cur, fmt = (x) => x) => list.map((x) => `<option value="${x}"${String(x) === String(cur) ? ' selected' : ''}>${fmt(x)}</option>`).join('');
  const hasFolder = vault.canUseFolder();
  const sheets = SH.sheetsOf(state.doc);
  const cur = SH.sheetIndexOf(state.doc);
  p.innerHTML = `
    <section class="psec">
      <h2>図面 <small>${cur + 1} / ${sheets.length} 枚目</small></h2>
      <div class="row sheet-pick">
        <select id="sh-pick" aria-label="図面を選ぶ">${sheets.map((s, i) => { const x = SH.sheetOf(state.doc, i); return `<option value="${i}"${i === cur ? ' selected' : ''}>${i + 1}. ${escapeHtml(x.title || '図面')}（${x.paper} 1/${x.scale}）</option>`; }).join('')}</select>
        <button type="button" id="sh-add">足す</button>
        ${sheets.length > 1 ? '<button type="button" id="sh-del" class="danger">消す</button>' : ''}
      </div>
      <form id="sheet-form" class="fields" onsubmit="return false">
        <label class="field"><span>用紙</span><select data-k="paper">${opt(Object.keys(SH.PAPERS), sh.paper)}</select></label>
        <label class="field"><span>向き</span><select data-k="orient">${opt(['landscape', 'portrait'], sh.orient, (x) => (x === 'landscape' ? '横' : '縦'))}</select></label>
        <label class="field"><span>縮尺</span><select data-k="scale">${opt(SH.SCALES, sh.scale, (x) => '1/' + x)}</select></label>
        ${field('図名', sh.title).replace('data-prop="図名"', 'data-k="title"')}
        ${field('図番', sh.number).replace('data-prop="図番"', 'data-k="number"')}
        ${field('会社名', sh.company).replace('data-prop="会社名"', 'data-k="company"')}
        ${field('北の向き', sh.north, { numeric: true, unit: '°' }).replace('data-prop="北の向き"', 'data-k="north"')}
        <label class="check"><input type="checkbox" data-k="underlays" ${sh.underlays ? 'checked' : ''}> 下図も印刷する</label>
      </form>
      <div class="row"><button type="button" id="sh-fit">全体が入るように</button></div>
      <p class="muted small">北の向きは、図の上を 0° として時計回りの角度です。</p>
    </section>
    <section class="psec">
      <h2>書き出す</h2>
      <button type="button" id="sh-pdf" class="primary wide">PDF を書き出す${sheets.length > 1 ? '（この一枚）' : ''}</button>
      ${sheets.length > 1 ? `<button type="button" id="sh-pdf-all" class="wide">全部（${sheets.length} 枚）を一つの PDF に</button>` : ''}
      ${hasFolder ? '<button type="button" id="sh-open" class="wide">開いて印刷する</button><button type="button" id="sh-folder" class="wide">Obsidian のフォルダに置く</button>' : ''}
      <p class="muted small">印刷するときは倍率を「実際のサイズ（100%）」にしてください。「用紙に合わせる」にすると縮尺がずれます。iPhone では共有シートから「プリント」か「ファイルに保存」を選べます。</p>
      ${state.doc.settings.geo ? `<label class="check"><input type="checkbox" id="sh-dxf-survey" ${sh.dxfSurvey !== false ? 'checked' : ''}> DXF を測量座標で書き出す（東が x・北が y、mm）</label>` : ''}
      <button type="button" id="sh-dxf" class="wide">DXF を書き出す</button>
      ${hasFolder ? '<button type="button" id="sh-dxf-folder" class="wide">DXF を Obsidian のフォルダに置く</button>' : ''}
      <p class="muted small">DXF は AutoCAD R12 形式・Shift_JIS・mm 単位です（Jw_cad・AutoCAD・Vectorworks 向け）。部材の種類ごとに画層を分け、文字は図面の縮尺で 2.5mm の高さにします。</p>
      <button type="button" id="sh-close" class="wide">終わる</button>
    </section>`;
  p.querySelector('#sheet-form').addEventListener('change', (ev) => {
    const t = ev.target;
    const k = t.dataset.k;
    if (!k) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'scale') v = Number(v);
    if (k === 'north') {
      v = Number(String(v).replace(/[０-９．－]/g, (c) => (c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
      if (!Number.isFinite(v)) return toast('北の向きは数で入れてください');
    }
    setSheet({ [k]: v });
    if (k === 'paper' || k === 'orient' || k === 'scale') fitSheet();
  });
  $('sh-fit').onclick = () => {
    const box = contentBox();
    if (!box) return toast('まだ部材がありません');
    setSheet(SH.fitToBox(SH.sheetOf(state.doc), box), { panel: true });
    fitSheet();
  };
  $('sh-pdf').onclick = () => exportPdf('share');
  if ($('sh-pdf-all')) $('sh-pdf-all').onclick = () => exportPdf('share', { all: true });
  $('sh-pick').onchange = (ev) => pickSheet(Number(ev.target.value));
  $('sh-add').onclick = addSheet;
  if ($('sh-del')) $('sh-del').onclick = removeSheet;
  $('sh-dxf').onclick = () => exportDxf('share');
  if ($('sh-dxf-survey')) $('sh-dxf-survey').onchange = (ev) => setSheet({ dxfSurvey: ev.target.checked });
  if ($('sh-dxf-folder')) $('sh-dxf-folder').onclick = () => exportDxf('folder');
  if (hasFolder) {
    $('sh-open').onclick = () => exportPdf('open');
    $('sh-folder').onclick = () => exportPdf('folder');
  }
  $('sh-close').onclick = exitSheetMode;
}

// 下図の画像を PDF に入れられる JPEG にする。
async function jpegOf(blob) {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;
  if (blob.type === 'image/jpeg') {
    bmp.close?.();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const jpg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await jpg.arrayBuffer()), w, h };
}

async function makePdfFile({ all = false } = {}) {
  const sh = SH.sheetOf(state.doc);
  const sheets = all ? SH.sheetsOf(state.doc).map((_, i) => SH.sheetOf(state.doc, i)) : [sh];
  const images = new Map();
  if (sheets.some((s) => s.underlays)) {
    for (const u of liveUnderlays(state.doc)) {
      if (!u.visible || images.has(u.blob)) continue;
      const e = blobUrls.get(u.blob);
      if (e && typeof e !== 'string') {
        images.set(u.blob, { vec: e.geo });
        continue;
      }
      const blob = await store.getBlob(u.blob).catch(() => null);
      if (blob) images.set(u.blob, await jpegOf(blob));
    }
  }
  if (all) return new File([plotSheets(state.doc, sheets, { images })], SH.pdfSetFileName(state.doc), { type: 'application/pdf' });
  const bytes = plotSheet(state.doc, sh, { images });
  return new File([bytes], SH.pdfFileName(state.doc, sh), { type: 'application/pdf' });
}

async function exportPdf(how, opts = {}) {
  // 新しいタブは押した直後に開かないと止められるので、先に開いておく。
  const win = how === 'open' ? window.open('', '_blank') : null;
  try {
    toast('PDF を作っています…');
    const file = await makePdfFile(opts);
    if (how === 'open') {
      const url = URL.createObjectURL(file);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('PDF を開きました。倍率「実際のサイズ」で印刷してください');
    } else if (how === 'folder') {
      const h = await vault.getFolder();
      if (!h) return toast('先に「Obsidian」で vault のフォルダを選んでください');
      await vault.writeToFolder(h, file);
      toast(`${file.name} を Obsidian のフォルダに置きました`);
    } else {
      const r = await vault.shareOrDownload([file], file.name);
      if (r !== 'cancelled') toast(r === 'shared' ? 'PDF を渡しました' : `${file.name} を書き出しました`);
    }
  } catch (err) {
    win?.close();
    toast('PDF を作れませんでした：' + err.message);
  }
}

function makeDxfFile() {
  const sh = SH.sheetOf(state.doc);
  const geo = state.doc.settings.geo;
  const offset = geo && sh.dxfSurvey !== false ? SV.dxfOffset(geo) : [0, 0];
  const bytes = buildDxf(state.doc, { textHeight: 2.5 * sh.scale, offset });
  return new File([bytes], dxfFileName(state.doc), { type: 'application/dxf' });
}

async function exportDxf(how) {
  try {
    const file = makeDxfFile();
    if (how === 'folder') {
      const h = await vault.getFolder();
      if (!h) return toast('先に「Obsidian」で vault のフォルダを選んでください');
      await vault.writeToFolder(h, file);
      toast(`${file.name} を Obsidian のフォルダに置きました`);
    } else {
      const r = await vault.shareOrDownload([file], file.name);
      if (r !== 'cancelled') toast(r === 'shared' ? 'DXF を渡しました' : `${file.name} を書き出しました`);
    }
  } catch (err) {
    toast('DXF を作れませんでした：' + err.message);
  }
}

// ---------- そのほか ----------

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function buildTools() {
  const nav = $('tools');
  nav.innerHTML = TOOLS.map((t) => {
    const label = t.label || KINDS[t.id].label;
    const attr = t.action ? `data-action="${t.id}" class="tool-action"` : `data-tool="${t.id}" aria-pressed="${t.id === state.tool}"`;
    return `<button type="button" ${attr} title="${t.title || label}${t.key ? `（${t.key}）` : ''}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ico-${t.id}"/></svg><span>${label}</span></button>`;
  }).join('') + ICONS;
  nav.onclick = (ev) => {
    const b = ev.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
    if (ev.target.closest('[data-action="underlay"]')) $('ul-input').click();
    if (ev.target.closest('[data-action="coord"]')) showCoordDialog();
  };
}

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="ico-select" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19z"/></symbol>
<symbol id="ico-shikichi" viewBox="0 0 24 24"><path d="M3 6l9-3 9 5-2 12-14-1z" stroke-dasharray="5 2 1 2"/></symbol>
<symbol id="ico-tatemono" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 12l8-8M4 20 20 4M12 20l8-8"/></symbol>
<symbol id="ico-hoso" viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 12h18M9 5v7M15 12v7"/></symbol>
<symbol id="ico-shokusaitai" viewBox="0 0 24 24"><path d="M3 18c3-8 15-8 18 0zM8 14l1-3M12 13V9M16 14l-1-3"/></symbol>
<symbol id="ico-jumoku" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9 12h6M12 9v6"/></symbol>
<symbol id="ico-keiseki" viewBox="0 0 24 24"><path d="M4 16l3-8 7-3 6 6-2 7-10 1z"/></symbol>
<symbol id="ico-hei" viewBox="0 0 24 24"><path d="M3 18 10 8h11" stroke-width="3.5"/></symbol>
<symbol id="ico-enseki" viewBox="0 0 24 24"><path d="M3 17c5-9 11-9 18-9"/></symbol>
<symbol id="ico-takasa" viewBox="0 0 24 24"><path d="M5 14h8M9 10v8M15 8h5M17.5 5.5v5"/></symbol>
<symbol id="ico-sunpo" viewBox="0 0 24 24"><path d="M4 7v10M20 7v10M4 12h16M6 14l-2-2 2-2M18 10l2 2-2 2"/></symbol>
<symbol id="ico-moji" viewBox="0 0 24 24"><path d="M5 6h14M12 6v13M9 19h6"/></symbol>
<symbol id="ico-coord" viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M8 16l4-7 6 3"/><circle cx="8" cy="16" r="1.4"/><circle cx="12" cy="9" r="1.4"/><circle cx="18" cy="12" r="1.4"/></symbol>
<symbol id="ico-underlay" viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4"/></symbol>
</defs></svg>`;

$('btn-undo').onclick = undo;
$('btn-redo').onclick = redo;
$('btn-fit').onclick = fitView;
$('btn-site').onclick = showSites;
$('btn-vault').onclick = showVault;
$('btn-panel').onclick = () => togglePanel();
$('cmd-done').onclick = () => (state.sheetMode ? exportPdf('share') : state.ulMode ? exitUlMode() : finishDraft());
$('btn-sheet').onclick = () => (state.sheetMode ? exitSheetMode() : startSheetMode());
$('cmd-cancel').onclick = () => {
  if (state.sheetMode) return exitSheetMode();
  if (state.ulMode?.type === 'move') {
    // 動かし始めてからの分を元に戻す。
    const n = state.ulMode.undoDepth ?? undoStack.length;
    while (undoStack.length > n) undo();
    exitUlMode();
  } else if (state.ulMode) exitUlMode();
  else cancelDraft();
};
$('ul-input').onchange = async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  for (const f of files) await addUnderlayFromFile(f);
};
$('shape-switch').onclick = (ev) => {
  const b = ev.target.closest('[data-shape]');
  if (!b || !state.draft) return;
  state.shape = b.dataset.shape;
  state.draft.shape = state.shape;
  state.draft.pts = [];
  updateCmd();
  render();
};
new ResizeObserver(() => render()).observe(svg);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

async function start() {
  buildTools();
  let doc = null;
  try {
    const id = await store.getKV('lastDoc');
    if (id) {
      const raw = await store.loadDoc(id);
      if (raw) doc = normalizeDoc(raw);
    }
  } catch (err) {
    toast('前の図を開けませんでした：' + err.message);
  }
  openDoc(doc || createDoc());
  store.requestPersist();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();

// 試験と点検のための入口。
window.nawabari = { state, get view() { return view; }, setTool, placePoint, finishDraft, undo, redo, fitView, select };
