"""e-Gov 法令XML（data/raw/）をアプリ用JSON（public/laws/）に変換する。

使い方:
    py scripts/convert_laws.py

出力:
    public/laws/{法令ID}.json  条文本体（条・項・号の入れ子。仕様書 §4.3）
    public/laws/index.json     法令一覧（アプリの目次・検索用）

扱えない要素（表・図など）は本文を落とさず "unsupported" として残し、件数を報告する。
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAWS_FILE = ROOT / "data" / "laws.json"
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "public" / "laws"

STRUCT_TAGS = {"Part": "編", "Chapter": "章", "Section": "節", "Subsection": "款", "Division": "目"}
COLUMN_SEP = "　"  # 号の中の「用語　定義」のような段組みを区切る全角空白（e-Gov の表示に合わせる）


class Converter:
    def __init__(self):
        self.warnings = []

    def warn(self, where, el):
        self.warnings.append(f"{where}: <{el.tag}> を unsupported として出力")

    # ---- 文字列 ----
    @staticmethod
    def text_of(el):
        """要素内の文字列。ルビの読み（<Rt>）は除く"""
        if el is None:
            return ""
        parts = [el.text or ""]
        for child in el:
            if child.tag != "Rt":
                parts.append(Converter.text_of(child))
            parts.append(child.tail or "")
        return "".join(parts).strip()

    def sentence_text(self, el):
        """ParagraphSentence / ItemSentence / SubitemNSentence の本文"""
        cols = [c for c in el if c.tag == "Column"]
        if cols:
            return COLUMN_SEP.join(self.text_of(c) for c in cols)
        return "".join(self.text_of(s) for s in el if s.tag == "Sentence")

    # ---- 号・号の細分（イ・ロ…）----
    def item(self, el, level):
        """level 0 = Item、1 以上 = SubitemN"""
        name = "Item" if level == 0 else f"Subitem{level}"
        node = {"num": el.get("Num"), "title": "", "text": ""}
        children = []
        for c in el:
            if c.tag == f"{name}Title":
                node["title"] = self.text_of(c)
            elif c.tag == f"{name}Sentence":
                node["text"] = self.sentence_text(c)
            elif c.tag == f"Subitem{level + 1}":
                children.append(self.item(c, level + 1))
            else:
                self.warn(name, c)
                children.append({"kind": "unsupported", "tag": c.tag, "text": self.text_of(c)})
        if children:
            node["items"] = children
        return node

    # ---- 項 ----
    def paragraph(self, el):
        node = {"num": int(el.get("Num") or 0), "label": "", "text": ""}
        items = []
        for c in el:
            if c.tag == "ParagraphNum":
                node["label"] = self.text_of(c)
            elif c.tag == "ParagraphCaption":
                node["caption"] = self.text_of(c)
            elif c.tag == "ParagraphSentence":
                node["text"] = self.sentence_text(c)
            elif c.tag == "Item":
                items.append(self.item(c, 0))
            else:
                self.warn("Paragraph", c)
                items.append({"kind": "unsupported", "tag": c.tag, "text": self.text_of(c)})
        if items:
            node["items"] = items
        return node

    # ---- 条 ----
    def article(self, el):
        node = {"key": el.get("Num"), "title": "", "caption": "", "paragraphs": []}
        for c in el:
            if c.tag == "ArticleTitle":
                node["title"] = self.text_of(c)
            elif c.tag == "ArticleCaption":
                node["caption"] = self.text_of(c)
            elif c.tag == "Paragraph":
                node["paragraphs"].append(self.paragraph(c))
            else:
                self.warn("Article", c)
                node["paragraphs"].append({"kind": "unsupported", "tag": c.tag, "text": self.text_of(c)})
        return node

    # ---- 編・章・節…の階層 ----
    def walk(self, el, articles, where):
        """el の子を順に見て、条は articles に集め、目次ノードの children を返す"""
        children = []
        loose = []  # 条に入っていない項（1条しかない法律・附則など）
        for c in el:
            if c.tag == "Article":
                art = self.article(c)
                articles.append(art)
                children.append(art["key"])
            elif c.tag in STRUCT_TAGS:
                title = self.text_of(c.find(f"{c.tag}Title"))
                children.append({"type": STRUCT_TAGS[c.tag], "title": title,
                                 "children": self.walk(c, articles, where)})
            elif c.tag == "Paragraph":
                loose.append(self.paragraph(c))
            elif c.tag.endswith("Title") or c.tag.endswith("Label"):
                continue  # 見出しは親で処理済み
            else:
                self.warn(where, c)
        if loose:
            art = {"key": "p", "title": "", "caption": "", "paragraphs": loose}
            articles.append(art)
            children.append(art["key"])
        return children

    def law(self, xml_bytes, meta, conf):
        root = ET.fromstring(xml_bytes)
        body = root.find("LawBody")
        articles = []
        toc = self.walk(body.find("MainProvision"), articles, "MainProvision")

        suppl = []
        for sp in body.findall("SupplProvision"):
            sp_articles = []
            self.walk(sp, sp_articles, "SupplProvision")
            suppl.append({
                "label": self.text_of(sp.find("SupplProvisionLabel")),
                "amendLawNum": sp.get("AmendLawNum"),
                "articles": sp_articles,
            })

        for c in body:
            if c.tag not in {"LawTitle", "EnactStatement", "TOC", "MainProvision", "SupplProvision"}:
                self.warn("LawBody", c)  # 別表など。段階5で対応を判断

        return {
            "lawId": meta["lawId"],
            "title": meta["title"],
            "lawNum": meta["lawNum"],
            "abbr": conf.get("abbr", []),
            "group": conf.get("group", ""),
            "revisionId": meta["revisionId"],
            "enforcementDate": meta["enforcementDate"],
            "toc": toc,
            "articles": articles,
            "suppl": suppl,
        }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    confs = {c["title"]: c for c in json.loads(LAWS_FILE.read_text(encoding="utf-8"))}
    index = []
    total_warnings = 0
    for meta_path in sorted(RAW_DIR.glob("*.meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        conf = confs.get(meta["title"])
        if conf is None:
            continue  # laws.json から外した法令の残骸
        conv = Converter()
        law = conv.law((RAW_DIR / f"{meta['lawId']}.xml").read_bytes(), meta, conf)
        (OUT_DIR / f"{meta['lawId']}.json").write_text(
            json.dumps(law, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({k: law[k] for k in ("lawId", "title", "abbr", "group", "enforcementDate")}
                     | {"articleCount": len(law["articles"])})
        for w in conv.warnings:
            print(f"  WARN {meta['title']} {w}")
        total_warnings += len(conv.warnings)
        print(f"OK   {meta['title']}: 本則 {len(law['articles'])} 条・附則 {len(law['suppl'])} 件")

    order = {c["title"]: i for i, c in enumerate(confs.values())}
    index.sort(key=lambda x: order[x["title"]])
    (OUT_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"完了: {len(index)} 法令・警告 {total_warnings} 件")
    sys.exit(0)


if __name__ == "__main__":
    main()
