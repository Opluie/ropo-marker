"""アプリアイコン（PNG）を生成する。フォントは BIZ UD明朝（SIL OFL ライセンス）。

    py scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = "C:/Windows/Fonts/BIZ-UDMinchoM.ttc"
BG = (31, 58, 52)        # 深緑（六法の装丁の色）
MARK = (245, 205, 70)    # マーカーの黄色
INK = (250, 248, 240)


def draw(size, padding):
    """padding: マスカブル（Android が丸や角丸に切り抜く）用の余白の割合"""
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    inner = size * (1 - 2 * padding)
    # 文字の下半分に引いたマーカー
    top = size / 2 + inner * 0.05
    d.rectangle([size / 2 - inner * 0.36, top, size / 2 + inner * 0.36, top + inner * 0.2], fill=MARK)
    font = ImageFont.truetype(FONT, int(inner * 0.72))
    d.text((size / 2, size / 2), "六", font=font, fill=INK, anchor="mm")
    return img


def main():
    out = ROOT / "public"
    draw(192, 0.08).save(out / "icon-192.png")
    draw(512, 0.08).save(out / "icon-512.png")
    draw(512, 0.2).save(out / "icon-maskable-512.png")
    draw(180, 0.08).save(out / "apple-touch-icon.png")
    print("アイコンを public/ に出力しました")


if __name__ == "__main__":
    main()
