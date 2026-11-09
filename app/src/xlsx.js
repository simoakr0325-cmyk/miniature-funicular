// 見積書の雛形（晃さんの Excel、INVOY の見積書の形）に、見積の行を流し込む。
// 雛形の罫線・書体・社名の欄はそのまま。品目の行の C（品目）・J（数量 単位）・K（単価）・M（金額）を書き換え、
// 「税額」「合計(税抜)」の行と、見積金額（C8）に式を入れる。式には計算済みの値も添える（再計算しない表示でも合うように）。

import { makeZip } from './zip.js';

// ---------- ZIP を開く ----------

export async function unzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Excel のファイルとして読めません');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Excel のファイルが壊れています');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const data = u8.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    files.set(name, method === 0 ? data.slice() : await inflate(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflate(data) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// ---------- セル ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colNum = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

function parseSharedStrings(xml) {
  if (!xml) return [];
  // ふりがな（rPh）は除く
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(''));
}

// シートの XML を、行・セルの塊として扱う。
class Sheet {
  constructor(xml, strings) {
    this.xml = xml;
    this.strings = strings;
  }

  cellRe(ref) {
    return new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  }

  // セルの文字（共有文字列・その場の文字・数）
  text(ref) {
    const m = this.cellRe(ref).exec(this.xml);
    if (!m || !m[2]) return '';
    const t = /\bt="(\w+)"/.exec(m[1])?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(m[2])?.[1];
    if (t === 's') return this.strings[Number(v)] ?? '';
    if (t === 'inlineStr') return [...m[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join('');
    return v !== undefined ? unesc(v) : '';
  }

  style(ref) {
    const m = this.cellRe(ref).exec(this.xml);
    return m ? /\bs="(\d+)"/.exec(m[1])?.[1] ?? null : null;
  }

  // 値を書く。value：文字か数か null（消す）。formula：式（= なし）。style：s の番号（省けば元のまま）
  set(ref, { value = null, formula = null, style = undefined } = {}) {
    const s = style !== undefined ? style : this.style(ref);
    const sAttr = s !== null && s !== undefined ? ` s="${s}"` : '';
    let el;
    if (formula) el = `<c r="${ref}"${sAttr}><f>${esc(formula)}</f>${value !== null ? `<v>${esc(value)}</v>` : ''}</c>`;
    else if (value === null || value === '') el = `<c r="${ref}"${sAttr}/>`;
    else if (typeof value === 'number') el = `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
    else el = `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    const re = this.cellRe(ref);
    if (re.test(this.xml)) {
      this.xml = this.xml.replace(re, el);
      return;
    }
    // 無ければ、その行の列の順の所へ足す
    const row = Number(ref.replace(/\D+/g, ''));
    const rowRe = new RegExp(`(<row r="${row}"[^>]*?)(/>|>([\\s\\S]*?)</row>)`);
    const rm = rowRe.exec(this.xml);
    if (!rm) throw new Error(`雛形に ${row} 行目がありません`);
    if (rm[2] === '/>') {
      this.xml = this.xml.replace(rowRe, `${rm[1]}>${el}</row>`);
      return;
    }
    const cells = rm[3];
    const c = colNum(ref);
    let at = cells.length;
    for (const m of cells.matchAll(/<c r="([A-Z]+)\d+"/g)) {
      if (colNum(m[1]) > c) { at = m.index; break; }
    }
    this.xml = this.xml.replace(rowRe, `${rm[1]}>${cells.slice(0, at)}${el}${cells.slice(at)}</row>`);
  }

  // row の前に、src 行（罫線・結合ごと）を写した行を count 行入れる。下の行・結合の番号はずらす。
  insertRows(row, count, src) {
    if (count <= 0) return;
    const shift = (n) => (n >= row ? n + count : n);
    const srcRe = new RegExp(`<row r="${src}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    const srcXml = srcRe.exec(this.xml)[0];
    // 既にある行と、セルの番地をずらす
    this.xml = this.xml.replace(/<row r="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (all, r, attrs, tail, inner) => {
      const n = Number(r);
      if (n < row) return all;
      const nr = shift(n);
      const cells = inner === undefined ? '' : inner.replace(/<c r="([A-Z]+)\d+"/g, (m, c) => `<c r="${c}${nr}"`);
      return `<row r="${nr}"${attrs}${inner === undefined ? '/>' : `>${cells}</row>`}`;
    });
    // 写した行（値は空）を入れる
    const copies = Array.from({ length: count }, (_, i) => {
      const nr = row + i;
      return srcXml.replace(/<row r="\d+"/, `<row r="${nr}"`).replace(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (m, c, a) => `<c r="${c}${nr}"${a.replace(/\s*t="\w+"/, '')}/>`);
    }).join('');
    const nextRe = new RegExp(`<row r="${row + count}"`);
    if (nextRe.test(this.xml)) this.xml = this.xml.replace(nextRe, `${copies}<row r="${row + count}"`);
    else this.xml = this.xml.replace('</sheetData>', `${copies}</sheetData>`);
    // 結合
    const refShift = (ref) => ref.replace(/([A-Z]+)(\d+)/g, (m, c, n) => `${c}${shift(Number(n))}`);
    const srcMerges = [];
    this.xml = this.xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m, ref) => {
      const mm = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ref);
      if (mm && Number(mm[1]) === src && Number(mm[2]) === src) srcMerges.push(ref);
      return `<mergeCell ref="${refShift(ref)}"/>`;
    });
    const added = [];
    for (let i = 0; i < count; i++) for (const ref of srcMerges) added.push(`<mergeCell ref="${ref.replace(/\d+/g, String(row + i))}"/>`);
    this.xml = this.xml.replace(/<mergeCells count="(\d+)">/, (m, n) => `<mergeCells count="${Number(n) + added.length}">${added.join('')}`);
    this.xml = this.xml.replace(/<dimension ref="([^"]+)"\/>/, (m, ref) => `<dimension ref="${refShift(ref)}"/>`);
  }

  // from〜to 行の中だけにある結合を外す
  unmergeRows(from, to) {
    this.xml = this.xml.replace(/<mergeCell ref="[A-Z]+(\d+):[A-Z]+(\d+)"\/>/g, (m, a, b) => (Number(a) >= from && Number(b) <= to ? '' : m));
    this.fixMergeCount();
  }

  merge(...refs) {
    const add = refs.map((ref) => `<mergeCell ref="${ref}"/>`).join('');
    if (/<mergeCells count="\d+">/.test(this.xml)) this.xml = this.xml.replace(/<mergeCells count="\d+">/, (m) => m + add);
    else this.xml = this.xml.replace('</sheetData>', `</sheetData><mergeCells count="0">${add}</mergeCells>`);
    this.fixMergeCount();
  }

  fixMergeCount() {
    const n = (this.xml.match(/<mergeCell ref=/g) || []).length;
    this.xml = this.xml.replace(/<mergeCells count="\d+">/, `<mergeCells count="${n}">`);
  }

  // 列 col で text を含む行を探す
  findRow(col, pred, from = 1, to = 200) {
    for (let r = from; r <= to; r++) if (pred(this.text(`${col}${r}`))) return r;
    return -1;
  }
}

// ---------- 書式（数量の単位を付けた数の表示） ----------

class Styles {
  constructor(xml) {
    this.xml = xml;
    this.cache = new Map();
  }

  // 元の書式 s を写して、数の形を formatCode にしたものの番号を返す
  withFormat(s, formatCode) {
    const key = `${s}|${formatCode}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let id;
    const existing = [...this.xml.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)].find((m) => unesc(m[2]) === formatCode);
    if (existing) id = Number(existing[1]);
    else {
      const ids = [...this.xml.matchAll(/numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
      id = Math.max(199, ...ids) + 1;
      const fmt = `<numFmt numFmtId="${id}" formatCode="${esc(formatCode)}"/>`;
      if (/<numFmts[^>]*>/.test(this.xml)) {
        this.xml = this.xml.replace(/<numFmts count="(\d+)">/, (_, n) => `<numFmts count="${Number(n) + 1}">${fmt}`);
      } else this.xml = this.xml.replace(/(<styleSheet[^>]*>)/, `$1<numFmts count="1">${fmt}</numFmts>`);
    }
    const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(this.xml);
    const xfs = [...m[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((x) => x[0]);
    const base = xfs[Number(s) || 0] || xfs[0];
    let xf = base.replace(/numFmtId="\d+"/, `numFmtId="${id}"`);
    xf = /applyNumberFormat=/.test(xf) ? xf.replace(/applyNumberFormat="\d"/, 'applyNumberFormat="1"') : xf.replace(/<xf\b/, '<xf applyNumberFormat="1"');
    xfs.push(xf);
    this.xml = this.xml.replace(m[0], `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
    const idx = xfs.length - 1;
    this.cache.set(key, idx);
    return idx;
  }
}

const unitFormat = (unit) => (unit ? `General"${unit.replace(/"/g, '')}"` : 'General');

// ---------- 流し込む ----------

// rows：estimateRows() の並び。head：{ 宛名, 日付 }。返り値：{ bytes, used, capacity, truncated }
export async function fillEstimate(templateBytes, rows, est, { 宛名 = '', 日付 = new Date() } = {}) {
  const files = await unzip(templateBytes);
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const wbRels = dec.decode(files.get('xl/_rels/workbook.xml.rels'));
  const wb = dec.decode(files.get('xl/workbook.xml'));
  // 一枚目のシート
  const firstRid = /<sheet [^>]*r:id="([^"]+)"/.exec(wb)[1];
  const target = new RegExp(`Id="${firstRid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstRid}"`).exec(wbRels);
  const sheetPath = 'xl/' + (target[1] || target[2]).replace(/^\/?xl\//, '');
  const strings = parseSharedStrings(files.has('xl/sharedStrings.xml') ? dec.decode(files.get('xl/sharedStrings.xml')) : '');
  const sh = new Sheet(dec.decode(files.get(sheetPath)), strings);
  const st = new Styles(dec.decode(files.get('xl/styles.xml')));

  // 表の位置：見出し「品目」の行の次から、「税額」の行の前まで
  const head = sh.findRow('C', (t) => t.replace(/\s/g, '') === '品目');
  const taxRow = sh.findRow('J', (t) => /税額/.test(t), head + 1);
  const totalRow = sh.findRow('J', (t) => /合計/.test(t), head + 1);
  if (head < 0 || taxRow < 0 || totalRow < 0) throw new Error('雛形に「品目」「税額」「合計(税抜)」の欄が見つかりません');
  const first = head + 1, last = taxRow - 1;
  const capacity = last - first + 1;

  // 入りきらなければ、表の最後の行を写して行を足す（印刷は一枚に収まるよう縮む雛形）
  const use = rows;
  const extra = Math.max(0, use.length - capacity);
  if (extra) sh.insertRows(last + 1, extra, last);
  const rowsTotal = capacity + extra;
  const taxRowN = taxRow + extra, totalRowN = totalRow + extra;

  // 品目の行を空にし、番号を振り直す。書式は、工事の見出しの行を雛形の 1 行目、ほかを 2 行目にそろえ、
  // 結合も 品目（C〜I）・単価（K〜L）・金額（M〜N）にそろえる（雛形の行ごとの太字・赤字が残らないように）。
  const COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  const groupStyle = Object.fromEntries(COLS.map((c) => [c, sh.style(`${c}${first}`)]));
  const lineStyle = Object.fromEntries(COLS.map((c) => [c, sh.style(`${c}${first + 1}`)]));
  sh.unmergeRows(first, first + rowsTotal - 1);
  for (let r = first; r < first + rowsTotal; r++) {
    // 空の雛形を作るときは、1 行目を見出しの書式のまま残す（次に流し込むときの手本になる）
    const isGroup = use.length ? use[r - first]?.type === 'group' : r === first;
    const styles = isGroup ? groupStyle : lineStyle;
    for (const c of COLS) sh.set(`${c}${r}`, { value: null, style: styles[c] });
    sh.set(`B${r}`, { value: r - first + 1 });
    sh.merge(`C${r}:I${r}`, `K${r}:L${r}`, `M${r}:N${r}`);
  }

  const qtyStyle = (r, unit) => st.withFormat(sh.style(`J${r}`), unitFormat(unit));
  const totalRefs = [];
  let total = 0;
  use.forEach((row, i) => {
    const r = first + i;
    if (row.type === 'blank') return;
    sh.set(`C${r}`, { value: row.品目 });
    if (row.数量 !== null && row.数量 !== undefined) {
      if (row.単位 === '一式' || row.単位 === '式') sh.set(`J${r}`, { value: '一式' });
      else sh.set(`J${r}`, { value: row.数量, style: qtyStyle(r, row.単位) });
    }
    if (row.率) {
      // 諸経費：工事の合計に率を掛ける式（Excel で金額を直しても付いてくる）
      const groups = totalRefs.length ? totalRefs.join('+') : '0';
      sh.set(`M${r}`, { formula: `ROUND((${groups})*${row.率},0)`, value: row.金額 });
    } else if (row.type === 'group' && row.children > 0) {
      sh.set(`M${r}`, { formula: `SUM(M${r + 1}:M${r + row.children})`, value: row.金額 });
    } else if (row.単価 !== null && row.単価 !== undefined) {
      sh.set(`K${r}`, { value: row.単価 });
      sh.set(`M${r}`, row.単位 === '一式' ? { value: row.金額 } : { formula: `ROUND(J${r}*K${r},0)`, value: row.金額 });
    } else if (row.金額) {
      sh.set(`M${r}`, { value: row.金額 });
    }
    if (row.type === 'group' || row.type === 'extra') {
      totalRefs.push(`M${r}`);
      total += row.金額 || 0;
    }
  });

  // 合計・税・見積金額（税込）
  const tax = Math.floor(total * est.税率);
  const pct = Math.round(est.税率 * 100);
  sh.set(`M${totalRowN}`, { formula: totalRefs.length ? totalRefs.join('+') : '0', value: total });
  sh.set(`J${taxRowN}`, { value: `${pct}% 税額` });
  sh.set(`M${taxRowN}`, { formula: `ROUNDDOWN(M${totalRowN}*${est.税率},0)`, value: tax });
  const amountRef = (() => {
    const r = sh.findRow('B', (t) => /見積金額/.test(t), 1, head);
    if (r < 0) return null;
    // 金額の欄は、見出しの行か次の行から始まる結合（雛形では C8:G9）
    for (const rr of [r, r + 1]) if (new RegExp(`<mergeCell ref="C${rr}:`).test(sh.xml)) return `C${rr}`;
    return `C${r}`;
  })();
  if (amountRef) sh.set(amountRef, { formula: `M${totalRowN}+M${taxRowN}`, value: total + tax });

  // 宛名と作成日
  const nameRow = sh.findRow('B', (t) => /様/.test(t), 1, head);
  if (nameRow > 0 && 宛名) sh.set(`B${nameRow}`, { value: 宛名 });
  const dateRow = sh.findRow('M', (t) => /作成日/.test(t), 1, head);
  if (dateRow > 0) sh.set(`O${dateRow}`, { value: `${日付.getFullYear()}年 ${日付.getMonth() + 1}月 ${日付.getDate()}日` });

  // 使わなくなった共有文字列を落として番号を振り直す（前の現場の文字が残らないように）
  const used = new Map();
  sh.xml = sh.xml.replace(/(<c r="[A-Z]+\d+"[^>]*?\bt="s"[^>]*>)<v>(\d+)<\/v>/g, (all, open, i) => {
    const s = strings[Number(i)];
    if (!used.has(s)) used.set(s, used.size);
    return `${open}<v>${used.get(s)}</v>`;
  });
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${used.size}" uniqueCount="${used.size}">${[...used.keys()].map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;

  files.set(sheetPath, enc.encode(sh.xml));
  files.set('xl/styles.xml', enc.encode(st.xml));
  files.set('xl/sharedStrings.xml', enc.encode(sst));
  // 開いたときに式を計算し直す。計算の順の控えは古くなるので外す。
  // 印刷範囲も足した行の分だけ下へ
  const wb1 = wb.replace(/(<definedName[^>]*_xlnm\.Print_Area[^>]*>)([^<]+)(<\/definedName>)/g, (m, a, ref, b) => a + ref.replace(/\$(\d+)/g, (x, n) => (Number(n) > last ? `$${Number(n) + extra}` : x)) + b);
  const wb2 = /<calcPr\b[^>]*\/>/.test(wb1) ? wb1.replace(/<calcPr\b([^>]*)\/>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="\w+"/, '')} fullCalcOnLoad="1"/>`) : wb1.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  files.set('xl/workbook.xml', enc.encode(wb2));
  if (files.has('xl/calcChain.xml')) {
    files.delete('xl/calcChain.xml');
    files.set('xl/_rels/workbook.xml.rels', enc.encode(wbRels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, '')));
    const ct = dec.decode(files.get('[Content_Types].xml'));
    files.set('[Content_Types].xml', enc.encode(ct.replace(/<Override [^>]*calcChain[^>]*\/>/, '')));
  }
  // [Content_Types].xml を先頭に
  const order = ['[Content_Types].xml', ...[...files.keys()].filter((k) => k !== '[Content_Types].xml')];
  const bytes = makeZip(order.map((name) => ({ name, data: files.get(name) })));
  return { bytes, used: use.length, capacity, added: extra, total, tax };
}

// 雛形から、表の大きさなどを読む（読み込んだときの確かめ用）
export async function inspectTemplate(templateBytes) {
  const files = await unzip(templateBytes);
  const dec = new TextDecoder();
  const strings = parseSharedStrings(files.has('xl/sharedStrings.xml') ? dec.decode(files.get('xl/sharedStrings.xml')) : '');
  const sheetName = [...files.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  const sh = new Sheet(dec.decode(files.get(sheetName)), strings);
  const head = sh.findRow('C', (t) => t.replace(/\s/g, '') === '品目');
  const taxRow = sh.findRow('J', (t) => /税額/.test(t), head + 1);
  return { ok: head > 0 && taxRow > 0, rows: head > 0 && taxRow > 0 ? taxRow - head - 1 : 0, cell: (ref) => sh.text(ref) };
}
