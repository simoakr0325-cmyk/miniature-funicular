// Obsidian の vault との受け渡し。
// PC（Chrome・Edge）：vault の中のフォルダを一度選べば、そこへ直接読み書きする。
// iPhone など：ファイルを選んで読み込み、共有シート（「ファイルに保存」）で書き出す。

import { getKV, setKV } from './storage.js';
import { toNote, fromNote, noteFileName, isNawabariNote } from './obsidian.js';
import { mergeDocs } from './model.js';

export const canUseFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function getFolder() {
  return (await getKV('vaultFolder')) || null;
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'nawabari-vault', mode: 'readwrite' });
  await setKV('vaultFolder', handle);
  return handle;
}

async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// フォルダ内の縄張りノートを一覧する。
export async function listNotes(handle) {
  if (!(await ensurePermission(handle))) throw new Error('フォルダを使う許可がありません');
  const out = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !name.endsWith('.md')) continue;
    const file = await entry.getFile();
    const text = await file.text();
    if (!isNawabariNote(text)) continue;
    try {
      out.push({ name, doc: fromNote(text), modified: file.lastModified });
    } catch (err) {
      out.push({ name, error: err.message, modified: file.lastModified });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

// フォルダの中の同じ図（図ID が同じノート）と合わせてから書き込む。
// 返り値の doc は合わせた結果。端末側もこれに置き換える。
export async function syncToFolder(handle, doc) {
  const notes = await listNotes(handle);
  const same = notes.find((n) => n.doc && n.doc.id === doc.id);
  let result = doc;
  let changed = 0;
  if (same) ({ doc: result, changed } = mergeDocs(doc, same.doc));
  let name = noteFileName(result);
  if (!same || same.name !== name) {
    // 同じ名前の別のノートがあれば上書きしない。
    const existing = await handle.getFileHandle(name).catch(() => null);
    if (existing) name = name.replace(/\.md$/, `_${result.id.slice(0, 8)}.md`);
  }
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(toNote(result));
  await w.close();
  // 現場名を変えてファイル名が変わったときは、古いノートを残さない。
  if (same && same.name !== name) await handle.removeEntry(same.name);
  return { doc: result, name, pulled: changed };
}

export async function readNoteFiles(files) {
  const out = [];
  for (const f of files) {
    try {
      out.push({ name: f.name, doc: fromNote(await f.text()) });
    } catch (err) {
      out.push({ name: f.name, error: err.message });
    }
  }
  return out;
}

// 共有シートが使えればそれで、使えなければダウンロードで書き出す。
export async function exportNote(doc) {
  const name = noteFileName(doc);
  const file = new File([toNote(doc)], name, { type: 'text/markdown' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
