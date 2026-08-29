"""Generate branded launcher icons (legacy / round / adaptive foreground)."""
import os
from PIL import Image, ImageDraw, ImageFont

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
RES = os.path.abspath(RES)

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
BG = (32, 38, 49)   # #202631 (app 品牌深色)
WHITE = (255, 255, 255)

def load_font(size):
    for p in [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf",
              r"C:\Windows\Fonts\seguisb.ttf", r"C:\Windows\Fonts\bahnschrift.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def draw_p(img, scale):
    w, h = img.size
    d = ImageDraw.Draw(img)
    font = load_font(int(min(w, h) * scale))
    bbox = d.textbbox((0, 0), "P", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (w - tw) / 2 - bbox[0]
    y = (h - th) / 2 - bbox[1]
    d.text((x, y), "P", font=font, fill=WHITE)

def circle_mask(img):
    w, h = img.size
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).ellipse([0, 0, w - 1, h - 1], fill=255)
    img.putalpha(m)
    return img

for d, size in LEGACY.items():
    img = Image.new("RGBA", (size, size), BG)
    draw_p(img, 0.52)
    img.save(f"{RES}/mipmap-{d}/ic_launcher.png")
    img2 = Image.new("RGBA", (size, size), BG)
    draw_p(img2, 0.52)
    circle_mask(img2).save(f"{RES}/mipmap-{d}/ic_launcher_round.png")

for d, size in FG.items():
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_p(img, 0.42)  # 保持在小部件安全区内
    img.save(f"{RES}/mipmap-{d}/ic_launcher_foreground.png")

print("icons generated ->", RES)
