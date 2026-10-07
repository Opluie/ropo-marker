"""条文中の参照（第○条・前項・民法第○条 など）を見つけ、リンク先を決める（仕様書 §4.5）。

convert_laws.py が全法令を変換したあとに呼ぶ。項・号の本文ごとに
    refs: [[開始, 終了, 法令ID or null（同じ法令）, 条key, 項番号 or null], ...]
を付ける（開始・終了は本文中の文字位置）。附則には付けない。

扱うもの:
  第○条（の○）（第○項）（第○号）／第○項（第○号）＝同じ条の項
  前条・次条・前○条（第○項）／前項・次項・前各項・前○項（第○号）
  {搭載法令名}（（…））第○条 …
  「及び」「、」などでつながった続き（民事執行法第一条及び第二条 → 両方とも民事執行法）
扱わないもの（リンクにしない）:
  同条・同項・同法（直前の文脈を追う必要がある。仕様書 §4.5 の4）
  搭載していない法令・附則・旧法の条（誤って同じ法令の条につながないよう、リンク自体を出さない）
"""
import re

NUM = "[〇一二三四五六七八九十百千]+"
DIGITS = {c: i for i, c in enumerate("〇一二三四五六七八九")}
UNITS = {"十": 10, "百": 100, "千": 1000}

TOKEN = re.compile(
    rf"(?P<dou>同(?:法|条|項)(?:第{NUM}条(?:の{NUM})*)?(?:第{NUM}項)?(?:第{NUM}号)?)"
    rf"|(?P<art>第{NUM}条(?:の{NUM})*(?:第{NUM}項)?(?:第{NUM}号)?)"
    rf"|(?P<relart>[前次](?:{NUM})?条(?:第{NUM}項)?(?:第{NUM}号)?)"
    rf"|(?P<relpara>[前次](?:各|{NUM})?項(?:第{NUM}号)?)"
    rf"|(?P<para>第{NUM}項(?:第{NUM}号)?)"
)
ART_PART = re.compile(rf"第({NUM})条((?:の{NUM})*)")
PARA_PART = re.compile(rf"第({NUM})項")
# 前の参照とこの参照の間がつなぎの語だけなら「続き」とみなし、前の参照の法令（・条）を引き継ぐ。
# 間の（…）と「ただし書」「前段」「第○号イ」などの限定と、編・章・節の参照（第二章第三節）は読み飛ばす
CONNECT = re.compile(r"(?:、|，|及び|並びに|又は|若しくは|から|ないし|まで|乃至|及ヒ|並ニ|又ハ|若クハ)*")
QUALIFIER = re.compile(
    rf"ただし書|本文|前段|中段|後段|各号列記以外の部分|各号|第{NUM}号(?:の{NUM})*[イロハニホヘトチリヌルヲワカヨタレソツネナラム]?"
    rf"|第{NUM}(?:編|章|節|款|目)(?:の{NUM})*")


def drop_parens(s):
    """対になった（…）を取り除く（入れ子も）"""
    prev = None
    while prev != s:
        prev, s = s, re.sub(r"（[^（）]*）", "", s)
    return s


def is_chain(between):
    return CONNECT.fullmatch(QUALIFIER.sub("", drop_parens(between))) is not None


def quoted_spans(text):
    """「」の中（読替え規定で引用された他の法令の文言）の範囲。中の参照はリンクにしない"""
    spans, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch == "「":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "」" and depth:
            depth -= 1
            if depth == 0:
                spans.append((start, i))
    return spans


# 搭載していない法令名・附則などの直後の第○条はリンクにしない
FOREIGN = re.compile(r"(?:法|法律|令|規則|条約|規程|憲章|附則|旧)$")
ALIASES = {"憲法": "日本国憲法"}  # 法文中の呼び方 → 搭載法令の正式名


def kanji_to_int(s):
    total, cur = 0, 0
    for ch in s:
        if ch in DIGITS:
            cur = DIGITS[ch]
        else:
            total += (cur or 1) * UNITS[ch]
            cur = 0
    return total + cur


def strip_paren(before):
    """末尾の（…）を1組取り除く（民法（明治二十九年法律第八十九号）第一条 の括弧）"""
    if not before.endswith("）"):
        return before
    depth = 0
    for i in range(len(before) - 1, -1, -1):
        ch = before[i]
        if ch == "）":
            depth += 1
        elif ch == "（":
            depth -= 1
            if depth == 0:
                return before[:i]
    return before


def key_tuple(key):
    return tuple(int(x) for x in key.split("_"))


class LawRefs:
    """参照先を引くための、法令ごとの条の一覧"""

    def __init__(self, law):
        self.law_id = law["lawId"]
        self.keys = [a["key"] for a in law["articles"]]
        self.index = {k: i for i, k in enumerate(self.keys)}
        self.paras = {a["key"]: {p.get("num") for p in a["paragraphs"]} for a in law["articles"]}

    def find(self, key):
        """条 key（範囲削除 "38:84" に含まれる番号はその範囲の key）。無ければ None"""
        if key in self.index:
            return key
        t = key_tuple(key)
        for k in self.keys:
            if ":" in k:
                lo, hi = (key_tuple(x) for x in k.split(":"))
                if lo <= t <= hi:
                    return k
        return None


class RefFinder:
    def __init__(self, laws):
        self.by_id = {law["lawId"]: LawRefs(law) for law in laws}
        names = {law["title"]: law["lawId"] for law in laws}
        names.update({a: names[t] for a, t in ALIASES.items() if t in names})
        # 長い名前から照合する（「会社法の施行に伴う…法律」を「…法律」より先に）
        self.names = sorted(names.items(), key=lambda x: -len(x[0]))
        self.unresolved = []  # 条が見つからなかった参照（テスト・報告用）

    def law_before(self, before):
        """参照の直前の文字列から法令を決める。戻り値 法令ID／"" ＝名前なし／None ＝搭載外の法令など"""
        head = strip_paren(before)
        for name, law_id in self.names:
            if head.endswith(name):
                return law_id
        return None if FOREIGN.search(head) else ""

    def find(self, text, law_id, art_key, para_num):
        """本文 text（law_id の art_key 条 para_num 項、またはその号）の参照一覧"""
        here = self.by_id[law_id]
        refs = []
        prev = None  # 直前の参照 (終了位置, 法令ID or None, 条key)
        # 「第十三条（第二項及び第三項を除く。）まで、第十三条の二」のように、括弧の中の参照を挟んでも
        # 括弧の外の続きを追えるよう、括弧を開いた時点の直前の参照を積んでおく
        outer = []
        quotes = quoted_spans(text)
        for m in TOKEN.finditer(text):
            s = m.group(0)
            between = drop_parens(text[prev[0]:m.start()]) if prev else ""
            if "）" in between:  # 括弧を閉じた: 括弧を開く前の参照に戻り、閉じた後の文字で続きか判断する
                closes = between.count("）")
                for _ in range(closes):
                    prev = outer.pop() if outer else None
                between = between[between.rindex("）") + 1:]
            if "（" in between:  # 括弧を開いた: 開く前の参照を覚え、括弧の中は開く前の参照の続きとみなす
                outer.extend([prev] * between.count("（"))
                head, between = between[:between.index("（")], between[between.rindex("（") + 1:]
                chained = prev is not None and is_chain(head) and is_chain(between)
            else:
                chained = prev is not None and is_chain(between)
            if any(a < m.start() < b for a, b in quotes):
                prev = (m.end(), None, None)
                continue
            kind = m.lastgroup
            target = None  # (法令ID, 条key, 項)
            if kind == "dou":
                prev = (m.end(), None, None)
                continue
            if kind == "art":
                a = ART_PART.match(s)
                key = "_".join([str(kanji_to_int(a.group(1)))]
                               + [str(kanji_to_int(x)) for x in a.group(2).split("の")[1:]])
                p = PARA_PART.search(s)
                law = self.law_before(text[:m.start()])
                if law == "":
                    law = prev[1] if chained else law_id
                target = law and (law, key, p and kanji_to_int(p.group(1)))
            elif kind == "relart":
                n = re.match(rf"[前次]({NUM})?条", s)
                step = kanji_to_int(n.group(1)) if n.group(1) else 1
                i = here.index.get(art_key)
                j = None if i is None else (i - step if s[0] == "前" else i + 1)
                p = PARA_PART.search(s)
                if j is not None and 0 <= j < len(here.keys):
                    target = (law_id, here.keys[j], p and kanji_to_int(p.group(1)))
            elif kind == "relpara":
                n = re.match(rf"[前次](各|{NUM})?項", s)
                if s[0] == "次":
                    num = para_num + 1
                elif n.group(1) == "各":
                    num = 1
                else:
                    num = para_num - (kanji_to_int(n.group(1)) if n.group(1) else 1)
                if num >= 1:
                    target = (law_id, art_key, num)
            elif kind == "para":
                num = kanji_to_int(PARA_PART.match(s).group(1))
                if chained and prev[1] is None:
                    target = None  # 同条第一項及び第二項 などの続き
                elif chained:
                    target = (prev[1], prev[2], num)
                else:
                    target = (law_id, art_key, num)

            if not target:
                prev = (m.end(), None, None)
                continue
            t_law, t_key, t_para = target
            lr = self.by_id[t_law]
            found = lr.find(t_key)
            if not found:
                self.unresolved.append(f"{law_id} {art_key}: {s}")
                prev = (m.end(), None, None)
                continue
            if t_para is not None and t_para not in lr.paras[found]:
                t_para = None
            refs.append([m.start(), m.end(), None if t_law == law_id else t_law, found, t_para])
            prev = (m.end(), t_law, found)
        return refs

    def annotate(self, law):
        """law の本則の項・号に refs を書き込む"""
        def items(nodes, art_key, para_num):
            for it in nodes or []:
                if it.get("kind") == "unsupported":
                    continue
                r = self.find(it["text"], law["lawId"], art_key, para_num)
                if r:
                    it["refs"] = r
                items(it.get("items"), art_key, para_num)

        for a in law["articles"]:
            if a["key"] == "p":
                continue  # 条の無い法令の項（前条などの基準が無い）
            for p in a["paragraphs"]:
                if p.get("kind") == "unsupported":
                    continue
                r = self.find(p["text"], law["lawId"], a["key"], p["num"])
                if r:
                    p["refs"] = r
                items(p.get("items"), a["key"], p["num"])
