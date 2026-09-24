import { lawHref } from './App.jsx';

const GROUP_ORDER = ['公法系', '民事系', '刑事系'];

export default function Home({ laws, searchBox }) {
  const groups = [...new Set(laws.map((l) => l.group))].sort(
    (a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );
  return (
    <>
      <header className="bar">
        <h1 className="bar-title">六法マーカー</h1>
        {searchBox}
      </header>
      <main className="home">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="group">{g}</h2>
            <ul className="law-list">
              {laws
                .filter((l) => l.group === g)
                .map((l) => (
                  <li key={l.lawId}>
                    <a href={lawHref(l.lawId)}>
                      <span className="law-name">{l.title}</span>
                      <span className="law-meta">{l.enforcementDate} 施行版</span>
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <p className="source">
          出典: e-Gov法令検索（デジタル庁）の法令データを加工して表示しています。
        </p>
      </main>
    </>
  );
}
