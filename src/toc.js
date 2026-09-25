// 目次と「今いる場所」（第二編 物権 › 第三章 所有権 › … › 第二百六条）

/** 条key → その条を含む目次ノードの列（編 → 章 → 節 → 款 …） */
export function tocPaths(toc) {
  const map = new Map();
  const walk = (nodes, path) => {
    for (const n of nodes) {
      if (typeof n === 'string') map.set(n, path);
      else walk(n.children, [...path, n]);
    }
  };
  walk(toc, []);
  return map;
}

/**
 * 画面上端（y）にかかっている条の番号（0 始まり）。条は上から順に並んでいるので二分探索する。
 * bottomOf(i) は i 番目の条の下端。全部 y より上なら length（＝本則を過ぎて附則にいる）
 */
export function indexAt(length, bottomOf, y) {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
