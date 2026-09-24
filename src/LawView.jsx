import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadLaw } from './data.js';
import { findArticleKey } from './search.js';
import { lawHref } from './App.jsx';
import { getMarkers, saveMarkers } from './db.js';
import { COLORS, ERASE, artKeyOf, itemLoc, paint, paraLoc, segments, textsByLoc } from './markers.js';
import { caretAt, currentRange, rangeToPieces } from './selection.js';

const COLOR_LABEL = { yellow: '黄', red: '赤', blue: '青', [ERASE]: '消す' };

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

function Toc({ nodes, lawId, onPick, depth = 0 }) {
  return (
    <ul className={`toc d${depth}`}>
      {nodes
        .filter((n) => typeof n !== 'string')
        .map((n, i) => (
          <li key={i}>
            <a href={lawHref(lawId, firstKey(n))} onClick={onPick}>
              {n.title}
            </a>
            {n.children.some((c) => typeof c !== 'string') && (
              <Toc nodes={n.children} lawId={lawId} onPick={onPick} depth={depth + 1} />
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
const Article = memo(function Article({ a, idPrefix, markable, marks }) {
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
                <span className="art-title">{a.title}</span>
              ) : (
                p.label && <span className="para-num">{p.label}</span>
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

/** 案①: 本文を選択している間だけ画面下に色ボタンを出す */
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

/** 案②: マーカーモード中は指でなぞった範囲を塗る（モード中は指でスクロールできない） */
function PaintBar({ mainRef, apply }) {
  const [on, setOn] = useState(false);
  const [pen, setPen] = useState('yellow');

  useEffect(() => {
    const main = mainRef.current;
    if (!on || !main) return;
    const sel = window.getSelection();
    let start = null;
    const down = (e) => {
      if (!e.isPrimary) return;
      start = caretAt(e.clientX, e.clientY);
      if (!start) return;
      e.preventDefault();
      main.setPointerCapture(e.pointerId);
      sel.removeAllRanges();
    };
    // なぞっている間はブラウザの選択範囲で塗る場所を見せ、指を離したら案①と同じ処理で塗る
    const move = (e) => {
      if (!start) return;
      const cur = caretAt(e.clientX, e.clientY);
      if (cur) sel.setBaseAndExtent(start.node, start.offset, cur.node, cur.offset);
    };
    const up = () => {
      if (!start) return;
      start = null;
      const range = currentRange(main); // 下から上になぞっても前→後の順に直っている
      sel.removeAllRanges();
      if (range) apply(pen, range);
    };
    const block = (e) => e.preventDefault(); // 長押しの選択メニュー・スクロールを止める
    const events = [
      ['pointerdown', down],
      ['pointermove', move],
      ['pointerup', up],
      ['pointercancel', up],
      ['touchstart', block],
      ['contextmenu', block],
    ];
    main.classList.add('painting');
    events.forEach(([t, f]) => main.addEventListener(t, f, { passive: false }));
    return () => {
      main.classList.remove('painting');
      events.forEach(([t, f]) => main.removeEventListener(t, f, { passive: false }));
    };
  }, [on, pen, apply, mainRef]);

  if (!on)
    return (
      <button className="mk-fab" onClick={() => setOn(true)} aria-label="マーカーモード">
        ✎
      </button>
    );
  return (
    <div className="mk-bar" role="toolbar" aria-label="マーカーモード">
      {[...COLORS, ERASE].map((c) => (
        <button key={c} className={`mk-btn mk-btn-${c}`} aria-pressed={pen === c} onClick={() => setPen(c)}>
          {COLOR_LABEL[c]}
        </button>
      ))}
      <button className="mk-btn mk-done" onClick={() => setOn(false)}>
        終了
      </button>
    </div>
  );
}

export default function LawView({ laws, route, searchBox, onMessage, op }) {
  const meta = laws.find((l) => l.lawId === route.lawId);
  const [law, setLaw] = useState(null);
  const [error, setError] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const mainRef = useRef(null);
  const { byArt, apply } = useMarkers(law, mainRef, onMessage);

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
      <header className="bar">
        <div className="bar-row">
          <a className="bar-btn" href="#/" aria-label="法令一覧へ">
            ‹
          </a>
          <h1 className="bar-title">{meta.title}</h1>
          <button className="bar-btn" onClick={() => setTocOpen(true)} disabled={!law}>
            目次
          </button>
        </div>
        {searchBox}
      </header>

      {tocOpen && law && (
        <div className="drawer-bg" onClick={() => setTocOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()} aria-label="目次">
            <div className="drawer-head">
              <span>目次</span>
              <button className="bar-btn" onClick={() => setTocOpen(false)}>
                閉じる
              </button>
            </div>
            <Toc nodes={law.toc} lawId={law.lawId} onPick={() => setTocOpen(false)} />
            {suppl.length > 0 && (
              <button
                className="toc-suppl"
                onClick={() => {
                  // URL の # は画面切り替えに使っているので、アンカーリンクにせず直接開いて移動する
                  const d = document.getElementById('suppl');
                  d.open = true;
                  setTocOpen(false);
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
      {law && (op === 'paint' ? <PaintBar mainRef={mainRef} apply={apply} /> : <SelectBar mainRef={mainRef} apply={apply} />)}
    </>
  );
}
