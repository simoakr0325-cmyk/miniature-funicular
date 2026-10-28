// 端末の中の自動保存（IndexedDB）。

const DB_NAME = 'nawabari';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('docs', { keyPath: 'id' });
      req.result.createObjectStore('kv');
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

// iPhone では、ホーム画面に追加したうえでこれを通すと消されにくくなる。
export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
