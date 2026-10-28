# 縄張り台（仮称）

山波創苑の外構・造園CAD。ブラウザだけで動き、電波のない現場でも開けます（PC が主、iPhone が従）。
2D の図が唯一の正本で、数量はそこから出します。一現場は一つの Obsidian ノートとして受け渡します。

## 動かす

```bash
npm start
```

`http://localhost:8080/` を開きます。外部ライブラリもビルドも要りません（Node.js 18 以上）。
iPhone で使うには、`app/` を HTTPS の置き場（Cloudflare Pages など）に置き、Safari で開いて「ホーム画面に追加」します。

## 試験

```bash
npm test
```

## 使い方の要点

| 操作 | PC | iPhone |
| --- | --- | --- |
| 描く | 左の道具を選び、点を押す | 下の道具を選び、点をタップ |
| 閉じる・終える | 最初の点／Enter／ダブルクリック | 最初の点／「確定」 |
| 長さで打つ | 数字を打って Enter（`3000`、角度付きは `3000,90`） | 帯の「長さ」欄に入れる |
| 動かす | 「選ぶ」で引く。Shift で 45°、Alt で吸着なし | 「選ぶ」で引く |
| 画面を動かす | 何もない所を引く／スペース＋引く／ホイールで拡大縮小 | 指で引く／二本指でつまむ |
| 元に戻す | Ctrl+Z／Ctrl+Y | 上の矢印 |
| そのほか | Delete 削除、Ctrl+D 複製、F 全体、G 方眼、Esc 取消 | 「詳細」で右の欄を出す |

## Obsidian との受け渡し

[docs/obsidian.md](docs/obsidian.md) を見てください。

## 中身

- `app/` アプリ本体（静的ファイルのみ）
  - `src/model.js` 図のデータの形、合わせ（同期）、数量
  - `src/obsidian.js` ノートへの書き出しと読み込み
  - `src/vault.js` vault のフォルダへの直接書き込み、共有シート
  - `src/geometry.js` `src/hit.js` `src/render.js` `src/main.js` 計算・当たり判定・描画・操作
- `tests/` 試験（`node --test`）
- `docs/` 確認事項・機能台帳・受け渡しの説明
