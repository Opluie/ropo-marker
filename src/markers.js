// マーカーの計算（画面・保存から切り離した純粋な関数。テストは markers.test.js）
//
// 位置は文字列アンカー方式（仕様書 §4.4）: loc（条/項/号）の本文の中の start〜end と、
// 改正後に探し直すための quote（塗った文字列と前後の文字）で持つ。
// 1つの loc の中でマーカーは重ならない（後から塗った色で上書きする）。

export const COLORS = ['yellow', 'red', 'blue'];
export const ERASE = 'erase';
const CONTEXT = 20; // quote の前後に残す文字数

/** 条（とその項・号）の loc。附則は安定した ID が無いので対象外 */
export function paraLoc(artKey, paraNum) {
  return `${artKey}/p${paraNum}`;
}
export function itemLoc(parentLoc, itemNum) {
  return `${parentLoc}/i${itemNum}`;
}
export function artKeyOf(loc) {
  return loc.slice(0, loc.indexOf('/'));
}

/** 法令データから loc → 本文 の対応表を作る */
export function textsByLoc(law) {
  const map = new Map();
  const walkItems = (items, parent) => {
    for (const it of items ?? []) {
      if (it.kind === 'unsupported') continue;
      const loc = itemLoc(parent, it.num);
      map.set(loc, it.text);
      walkItems(it.items, loc);
    }
  };
  for (const a of law.articles) {
    for (const p of a.paragraphs) {
      if (p.kind === 'unsupported') continue;
      const loc = paraLoc(a.key, p.num);
      map.set(loc, p.text);
      walkItems(p.items, loc);
    }
  }
  return map;
}

export function makeQuote(text, start, end) {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

/**
 * 保存された位置が今の本文と合うか確かめ、ずれていれば quote.exact で探し直す。
 * 候補が複数あれば前後の文字（prefix/suffix）が一番よく合う所、同点なら元の位置に近い所。
 * 見つからなければ null（表示しない。データは消さない）。
 */
export function resolve(m, text) {
  const { exact, prefix = '', suffix = '' } = m.quote;
  if (!exact) return null;
  if (text.slice(m.start, m.end) === exact) return { start: m.start, end: m.end };
  let best = null;
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
    const score =
      (text.slice(0, i).endsWith(prefix) ? 2 : 0) + (text.slice(i + exact.length).startsWith(suffix) ? 2 : 0);
    const dist = Math.abs(i - m.start);
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { i, score, dist };
  }
  return best && { start: best.i, end: best.i + exact.length };
}

/** 本文を塗り分けの区間に切る → [{ text, color|null }] */
export function segments(text, markers = []) {
  const spans = markers
    .map((m) => ({ ...resolve(m, text), color: m.color }))
    .filter((s) => s.start != null && s.start < s.end)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue; // 探し直しの結果で重なったら先の方を優先
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), color: null });
    out.push({ text: text.slice(s.start, s.end), color: s.color });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), color: null });
  return out;
}

/**
 * 1つの loc に塗る（color が ERASE なら消す）。
 * existing: その loc の保存済みマーカー。戻り値 { put: 保存し直すもの, del: 削除する id }
 */
export function paint(existing, { lawId, loc, start, end, color }, text, { now, newId }) {
  const stamp = (m) => ({ ...m, quote: makeQuote(text, m.start, m.end) });
  // 位置を今の本文に合わせる（探し直せないものは触らない）
  const live = [];
  for (const m of existing) {
    const r = resolve(m, text);
    if (r) live.push({ ...m, ...r });
  }

  let next = [];
  for (const m of live) {
    if (m.end <= start || m.start >= end) next.push(m);
    else {
      if (m.start < start) next.push({ ...m, end: start }); // 左の残り（id を引き継ぐ）
      if (m.end > end) next.push({ ...m, id: newId(), start: end }); // 右の残り
    }
  }
  if (color !== ERASE) {
    let add = { id: newId(), lawId, loc, start, end, color, createdAt: now };
    // 隣り合う同じ色はつなげる
    next = next.filter((m) => {
      if (m.color !== color || (m.end !== add.start && m.start !== add.end)) return true;
      add = { ...add, start: Math.min(add.start, m.start), end: Math.max(add.end, m.end) };
      return false;
    });
    next.push(add);
  }

  const before = new Map(live.map((m) => [m.id, m]));
  const orig = new Map(existing.map((m) => [m.id, m]));
  const keep = new Set(next.map((m) => m.id));
  return {
    put: next
      .filter((m) => {
        const o = orig.get(m.id);
        return !o || o.start !== m.start || o.end !== m.end;
      })
      .map(stamp),
    del: [...before.keys()].filter((id) => !keep.has(id)),
  };
}

// ---- 書き出し・読み込み ----

export const BACKUP_APP = 'ropo-marker';
export const BACKUP_VERSION = 1;

export function makeBackup(markers, now) {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, markers };
}

function isMarker(m) {
  return (
    m &&
    typeof m.id === 'string' &&
    typeof m.lawId === 'string' &&
    typeof m.loc === 'string' &&
    m.loc.includes('/') &&
    Number.isInteger(m.start) &&
    Number.isInteger(m.end) &&
    m.start < m.end &&
    COLORS.includes(m.color) &&
    m.quote &&
    typeof m.quote.exact === 'string' &&
    m.quote.exact.length > 0
  );
}

/** 読み込んだファイルの中身を確かめ、マーカーの配列を返す（形式が違えば Error） */
export function parseBackup(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('JSON ファイルとして読めません');
  }
  if (data?.app !== BACKUP_APP || !Array.isArray(data.markers))
    throw new Error('六法マーカーの書き出しファイルではありません');
  if (data.version > BACKUP_VERSION) throw new Error('新しい版のアプリで書き出したファイルです。アプリを更新してください');
  const bad = data.markers.filter((m) => !isMarker(m)).length;
  if (bad) throw new Error(`壊れたマーカーが ${bad} 件あります`);
  return data.markers;
}
