import { describe, expect, it } from 'vitest';
import { refLabel, splitRefs } from './refs.js';

describe('splitRefs', () => {
  const segs = [
    { text: 'あいう', color: null },
    { text: 'えお', color: 'yellow' },
    { text: 'かき', color: null },
  ];

  it('リンクが無ければそのまま', () => {
    expect(splitRefs(segs, undefined).map((s) => s.text)).toEqual(['あいう', 'えお', 'かき']);
  });

  it('マーカーの区間をまたぐリンクは区間ごとに切れ、どちらも同じリンクを指す', () => {
    // 「うえ」（2〜4）がリンク
    expect(splitRefs(segs, [[2, 4, null, '1', null]])).toEqual([
      { text: 'あい', color: null, ref: null },
      { text: 'う', color: null, ref: 0 },
      { text: 'え', color: 'yellow', ref: 0 },
      { text: 'お', color: 'yellow', ref: null },
      { text: 'かき', color: null, ref: null },
    ]);
  });

  it('リンクが複数・区間の中に収まる', () => {
    const r = splitRefs([{ text: 'あいうえおか', color: null }], [[0, 1, null, '1', null], [3, 5, null, '2', 1]]);
    expect(r.map((s) => [s.text, s.ref])).toEqual([['あ', 0], ['いう', null], ['えお', 1], ['か', null]]);
  });
});

describe('refLabel', () => {
  const laws = [{ lawId: 'M', title: '民法', abbr: ['民'] }];
  it('略称・枝番・項', () => {
    expect(refLabel(laws, { lawId: 'M', key: '3_2', para: 2 })).toBe('民3の2②');
    expect(refLabel(laws, { lawId: 'M', key: '94', para: null })).toBe('民94');
  });
});
