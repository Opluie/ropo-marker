// 条番号検索: 「民709」「民法第七百九条」「709の2」「会社2条1項3号」などを正規化して条を引く。

const KANJI_DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNITS = { 十: 10, 百: 100, 千: 1000 };

/** 漢数字（位取り式: 千五十 = 1050）を整数に */
export function kanjiToInt(s) {
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in KANJI_DIGITS) cur = KANJI_DIGITS[ch];
    else {
      total += (cur || 1) * KANJI_UNITS[ch];
      cur = 0;
    }
  }
  return total + cur;
}

/** 全角→半角・空白除去・漢数字→算用数字・「の」の別表記（- _ ‐）をそろえる */
export function normalize(q) {
  return q
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[〇一二三四五六七八九十百千]+/g, (m) => String(kanjiToInt(m)))
    .replace(/[-_‐−ー](?=\d)/g, 'の');
}

const REF = /^第?(\d+)(?:条)?((?:の\d+)*)(?:第?(\d+)項)?(?:第?(\d+)号)?$/;

/** 条の key（"3_2"・"38:84"）を比較用の数列に */
export function keyTuple(key) {
  return key.split('_').map(Number);
}

function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 条の key を探す。範囲削除（"38:84"）に含まれる番号はその範囲の条を返す */
export function findArticleKey(articles, key) {
  if (articles.some((a) => a.key === key)) return key;
  const t = keyTuple(key);
  const hit = articles.find((a) => {
    if (!a.key.includes(':')) return false;
    const [from, to] = a.key.split(':').map(keyTuple);
    return cmp(from, t) <= 0 && cmp(t, to) <= 0;
  });
  return hit ? hit.key : null;
}

/**
 * 法令名（正式名・略称）の最長一致で法令を特定する。
 * laws: index.json の配列。戻り値 { law, rest } または null
 */
export function matchLaw(laws, q) {
  let best = null;
  for (const law of laws) {
    for (const name of [law.title, ...law.abbr]) {
      if (q.startsWith(name) && (!best || name.length > best.name.length)) best = { law, name };
    }
  }
  return best && { law: best.law, rest: q.slice(best.name.length) };
}

/**
 * 検索語を解釈する。
 * 戻り値: { lawId, key?, para?, item? } または { error }
 *   key が無いときは法令の先頭を開く。
 * currentLawId: 法令名が省略されたときに使う法令（表示中の法令）
 */
export function parseQuery(laws, raw, currentLawId) {
  const q = normalize(raw);
  if (!q) return { error: '' };
  const m = matchLaw(laws, q);
  const lawId = m ? m.law.lawId : currentLawId;
  const rest = m ? m.rest.replace(/^法/, '') : q; // 「民法」を略称「民」＋「法」と読んだ場合
  if (!lawId) return { error: '法令名が分かりません（例: 民709）' };
  if (!rest) return { lawId };
  const r = rest.match(REF);
  if (!r) return { error: `「${raw}」を条番号として読めません` };
  const key = [r[1], ...r[2].split('の').slice(1)].join('_');
  return {
    lawId,
    key,
    para: r[3] ? Number(r[3]) : undefined,
    item: r[4] ? Number(r[4]) : undefined,
  };
}
