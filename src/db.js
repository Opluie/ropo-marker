// マーカーの保存先（IndexedDB）。端末の中にだけあり、リポジトリや公開サイトには出ない。

const DB_NAME = 'ropo-marker';
const STORE = 'markers';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('lawId', 'lawId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMarkers(lawId) {
  const db = await open();
  return done(db.transaction(STORE).objectStore(STORE).index('lawId').getAll(lawId));
}

export async function getAllMarkers() {
  const db = await open();
  return done(db.transaction(STORE).objectStore(STORE).getAll());
}

/** 保存と削除を1回の取引（トランザクション）でまとめて行う。途中で失敗したら全部取り消される */
export async function saveMarkers(put, del = []) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  put.forEach((m) => store.put(m));
  del.forEach((id) => store.delete(id));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('マーカーを保存できませんでした'));
  });
}

/** ブラウザが容量不足のときに勝手にデータを消さないよう頼む（許可されないこともある） */
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
