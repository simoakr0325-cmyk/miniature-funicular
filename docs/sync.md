# オンラインの自動同期と、iPhone から開く置き場所

いまの置き場所：**https://nawabari.simoakr0325.workers.dev/**（2026-11-12 に置いた）

縄張り台を Cloudflare Workers に置くと、一つの URL で、アプリの配信（iPhone から開ける）と、図の自動同期（PC と iPhone で揃う）の両方ができます。GitHub Pages は使いません。

## しくみ

- `server/worker.js` が一つの Worker。`/api/` 以外はアプリ（`app/`）のファイルを返し、`/api/` は同期の保管庫です。
- アプリのファイルも同じ KV に `file:/〈道〉` として入れます（`tools/upload-app.mjs`）。Workers の静的アセットを使わないのは、上げる時に使い捨ての鍵を使うため、トークンを中継で差し込む作業環境からは上げられないからです。
- 図と下図の画像は Cloudflare KV に置きます。図は端末どうしと同じ決まり（部材ごとに新しい方を採る）で合わせるので、電波の無い間に二台で別々に直しても、つながれば両方が残ります。
- `/api/` は合言葉（`SYNC_KEY`、長い鍵）が合うときだけ読み書きできます。アプリの画面は誰でも開けますが、合言葉が無ければ中身は空です。
- 端末では、直してから 15 秒ほどで自動で送り、画面を開いたとき・電波が戻ったとき・1 分ごとに、ほかの端末の変更を取り込みます。引いている・描いている最中は待ちます。見本の庭は送りません。

## 置き方（一度だけ）

Cloudflare のアカウントと、Node.js が要ります。

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create STORE
```

出てきた `id` を `wrangler.toml` の STORE の `id` に入れます（いまの置き場所の id は入れてあります）。

```bash
npx wrangler secret put SYNC_KEY
```

合言葉（英数 24 字以上の、人に当てられない文字列）を入れます。

```bash
node tools/upload-app.mjs
```

```bash
npx wrangler deploy
```

出てきた `https://nawabari.〈アカウント名〉.workers.dev/` がアプリの URL です。

## アプリを直したとき

`app/` を直したら、変わったファイルだけを送ります（Worker 自体を直したときは `npx wrangler deploy` も）。Service Worker の `VERSION` を上げておくと、iPhone も次に開いたときに新しくなります。

```bash
node tools/upload-app.mjs
```

## 端末をつなぐ

1. PC でその URL を開き、「Obsidian」→「オンラインの自動同期」に合言葉を入れて「つなぐ」。
2. 「ほかの端末に渡すリンクをコピー」で出るリンクを iPhone に送り（AirDrop・自分宛てのメモなど）、Safari で開いて「ホーム画面に追加」。リンクには合言葉が入っているので、人には渡さないでください。
3. 別の端末で作った現場は、左上の現場名 →「サーバにあって、この端末に無い図」から取り込みます。

## 手元で試す

```bash
SYNC_KEY=himitsu node tools/serve.mjs
```

`SYNC_DIR=./.sync` を付けると、保管庫の中身をファイルに残します。

## 目安と限り

- 無料枠の KV は一日 1,000 回の書き込みまで。中身が変わらない同期は書き込まないので、ふつうの使い方なら収まります。
- 端末から現場を消しても、サーバの図は残ります。
- KV の一覧は反映に一分ほどかかるため、サーバは一日分の目録（`index`）も持ち、新しく作った現場がほかの端末にすぐ出るようにしています。
- Obsidian との受け渡し（ノート・図の絵・下図）はこれまでどおり使えます。同期はそれとは別の道です。
