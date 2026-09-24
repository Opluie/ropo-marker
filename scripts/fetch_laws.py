"""e-Gov 法令API v2 から法令XMLを取得する。

使い方:
    py scripts/fetch_laws.py              # data/laws.json の全法令を最新版で取得
    py scripts/fetch_laws.py --asof 2026-01-01   # 指定日時点で施行されていた版を取得

出力: data/raw/{法令ID}.xml と data/raw/{法令ID}.meta.json
"""
import argparse
import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAWS_FILE = ROOT / "data" / "laws.json"
RAW_DIR = ROOT / "data" / "raw"
API = "https://laws.e-gov.go.jp/api/2"


def get_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res)


def resolve_law_id(title):
    """法令名の完全一致で法令IDを引く（部分一致の別法令を拾わないため）"""
    url = f"{API}/laws?law_title={urllib.parse.quote(title)}&limit=50"
    hits = [
        law["law_info"]["law_id"]
        for law in get_json(url)["laws"]
        if law["revision_info"]["law_title"] == title
    ]
    if len(hits) != 1:
        raise RuntimeError(f"法令名「{title}」の完全一致が {len(hits)} 件（1件であるべき）")
    return hits[0]


def fetch(law_id, asof=None):
    params = {"law_full_text_format": "xml"}
    if asof:
        params["asof"] = asof
    data = get_json(f"{API}/law_data/{law_id}?{urllib.parse.urlencode(params)}")
    xml = base64.b64decode(data["law_full_text"])
    rev = data["revision_info"]
    meta = {
        "lawId": law_id,
        "lawNum": data["law_info"]["law_num"],
        "revisionId": rev["law_revision_id"],
        "title": rev["law_title"],
        "enforcementDate": rev["amendment_enforcement_date"],
        "updated": rev["updated"],
        "asof": asof,
    }
    return xml, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", help="この日付時点で施行されていた版を取得（YYYY-MM-DD）")
    args = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    laws = json.loads(LAWS_FILE.read_text(encoding="utf-8"))
    errors = 0
    for law in laws:
        try:
            law_id = law.get("lawId") or resolve_law_id(law["title"])
            xml, meta = fetch(law_id, args.asof)
            (RAW_DIR / f"{law_id}.xml").write_bytes(xml)
            (RAW_DIR / f"{law_id}.meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"OK   {law['title']} {law_id} 施行日 {meta['enforcementDate']}")
        except Exception as e:  # 1件の失敗で全体を止めない
            errors += 1
            print(f"FAIL {law['title']}: {e}", file=sys.stderr)
        time.sleep(1)  # API への負荷を抑える
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
