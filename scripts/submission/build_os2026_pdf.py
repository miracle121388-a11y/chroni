"""Build the OS2026 introduction from one editable JSON source.

Run through Conda, for example: conda run -n dueflow python scripts/submission/build_os2026_pdf.py
"""
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfgen import canvas
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / "docs/os2026/project-introduction.json").read_text())
OUT = ROOT / "output/pdf/Chroni_OS2026_Introduction.pdf"
ASSETS = ROOT / "docs/os2026/assets"
W, H = A4
LEFT, RIGHT = 43, W - 43
WIDTH = RIGHT - LEFT
GREEN = colors.HexColor("#285b50")
INK = colors.HexColor("#243c35")
MUTED = colors.HexColor("#65766f")
PALE = colors.HexColor("#edf4ef")
LINE = colors.HexColor("#d8e4dc")


def fonts():
    regular = os.environ.get("CHRONI_PDF_FONT", "/System/Library/Fonts/STHeiti Light.ttc")
    bold = os.environ.get("CHRONI_PDF_BOLD_FONT", "/System/Library/Fonts/STHeiti Medium.ttc")
    pdfmetrics.registerFont(TTFont("CN", regular, subfontIndex=0))
    pdfmetrics.registerFont(TTFont("CN-Bold", bold, subfontIndex=0))
    pdfmetrics.registerFontFamily("CN", normal="CN", bold="CN-Bold", italic="CN", boldItalic="CN-Bold")


def style(size=10.5, leading=17, color=INK, bold=False):
    return ParagraphStyle("CN", fontName="CN-Bold" if bold else "CN", fontSize=size,
                          leading=leading, textColor=color, wordWrap="CJK")


def p(c, text, top, size=10.5, leading=17, color=INK, bold=False, x=LEFT, width=WIDTH):
    para = Paragraph(escape(text), style(size, leading, color, bold))
    _, height = para.wrap(width, H)
    para.drawOn(c, x, top - height)
    return top - height - 9


def footer(c, number):
    c.setStrokeColor(LINE)
    c.line(LEFT, 43, RIGHT, 43)
    c.setFont("CN", 8)
    c.setFillColor(MUTED)
    c.drawString(LEFT, 28, "Chroni v0.2.4 | 2026 上海开源软件应用创新大赛 | 2026-10-08")
    c.drawRightString(RIGHT, 28, f"{number:02d} / 08")


def screenshot(c, name, top, maxheight=226):
    path = ASSETS / name
    with Image.open(path) as im:
        ratio = im.width / im.height
    height = min(maxheight, WIDTH / ratio)
    width = height * ratio
    c.drawImage(str(path), (W-width)/2, top-height, width, height)
    return top-height-10


def table(c, rows, top):
    data = [[Paragraph(escape(a), style(9.6, 15, GREEN, True)),
             Paragraph(escape(b), style(9.6, 15))] for a, b in rows]
    t = Table(data, colWidths=[133, WIDTH-133])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BACKGROUND", (0,0), (0,-1), PALE),
        ("LINEBELOW", (0,0), (-1,-1), 0.5, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    _, height = t.wrap(WIDTH, H)
    t.drawOn(c, LEFT, top-height)
    return top-height-14


def architecture(c, top):
    layers = [
        ("桌面交互层", "React 控制中心 / 时间轴 / 每日回顾 / 桌宠 / 语音入口"),
        ("受限接口层", "preload IPC / 输入校验 / 主进程文件与系统能力"),
        ("理解与事实层", "多格式解析 + 本地 OCR / 规则基线 / 可选 LLM / 来源核验"),
        ("学习执行层", "Ground - Plan - Act - Verify - Adapt / TaskPlan / Learning Mission"),
        ("状态与证据层", "本地 ChroniStore / 原子写入 / 证据与检查点 / 回顾 / Trace"),
    ]
    y = top
    for i, (label, body) in enumerate(layers):
        c.setFillColor(GREEN if i == 3 else PALE)
        c.roundRect(LEFT, y-47, WIDTH, 47, 7, fill=1, stroke=0)
        color = colors.white if i == 3 else INK
        p(c, label, y-7, 10, 13, color, True, x=LEFT+12, width=WIDTH-24)
        p(c, body, y-23, 8.8, 12, color, x=LEFT+12, width=WIDTH-24)
        if i < len(layers)-1:
            c.setStrokeColor(GREEN); c.setLineWidth(1)
            c.line(W/2, y-47, W/2, y-57)
            c.line(W/2, y-57, W/2-3, y-53)
            c.line(W/2, y-57, W/2+3, y-53)
        y -= 60
    return y+1


def build():
    fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=A4)
    c.setTitle("Chroni - 2026 上海开源软件应用创新大赛作品介绍")
    c.setAuthor("Chroni contributors")
    c.setSubject("项目背景、技术架构、应用场景、创新点与验证依据")
    c.setFillColor(GREEN); c.rect(0, H-165, W, 165, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("CN", 11)
    c.drawString(LEFT, H-49, "2026 上海开源软件应用创新大赛 · 作品介绍")
    c.setFont("CN-Bold", 44); c.drawString(LEFT, H-111, DATA["title"])
    c.setFont("CN", 12); c.drawString(LEFT, H-145, "本地优先的学习执行 Agent")
    y = p(c, DATA["subtitle"], H-194, 21, 30, GREEN, True)
    y = p(c, "从来源事实到学习成果，连接 Ground / Plan / Act / Verify / Adapt。", y-2, 11, 19, MUTED)
    y = screenshot(c, "mission-overview.png", y-10, 244)
    y = p(c, "真实产品界面 · 隔离合成数据 · 当前版本 v0.2.4", y, 8.5, 14, MUTED)
    y = table(c, [["参赛方向",DATA["track"]],["运行平台","Windows / macOS"],["源码许可","MIT（自研代码）；第三方依赖与素材按独立许可使用"],["材料日期",DATA["date"]]], y-6)
    y = p(c, DATA["repository"], y, 9, 15, GREEN)
    c.linkURL(DATA["repository"], (LEFT,y,RIGHT,y+18), relative=0)
    footer(c,1); c.showPage()
    for n, page in enumerate(DATA["pages"],2):
        c.setFillColor(GREEN); c.setFont("CN-Bold", 10)
        c.drawString(LEFT,H-47,f"CHRONI / OS2026 / {n-1:02d}")
        y = p(c,page["title"],H-68,22,29,GREEN,True)
        y = p(c,page["lead"],y-4,10.7,18,MUTED)
        if page.get("architecture"):
            y = architecture(c,y-4)
        if page.get("image"):
            y = screenshot(c,page["image"],y-4,216)
            y = p(c,page["caption"],y,8.3,13,MUTED)
        for section in page["sections"]:
            y = p(c,section["title"],y-3,12.5,18,GREEN,True)
            if section.get("body"):
                y = p(c,section["body"],y)
            if section.get("rows"):
                y = table(c,section["rows"],y)
            for label,url in section.get("links",[]):
                y = p(c,label,y,9.4,15,GREEN,True)
                # Display compact labels; keep the actual URL as an embedded clickable annotation.
                c.linkURL(url,(LEFT,y+8,RIGHT,y+24),relative=0)
        if y < 56:
            raise ValueError(f"Page {n} exceeds bottom margin: {y:.1f}")
        footer(c,n);c.showPage()
    c.save()
    reader = PdfReader(str(OUT))
    assert len(reader.pages)==8
    text="\n".join(page.extract_text() for page in reader.pages)
    for keyword in ["项目背景", "技术架构", "应用场景", "创新点", "开源治理", "83.9%"]:
        assert keyword in text, keyword
    print(f"Created {OUT} ({len(reader.pages)} pages)")


if __name__ == "__main__":
    build()
