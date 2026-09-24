import { lawHref } from './App.jsx';
import Backup from './Backup.jsx';

const GROUP_ORDER = ['公法系', '民事系', '刑事系'];

const OPS = [
  { value: 'select', label: '案① 選択して塗る', note: '長押しで範囲を選び、画面下の色ボタンを押す' },
  { value: 'paint', label: '案② なぞって塗る', note: '右下の ✎ でマーカーモードにして、指でなぞる（モード中はスクロールしない）' },
];

export default function Home({ laws, searchBox, op, setOp, onMessage }) {
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
        <section>
          <h2 className="group">マーカーの操作方法（試作中）</h2>
          <div className="panel" role="radiogroup">
            {OPS.map((o) => (
              <label key={o.value} className="op">
                <input type="radio" name="op" value={o.value} checked={op === o.value} onChange={() => setOp(o.value)} />
                <span>
                  {o.label}
                  <span className="op-note">{o.note}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
        <Backup onMessage={onMessage} />
        <p className="source">
          出典: e-Gov法令検索（デジタル庁）の法令データを加工して表示しています。
        </p>
      </main>
    </>
  );
}
