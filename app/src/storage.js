// 端末の中の自動保存（IndexedDB）。

const DB_NAME = 'nawabari';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      if (e.oldVersion < 1) {
        req.result.createObjectStore('docs', { keyPath: 'id' });
        req.result.createObjectStore('kv');
      }
      if (e.oldVersion < 2) req.result.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveDoc = (doc) => run('docs', 'readwrite', (s) => s.put(doc));
export const loadDoc = (id) => run('docs', 'readonly', (s) => s.get(id));
export const deleteDoc = (id) => run('docs', 'readwrite', (s) => s.delete(id));
export const listDocs = () => run('docs', 'readonly', (s) => s.getAll());
export const getKV = (k) => run('kv', 'readonly', (s) => s.get(k));
export const setKV = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k));
// 下図の画像。中身の指紋を鍵にするので、同じ画像は一つで済む。
export const getBlob = (hash) => run('blobs', 'readonly', (s) => s.get(hash));
export const putBlob = (hash, blob) => run('blobs', 'readwrite', (s) => s.put(blob, hash));

// iPhone では、ホーム画面に追加したうえでこれを通すと消されにくくなる。
export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
