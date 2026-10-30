// 文字列を Shift_JIS（Windows-31J）のバイト列にする。
// 変換表は持たず、ブラウザの読み取り（TextDecoder）を逆引きして初めて使うときに作る。

let table = null;

function build() {
  const dec = new TextDecoder('shift_jis');
  table = new Map();
  const lead = [...range(0x81, 0x9f), ...range(0xe0, 0xfc)];
  for (const a of lead) {
    for (const b of [...range(0x40, 0x7e), ...range(0x80, 0xfc)]) {
      const ch = dec.decode(new Uint8Array([a, b]));
      // 同じ字に複数の符号があるとき（NEC 選定 IBM 拡張など）は先に見つかった方を使う。
      if (ch.length === 1 && ch !== '�' && !table.has(ch)) table.set(ch, [a, b]);
    }
  }
  for (let c = 0xa1; c <= 0xdf; c++) table.set(dec.decode(new Uint8Array([c])), [c]); // 半角カナ
}

function* range(a, b) {
  for (let i = a; i <= b; i++) yield i;
}

// 表せない字は「?」にする。
export function encodeSjis(s) {
  if (!table) build();
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (table.has(ch)) out.push(...table.get(ch));
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}
