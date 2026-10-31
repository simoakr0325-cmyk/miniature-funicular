import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, createUnderlay } from '../app/src/model.js';
import { toNote } from '../app/src/obsidian.js';
import { cleanFolderBlobs } from '../app/src/vault.js';

// File System Access のフォルダの代わり。
function fakeFolder(files) {
  const map = new Map(Object.entries(files));
  return {
    map,
    queryPermission: async () => 'granted',
    async *entries() {
      for (const [name, body] of map) yield [name, { kind: 'file', getFile: async () => new Blob([body]) }];
    },
    removeEntry: async (name) => { map.delete(name); },
  };
}

test('フォルダの掃除は、どのノートからも使われていない下図だけを消す', async () => {
  const d = createDoc({ siteName: 'A' });
  d.underlays.push(createUnderlay({ blob: 'aaaaaaaaaaaaaaaa', mime: 'image/jpeg', w: 10, h: 10 }));
  const gone = createUnderlay({ blob: 'bbbbbbbbbbbbbbbb', mime: 'image/png', w: 10, h: 10 });
  gone.deleted = true;
  d.underlays.push(gone);
  const h = fakeFolder({
    'A_縄張り.md': toNote(d),
    '下図_aaaaaaaaaaaaaaaa.jpg': 'x'.repeat(100),
    '下図_bbbbbbbbbbbbbbbb.png': 'y'.repeat(200),
    '下図_cccccccccccccccc.jpg': 'z'.repeat(300),
    '下図_メモ.jpg': 'keep',
    'ほかの写真.jpg': 'keep',
  });
  const r = await cleanFolderBlobs(h);
  assert.deepEqual(r, { count: 2, bytes: 500 });
  assert.deepEqual([...h.map.keys()].sort(), ['A_縄張り.md', 'ほかの写真.jpg', '下図_aaaaaaaaaaaaaaaa.jpg', '下図_メモ.jpg'].sort());
});
