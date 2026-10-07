import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadLaw } from './data.js';
import { findArticleKey } from './search.js';
import { lawHref } from './App.jsx';
import { refLabel, splitRefs } from './refs.js';
import { getMarkers, saveMarkers } from './db.js';
import { COLORS, ERASE, artKeyOf, itemLoc, paint, paraLoc, segments, textsByLoc, usedParas } from './markers.js';
import { currentRange, rangeToPieces } from './selection.js';
import { indexAt, tocPaths } from './toc.js';

const FILTERS = [
  ['all', '全て'],
  ['marked', 'マーカーあり'],
  ['unmarked', 'マーカーなし'],
];

const COLOR_LABEL = { yellow: '黄', green: '緑', [ERASE]: '消す' };

/**
 * 要素まで移動する。画面外の条は描画を省略している（content-visibility）ため、
 * 移動した直後に周りの条の高さが確定して位置がずれる。位置が落ち着くまで数フレームやり直す。
 */
function scrollSettled(el, tries = 8) {
  el.scrollIntoView({ block: 'start' });
  const before = el.getBoundingClientRect().top;
  requestAnimationFrame(() => {
    if (tries > 1 && Math.abs(el.getBoundingClientRect().top - before) > 1) scrollSettled(el, tries - 1);
    else if (tries > 1) requestAnimationFrame(() => {
      if (Math.abs(el.getBoundingClientRect().top - before) > 1) scrollSettled(el, tries - 1);
    });
  });
}

/** 目次ノードの中で最初の条 */
function firstKey(node) {
  for (const c of node.children) {
    if (typeof c === 'string') return c;
    const k = firstKey(c);
    if (k) return k;
  }
  return null;
}

/** 目次。path（今いる条を含む編・章・節…）に入っている項目を強調する */
function Toc({ nodes, lawId, onPick, path, depth = 0 }) {
  return (
    <ul className={`toc d${depth}`}>
      {nodes
        .filter((n) => typeof n !== 'string')
        .map((n, i) => (
          <li key={i}>
            <a href={lawHref(lawId, firstKey(n))} onClick={onPick} className={path.includes(n) ? 'cur' : undefined}>
              {n.title}
            </a>
            {n.children.some((c) => typeof c !== 'string') && (
              <Toc nodes={n.children} lawId={lawId} onPick={onPick} path={path} depth={depth + 1} />
            )}
          </li>
        ))}
    </ul>
  );
}

/**
 * 本文（マーカーの単位）。loc が無ければ（附則）素の文字。
 * markable のときだけ data-loc を付けて選択して塗れるようにする（参照の小窓では塗らない）。
 * 参照（refs）は押せる文字にする。リンクは <a href> にしない（長押しで文字を選べなくなるため）
 */
function Text({ text, loc, marks, refs, lawId, markable }) {
  if (!loc) return text;
  const own = marks?.filter((m) => m.loc === loc);
  return (
    <span data-loc={markable ? loc : undefined}>
      {splitRefs(segments(text, own), refs).map((s, i) => {
        let el = s.color ? <mark className={`mk mk-${s.color}`}>{s.text}</mark> : s.text;
        if (s.ref != null) {
          const [, , law, key, para] = refs[s.ref];
          el = (
            <span className="ref" data-law={law ?? lawId} data-key={key} data-para={para ?? ''}>
              {el}
            </span>
          );
        }
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </span>
  );
}

function Items({ items, parentLoc, ...rest }) {
  return (
    <ul className="items">
      {items.map((it, i) => {
        if (it.kind === 'unsupported') return <li key={i} className="unsupported">{it.text}</li>;
        const loc = parentLoc && itemLoc(parentLoc, it.num);
        return (
          <li key={i}>
            <span className="item-title">{it.title}</span>
            <Text text={it.text} loc={loc} refs={it.refs} {...rest} />
            {it.items && <Items items={it.items} parentLoc={loc} {...rest} />}
          </li>
        );
      })}
    </ul>
  );
}

// marks はこの条のマーカー。変わった条だけ描き直すため、条ごとの配列を渡す
// マーカーを引いた項は番号に色を付ける（第1項は条名で示す。ほかの項だけなら条名は下線）
// 附則（suppl）は条番号が附則ごとに重なり位置を決められないので、マーカー・参照なし
const Article = memo(function Article({ a, idPrefix, suppl, markable, marks, lawId }) {
  const locOf = (num) => !suppl && paraLoc(a.key, num);
  const rest = { marks, lawId, markable };
  const used = usedParas(marks);
  const titleClass = used.has(a.paragraphs[0]?.num) ? ' used' : used.size ? ' used-sub' : '';
  return (
    <article id={`${idPrefix}${a.key}`} className="art">
      {a.caption && <div className="caption">{a.caption}</div>}
      {a.paragraphs.map((p, i) =>
        p.kind === 'unsupported' ? (
          <p key={i} className="unsupported">{p.text}</p>
        ) : (
          <div key={i} className="para" id={`${idPrefix}${a.key}-p${p.num}`}>
            {p.caption && <div className="caption">{p.caption}</div>}
            <p>
              {i === 0 && a.title ? (
                <span className={'art-title' + titleClass}>{a.title}</span>
              ) : (
                p.label && <span className={'para-num' + (used.has(p.num) ? ' used' : '')}>{p.label}</span>
              )}
              <Text text={p.text} loc={locOf(p.num)} refs={p.refs} {...rest} />
            </p>
            {p.items && <Items items={p.items} parentLoc={locOf(p.num)} {...rest} />}
          </div>
        ),
      )}
    </article>
  );
});

/** マーカーの一覧 → 条ごとの配列 */
function groupByArticle(list) {
  const map = new Map();
  for (const m of list) {
    const k = artKeyOf(m.loc);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  return map;
}

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const HISTORY_MAX = 100;

/**
 * 開いている法令のマーカーの読み込みと、選択範囲に塗る処理・取り消し・やり直し。
 * 1回の操作（塗る・消す）を「触った loc のマーカーの前と後」で記録し、取り消しは前に、やり直しは後に戻す
 */
function useMarkers(law, mainRef, onMessage) {
  const [byArt, setByArt] = useState(() => new Map());
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const busy = useRef(false); // 保存中にもう一度押されても同じ操作を二重に戻さない
  const texts = useMemo(() => (law ? textsByLoc(law) : null), [law]);

  useEffect(() => {
    setByArt(new Map());
    setHist({ undo: [], redo: [] });
    if (!law) return;
    let alive = true;
    getMarkers(law.lawId).then(
      (list) => alive && setByArt(groupByArticle(list)),
      () => onMessage('マーカーを読み込めませんでした'),
    );
    return () => {
      alive = false;
    };
  }, [law, onMessage]);

  /** locs のマーカーを from の状態から to の状態に置き換えて保存する。失敗したら false */
  const replace = useCallback(
    async (locs, from, to) => {
      const keep = new Set(to.map((m) => m.id));
      try {
        await saveMarkers(to, from.filter((m) => !keep.has(m.id)).map((m) => m.id));
      } catch {
        onMessage('マーカーを保存できませんでした');
        return false;
      }
      // 変わった条の配列だけ作り直す（ほかの条は描き直さない）
      setByArt((prev) => {
        const next = new Map(prev);
        for (const k of new Set([...locs].map(artKeyOf))) {
          const others = (prev.get(k) ?? []).filter((m) => !locs.has(m.loc));
          next.set(k, [...others, ...to.filter((m) => artKeyOf(m.loc) === k)]);
        }
        return next;
      });
      return true;
    },
    [onMessage],
  );

  const apply = useCallback(
    async (color, range) => {
      const pieces = rangeToPieces(range, mainRef.current);
      if (!pieces.length) return;
      const now = new Date().toISOString();
      const locs = new Set(pieces.map((pc) => pc.loc));
      const before = [...locs].flatMap((loc) => (byArt.get(artKeyOf(loc)) ?? []).filter((m) => m.loc === loc));
      const put = [];
      const del = new Set();
      for (const pc of pieces) {
        const existing = before.filter((m) => m.loc === pc.loc);
        const r = paint(existing, { lawId: law.lawId, color, ...pc }, texts.get(pc.loc), { now, newId });
        put.push(...r.put);
        r.del.forEach((id) => del.add(id));
      }
      if (!put.length && !del.size) return;
      const changed = new Set(put.map((m) => m.id));
      const after = [...before.filter((m) => !del.has(m.id) && !changed.has(m.id)), ...put];
      if (await replace(locs, before, after))
        setHist((h) => ({ undo: [...h.undo, { locs, before, after }].slice(-HISTORY_MAX), redo: [] }));
    },
    [byArt, law, texts, mainRef, replace],
  );

  const step = useCallback(
    async (back) => {
      const op = (back ? hist.undo : hist.redo).at(-1);
      if (!op || busy.current) return;
      busy.current = true;
      const ok = back ? await replace(op.locs, op.after, op.before) : await replace(op.locs, op.before, op.after);
      busy.current = false;
      if (!ok) return;
      setHist((h) =>
        back ? { undo: h.undo.slice(0, -1), redo: [...h.redo, op] } : { undo: [...h.undo, op], redo: h.redo.slice(0, -1) },
      );
      onMessage(back ? 'マーカーを1つ戻しました' : 'マーカーを1つ進めました');
    },
    [hist, replace, onMessage],
  );

  return { byArt, apply, step, canUndo: hist.undo.length > 0, canRedo: hist.redo.length > 0 };
}

/**
 * 本文を選択している間だけ、画面上部（検索欄の下）に色ボタンを出す。
 * 画面下は Android の検索パネル（かんたん検索）が重なって押せないため上に置く
 */
function SelectBar({ mainRef, apply }) {
  const [range, setRange] = useState(null);

  useEffect(() => {
    const onChange = () => setRange(mainRef.current && currentRange(mainRef.current));
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [mainRef]);

  if (!range) return null;
  // 指が触れた時点で塗る。離す頃にはスマホが選択を解除していることがあるため
  const press = (color) => (e) => {
    e.preventDefault();
    apply(color, range);
    window.getSelection()?.removeAllRanges();
    setRange(null);
  };
  return (
    <div className="mk-bar" role="toolbar" aria-label="マーカー">
      {[...COLORS, ERASE].map((c) => (
        <button key={c} className={`mk-btn mk-btn-${c}`} onPointerDown={press(c)}>
          {COLOR_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

/** 画面上端にかかっている条の key（本則を過ぎていれば null＝附則）。articles は今表示している条 */
function keyAtTop(articles, header) {
  if (!articles.length) return null;
  const y = header.getBoundingClientRect().bottom + 1;
  const bottomOf = (k) => document.getElementById(`a-${articles[k].key}`).getBoundingClientRect().bottom;
  return articles[indexAt(articles.length, bottomOf, y)]?.key ?? null;
}

function crumbText(law, paths, key) {
  if (!key) return '附則';
  const a = law.articles.find((x) => x.key === key);
  return [...(paths.get(key) ?? []).map((n) => n.title), a?.title].filter(Boolean).join(' › ');
}

/** 今いる場所を1行で出す（入りきらなければ先頭側を省略して、条名は必ず見せる）。押すと目次 */
function Crumb({ law, articles, paths, headerRef, onOpen }) {
  const [key, setKey] = useState(undefined);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      if (headerRef.current) setKey(keyAtTop(articles, headerRef.current));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [law, articles, headerRef]);
  return (
    <button className="crumb" onClick={onOpen} aria-label="今いる場所（押すと目次）">
      <span dir="ltr">{key === undefined ? '\u00a0' : crumbText(law, paths, key)}</span>
    </button>
  );
}

const SECT_LEVEL = { 編: 1, 章: 2, 節: 3, 款: 4, 目: 5 };

/** 本文中の編・章・節…の見出し。前に表示した条と違う所から下だけ出す（絞り込み中も、出ている条の見出しが出る） */
function Headings({ path = [], prev = [] }) {
  let d = 0;
  while (d < path.length && path[d] === prev[d]) d++;
  return path.slice(d).map((n, i) => (
    <h2 key={i} className={`sect sect-${SECT_LEVEL[n.type] ?? 5}`}>
      {n.title}
    </h2>
  ));
}

/** 押された参照の行き先 { lawId, key, para }。文字を選んでいる最中は参照として扱わない */
function refAt(target) {
  const el = target.closest?.('.ref');
  if (!el || !window.getSelection()?.isCollapsed) return null;
  return { lawId: el.dataset.law, key: el.dataset.key, para: el.dataset.para ? Number(el.dataset.para) : null };
}

const sameRef = (a, b) => a && b && a.lawId === b.lawId && a.key === b.key && a.para === b.para;

/**
 * 参照先を画面下半分の小窓に出す。本文はそのまま（閉じれば元の位置）。
 * 小窓の中の参照を押すと小窓の中で次へ進み、上の道筋（民94 › 民93 › …）で好きな段まで戻れる
 */
function RefSheet({ laws, stack, setStack, onJump, onMessage }) {
  const top = stack.at(-1);
  const [view, setView] = useState(null); // { ref, law, marks }
  const bodyRef = useRef(null);
  const trailRef = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadLaw(top.lawId), getMarkers(top.lawId).catch(() => [])]).then(
      ([law, list]) => alive && setView({ ref: top, law, marks: groupByArticle(list) }),
      () => alive && onMessage('参照先の法令を読み込めませんでした'),
    );
    return () => {
      alive = false;
    };
  }, [top, onMessage]);

  const ready = view && view.ref === top;
  const key = ready ? findArticleKey(view.law.articles, top.key) : null;
  const article = key && view.law.articles.find((a) => a.key === key);

  // 参照先の項を小窓の上の方に出して一瞬色を付ける。道筋は最後（今見ている所）が見えるように
  useEffect(() => {
    trailRef.current?.scrollTo({ left: trailRef.current.scrollWidth });
    const body = bodyRef.current;
    if (!article || !body) return;
    body.scrollTop = 0;
    const el = top.para && body.querySelector(`[id="r-${article.key}-p${top.para}"]`);
    if (!el) return;
    // 第1項なら条名・見出しから見せる
    if (top.para !== article.paragraphs[0]?.num)
      body.scrollTop = el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [article, top]);

  const onClick = (e) => {
    const r = refAt(e.target);
    if (r && !sameRef(r, top)) setStack([...stack, r]);
  };

  return (
    <section className="sheet" aria-label="参照先">
      <div className="sheet-head">
        <button className="sheet-btn" onClick={() => setStack(stack.slice(0, -1))} disabled={stack.length < 2} aria-label="1つ前の参照先へ">
          ‹
        </button>
        <div className="sheet-trail" ref={trailRef}>
          {stack.map((r, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="sheet-sep">›</span>}
              <button aria-current={i === stack.length - 1 || undefined} onClick={() => setStack(stack.slice(0, i + 1))}>
                {refLabel(laws, r)}
              </button>
            </Fragment>
          ))}
        </div>
        <button className="sheet-btn" onClick={() => setStack([])} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="sheet-body law" ref={bodyRef} onClick={onClick}>
        {!ready ? (
          <p className="notice">読み込み中…</p>
        ) : !article ? (
          <p className="notice">参照先の条が見つかりません</p>
        ) : (
          <>
            <p className="sheet-law">{view.law.title}</p>
            <Article a={article} idPrefix="r-" marks={view.marks.get(article.key)} lawId={view.law.lawId} />
          </>
        )}
      </div>
      <div className="sheet-foot">
        <button onClick={() => onJump(top)} disabled={!article}>
          この条へ移動
        </button>
      </div>
    </section>
  );
}

export default function LawView({ laws, route, searchBox, onMessage, onGo }) {
  const meta = laws.find((l) => l.lawId === route.lawId);
  const [law, setLaw] = useState(null);
  const [error, setError] = useState('');
  const [tocKey, setTocKey] = useState(undefined); // 目次を開いた時点で今いた条（undefined＝閉じている）
  const [filter, setFilter] = useState('all'); // 表示する条: 全て / マーカーのある条 / マーカーのない条
  const [markedKeys, setMarkedKeys] = useState(() => new Set()); // 絞り込みを押した時点でマーカーのあった条
  const [scrollTick, setScrollTick] = useState(0);
  const mainRef = useRef(null);
  const headerRef = useRef(null);
  const drawerRef = useRef(null);
  const { byArt, apply, step, canUndo, canRedo } = useMarkers(law, mainRef, onMessage);
  const [refStack, setRefStack] = useState([]); // 参照の小窓で辿った参照先（空＝閉じている）
  const [refOrigin, setRefOrigin] = useState(null); // 小窓を開いた参照のあった場所 { lawId, key, para }
  const [returns, setReturns] = useState([]); // 「この条へ移動」で離れた場所（戻るボタンで1つずつ戻る）
  const paths = useMemo(() => (law ? tocPaths(law.toc) : new Map()), [law]);
  // 絞り込みの対象は押した時点で固定する。塗った（消した）条がその場で消えると操作しづらいため。同じボタンをもう一度押すと更新する
  const pickFilter = (f) => {
    setMarkedKeys(new Set([...byArt].filter(([, ms]) => ms.length).map(([k]) => k)));
    setFilter(f);
  };
  const shown = useMemo(() => {
    if (!law || filter === 'all') return law?.articles ?? [];
    return law.articles.filter((a) => markedKeys.has(a.key) === (filter === 'marked'));
  }, [law, filter, markedKeys]);
  const tocOpen = tocKey !== undefined;
  const openToc = () => setTocKey(keyAtTop(shown, headerRef.current));
  const closeToc = () => setTocKey(undefined);

  // 上部バーの高さ（検索欄・今いる場所の行を含む）を CSS に渡す。条へ移動したときの位置合わせと色ボタンの位置に使う
  useEffect(() => {
    const el = headerRef.current;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 目次を開いたら、今いる所が見える位置までスクロールする
  useEffect(() => {
    if (!tocOpen) return;
    const cur = drawerRef.current?.querySelectorAll('a.cur');
    cur?.[cur.length - 1]?.scrollIntoView({ block: 'center' });
  }, [tocOpen]);

  useEffect(() => {
    setLaw(null);
    setError('');
    setFilter('all');
    loadLaw(route.lawId).then(setLaw, (e) => setError(e.message));
  }, [route.lawId]);

  // 検索・目次で指定された条（と項）へスクロールし、一瞬色を付ける
  useEffect(() => {
    if (!law) return;
    if (!route.key) {
      window.scrollTo(0, 0);
      return;
    }
    const key = findArticleKey(law.articles, route.key);
    if (!key) {
      onMessage(`${law.title}に第${route.key.replace(/_/g, 'の')}条はありません`);
      return;
    }
    const id = `a-${key}` + (route.para ? `-p${route.para}` : '');
    const el = document.getElementById(id) || document.getElementById(`a-${key}`);
    if (!el) {
      // 絞り込みで隠れている条への移動は、絞り込みを解いてからやり直す
      setFilter('all');
      setScrollTick((t) => t + 1);
      return;
    }
    if (route.para && !document.getElementById(id)) onMessage(`第${route.para}項はありません`);
    scrollSettled(el);
    el.classList.remove('flash');
    void el.offsetWidth; // アニメーションをやり直すため
    el.classList.add('flash');
  }, [law, route, onMessage, scrollTick]);

  // 移動したら参照の小窓は閉じる
  useEffect(() => setRefStack([]), [route]);

  // 本文の参照を押したら小窓を開く。その参照が小窓に隠れる位置なら、本文を少し上げて見えるようにする
  const onMainClick = (e) => {
    const r = refAt(e.target);
    if (!r) return;
    const para = e.target.closest('.para');
    const m = para?.id.match(/^a-(.+)-p(\d+)$/);
    if (!m) return;
    setRefOrigin({ lawId: law.lawId, key: m[1], para: Number(m[2]) });
    setRefStack([r]);
    const y = e.target.getBoundingClientRect().bottom;
    const limit = window.innerHeight * 0.4;
    if (y > limit) window.scrollBy({ top: y - limit, behavior: 'smooth' });
  };

  const jumpTo = (target) => {
    setReturns((rs) => [...rs, refOrigin]);
    onGo(lawHref(target.lawId, target.key, target.para));
  };
  const goBack = () => {
    const o = returns.at(-1);
    setReturns((rs) => rs.slice(0, -1));
    onGo(lawHref(o.lawId, o.key, o.para));
  };

  // 附則はマーカーを引けないので、絞り込み中は出さない
  const suppl = useMemo(() => (filter === 'all' ? law?.suppl ?? [] : []), [law, filter]);

  if (!meta) return <p className="notice">この法令は登載されていません。<a href="#/">一覧へ</a></p>;

  return (
    <>
      <header className="bar" ref={headerRef}>
        <div className="bar-row">
          <a className="bar-btn" href="#/" aria-label="法令一覧へ">
            ‹
          </a>
          <h1 className="bar-title">{meta.title}</h1>
          <button className="bar-btn bar-icon" onClick={() => step(true)} disabled={!canUndo} aria-label="マーカーを1つ戻す">
            ↶
          </button>
          <button className="bar-btn bar-icon" onClick={() => step(false)} disabled={!canRedo} aria-label="マーカーを1つ進める">
            ↷
          </button>
          <button className="bar-btn" onClick={openToc} disabled={!law}>
            目次
          </button>
        </div>
        {searchBox}
        <div className="view-filter" role="group" aria-label="表示する条文">
          {FILTERS.map(([f, label]) => (
            <button key={f} aria-pressed={filter === f} disabled={!law} onClick={() => pickFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        {law ? <Crumb law={law} articles={shown} paths={paths} headerRef={headerRef} onOpen={openToc} /> : <div className="crumb">{'\u00a0'}</div>}
      </header>

      {tocOpen && law && (
        <div className="drawer-bg" onClick={closeToc}>
          <nav className="drawer" ref={drawerRef} onClick={(e) => e.stopPropagation()} aria-label="目次">
            <div className="drawer-head">
              <span>目次</span>
              <button className="bar-btn" onClick={closeToc}>
                閉じる
              </button>
            </div>
            <p className="drawer-cur">今いる場所: {crumbText(law, paths, tocKey)}</p>
            <Toc nodes={law.toc} lawId={law.lawId} onPick={closeToc} path={paths.get(tocKey) ?? []} />
            {suppl.length > 0 && (
              <button
                className="toc-suppl"
                onClick={() => {
                  // URL の # は画面切り替えに使っているので、アンカーリンクにせず直接開いて移動する
                  const d = document.getElementById('suppl');
                  d.open = true;
                  closeToc();
                  d.scrollIntoView({ block: 'start' });
                }}
              >
                附則
              </button>
            )}
          </nav>
        </div>
      )}

      <main className="law" ref={mainRef} onClick={onMainClick}>
        {error && <p className="notice">{error}</p>}
        {!law && !error && <p className="notice">読み込み中…</p>}
        {law && (
          <>
            <p className="law-head">
              {law.lawNum}
              <br />
              {law.enforcementDate} 施行版
            </p>
            {!shown.length && (
              <p className="notice">
                {filter === 'marked' ? 'マーカーを引いた条文はありません' : 'マーカーのない条文はありません'}
              </p>
            )}
            {shown.map((a, i) => (
              <Fragment key={a.key}>
                <Headings path={paths.get(a.key)} prev={i ? paths.get(shown[i - 1].key) : undefined} />
                <Article a={a} idPrefix="a-" markable marks={byArt.get(a.key)} lawId={law.lawId} />
              </Fragment>
            ))}
            {suppl.length > 0 && (
              <details id="suppl" className="suppl">
                <summary>附則（{suppl.length}件）</summary>
                {suppl.map((s, i) => (
                  <section key={i}>
                    <h3 className="suppl-label">
                      {s.label}
                      {s.amendLawNum && <span className="suppl-num">（{s.amendLawNum}）</span>}
                    </h3>
                    {s.articles.map((a) => (
                      <Article key={a.key} a={a} idPrefix={`s${i}-`} suppl />
                    ))}
                  </section>
                ))}
              </details>
            )}
          </>
        )}
      </main>
      {law && <SelectBar mainRef={mainRef} apply={apply} />}
      {refStack.length > 0 && (
        <RefSheet laws={laws} stack={refStack} setStack={setRefStack} onJump={jumpTo} onMessage={onMessage} />
      )}
      {!refStack.length && returns.length > 0 && (
        <div className="return-bar">
          <button className="return-btn" onClick={goBack}>
            ↩ {refLabel(laws, returns.at(-1))}に戻る
          </button>
          <button className="return-x" onClick={() => setReturns([])} aria-label="戻る場所を消す">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
