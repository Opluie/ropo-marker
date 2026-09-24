"""変換結果の検証。先に fetch_laws.py → convert_laws.py を実行しておくこと。

    py -m unittest scripts/test_convert.py -v
"""
import json
import re
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "public" / "laws"
sys.path.insert(0, str(Path(__file__).resolve().parent))  # convert_laws を import するため

MINPO, SHAKUCHI, KAISHA = "129AC0000000089", "403AC0000000090", "417AC0000000086"

DIGITS = {c: i for i, c in enumerate("〇一二三四五六七八九")}
UNITS = {"十": 10, "百": 100, "千": 1000}


def kanji_to_int(s):
    """漢数字（位取り式: 千五十 = 1050）を整数に"""
    total, cur = 0, 0
    for ch in s:
        if ch in DIGITS:
            cur = DIGITS[ch]
        else:
            total += (cur or 1) * UNITS[ch]
            cur = 0
    return total + cur


NUM = "[〇一二三四五六七八九十百千]+"
ONE = f"第({NUM})条((?:の{NUM})*)"


def title_to_key(title):
    """条の見出し（第三条の二／第三十八条から第八十四条まで）を XML の Num 形式にする"""
    def one(m):
        branch = [str(kanji_to_int(b)) for b in m.group(2).split("の")[1:]]
        return "_".join([str(kanji_to_int(m.group(1)))] + branch)

    parts = [one(m) for m in re.finditer(ONE, title)]
    return ":".join(parts)


def key_sort(key):
    """"3_2" → (3, 2)、範囲 "38:84" は先頭で並べる"""
    return tuple(int(x) for x in key.split(":")[0].split("_"))


def load(law_id):
    return json.loads((OUT_DIR / f"{law_id}.json").read_text(encoding="utf-8"))


def article(law, key):
    return next(a for a in law["articles"] if a["key"] == key)


def json_texts(node):
    """JSON 中の本文をすべて出現順に"""
    if isinstance(node, dict):
        for k in ("text",):
            if k in node and node[k]:
                yield node[k]
        for k in ("paragraphs", "items"):
            for c in node.get(k, []):
                yield from json_texts(c)


def strip_ws(s):
    return re.sub(r"\s", "", s)


class TestConvert(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.laws = {i: load(i) for i in (MINPO, SHAKUCHI, KAISHA)}

    def test_no_text_lost(self):
        """本則の全 Sentence の文字列が、欠けず・順序どおり JSON に入っている"""
        from convert_laws import Converter
        for law_id, law in self.laws.items():
            root = ET.fromstring((RAW_DIR / f"{law_id}.xml").read_bytes())
            main = root.find("LawBody/MainProvision")
            xml_text = "".join(Converter.text_of(s) for s in main.iter("Sentence"))
            got = "".join(t for a in law["articles"] for t in json_texts(a))
            with self.subTest(law=law["title"]):
                self.assertEqual(strip_ws(got), strip_ws(xml_text))

    def test_titles_match_keys(self):
        """条の見出し（漢数字）と条番号 key が全条で一致し、重複なく昇順に並ぶ"""
        for law in self.laws.values():
            keys = [a["key"] for a in law["articles"]]
            with self.subTest(law=law["title"]):
                self.assertEqual(len(keys), len(set(keys)), "条番号の重複")
                self.assertEqual(keys, sorted(keys, key=key_sort), "条番号の順序")
                for a in law["articles"]:
                    self.assertEqual(title_to_key(a["title"]), a["key"], a["title"])

    def test_last_article(self):
        """最終条が既知の条番号（民法1050条・会社法979条・借地借家法61条＝2026-05-21 施行で追加）"""
        expect = {MINPO: "1050", SHAKUCHI: "61", KAISHA: "979"}
        for law_id, last in expect.items():
            self.assertEqual(self.laws[law_id]["articles"][-1]["key"], last)

    def test_known_articles(self):
        m, s, k = self.laws[MINPO], self.laws[SHAKUCHI], self.laws[KAISHA]
        # 条・見出し・本文
        a = article(m, "709")
        self.assertEqual(a["caption"], "（不法行為による損害賠償）")
        self.assertTrue(a["paragraphs"][0]["text"].startswith("故意又は過失によって他人の権利"))
        # 第2項・項番号ラベル
        p2 = article(m, "94")["paragraphs"][1]
        self.assertEqual((p2["num"], p2["label"]), (2, "２"))
        self.assertIn("善意の第三者", p2["text"])
        # 枝番号
        self.assertEqual(article(m, "3_2")["title"], "第三条の二")
        # 範囲削除
        a = article(m, "38:84")
        self.assertEqual(a["title"], "第三十八条から第八十四条まで")
        self.assertEqual(a["paragraphs"][0]["text"], "削除")
        # 号（民法95条1項に一号・二号）
        items = article(m, "95")["paragraphs"][0]["items"]
        self.assertEqual([i["title"] for i in items], ["一", "二"])
        # 段組み（号の中の Column）は全角空白で連結
        self.assertEqual(article(m, "602")["paragraphs"][0]["items"][0]["text"],
                         "樹木の栽植又は伐採を目的とする山林の賃貸借　十年")
        # ルビの読みが混ざらない（失踪の宣告）
        self.assertEqual(article(m, "30")["caption"], "（失踪の宣告）")
        # 本文とただし書が1つの文字列につながる
        self.assertIn("ただし、", article(m, "5")["paragraphs"][0]["text"])
        # 借地借家法3条
        self.assertIn("三十年", article(s, "3")["paragraphs"][0]["text"])
        # 会社法2条: 定義規定の号とイ・ロ（号の細分）
        items = article(k, "2")["paragraphs"][0]["items"]
        self.assertGreater(len(items), 30)
        self.assertTrue(any("items" in i for i in items), "号の細分（イ・ロ）がない")

    def test_suppl_separate(self):
        """附則は本則と別に保持され、本則の条番号と混ざらない"""
        m = self.laws[MINPO]
        self.assertGreater(len(m["suppl"]), 0)
        # e-Gov の民法には制定時の附則が無く、最初は大正15年改正法の附則
        self.assertEqual(m["suppl"][0]["amendLawNum"], "大正一五年四月二四日法律第六九号")
        self.assertTrue(all(s["label"].startswith("附") for s in m["suppl"]))

    def test_no_unsupported(self):
        """表・図などの未対応要素が本則に無い（出たら段階5で対応を検討）"""
        for law in self.laws.values():
            raw = json.dumps(law["articles"], ensure_ascii=False)
            self.assertNotIn('"unsupported"', raw, law["title"])


if __name__ == "__main__":
    unittest.main()
