// お気に入りの法令（端末の localStorage に法令IDの配列で保存。マーカーと違い、書き出しの対象外）

const KEY = 'ropo-favorites';

export function loadFavorites() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 保存できなくても、その回の表示には反映される
  }
}
