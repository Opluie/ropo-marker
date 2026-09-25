import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadLaw } from './data.js';
import { findArticleKey } from './search.js';
import { lawHref } from './App.jsx';
import { getMarkers, saveMarkers } from './db.js';
import { COLORS, ERASE, artKeyOf, itemLoc, paint, paraLoc, segments, textsByLoc, usedParas } from './markers.js';
import { currentRange, rangeToPieces } from './selection.js';
import { indexAt, tocPaths } from './toc.js';

const COLOR_LABEL = { yellow: '黄', green: '緑', orange: '橙', [ERASE]: '消す' };

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

/** 本文（塗れる単位）。loc が無ければ（附則）塗れない素の文字 */
function Text({ text, loc, marks }) {
  if (!loc) return text;
  const own = marks?.filter((m) => m.loc === loc);
  return (
    <span data-loc={loc}>
      {segments(text, own).map((s, i) =>
        s.color ? (
          <mark key={i} className={`mk mk-${s.color}`}>
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </span>
  );
}

function Items({ items, parentLoc, marks }) {
  return (
    <ul className="items">
      {items.map((it, i) => {
        if (it.kind === 'unsupported') return <li key={i} className="unsupported">{it.text}</li>;
        const loc = parentLoc && itemLoc(parentLoc, it.num);
        return (
          <li key={i}>
            <span className="item-title">{it.title}</span>
            <Text text={it.text} loc={loc} marks={marks} />
            {it.items && <Items items={it.items} parentLoc={loc} marks={marks} />}
          </li>
        );
      })}
    </ul>
  );
}

// marks はこの条のマーカー。変わった条だけ描き直すため、条ごとの配列を渡す
// マーカーを引いた項は番号に色を付ける（第1項は条名で示す。ほかの項だけなら条名は下線）
const Article = memo(function Article({ a, idPrefix, markable, marks }) {
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
              <Text text={p.text} loc={markable && paraLoc(a.key, p.num)} marks={marks} />
            </p>
            {p.items && <Items items={p.items} parentLoc={markable && paraLoc(a.key, p.num)} marks={marks} />}
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

/** 開いている法令のマーカーの読み込みと、選択範囲に塗る処理 */
function useMarkers(law, mainRef, onMessage) {
  const [byArt, setByArt] = useState(() => new Map());
  const texts = useMemo(() => (law ? textsByLoc(law) : null), [law]);

  useEffect(() => {
    setByArt(new Map());
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

  const apply = useCallback(
    async (color, range) => {
      const pieces = rangeToPieces(range, mainRef.current);
      if (!pieces.length) return;
      const now = new Date().toISOString();
      const put = [];
      const del = [];
      for (const pc of pieces) {
        const existing = (byArt.get(artKeyOf(pc.loc)) ?? []).filter((m) => m.loc === pc.loc);
        const r = paint(existing, { lawId: law.lawId, color, ...pc }, texts.get(pc.loc), { now, newId });
        put.push(...r.put);
        del.push(...r.del);
      }
      if (!put.length && !del.length) return;
      try {
        await saveMarkers(put, del);
      } catch {
        onMessage('マーカーを保存できませんでした');
        return;
      }
      // 変わった条の配列だけ作り直す（ほかの条は描き直さない）
      setByArt((prev) => {
        const next = new Map(prev);
        const gone = new Set(del);
        for (const k of new Set(pieces.map((pc) => artKeyOf(pc.loc)))) {
          const fresh = put.filter((m) => artKeyOf(m.loc) === k);
          const ids = new Set(fresh.map((m) => m.id));
          next.set(k, [...(prev.get(k) ?? []).filter((m) => !gone.has(m.id) && !ids.has(m.id)), ...fresh]);
        }
        return next;
      });
    },
    [byArt, law, texts, mainRef, onMessage],
  );

  return { byArt, apply };
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

/** 画面上端にかかっている条の key（本則を過ぎていれば null＝附則） */
function keyAtTop(law, header) {
  const y = header.getBoundingClientRect().bottom + 1;
  const bottomOf = (k) => document.getElementById(`a-${law.articles[k].key}`).getBoundingClientRect().bottom;
  return law.articles[indexAt(law.articles.length, bottomOf, y)]?.key ?? null;
}

function crumbText(law, paths, key) {
  if (!key) return '附則';
  const a = law.articles.find((x) => x.key === key);
  return [...(paths.get(key) ?? []).map((n) => n.title), a?.title].filter(Boolean).join(' › ');
}

/** 今いる場所を1行で出す（入りきらなければ先頭側を省略して、条名は必ず見せる）。押すと目次 */
function Crumb({ law, paths, headerRef, onOpen }) {
  const [key, setKey] = useState(undefined);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      if (headerRef.current) setKey(keyAtTop(law, headerRef.current));
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
  }, [law, headerRef]);
  return (
    <button className="crumb" onClick={onOpen} aria-label="今いる場所（押すと目次）">
      <span dir="ltr">{key === undefined ? '\u00a0' : crumbText(law, paths, key)}</span>
    </button>
  );
}

export default function LawView({ laws, route, searchBox, onMessage }) {
  const meta = laws.find((l) => l.lawId === route.lawId);
  const [law, setLaw] = useState(null);
  const [error, setError] = useState('');
  const [tocKey, setTocKey] = useState(undefined); // 目次を開いた時点で今いた条（undefined＝閉じている）
  const mainRef = useRef(null);
  const headerRef = useRef(null);
  const drawerRef = useRef(null);
  const { byArt, apply } = useMarkers(law, mainRef, onMessage);
  const paths = useMemo(() => (law ? tocPaths(law.toc) : new Map()), [law]);
  const tocOpen = tocKey !== undefined;
  const openToc = () => setTocKey(keyAtTop(law, headerRef.current));
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
    if (route.para && !document.getElementById(id)) onMessage(`第${route.para}項はありません`);
    scrollSettled(el);
    el.classList.remove('flash');
    void el.offsetWidth; // アニメーションをやり直すため
    el.classList.add('flash');
  }, [law, route, onMessage]);

  const suppl = useMemo(() => law?.suppl ?? [], [law]);

  if (!meta) return <p className="notice">この法令は登載されていません。<a href="#/">一覧へ</a></p>;

  return (
    <>
      <header className="bar" ref={headerRef}>
        <div className="bar-row">
          <a className="bar-btn" href="#/" aria-label="法令一覧へ">
            ‹
          </a>
          <h1 className="bar-title">{meta.title}</h1>
          <button className="bar-btn" onClick={openToc} disabled={!law}>
            目次
          </button>
        </div>
        {searchBox}
        {law ? <Crumb law={law} paths={paths} headerRef={headerRef} onOpen={openToc} /> : <div className="crumb">{'\u00a0'}</div>}
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

      <main className="law" ref={mainRef}>
        {error && <p className="notice">{error}</p>}
        {!law && !error && <p className="notice">読み込み中…</p>}
        {law && (
          <>
            <p className="law-head">
              {law.lawNum}
              <br />
              {law.enforcementDate} 施行版
            </p>
            {law.articles.map((a) => (
              <Article key={a.key} a={a} idPrefix="a-" markable marks={byArt.get(a.key)} />
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
                      <Article key={a.key} a={a} idPrefix={`s${i}-`} />
                    ))}
                  </section>
                ))}
              </details>
            )}
          </>
        )}
      </main>
      {law && <SelectBar mainRef={mainRef} apply={apply} />}
    </>
  );
}
