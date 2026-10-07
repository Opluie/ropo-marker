// 参照リンク（変換時に検出済み。scripts/refs.py）の表示用の計算。テストは refs.test.js
//
// 本文の refs: [[開始, 終了, 法令ID or null（同じ法令）, 条key, 項番号 or null], ...]

/**
 * マーカーで塗り分けた区間（segments の結果）を、参照リンクの境目でさらに切る。
 * → [{ text, color, ref }]（ref はリンクなら refs の添字、リンクでなければ null）
 */
export function splitRefs(segs, refs) {
  if (!refs?.length) return segs.map((s) => ({ ...s, ref: null }));
  const out = [];
  let pos = 0;
  for (const s of segs) {
    const end = pos + s.text.length;
    let cur = pos;
    while (cur < end) {
      const i = refs.findIndex((r) => r[0] <= cur && cur < r[1]);
      let next;
      if (i >= 0) next = Math.min(end, refs[i][1]);
      else next = Math.min(end, ...refs.filter((r) => r[0] > cur).map((r) => r[0]));
      out.push({ text: s.text.slice(cur - pos, next - pos), color: s.color, ref: i >= 0 ? i : null });
      cur = next;
    }
    pos = end;
  }
  return out;
}

/** 参照先 { lawId, key, para } の短い呼び名（民94②・民93）。laws は index.json */
export function refLabel(laws, { lawId, key, para }) {
  const meta = laws.find((l) => l.lawId === lawId);
  const name = meta?.abbr?.[0] ?? meta?.title ?? '';
  const circled = para && para <= 20 ? String.fromCharCode(0x2460 + para - 1) : para ? `-${para}` : '';
  return `${name}${key.replace(/_/g, 'の').replace(':', '〜')}${circled}`;
}
