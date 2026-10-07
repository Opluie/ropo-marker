"""参照リンクの検出（refs.py）のテスト。

    py -m unittest scripts/test_refs.py -v

前半は作り物の法令で規則を確かめ、後半は変換済みの public/laws/ で実データを確かめる。
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refs import RefFinder  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "laws"
MINPO, KAISHA = "129AC0000000089", "417AC0000000086"


def law(law_id, title, keys, paras=3):
    return {"lawId": law_id, "title": title,
            "articles": [{"key": k, "paragraphs": [{"num": n} for n in range(1, paras + 1)]} for k in keys]}


A = law("A", "甲法", ["1", "2", "3", "3_2", "4", "10:20", "21"])
B = law("B", "乙法", ["1", "5", "7"])


def refs(text, key="4", para=2):
    f = RefFinder([A, B])
    return [(text[s:e], lw, k, p) for s, e, lw, k, p in f.find(text, "A", key, para)]


class TestRules(unittest.TestCase):
    def test_same_law(self):
        self.assertEqual(refs("第三条の二第二項の規定"), [("第三条の二第二項", None, "3_2", 2)])
        self.assertEqual(refs("第一条第三号"), [("第一条第三号", None, "1", None)])

    def test_range_deleted(self):
        self.assertEqual(refs("第十五条"), [("第十五条", None, "10:20", None)])

    def test_missing_article_is_dropped(self):
        self.assertEqual(refs("第九十九条"), [])

    def test_relative(self):
        self.assertEqual(refs("前条"), [("前条", None, "3_2", None)])
        self.assertEqual(refs("次条第一項"), [("次条第一項", None, "10:20", 1)])
        self.assertEqual(refs("前二条"), [("前二条", None, "3", None)])
        self.assertEqual(refs("前項"), [("前項", None, "4", 1)])
        self.assertEqual(refs("次項"), [("次項", None, "4", 3)])
        self.assertEqual(refs("前各項", para=3), [("前各項", None, "4", 1)])
        self.assertEqual(refs("前二項", para=3), [("前二項", None, "4", 1)])
        self.assertEqual(refs("前項", para=1), [])

    def test_paragraph_of_same_article(self):
        self.assertEqual(refs("第三項"), [("第三項", None, "4", 3)])

    def test_other_law(self):
        self.assertEqual(refs("乙法第五条"), [("第五条", "B", "5", None)])
        self.assertEqual(refs("乙法（令和元年法律第一号）第五条"), [("第五条", "B", "5", None)])

    def test_unknown_law_not_linked(self):
        self.assertEqual(refs("丙法第一条"), [])
        self.assertEqual(refs("附則第二条"), [])

    def test_chain_inherits_law(self):
        got = refs("乙法第一条ただし書、第五条第一項前段及び第二項並びに第七条")
        self.assertEqual(got, [("第一条", "B", "1", None), ("第五条第一項", "B", "5", 1),
                               ("第二項", "B", "5", 2), ("第七条", "B", "7", None)])

    def test_chain_through_parentheses(self):
        got = refs("乙法第一条から第五条（第二項を除く。）まで、第七条")
        self.assertEqual([g[1:] for g in got], [("B", "1", None), ("B", "5", None), ("B", "5", 2), ("B", "7", None)])

    def test_chain_breaks_on_other_words(self):
        got = refs("乙法第一条の規定により第二条")
        self.assertEqual([g[1] for g in got], ["B", None])

    def test_dou_not_linked_and_blocks_chain(self):
        self.assertEqual(refs("同条第二項及び第三項"), [])
        self.assertEqual(refs("同法第一条"), [])

    def test_quoted_not_linked(self):
        self.assertEqual(refs("同項中「第一条」とあるのは「第二条」と"), [])


def load(law_id):
    return json.loads((OUT_DIR / f"{law_id}.json").read_text(encoding="utf-8"))


def all_refs(law):
    def walk(n, key):
        for r in n.get("refs", []):
            yield key, n["text"], r
        for c in n.get("paragraphs", []) + n.get("items", []):
            yield from walk(c, key)
    for a in law["articles"]:
        yield from walk(a, a["key"])


class TestRealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.laws = {p.stem: json.loads(p.read_text(encoding="utf-8"))
                    for p in OUT_DIR.glob("*.json") if p.name != "index.json"}

    def test_targets_exist(self):
        """全法令のリンク先の条・項が実在する（仕様書 §7 段階4の基準）"""
        for law in self.laws.values():
            for key, _, (s, e, lw, k, p) in all_refs(law):
                target = self.laws[lw or law["lawId"]]
                art = next((a for a in target["articles"] if a["key"] == k), None)
                with self.subTest(law=law["title"], key=key, ref=k):
                    self.assertIsNotNone(art)
                    if p is not None:
                        self.assertIn(p, [x.get("num") for x in art["paragraphs"]])

    def test_known_refs(self):
        m, k = self.laws[MINPO], self.laws[KAISHA]

        def at(law, key, para, word):
            a = next(a for a in law["articles"] if a["key"] == key)
            p = next(p for p in a["paragraphs"] if p.get("num") == para)
            return [r[2:] for r in p.get("refs", []) if p["text"][r[0]:r[1]] == word]

        self.assertEqual(at(m, "94", 2, "前項"), [[None, "94", 1]])
        self.assertEqual(at(m, "96", 3, "前二項"), [[None, "96", 1]])
        self.assertEqual(at(m, "95", 4, "第一項"), [[None, "95", 1]])
        self.assertEqual(at(m, "13", 1, "第九条"), [[None, "9", None]])
        self.assertEqual(at(k, "774_8", 1, "第九十四条第一項"), [[MINPO, "94", 1]])

    def test_suppl_has_no_refs(self):
        for law in self.laws.values():
            self.assertNotIn('"refs"', json.dumps(law["suppl"], ensure_ascii=False), law["title"])


if __name__ == "__main__":
    unittest.main()
