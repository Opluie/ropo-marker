// 画面上の選択範囲を、マーカーの位置（loc と本文中の文字位置）に直す。
// 本文は <span data-loc="94/p2"> で包んであり、中身は本文の文字だけ（マーカーの <mark> を含む）。

/** span の先頭から（node, offset）までの文字数 */
function offsetIn(span, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(span);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** 選択範囲 → [{ loc, start, end }]（項・号をまたぐ選択は loc ごとに分ける） */
export function rangeToPieces(range, root) {
  const pieces = [];
  for (const span of root.querySelectorAll('[data-loc]')) {
    if (!range.intersectsNode(span)) continue;
    const len = span.textContent.length;
    const start = span.contains(range.startContainer) ? offsetIn(span, range.startContainer, range.startOffset) : 0;
    const end = span.contains(range.endContainer) ? offsetIn(span, range.endContainer, range.endOffset) : len;
    if (start < end) pieces.push({ loc: span.dataset.loc, start, end });
  }
  return pieces;
}

/** いま root の中の本文が選択されていれば、その範囲（の写し）を返す */
export function currentRange(root) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

/** 画面の座標にある文字の位置（案②のなぞり用） */
export function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}
