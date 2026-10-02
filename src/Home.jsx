import { useState } from 'react';
import { lawHref } from './App.jsx';
import Backup from './Backup.jsx';
import { loadFavorites, saveFavorites } from './favorites.js';

const ROPPO = ['日本国憲法', '民法', '商法', '刑法', '民事訴訟法', '刑事訴訟法'];
const GROUP_ORDER = ['公法系', '民事系', '刑事系'];

function LawList({ title, laws, favs, onToggle }) {
  if (!laws.length) return null;
  return (
    <section>
      <h2 className="group">{title}</h2>
      <ul className="law-list">
        {laws.map((l) => {
          const fav = favs.includes(l.lawId);
          return (
            <li key={l.lawId}>
              <a href={lawHref(l.lawId)}>
                <span className="law-name">{l.title}</span>
                <span className="law-meta">{l.enforcementDate} 施行版</span>
              </a>
              <button
                className={'fav-btn' + (fav ? ' on' : '')}
                onClick={() => onToggle(l.lawId)}
                aria-pressed={fav}
                aria-label={`${l.title}をお気に入り${fav ? 'から外す' : 'に追加'}`}
              >
                {fav ? '★' : '☆'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Home({ laws, searchBox, onMessage }) {
  const [favs, setFavs] = useState(loadFavorites);
  const toggle = (id) =>
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveFavorites(next);
      return next;
    });

  // 表示順: お気に入り（追加順） → 六法 → 各分野。お気に入りにした法令は下の一覧から移る
  const favLaws = favs.map((id) => laws.find((l) => l.lawId === id)).filter(Boolean);
  const rest = laws.filter((l) => !favs.includes(l.lawId));
  const roppo = ROPPO.map((t) => rest.find((l) => l.title === t)).filter(Boolean);
  const others = rest.filter((l) => !ROPPO.includes(l.title));
  const groups = [...new Set(others.map((l) => l.group))].sort(
    (a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );
  return (
    <>
      <header className="bar">
        <h1 className="bar-title">六法マーカー</h1>
        {searchBox}
      </header>
      <main className="home">
        <LawList title="★ お気に入り" laws={favLaws} favs={favs} onToggle={toggle} />
        <LawList title="六法" laws={roppo} favs={favs} onToggle={toggle} />
        {groups.map((g) => (
          <LawList key={g} title={g} laws={others.filter((l) => l.group === g)} favs={favs} onToggle={toggle} />
        ))}
        <Backup onMessage={onMessage} />
        <p className="source">
          出典: e-Gov法令検索（デジタル庁）の法令データを加工して表示しています。
        </p>
      </main>
    </>
  );
}
