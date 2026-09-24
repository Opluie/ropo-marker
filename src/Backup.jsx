import { useEffect, useRef, useState } from 'react';
import { getAllMarkers, saveMarkers } from './db.js';
import { makeBackup, parseBackup } from './markers.js';

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** マーカーの書き出し（JSON ファイルを保存）と読み込み（同じ id は置き換え・今あるものは消さない） */
export default function Backup({ onMessage }) {
  const [count, setCount] = useState(null);
  const fileRef = useRef(null);

  const refresh = () => getAllMarkers().then((l) => setCount(l.length), () => setCount(null));
  useEffect(() => {
    refresh();
  }, []);

  const exportFile = async () => {
    const list = await getAllMarkers();
    const blob = new Blob([JSON.stringify(makeBackup(list, new Date().toISOString()))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ropo-marker-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    onMessage(`${list.length} 件を書き出しました`);
  };

  const importFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 同じファイルをもう一度選べるように
    if (!file) return;
    try {
      const markers = parseBackup(await file.text());
      await saveMarkers(markers);
      onMessage(`${markers.length} 件を読み込みました`);
      refresh();
    } catch (err) {
      onMessage(`読み込めませんでした: ${err.message}`);
    }
  };

  return (
    <section>
      <h2 className="group">マーカーのバックアップ</h2>
      <div className="panel">
        <p className="panel-note">
          マーカーはこの端末の中にだけ保存されています（{count ?? '—'} 件）。機種変更やアプリの削除に備えて、ときどき書き出してください。
        </p>
        <div className="panel-row">
          <button className="panel-btn" onClick={exportFile}>
            書き出す
          </button>
          <button className="panel-btn" onClick={() => fileRef.current.click()}>
            読み込む
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
        </div>
      </div>
    </section>
  );
}
