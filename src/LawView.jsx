import { memo, useEffect, useMemo, useState } from 'react';
import { loadLaw } from './data.js';
import { findArticleKey } from './search.js';
import { lawHref } from './App.jsx';

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

function Items({ items }) {
  return (
    <ul className="items">
      {items.map((it, i) =>
        it.kind === 'unsupported' ? (
          <li key={i} className="unsupported">{it.text}</li>
        ) : (
          <li key={i}>
            <span className="item-title">{it.title}</span>
            {it.text}
            {it.items && <Items items={it.items} />}
          </li>
        ),
      )}
    </ul>
  );
}

const Article = memo(function Article({ a, idPrefix }) {
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
              {p.text}
            </p>
            {p.items && <Items items={p.items} />}
          </div>
        ),
      )}
    </article>
  );
});

export default function LawView({ laws, route, searchBox, onMessage }) {
  const meta = laws.find((l) => l.lawId === route.lawId);
  const [law, setLaw] = useState(null);
  const [error, setError] = useState('');
  const [tocOpen, setTocOpen] = useState(false);

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

      <main className="law">
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
              <Article key={a.key} a={a} idPrefix="a-" />
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
    </>
  );
}
