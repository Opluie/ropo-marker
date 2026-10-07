import { useCallback, useEffect, useRef, useState } from 'react';
import { loadIndex } from './data.js';
import { requestPersist } from './db.js';
import { parseQuery } from './search.js';
import Home from './Home.jsx';
import LawView from './LawView.jsx';

// 画面の切り替えは URL の # 以降で行う（GitHub Pages でも再読み込みで壊れないため）
//   #/                     法令一覧
//   #/law/{法令ID}         法令の先頭
//   #/law/{法令ID}/{条key}/{項番号?}
function parseHash() {
  const [, kind, lawId, key, para] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (kind !== 'law' || !lawId) return { lawId: null };
  return { lawId, key: key || null, para: para ? Number(para) : null };
}

export function lawHref(lawId, key, para) {
  return '#/' + ['law', lawId, key, para].filter((x) => x != null && x !== '').map(encodeURIComponent).join('/');
}

export default function App() {
  const [laws, setLaws] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [route, setRoute] = useState(parseHash);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  // 条文画面の検索欄は最初からテンキー（条番号だけ打つことが多いため）。「あ」で通常のキーボードに切り替える
  const [textKb, setTextKb] = useState(false);
  const inputRef = useRef(null);
  const refocus = useRef(false);
  const numeric = !!route.lawId && !textKb;

  // キーボードの種類は入力欄を選び直したときに変わるので、切り替えたら選び直す
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const el = inputRef.current;
    el?.blur();
    const t = setTimeout(() => el?.focus(), 50);
    return () => clearTimeout(t);
  }, [textKb]);

  useEffect(() => {
    requestPersist();
    loadIndex().then(setLaws, (e) => setLoadError(e.message));
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(t);
  }, [message]);

  /** href へ移動する。同じ場所でも移動し直す（同じ条をもう一度検索したとき・戻るボタン） */
  const go = useCallback((href) => {
    if (location.hash === href) setRoute(parseHash());
    else location.hash = href;
  }, []);

  const onSearch = useCallback(
    (e) => {
      e.preventDefault();
      if (!laws) return;
      const r = parseQuery(laws, query, route.lawId);
      if (r.error !== undefined) {
        setMessage(r.error);
        return;
      }
      go(lawHref(r.lawId, r.key, r.para));
      setQuery('');
      setTextKb(false);
      document.activeElement?.blur(); // スマホのキーボードを閉じる
    },
    [laws, query, route.lawId, go],
  );

  const searchBox = (
    <form className="search" onSubmit={onSearch} role="search">
      <input
        ref={inputRef}
        type="search"
        inputMode={numeric ? 'numeric' : 'search'}
        enterKeyHint="go"
        placeholder={numeric ? '条番号 709・3-2・94.2' : '例: 民709・会社2条1項'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="条番号検索"
      />
      {route.lawId && (
        <button
          type="button"
          className="kb-toggle"
          onClick={() => {
            refocus.current = true;
            setTextKb((v) => !v);
          }}
          aria-label={numeric ? '通常のキーボードにする' : 'テンキーにする'}
        >
          {numeric ? 'あ' : '123'}
        </button>
      )}
      <button type="submit">移動</button>
    </form>
  );

  let body;
  if (loadError) body = <p className="notice">{loadError}</p>;
  else if (!laws) body = <p className="notice">読み込み中…</p>;
  else if (route.lawId)
    body = <LawView laws={laws} route={route} searchBox={searchBox} onMessage={setMessage} onGo={go} />;
  else body = <Home laws={laws} searchBox={searchBox} onMessage={setMessage} />;

  return (
    <>
      {body}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </>
  );
}
