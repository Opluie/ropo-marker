// 法令データの読み込み（一度読んだ法令はメモリに保持。オフライン時は Service Worker の保存分が返る）

const cache = new Map();

export async function loadIndex() {
  const res = await fetch('./laws/index.json');
  if (!res.ok) throw new Error(`法令一覧を読み込めません（${res.status}）`);
  return res.json();
}

export function loadLaw(lawId) {
  if (!cache.has(lawId)) {
    const p = fetch(`./laws/${lawId}.json`).then((res) => {
      if (!res.ok) throw new Error(`法令データを読み込めません（${res.status}）`);
      return res.json();
    });
    p.catch(() => cache.delete(lawId)); // 失敗したら次回やり直せるように
    cache.set(lawId, p);
  }
  return cache.get(lawId);
}
