import { useCallback, useEffect, useState } from 'react';
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

  const onSearch = useCallback(
    (e) => {
      e.preventDefault();
      if (!laws) return;
      const r = parseQuery(laws, query, route.lawId);
      if (r.error !== undefined) {
        setMessage(r.error);
        return;
      }
      const href = lawHref(r.lawId, r.key, r.para);
      if (location.hash === href) setRoute(parseHash()); // 同じ条をもう一度検索しても移動し直す
      else location.hash = href;
      setQuery('');
      document.activeElement?.blur(); // スマホのキーボードを閉じる
    },
    [laws, query, route.lawId],
  );

  const searchBox = (
    <form className="search" onSubmit={onSearch} role="search">
      <input
        type="search"
        inputMode="search"
        enterKeyHint="go"
        placeholder={route.lawId ? '条番号（例: 709・民94②）' : '例: 民709・会社2条1項'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="条番号検索"
      />
      <button type="submit">移動</button>
    </form>
  );

  let body;
  if (loadError) body = <p className="notice">{loadError}</p>;
  else if (!laws) body = <p className="notice">読み込み中…</p>;
  else if (route.lawId)
    body = <LawView laws={laws} route={route} searchBox={searchBox} onMessage={setMessage} />;
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
