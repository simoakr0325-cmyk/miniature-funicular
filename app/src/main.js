// 縄張り台：画面と操作。

import {
  KINDS, LAYERS, NUMERIC_PROPS, createDoc, createElement, live, sortedForDraw, applySnapshot,
  mergeDocs, normalizeDoc, measure, quantities, formatQty, now, round, touch, tombstone, newId,
} from './model.js';
import { dist, orthoConstrain, pointAtDistance, rectFromCorners, bbox } from './geometry.js';
import { makeView, renderScene, renderOverlay, handlesOf } from './render.js';
import { hitElement, findSnap } from './hit.js';
import * as store from './storage.js';
import * as vault from './vault.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const sceneG = $('scene');
const overlayG = $('overlay');

const TOOLS = [
  { id: 'select', label: '選ぶ', key: 'V' },
  { id: 'shikichi' }, { id: 'tatemono' }, { id: 'hoso' }, { id: 'shokusaitai' }, { id: 'jumoku' },
  { id: 'keiseki' }, { id: 'hei' }, { id: 'enseki' }, { id: 'takasa' }, { id: 'sunpo' }, { id: 'moji' },
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
  selection: null,
  snap: null,
  lastTreeR: 750,
};
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
    sceneG.innerHTML = renderScene(state, v);
    overlayG.innerHTML = renderOverlay(state, v);
    $('empty-hint').hidden = live(state.doc).length > 0 || !!state.draft;
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  });
}

function renderOverlayOnly() {
  overlayG.innerHTML = renderOverlay(state, currentView());
}

function fitView() {
  const els = live(state.doc);
  const pts = els.flatMap((e) => (e.r ? [[e.pts[0][0] - e.r, e.pts[0][1] - e.r], [e.pts[0][0] + e.r, e.pts[0][1] + e.r]] : e.pts));
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
  const before = structuredClone(state.doc.elements);
  fn();
  pushHistory(before);
  changed(opts);
}

function undo() {
  if (!undoStack.length) return;
  cancelDraft();
  redoStack.push(structuredClone(state.doc.elements));
  state.doc.elements = applySnapshot(state.doc.elements, undoStack.pop());
  if (state.selection && !byId(state.selection)) state.selection = null;
  changed();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(structuredClone(state.doc.elements));
  state.doc.elements = applySnapshot(state.doc.elements, redoStack.pop());
  if (state.selection && !byId(state.selection)) state.selection = null;
  changed();
}

function addElement(el) {
  commit(() => state.doc.elements.push(el));
  select(el.id);
}

function deleteSelected() {
  const el = byId(state.selection);
  if (!el) return;
  commit(() => {
    const i = state.doc.elements.indexOf(el);
    state.doc.elements[i] = tombstone(el);
    state.selection = null;
  });
}

function duplicateSelected() {
  const el = byId(state.selection);
  if (!el) return;
  const off = state.doc.settings.grid * 5;
  const copy = { ...structuredClone(el), id: newId(), updatedAt: now(), pts: el.pts.map((p) => [p[0] + off, p[1] + off]) };
  addElement(copy);
}

function select(id) {
  state.selection = id;
  render();
  renderPanel();
}

// ---------- 道具 ----------

function geomOf(kind) {
  return KINDS[kind].geom;
}

function setTool(id) {
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

function snapAt(sp, e, exclude) {
  const d = state.draft;
  const s = e.altKey
    ? { p: currentView().toW(sp), type: 'free' }
    : findSnap(live(state.doc), currentView(), sp, {
        grid: state.doc.settings.grid,
        gridOn: state.doc.settings.gridOn,
        extra: d ? d.pts : [],
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
    if (gesture?.type === 'move' || gesture?.type === 'vertex') {
      state.doc.elements = gesture.before;
      render();
    }
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', d0: dist(a, b), mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view0: { ...view } };
    return;
  }
  if (pointers.size > 2) return;
  const v = currentView();
  if (e.button === 1 || spaceDown) {
    gesture = { type: 'pan', start: sp, view0: { ...view } };
    return;
  }
  if (e.button !== 0) return;
  if (state.tool === 'select') {
    const sel = byId(state.selection);
    if (sel) {
      const h = handlesOf(sel).find((h) => dist(v.toS(h.p), sp) <= (e.pointerType === 'touch' ? 16 : 9));
      if (h) {
        gesture = { type: 'vertex', el: sel, h, before: structuredClone(state.doc.elements), moved: false };
        return;
      }
    }
    const els = sortedForDraw(live(state.doc)).filter((x) => !(state.doc.settings.hiddenLayers || []).includes(KINDS[x.kind].layer));
    const hit = hitElement(els, v, sp, e.pointerType === 'touch' ? 14 : 8);
    if (hit) {
      if (state.selection !== hit.id) select(hit.id);
      gesture = { type: 'move', el: hit, startW: v.toW(sp), orig: structuredClone(hit.pts), before: structuredClone(state.doc.elements), moved: false, start: sp };
    } else {
      gesture = { type: 'pan', start: sp, view0: { ...view }, clickClears: true };
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
    gesture.el.pts = gesture.orig.map((p) => [round(p[0] + dx), round(p[1] + dy)]);
    render();
    return;
  }
  if (gesture?.type === 'vertex') {
    const { el, h } = gesture;
    const s = snapAt(sp, e, el.id);
    gesture.moved = true;
    if (h.radius) {
      el.r = Math.max(round(dist(el.pts[0], v.toW(sp))), 50);
    } else if (h.mid) {
      el.pts.splice(h.i + 1, 0, [round(s.p[0]), round(s.p[1])]);
      gesture.h = { i: h.i + 1 };
    } else {
      el.pts[h.i] = [round(s.p[0]), round(s.p[1])];
    }
    state.snap = s.type === 'vertex' ? s : null;
    render();
    return;
  }
  if (state.draft && !gesture && e.pointerType !== 'touch') {
    const s = snapAt(sp, e);
    state.draft.cursor = s.p;
    state.snap = s.type === 'free' ? null : s;
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
  gesture = null;
  if (e.type === 'pointercancel') {
    if (g.before) {
      state.doc.elements = g.before;
      render();
    }
    return;
  }
  if (g.type === 'pan' && g.clickClears && state.selection) select(null);
  if ((g.type === 'move' || g.type === 'vertex') && g.moved) {
    touch(g.el);
    state.snap = null;
    if (g.el.r) state.lastTreeR = g.el.r;
    pushHistory(g.before);
    changed();
  }
  if (g.type === 'place') {
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
    if (e.key === 'Enter') {
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
  if (mod) return;
  switch (e.key) {
    case 'Escape':
      if (state.draft?.pts.length) cancelDraft();
      else if (state.tool !== 'select') setTool('select');
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
  const el = byId(state.selection);
  if (el) {
    const def = KINDS[el.kind];
    const m = measure(el);
    const fields = Object.entries(el.props).map(([k, v]) =>
      field(k, v, { numeric: NUMERIC_PROPS.has(k), choices: def.choices?.[k], unit: NUMERIC_PROPS.has(k) ? 'mm' : '' }));
    if (def.geom === 'circle') fields.push(field('葉張', el.r * 2, { numeric: true, unit: 'mm' }));
    const facts = [];
    if (m.area !== undefined) facts.push(['面積', `${(m.area / 1e6).toFixed(2)} m²`]);
    if (m.length !== undefined) facts.push(['長さ', fmtLen(m.length)]);
    if (def.geom === 'polygon' || def.geom === 'polyline') facts.push(['頂点', `${el.pts.length}`]);
    p.innerHTML = `
      <section class="psec">
        <h2>${def.label}<small>${def.layer}</small></h2>
        <form id="props" class="fields" onsubmit="return false">${fields.join('')}</form>
        ${facts.length ? `<dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>` : ''}
        <p class="muted small">頂点の四角を引くと形が変わり、辺の丸を引くと頂点が増えます。</p>
        <div class="row">
          <button type="button" id="p-dup">複製</button>
          <button type="button" id="p-del" class="danger">削除</button>
          <button type="button" id="p-close">選択を外す</button>
        </div>
      </section>`;
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
    $('p-del').onclick = deleteSelected;
    $('p-close').onclick = () => select(null);
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
  state.selection = null;
  undoStack = [];
  redoStack = [];
  setTool('select');
  updateSiteLabel();
  renderPanel();
  if (fit) fitView();
  saveNow();
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
  if (!$('dlg-site').open) $('dlg-site').showModal();
}

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
    : 'ノートのファイルを手で運びます。iPhone では「ファイルに保存」で iCloud Drive › Obsidian › vault の中へ保存し、読み込みもそこから選びます。';
  if (canFolder) {
    const h = await vault.getFolder();
    $('folder-name').textContent = h ? h.name : '未選択';
    $('btn-sync').disabled = !h;
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
      if (b) importDocs([notes[Number(b.dataset.note)]]).then(() => $('dlg-vault').close());
    };
  } catch (err) {
    ul.innerHTML = `<li class="muted">${escapeHtml(err.message)}</li>`;
  }
}

// 読み込んだ図を開く。同じ図が端末にあれば合わせる。
async function importDocs(items) {
  const good = items.filter((i) => i.doc);
  for (const bad of items.filter((i) => i.error)) toast(`${bad.name}：${bad.error}`);
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
  toast(good.length > 1 ? `${good.length} 件のノートを読み込みました` : msg);
}

$('btn-pick-folder').onclick = async () => {
  try {
    const h = await vault.pickFolder();
    $('folder-name').textContent = h.name;
    $('btn-sync').disabled = false;
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
    return `<button type="button" data-tool="${t.id}" aria-pressed="${t.id === state.tool}" title="${label}${t.key ? `（${t.key}）` : ''}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ico-${t.id}"/></svg><span>${label}</span></button>`;
  }).join('') + ICONS;
  nav.onclick = (ev) => {
    const b = ev.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
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
</defs></svg>`;

$('btn-undo').onclick = undo;
$('btn-redo').onclick = redo;
$('btn-fit').onclick = fitView;
$('btn-site').onclick = showSites;
$('btn-vault').onclick = showVault;
$('btn-panel').onclick = () => togglePanel();
$('cmd-done').onclick = finishDraft;
$('cmd-cancel').onclick = cancelDraft;
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
