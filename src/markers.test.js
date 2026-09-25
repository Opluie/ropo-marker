import { describe, expect, it } from 'vitest';
import {
  ERASE,
  makeBackup,
  makeQuote,
  paint,
  parseBackup,
  resolve,
  segments,
  textsByLoc,
  usedParas,
} from './markers.js';

const TEXT = '前項の規定による意思表示の無効は、善意の第三者に対抗することができない。';
const LOC = '94/p2';
const LAW = '129AC0000000089';

function ids() {
  let n = 0;
  return () => `n${++n}`;
}

/** 塗った結果を反映した後の一覧（テスト用に保存処理をまねる） */
function apply(list, { put, del }) {
  const map = new Map(list.map((m) => [m.id, m]));
  del.forEach((id) => map.delete(id));
  put.forEach((m) => map.set(m.id, m));
  return [...map.values()].sort((a, b) => a.start - b.start);
}

function run(steps) {
  const newId = ids();
  let list = [];
  for (const [start, end, color] of steps) {
    list = apply(list, paint(list, { lawId: LAW, loc: LOC, start, end, color }, TEXT, { now: 't', newId }));
  }
  return list.map((m) => [m.start, m.end, m.color, m.quote.exact]);
}

const at = (s) => [TEXT.indexOf(s), TEXT.indexOf(s) + s.length];

describe('paint', () => {
  it('塗ると quote も保存される', () => {
    const [s, e] = at('善意の第三者');
    expect(run([[s, e, 'yellow']])).toEqual([[s, e, 'yellow', '善意の第三者']]);
  });

  it('別の色で中を塗ると3つに分かれる', () => {
    const [s, e] = at('善意の第三者');
    const [ms] = at('意の');
    const r = run([
      [s, e, 'yellow'],
      [ms + 1, ms + 2, 'red'],
    ]);
    expect(r.map((x) => x[3])).toEqual(['善意', 'の', '第三者']);
    expect(r.map((x) => x[2])).toEqual(['yellow', 'red', 'yellow']);
  });

  it('同じ色で重ねるとつながって1件になる', () => {
    const [s] = at('善意');
    const [, e] = at('第三者');
    const r = run([
      [s, s + 3, 'yellow'],
      [s + 2, e, 'yellow'],
    ]);
    expect(r).toEqual([[s, e, 'yellow', '善意の第三者']]);
  });

  it('隣り合う同じ色もつながる', () => {
    const [s, e] = at('善意の第三者');
    const r = run([
      [s, s + 2, 'blue'],
      [s + 2, e, 'blue'],
    ]);
    expect(r).toEqual([[s, e, 'blue', '善意の第三者']]);
  });

  it('上から別の色で全部塗ると置き換わる', () => {
    const [s, e] = at('善意の第三者');
    expect(run([
      [s, e, 'yellow'],
      [s - 1, e + 1, 'red'],
    ])).toEqual([[s - 1, e + 1, 'red', TEXT.slice(s - 1, e + 1)]]);
  });

  it('消すと選んだ範囲だけ消える', () => {
    const [s, e] = at('善意の第三者');
    const r = run([
      [s, e, 'yellow'],
      [s + 2, s + 3, ERASE],
    ]);
    expect(r.map((x) => x[3])).toEqual(['善意', '第三者']);
  });

  it('何も無い所を消しても何も起きない', () => {
    expect(run([[0, 5, ERASE]])).toEqual([]);
  });

  it('左の残りは元の id を引き継ぎ、作成日時も保つ', () => {
    const newId = ids();
    const first = paint([], { lawId: LAW, loc: LOC, start: 0, end: 10, color: 'yellow' }, TEXT, { now: 'old', newId });
    const r = paint(first.put, { lawId: LAW, loc: LOC, start: 5, end: 20, color: 'red' }, TEXT, { now: 'new', newId });
    const left = r.put.find((m) => m.color === 'yellow');
    expect(left.id).toBe(first.put[0].id);
    expect(left.createdAt).toBe('old');
    expect(r.del).toEqual([]);
  });
});

describe('resolve（改正で本文が変わったときの探し直し）', () => {
  const m = { start: 17, end: 23, quote: makeQuote(TEXT, 17, 23) };

  it('位置が合えばそのまま', () => {
    expect(resolve(m, TEXT)).toEqual({ start: 17, end: 23 });
  });

  it('前に文字が増えたら探し直す', () => {
    expect(resolve(m, 'ＸＸ' + TEXT)).toEqual({ start: 19, end: 25 });
  });

  it('無くなっていたら null', () => {
    expect(resolve(m, TEXT.replace('善意の第三者', '第三者'))).toBeNull();
  });

  it('同じ語が複数あれば前後の文字が合う方', () => {
    const t = 'Ａの者。Ｂの者。';
    const mk = { start: 5, end: 7, quote: makeQuote(t, 5, 7) }; // 「の者」の2つ目
    expect(resolve({ ...mk, start: 0, end: 2 }, 'ＺＺ' + t)).toEqual({ start: 7, end: 9 });
  });
});

describe('segments', () => {
  it('塗った所と塗っていない所に切る', () => {
    const r = segments('あいうえお', [{ start: 1, end: 3, color: 'red', quote: { exact: 'いう' } }]);
    expect(r).toEqual([
      { text: 'あ', color: null },
      { text: 'いう', color: 'red' },
      { text: 'えお', color: null },
    ]);
  });

  it('マーカーが無ければ1区間', () => {
    expect(segments('あいう')).toEqual([{ text: 'あいう', color: null }]);
  });
});

describe('textsByLoc', () => {
  it('項と号（入れ子の号も）の本文を拾い、未対応要素は飛ばす', () => {
    const law = {
      articles: [
        {
          key: '13',
          paragraphs: [
            { num: 1, text: '本文', items: [{ num: '1', text: '一号', items: [{ num: '1', text: 'イ' }] }] },
            { kind: 'unsupported', text: '表' },
          ],
        },
      ],
    };
    expect([...textsByLoc(law)]).toEqual([
      ['13/p1', '本文'],
      ['13/p1/i1', '一号'],
      ['13/p1/i1/i1', 'イ'],
    ]);
  });
});

describe('書き出し・読み込み', () => {
  const marker = { id: 'a', lawId: LAW, loc: LOC, start: 17, end: 23, color: 'yellow', quote: makeQuote(TEXT, 17, 23), createdAt: 't' };

  it('書き出したものを読み込むと元に戻る', () => {
    const file = JSON.stringify(makeBackup([marker], 'now'));
    expect(parseBackup(file)).toEqual([marker]);
  });

  it('別のファイルは断る', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow('書き出しファイルではありません');
    expect(() => parseBackup('あ')).toThrow('JSON');
  });

  it('壊れたマーカーがあれば件数を示して断る', () => {
    const file = makeBackup([marker, { ...marker, color: 'purple' }], 'now');
    expect(() => parseBackup(file)).toThrow('1 件');
  });
});

describe('色の読み替え・使った項', () => {
  it('試作版の赤・青は橙・緑として読み込む', () => {
    const old = { id: 'a', lawId: LAW, loc: LOC, start: 17, end: 23, color: 'red', quote: makeQuote(TEXT, 17, 23) };
    const file = makeBackup([old, { ...old, id: 'b', color: 'blue' }], 'now');
    expect(parseBackup(file).map((m) => m.color)).toEqual(['orange', 'green']);
  });

  it('マーカーのある項の番号を拾う（号のマーカーは項に数える）', () => {
    expect([...usedParas([{ loc: '13/p1/i5' }, { loc: '13/p3' }, { loc: '13/p1' }])]).toEqual([1, 3]);
    expect(usedParas(undefined).size).toBe(0);
  });
});
