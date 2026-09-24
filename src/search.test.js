import { describe, expect, test } from 'vitest';
import { findArticleKey, kanjiToInt, normalize, parseQuery } from './search.js';

const LAWS = [
  { lawId: 'MIN', title: '民法', abbr: ['民'] },
  { lawId: 'MINSO', title: '民事訴訟法', abbr: ['民訴'] },
  { lawId: 'SHAKU', title: '借地借家法', abbr: ['借地借家'] },
  { lawId: 'KAI', title: '会社法', abbr: ['会社'] },
];

describe('kanjiToInt', () => {
  test.each([
    ['九', 9], ['十', 10], ['十五', 15], ['百', 100], ['七百九', 709],
    ['千五十', 1050], ['九百七十九', 979], ['三十', 30],
  ])('%s → %i', (s, n) => expect(kanjiToInt(s)).toBe(n));
});

describe('normalize', () => {
  test('全角・空白・漢数字', () => expect(normalize('民法　第七百九条')).toBe('民法第709条'));
  test('ハイフンは「の」', () => expect(normalize('709-2')).toBe('709の2'));
});

describe('parseQuery', () => {
  test.each([
    ['民709', { lawId: 'MIN', key: '709' }],
    ['民法709条', { lawId: 'MIN', key: '709' }],
    ['民法第七百九条', { lawId: 'MIN', key: '709' }],
    ['民 94 2項', { lawId: 'MIN', key: '94', para: 2 }],
    ['民3の2', { lawId: 'MIN', key: '3_2' }],
    ['民訴248', { lawId: 'MINSO', key: '248' }], // 「民」より長い「民訴」を優先
    ['民事訴訟法248条', { lawId: 'MINSO', key: '248' }],
    ['会社2条1項3号', { lawId: 'KAI', key: '2', para: 1, item: 3 }],
    ['借地借家3', { lawId: 'SHAKU', key: '3' }],
    ['会社', { lawId: 'KAI' }],
  ])('%s', (q, want) => expect(parseQuery(LAWS, q)).toEqual(expect.objectContaining(want)));

  test('法令名の省略は表示中の法令', () =>
    expect(parseQuery(LAWS, '709', 'MIN')).toEqual(expect.objectContaining({ lawId: 'MIN', key: '709' })));
  test('法令名なし・表示中の法令もなし', () => expect(parseQuery(LAWS, '709').error).toBeTruthy());
  test('読めない入力', () => expect(parseQuery(LAWS, '民あいう').error).toBeTruthy());
});

describe('findArticleKey', () => {
  const arts = [{ key: '37' }, { key: '38:84' }, { key: '85' }, { key: '3_2' }];
  test('そのまま', () => expect(findArticleKey(arts, '3_2')).toBe('3_2'));
  test('範囲削除に含まれる', () => expect(findArticleKey(arts, '40')).toBe('38:84'));
  test('範囲の端', () => expect(findArticleKey(arts, '84')).toBe('38:84'));
  test('存在しない', () => expect(findArticleKey(arts, '999')).toBeNull());
});
