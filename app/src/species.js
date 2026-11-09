// 樹種ライブラリ。正本は Obsidian の vault の「10_辞書/植木」のノート（frontmatter に 分類: 植木）。
// 内蔵の一覧は、そのノートの元にするためのもの。vault から読んだノートがあれば、和名が同じものはそちらを採る。
//
// frontmatter に入れるのは、図鑑で確かめられることだけ：和名・読み・学名・科（APG 体系）・常落・葉形。
// 区分（高木・中木・低木・地被）は造園での使い方の目安。規格（H・W・C、m）と単価は空にしておき、山波創苑の
// 仕入れの決まりで埋めてもらう。耐寒性などの地域の数値は、根拠の資料（確認事項 11）が決まるまで入れない。

const RAW = `
ヤマボウシ|やまぼうし|Cornus kousa|ミズキ科|落葉|広葉|高木
ハナミズキ|はなみずき|Cornus florida|ミズキ科|落葉|広葉|高木
アオダモ|あおだも|Fraxinus lanuginosa f. serrata|モクセイ科|落葉|広葉|高木
シマトネリコ|しまとねりこ|Fraxinus griffithii|モクセイ科|半常緑|広葉|高木
イロハモミジ|いろはもみじ|Acer palmatum|ムクロジ科|落葉|広葉|高木
ハウチワカエデ|はうちわかえで|Acer japonicum|ムクロジ科|落葉|広葉|高木
コハウチワカエデ|こはうちわかえで|Acer sieboldianum|ムクロジ科|落葉|広葉|高木
エゴノキ|えごのき|Styrax japonicus|エゴノキ科|落葉|広葉|高木
ナツツバキ|なつつばき|Stewartia pseudocamellia|ツバキ科|落葉|広葉|高木
ヒメシャラ|ひめしゃら|Stewartia monadelpha|ツバキ科|落葉|広葉|高木
シラカバ|しらかば|Betula platyphylla var. japonica|カバノキ科|落葉|広葉|高木
アカシデ|あかしで|Carpinus laxiflora|カバノキ科|落葉|広葉|高木
イヌシデ|いぬしで|Carpinus tschonoskii|カバノキ科|落葉|広葉|高木
コナラ|こなら|Quercus serrata|ブナ科|落葉|広葉|高木
クヌギ|くぬぎ|Quercus acutissima|ブナ科|落葉|広葉|高木
ケヤキ|けやき|Zelkova serrata|ニレ科|落葉|広葉|高木
カツラ|かつら|Cercidiphyllum japonicum|カツラ科|落葉|広葉|高木
ソメイヨシノ|そめいよしの|Prunus × yedoensis 'Somei-yoshino'|バラ科|落葉|広葉|高木
ヤマザクラ|やまざくら|Prunus jamasakura|バラ科|落葉|広葉|高木
ウメ|うめ|Prunus mume|バラ科|落葉|広葉|高木
ナナカマド|ななかまど|Sorbus commixta|バラ科|落葉|広葉|高木
コブシ|こぶし|Magnolia kobus|モクレン科|落葉|広葉|高木
ハクモクレン|はくもくれん|Magnolia denudata|モクレン科|落葉|広葉|高木
サルスベリ|さるすべり|Lagerstroemia indica|ミソハギ科|落葉|広葉|高木
リョウブ|りょうぶ|Clethra barbinervis|リョウブ科|落葉|広葉|高木
カラマツ|からまつ|Larix kaempferi|マツ科|落葉|針葉|高木
ソヨゴ|そよご|Ilex pedunculosa|モチノキ科|常緑|広葉|高木
モチノキ|もちのき|Ilex integra|モチノキ科|常緑|広葉|高木
シラカシ|しらかし|Quercus myrsinifolia|ブナ科|常緑|広葉|高木
アラカシ|あらかし|Quercus glauca|ブナ科|常緑|広葉|高木
ヤマモモ|やまもも|Morella rubra|ヤマモモ科|常緑|広葉|高木
オリーブ|おりーぶ|Olea europaea|モクセイ科|常緑|広葉|高木
アカマツ|あかまつ|Pinus densiflora|マツ科|常緑|針葉|高木
クロマツ|くろまつ|Pinus thunbergii|マツ科|常緑|針葉|高木
ゴヨウマツ|ごようまつ|Pinus parviflora|マツ科|常緑|針葉|高木
モミ|もみ|Abies firma|マツ科|常緑|針葉|高木
ドイツトウヒ|どいつとうひ|Picea abies|マツ科|常緑|針葉|高木
ヒノキ|ひのき|Chamaecyparis obtusa|ヒノキ科|常緑|針葉|高木
サワラ|さわら|Chamaecyparis pisifera|ヒノキ科|常緑|針葉|高木
スギ|すぎ|Cryptomeria japonica|ヒノキ科|常緑|針葉|高木
イチイ|いちい|Taxus cuspidata|イチイ科|常緑|針葉|高木
マユミ|まゆみ|Euonymus sieboldianus|ニシキギ科|落葉|広葉|中木
キンモクセイ|きんもくせい|Osmanthus fragrans var. aurantiacus|モクセイ科|常緑|広葉|中木
ヒイラギ|ひいらぎ|Osmanthus heterophyllus|モクセイ科|常緑|広葉|中木
ネズミモチ|ねずみもち|Ligustrum japonicum|モクセイ科|常緑|広葉|中木
ヤブツバキ|やぶつばき|Camellia japonica|ツバキ科|常緑|広葉|中木
サザンカ|さざんか|Camellia sasanqua|ツバキ科|常緑|広葉|中木
カクレミノ|かくれみの|Dendropanax trifidus|ウコギ科|常緑|広葉|中木
ウバメガシ|うばめがし|Quercus phillyreoides|ブナ科|常緑|広葉|中木
イヌツゲ|いぬつげ|Ilex crenata|モチノキ科|常緑|広葉|中木
マサキ|まさき|Euonymus japonicus|ニシキギ科|常緑|広葉|中木
レッドロビン|れっどろびん|Photinia × fraseri 'Red Robin'|バラ科|常緑|広葉|中木
ゴールドクレスト|ごーるどくれすと|Cupressus macrocarpa 'Goldcrest'|ヒノキ科|常緑|針葉|中木
ドウダンツツジ|どうだんつつじ|Enkianthus perulatus|ツツジ科|落葉|広葉|低木
レンゲツツジ|れんげつつじ|Rhododendron molle subsp. japonicum|ツツジ科|落葉|広葉|低木
ミツバツツジ|みつばつつじ|Rhododendron dilatatum|ツツジ科|落葉|広葉|低木
ヤマブキ|やまぶき|Kerria japonica|バラ科|落葉|広葉|低木
ユキヤナギ|ゆきやなぎ|Spiraea thunbergii|バラ科|落葉|広葉|低木
コデマリ|こでまり|Spiraea cantoniensis|バラ科|落葉|広葉|低木
シモツケ|しもつけ|Spiraea japonica|バラ科|落葉|広葉|低木
アジサイ|あじさい|Hydrangea macrophylla|アジサイ科|落葉|広葉|低木
アナベル|あなべる|Hydrangea arborescens 'Annabelle'|アジサイ科|落葉|広葉|低木
ニシキギ|にしきぎ|Euonymus alatus|ニシキギ科|落葉|広葉|低木
ミヤギノハギ|みやぎのはぎ|Lespedeza thunbergii|マメ科|落葉|広葉|低木
コムラサキ|こむらさき|Callicarpa dichotoma|シソ科|落葉|広葉|低木
ヒュウガミズキ|ひゅうがみずき|Corylopsis pauciflora|マンサク科|落葉|広葉|低木
トサミズキ|とさみずき|Corylopsis spicata|マンサク科|落葉|広葉|低木
ロウバイ|ろうばい|Chimonanthus praecox|ロウバイ科|落葉|広葉|低木
レンギョウ|れんぎょう|Forsythia suspensa|モクセイ科|落葉|広葉|低木
メギ|めぎ|Berberis thunbergii|メギ科|落葉|広葉|低木
サツキ|さつき|Rhododendron indicum|ツツジ科|常緑|広葉|低木
ヒラドツツジ|ひらどつつじ|Rhododendron × pulchrum|ツツジ科|常緑|広葉|低木
クルメツツジ|くるめつつじ|Rhododendron × obtusum|ツツジ科|常緑|広葉|低木
ジンチョウゲ|じんちょうげ|Daphne odora|ジンチョウゲ科|常緑|広葉|低木
アセビ|あせび|Pieris japonica|ツツジ科|常緑|広葉|低木
ナンテン|なんてん|Nandina domestica|メギ科|常緑|広葉|低木
ヒイラギナンテン|ひいらぎなんてん|Mahonia japonica|メギ科|常緑|広葉|低木
センリョウ|せんりょう|Sarcandra glabra|センリョウ科|常緑|広葉|低木
マンリョウ|まんりょう|Ardisia crenata|サクラソウ科|常緑|広葉|低木
キャラボク|きゃらぼく|Taxus cuspidata var. nana|イチイ科|常緑|針葉|低木
ハイネズ|はいねず|Juniperus conferta|ヒノキ科|常緑|針葉|地被
フッキソウ|ふっきそう|Pachysandra terminalis|ツゲ科|常緑|広葉|地被
リュウノヒゲ|りゅうのひげ|Ophiopogon japonicus|キジカクシ科|常緑|広葉|地被
`;

export const KUBUN = ['高木', '中木', '低木', '地被'];

export const BUILTIN = RAW.trim().split('\n').map((line) => {
  const [和名, 読み, 学名, 科, 常落, 葉形, 区分] = line.split('|');
  return { 分類: '植木', 和名, 読み, 学名, 科, 常落, 葉形, 区分, 規格H: null, 規格W: null, 規格C: null, 単価: null, from: 'builtin' };
});

// ---------- frontmatter ----------

// 平らな frontmatter（key: value と、key の下の「- 値」の並び）だけを読む。
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(String(text));
  if (!m) return null;
  const out = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(raw);
    if (item && listKey) {
      out[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([^:\s][^:]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].trim();
    if (val === '') {
      out[key] = [];
      listKey = key;
    } else {
      listKey = null;
      out[key] = val.startsWith('[') && val.endsWith(']') ? val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean) : unquote(val);
    }
  }
  // 中身の無い「key:」は空の並びではなく空の値とみなす
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && !v.length && k !== 'tags' && k !== 'aliases') out[k] = null;
  return out;
}

function unquote(s) {
  const t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"');
  return t;
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) ? n : null;
};

// 植木のノートなら樹種の形にして返す。違えば null。
export function parseSpeciesNote(text, fileName = '') {
  const fm = parseFrontmatter(text);
  if (!fm || fm.分類 !== '植木') return null;
  const 和名 = fm.和名 || String(fileName).replace(/\.md$/i, '').trim();
  if (!和名) return null;
  return {
    分類: '植木', 和名,
    読み: fm.読み || '', 学名: fm.学名 || '', 科: fm.科 || '', 常落: fm.常落 || '', 葉形: fm.葉形 || '', 区分: fm.区分 || '',
    規格H: numOrNull(fm.規格H), 規格W: numOrNull(fm.規格W), 規格C: numOrNull(fm.規格C), 単価: numOrNull(fm.単価),
    from: 'vault',
  };
}

const yq = (s) => (s === null || s === undefined || s === '' ? '' : /[:#'"[\]{}&*!|>%@`]|^\s|\s$/.test(String(s)) ? ` "${String(s).replace(/"/g, '\\"')}"` : ` ${s}`);

// 樹種をノートにする（vault の 10_辞書/植木 に置く元）。
export function toSpeciesNote(sp) {
  return [
    '---',
    '分類: 植木',
    `和名:${yq(sp.和名)}`,
    `読み:${yq(sp.読み)}`,
    `学名:${yq(sp.学名)}`,
    `科:${yq(sp.科)}`,
    `常落:${yq(sp.常落)}`,
    `葉形:${yq(sp.葉形)}`,
    `区分:${yq(sp.区分)}`,
    `規格H:${yq(sp.規格H)}`,
    `規格W:${yq(sp.規格W)}`,
    `規格C:${yq(sp.規格C)}`,
    `単価:${yq(sp.単価)}`,
    'tags:',
    '  - 植木',
    '---',
    '',
    `# ${sp.和名}`,
    '',
    '> 規格は山波創苑で標準に仕入れる大きさ（H 樹高・W 葉張・C 幹周、いずれも m）。縄張り台で樹木を置くと、H と W を初めの大きさに使います。単価は円（税抜）。',
    '',
    '## メモ',
    '',
    '',
  ].join('\n');
}

export const speciesFileName = (sp) => `${sp.和名.replace(/[\\/:*?"<>|#^[\]]/g, '-')}.md`;

// 内蔵と vault を合わせる。和名が同じなら vault の方。並びは区分 → 読み。
export function mergeLibrary(vaultList = [], builtin = BUILTIN) {
  const map = new Map(builtin.map((s) => [s.和名, s]));
  for (const s of vaultList) map.set(s.和名, s);
  const order = (s) => (KUBUN.includes(s.区分) ? KUBUN.indexOf(s.区分) : KUBUN.length);
  return [...map.values()].sort((a, b) => order(a) - order(b) || (a.読み || a.和名).localeCompare(b.読み || b.和名, 'ja'));
}

export const findSpecies = (lib, name) => lib.find((s) => s.和名 === String(name || '').trim()) || null;
