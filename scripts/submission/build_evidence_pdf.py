import hashlib
import json
import subprocess
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
VERSION = PACKAGE["version"]
OUTPUT = ROOT / "output" / "pdf" / "Chroni_GOAI_2026_更新版项目方案.pdf"
SCREENSHOT_ROOT = ROOT / "docs" / "store" / "assets" / "screenshots" / "zh-CN"
FIRST_RUN_SCREENSHOT = SCREENSHOT_ROOT / "00-first-run.png"
DAILY_SCREENSHOT = SCREENSHOT_ROOT / "01-today.png"
MISSION_SCREENSHOT = SCREENSHOT_ROOT / "02-learning-mission.png"
AGENT_SCREENSHOT = SCREENSHOT_ROOT / "03-agent.png"
SMART_SCREENSHOT = SCREENSHOT_ROOT / "03-smart-organize.png"
REVIEW_SCREENSHOT = SCREENSHOT_ROOT / "04-daily-review.png"
COMPANION_SCREENSHOT = SCREENSHOT_ROOT / "05-companion.png"
EVALUATION = json.loads((ROOT / "benchmarks" / "goai-v1" / "reports" / "latest.json").read_text(encoding="utf-8"))
INSTALLER = ROOT / "apps" / "desktop" / "dist-electron" / f"Chroni-{VERSION}-win-x64-setup.exe"
BASELINE_TAG = "v0.1.4"
BASELINE_COMMIT = subprocess.check_output(
    ["git", "rev-list", "-n", "1", BASELINE_TAG], cwd=ROOT, text=True
).strip()
CURRENT_COMMIT = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
COMMITS_SINCE_BASELINE = subprocess.check_output(
    ["git", "rev-list", "--count", f"{BASELINE_TAG}..HEAD"], cwd=ROOT, text=True
).strip()
DIFF_SUMMARY = subprocess.check_output(
    ["git", "diff", "--shortstat", f"{BASELINE_TAG}..HEAD"], cwd=ROOT, text=True
).strip()
SUBMISSION_DATE = "2026-09-02"

INK = colors.HexColor("#20312C")
MUTED = colors.HexColor("#66736D")
GREEN = colors.HexColor("#2F6B61")
GREEN_DARK = colors.HexColor("#244B43")
GREEN_PALE = colors.HexColor("#EAF3EF")
CORAL = colors.HexColor("#E9796B")
CORAL_PALE = colors.HexColor("#FBE9E6")
GOLD = colors.HexColor("#B77A30")
GOLD_PALE = colors.HexColor("#FFF5E5")
PAPER = colors.HexColor("#FBFAF6")
LINE = colors.HexColor("#D8E1DC")
WHITE = colors.white


def percent(value):
    return f"{float(value) * 100:.1f}%"


def installer_summary():
    if not INSTALLER.exists():
        return "安装包尚未在本机生成；请先运行 pnpm run package:submission:windows。"
    digest_hash = hashlib.sha256()
    with INSTALLER.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest_hash.update(chunk)
    digest = digest_hash.hexdigest()
    return f"<b>Windows x64 安装版：</b>{INSTALLER.name}<br/><b>大小：</b>{INSTALLER.stat().st_size:,} bytes<br/><b>SHA-256：</b>{digest}"


def register_fonts():
    regular = Path(r"C:\Windows\Fonts\msyh.ttc")
    bold = Path(r"C:\Windows\Fonts\msyhbd.ttc")
    fallback = Path(r"C:\Windows\Fonts\simhei.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("ChroniSans", str(regular), subfontIndex=0))
        pdfmetrics.registerFont(TTFont("ChroniSansBold", str(bold), subfontIndex=0))
    elif fallback.exists():
        pdfmetrics.registerFont(TTFont("ChroniSans", str(fallback)))
        pdfmetrics.registerFont(TTFont("ChroniSansBold", str(fallback)))
    else:
        raise FileNotFoundError("A Chinese TrueType font is required to build the evidence PDF.")


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="ChroniSansBold",
            fontSize=10,
            leading=14,
            textColor=GREEN,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName="ChroniSansBold",
            fontSize=34,
            leading=42,
            textColor=INK,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            parent=base["Normal"],
            fontName="ChroniSans",
            fontSize=15,
            leading=23,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="ChroniSansBold",
            fontSize=22,
            leading=29,
            textColor=INK,
            spaceAfter=11,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="ChroniSansBold",
            fontSize=13,
            leading=18,
            textColor=GREEN_DARK,
            spaceBefore=8,
            spaceAfter=6,
        ),
        "h2_compact": ParagraphStyle(
            "h2_compact",
            parent=base["Heading2"],
            fontName="ChroniSansBold",
            fontSize=12.5,
            leading=16,
            textColor=GREEN_DARK,
            spaceBefore=3,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=9.3,
            leading=15.5,
            textColor=INK,
            spaceAfter=7,
        ),
        "body_compact": ParagraphStyle(
            "body_compact",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=8.7,
            leading=13,
            textColor=INK,
            spaceAfter=4,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=7.8,
            leading=12,
            textColor=MUTED,
        ),
        "caption": ParagraphStyle(
            "caption",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=7.6,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=3,
            spaceAfter=7,
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=8,
            leading=12,
            textColor=INK,
        ),
        "table_bold": ParagraphStyle(
            "table_bold",
            parent=base["BodyText"],
            fontName="ChroniSansBold",
            fontSize=8,
            leading=12,
            textColor=INK,
        ),
        "metric": ParagraphStyle(
            "metric",
            parent=base["BodyText"],
            fontName="ChroniSansBold",
            fontSize=16,
            leading=20,
            textColor=GREEN_DARK,
            alignment=TA_CENTER,
        ),
        "metric_label": ParagraphStyle(
            "metric_label",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=7.6,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
    }


def para(text, style):
    return Paragraph(text, style)


def section_title(number, title, style):
    return para(f'<font color="#2F6B61">{number}</font>  {title}', style)


def info_box(text, style, background=GREEN_PALE, border=GREEN):
    table = Table([[para(text, style)]], colWidths=[174 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return table


def styled_table(data, widths, header=True, row_backgrounds=None, cell_padding=6):
    if header:
        data = [list(row) for row in data]
        rendered_header = []
        for index, cell in enumerate(data[0]):
            if isinstance(cell, Paragraph):
                header_style = ParagraphStyle(
                    f"table_header_{id(data)}_{index}",
                    parent=cell.style,
                    textColor=WHITE,
                )
                cell = Paragraph(cell.text, header_style)
            rendered_header.append(cell)
        data[0] = rendered_header
    table = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.55, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), cell_padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), cell_padding),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), GREEN_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ])
    if row_backgrounds:
        start = 1 if header else 0
        for index, background in enumerate(row_backgrounds, start=start):
            commands.append(("BACKGROUND", (0, index), (-1, index), background))
    table.setStyle(TableStyle(commands))
    return table


def scaled_image(path, width):
    image = Image(str(path))
    ratio = image.imageHeight / image.imageWidth
    image.drawWidth = width
    image.drawHeight = width * ratio
    image.hAlign = "CENTER"
    return image


def draw_page(canvas, doc):
    page = canvas.getPageNumber()
    if page == 1:
        return
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, 15 * mm, width - 18 * mm, 15 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("ChroniSans", 7.5)
    canvas.drawString(18 * mm, 9.5 * mm, "Chroni GOAI 2026 更新版项目方案")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"{page}")
    canvas.restoreState()


def build_story(s):
    story = []

    story.extend([
        Spacer(1, 31 * mm),
        para("GOAI 2026 · BOUNDLESS AGENTS · AI + 教育", s["cover_kicker"]),
        para("Chroni", s["cover_title"]),
        para("从课程材料到每日行动、过程证据与复盘的本地学习执行 Agent", s["cover_subtitle"]),
        Spacer(1, 12 * mm),
    ])
    cover_rule = Table([[""]], colWidths=[34 * mm], rowHeights=[2.4 * mm])
    cover_rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CORAL)]))
    cover_rule.hAlign = "CENTER"
    story.extend([
        cover_rule,
        Spacer(1, 14 * mm),
        info_box(
            "<b>一句话价值</b><br/>不替学生完成作业，而是把课程要求转化为可执行、可验证、可调整的学习过程。",
            s["body"],
            PAPER,
            LINE,
        ),
        Spacer(1, 12 * mm),
    ])
    cover_meta = [
        [para("项目版本", s["metric_label"]), para("验证状态", s["metric_label"]), para("材料日期", s["metric_label"])],
        [para(VERSION, s["metric"]), para("复赛最终版", s["metric"]), para(SUBMISSION_DATE, s["metric"])],
    ]
    meta = Table(cover_meta, colWidths=[58 * mm] * 3)
    meta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN_PALE),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([
        meta,
        Spacer(1, 20 * mm),
        para("本材料只使用仓库中的真实截图、真实源码、真实测试与可复现评测。未测量项和发布限制在正文中明确标注。", s["small"]),
        PageBreak(),
    ])

    story.extend([
        section_title("00", "复赛更新摘要", s["h1"]),
        para(
            f"本轮严格以 v0.1.4 初版为基线。初版已经能完成材料抽取、TaskPlan、每日时间轴和提醒；v{VERSION} 在此基础上补齐 Learning Mission、证据/检查点、智能整理、语义优先级、容量自适应、14 日回顾趋势、托管模型入口、评测与发布工程，使系统从 DDL 管理进入可持续学习执行闭环。",
            s["body"],
        ),
        info_box(
            f"<b>v{VERSION} 核心闭环：</b>材料输入 → 智能整理 → Learning Mission → TaskPlan → 今日执行 → 证据/检查点 → 每日回顾 → 风险、容量与下一步调整。",
            s["body"],
        ),
        Spacer(1, 5 * mm),
        para(f"从 v0.1.4 到 v{VERSION}", s["h2"]),
        para(
            f"基线 commit：{BASELINE_COMMIT[:8]}　当前 commit：{CURRENT_COMMIT[:8]}　新增提交：{COMMITS_SINCE_BASELINE} 个。Git 统计：{DIFF_SUMMARY}。",
            s["small"],
        ),
    ])
    update_rows = [
        [para("维度", s["table_bold"]), para("v0.1.4 初版", s["table_bold"]), para(f"v{VERSION} 复赛版", s["table_bold"])],
        [para("产品中心", s["table_bold"]), para("DDL、TaskPlan 与提醒", s["table"]), para("Learning Mission 与学习执行闭环", s["table"])],
        [para("验证方式", s["table_bold"]), para("用户勾选完成", s["table"]), para("SHA-256 产出证据、阶段检查点与人工确认", s["table"])],
        [para("Agent 行为", s["table_bold"]), para("抽取、追问、拆解、排程", s["table"]), para("Ground → Plan → Act → Verify → Adapt", s["table"])],
        [para("连续规划", s["table_bold"]), para("以截止和基础风险为主", s["table"]), para("语境、截止、进度、工作量和历史执行联合排序；15/25 分钟分级恢复", s["table"])],
        [para("每日反馈", s["table_bold"]), para("查看任务完成状态", s["table"]), para("独立每日回顾、活动轨迹、总结、历史与顺延", s["table"])],
        [para("使用门槛", s["table_bold"]), para("用户自行配置模型", s["table"]), para("托管模型默认入口、个人 DeepSeek 可选、本地规则可回退", s["table"])],
        [para("演示与评测", s["table_bold"]), para("通用回归和安装包", s["table"]), para("A/B/C 三种路径、60 条固定时钟评测、精确 commit 与哈希", s["table"])],
    ]
    story.extend([
        styled_table(update_rows, [31 * mm, 54 * mm, 89 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 5 * mm),
        para("复赛手册交付映射", s["h2"]),
    ])
    requirement_rows = [
        [para("手册要求", s["table_bold"]), para("本项目可核验交付", s["table_bold"])],
        [para("更新项目方案", s["table_bold"]), para("本 PDF：更新摘要、价值、Agent 闭环、技术、评测、安全和后续边界。", s["table"])],
        [para("可运行 Demo", s["table_bold"]), para("Windows 安装包 + 180/60 秒脚本 + 三组合成输入；明确主链路无 Key 可运行。", s["table"])],
        [para("工程与复现", s["table_bold"]), para("启动/测试/构建命令、核心源码、评测 runner/schema、关键测试、提交 SHA 与哈希。", s["table"])],
        [para("数据与合规", s["table_bold"]), para("合成数据边界、隐私/IP、威胁模型、MIT License 与第三方许可证。", s["table"])],
    ]
    story.extend([
        styled_table(requirement_rows, [42 * mm, 132 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 5 * mm),
        info_box(
            "<b>事实边界：</b>合成评测证明确定性系统闭环可复现，不代表真实学生学习成效、DeepSeek 总体准确率或真实图片 OCR 总体性能。项目不声称已有学校合作、生产用户或比赛结果。",
            s["body"],
            CORAL_PALE,
            CORAL,
        ),
        PageBreak(),
    ])

    story.extend([
        section_title("01", "项目概览与闭环", s["h1"]),
        para(
            "Chroni 面向承担课程项目、实验报告和多阶段交付的大学生。它不是只记录截止时间的 Todo，也不是生成一次性建议的聊天助手，而是持续维护来源、目标、完成标准、里程碑、真实产出和阶段反馈的混合式学习执行 Agent。",
            s["body"],
        ),
        info_box(
            "<b>核心原则：</b>模型提出候选，本地确定性系统掌握事实、证据、工具和状态变更权。原始材料不计为学习成果，模型不能自行宣布完成。",
            s["body"],
        ),
        Spacer(1, 6 * mm),
        para("完整任务闭环", s["h2"]),
    ])
    flow_cells = [
        ("1", "Ground", "解析课程材料，锁定来源、时间、交付物与边界"),
        ("2", "Mission", "形成目标、完成标准、里程碑和当前行动"),
        ("3", "Plan", "版本化步骤、估时、依赖、缓冲和容量约束"),
        ("4", "Act", "把当前步骤排入今日真实可用时间并调用工具"),
        ("5", "Verify", "登记产出证据、实际投入、阶段状态和阻塞"),
        ("6", "Adapt", "重算风险与下一步，保留用户确认和回退"),
    ]
    flow_data = []
    for row in (flow_cells[:3], flow_cells[3:]):
        flow_data.append([
            para(f'<font color="#E9796B"><b>{number}</b></font>　<b>{title}</b><br/><font color="#66736D">{copy}</font>', s["table"])
            for number, title, copy in row
        ])
    flow = Table(flow_data, colWidths=[58 * mm] * 3)
    flow.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("GRID", (0, 0), (-1, -1), 0.65, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.extend([
        flow,
        Spacer(1, 6 * mm),
        para("已实现能力", s["h2"]),
    ])
    capability_rows = [
        [para("能力", s["table_bold"]), para("可核验实现", s["table_bold"])],
        [para("多格式输入", s["table_bold"]), para("TXT/MD/PDF/DOCX/XLSX/ICS/图片统一进入 intake 管线；OCR 在本机完成。", s["table"])],
        [para("Learning Mission", s["table_bold"]), para("来源、目标、交付物、完成标准、TaskPlan 里程碑、证据、检查点、进度和风险统一建档。", s["table"])],
        [para("证据与反馈", s["table_bold"]), para("文件流式 SHA-256 与说明证据；检查点绑定里程碑并回写步骤、进度和下一步。", s["table"])],
        [para("Agent 规划", s["table_bold"]), para("Ground → Plan → Act → Verify → Adapt；融合学业语境、截止、进度、工作量和历史执行，并避开既有课程/会议。", s["table"])],
        [para("每日时间轴", s["table_bold"]), para("日、多日、周、月视图；按真实时长显示，支持缩放、拖动、重排和历史回顾。", s["table"])],
        [para("每日回顾", s["table_bold"]), para("按日期保存活动轨迹、完成率、自动摘要、个人记录和未完成项；对比前后 7 天并反馈下一轮容量。", s["table"])],
        [para("低门槛模型", s["table_bold"]), para("默认可使用托管兼容网关，也可切换个人 DeepSeek；模型失败时保留本地规则结果。", s["table"])],
        [para("可控记忆", s["table_bold"]), para("只从用户明确保存的计划差异学习；可停用、删除或清空。", s["table"])],
        [para("可复现演示", s["table_bold"]), para("A/B/C 合成输入覆盖明确任务、缺失字段与来源冲突；本地规则主链路无需 Key。", s["table"])],
    ]
    story.extend([
        styled_table(capability_rows, [38 * mm, 136 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE]),
        PageBreak(),
    ])

    story.extend([
        section_title("02", "真实产品界面", s["h1"]),
        para(f"下列截图来自 Chroni {VERSION} 的真实控制中心，使用明确标注的隔离合成演示数据，不是概念效果图。", s["body"]),
        scaled_image(SMART_SCREENSHOT, 125 * mm),
        para("智能整理：文本、文件和拖入材料进入统一工作流；明确事项直接整理，必要确认集中为一个阻断问题。", s["caption"]),
        scaled_image(MISSION_SCREENSHOT, 125 * mm),
        para("学习任务：来源、目标、交付物、完成标准、里程碑、证据覆盖和阶段反馈处于同一任务档案。", s["caption"]),
        info_box(
            "<b>教育边界：</b>证据覆盖只说明交付物存在用户登记记录，不等同于学术质量评分；任务完成仍由用户确认。",
            s["body"],
            GOLD_PALE,
            GOLD,
        ),
        PageBreak(),
        Spacer(1, 3 * mm),
        section_title("02", "真实产品界面（执行层）", s["h1"]),
        scaled_image(DAILY_SCREENSHOT, 125 * mm),
        para("今日执行：任务按真实时长占据时间轴；重叠自动分栏，可缩放、拖拽、重排并查看多日计划。", s["caption"]),
        scaled_image(AGENT_SCREENSHOT, 125 * mm),
        para("学习执行 Agent 工作台：展示下一步、今日工作块、高风险任务、覆盖率、规划来源和结构化 Trace。", s["caption"]),
        PageBreak(),
        Spacer(1, 3 * mm),
        section_title("02", "真实产品界面（每日反馈）", s["h1"]),
        para(f"v{VERSION} 将每日活动整理提升为独立一级栏目，并新增前后 7 天趋势，让执行结果持续反馈给下一次规划。", s["body"]),
        scaled_image(REVIEW_SCREENSHOT, 166 * mm),
        para("每日回顾：按日期保存活动轨迹、完成率、计划/完成时长、自动摘要、个人记录和未完成项顺延。", s["caption"]),
        info_box(
            "<b>持续使用价值：</b>用户可以回顾过去、总结当天，也可以检查未来计划；回顾不是一次性生成的文本，而是与本地任务状态共同持久化的产品对象。",
            s["body"],
            GREEN_PALE,
            GREEN,
        ),
        PageBreak(),
        section_title("02", "真实产品界面（桌面伙伴）", s["h1"]),
        scaled_image(COMPANION_SCREENSHOT, 158 * mm),
        para("桌面伙伴：蓝色动态桌宠提供拖放、状态反馈、提醒与一键打开日程；控制中心与桌宠读取同一份本地状态。", s["caption"]),
        info_box(
            "<b>交付修复：</b>复赛安装包强制使用 product/xiaotong 构建并校验 219 张动作帧、完整许可证与 About。打包脚本会拒绝把 Chroni 大图标当成桌宠的 original 占位产物。",
            s["body"],
            CORAL_PALE,
            CORAL,
        ),
        PageBreak(),
    ])

    story.extend([
        section_title("03", "Agent 技术架构", s["h1"]),
        info_box(
            "Chroni 不展示模型私有思维链。它保留可审计的结构化证据：输入来源、候选、校验结果、工具调用、计划版本、回退原因和最终 Verify 状态。",
            s["body"],
            GOLD_PALE,
            GOLD,
        ),
        Spacer(1, 5 * mm),
    ])
    architecture_rows = [
        [para("阶段", s["table_bold"]), para("模型职责（可选）", s["table_bold"]), para("本地确定性职责", s["table_bold"])],
        [para("Ground", s["table_bold"]), para("从长文本提出目标、交付物、完成标准和时间候选。", s["table"]), para("解析/OCR；核对来源、日期、条件、冲突、重复项和 schema。", s["table"])],
        [para("智能整理", s["table_bold"]), para("可辅助跨段语义和问题表达。", s["table"]), para("明确事项先落地；只在事实阻断执行时提出一个必要问题。", s["table"])],
        [para("Plan", s["table_bold"]), para("提出步骤、耗时和不确定性。", s["table"]), para("版本化 TaskPlan；验证依赖、总耗时、交付物、完成标准和截止边界。", s["table"])],
        [para("Act", s["table_bold"]), para("可提出结构化分配建议。", s["table"]), para("语境优先级、slack、容量、时间冲突、已有课程/会议、排程/提醒/持久化工具和规则回退。", s["table"])],
        [para("Verify / Review", s["table_bold"]), para("可辅助生成每日摘要，不得自行完成或评分。", s["table"]), para("证据 SHA-256、里程碑检查点、每日活动轨迹、个人记录与未完成项顺延。", s["table"])],
        [para("Adapt", s["table_bold"]), para("可提出结构化调整建议。", s["table"]), para("根据实际投入、阻塞、14 日趋势和历史未完成重算风险、容量与下一步；触发 25 分钟恢复或 15 分钟重新启动。", s["table"])],
        [para("记忆 / Trace", s["table_bold"]), para("只消费筛选后的结构化偏好。", s["table"]), para("偏好证据门槛、开关/删除、脱敏运行证据导出。", s["table"])],
    ]
    story.extend([
        styled_table(architecture_rows, [28 * mm, 64 * mm, 82 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 6 * mm),
        para("可复用能力模块", s["h2"]),
        para(
            "DeadlineExtraction · EvidenceValidation · MissingFieldClarification · TaskPlanGeneration · PlanConstraintValidation · LearningMissionSynthesis · EvidenceCheckpoint · DailyScheduling · DailyReview · ReminderDispatch · PlanningPreferenceLearning · RunTraceExport",
            s["body"],
        ),
        para("开源仓库中的核心实现", s["h2"]),
        para(
            "附件保留 intake、Learning Mission、Deadline Agent、工具、TaskPlan、证据、Store 与 Daily Review 等关键实现；完整源码、typed API、CI 和 Release 工作流可按附件记录的精确 commit 在公开仓库核验。",
            s["body"],
        ),
        PageBreak(),
    ])

    story.extend([
        section_title("04", "可复现评测与测试", s["h1"]),
        para(
            "GOAI v1 使用 60 条合成案例，固定参考时钟为 2026-08-06 10:00（Asia/Shanghai）。本次结果来自本地规则路径，不使用模型、不需要网络，每例执行 1 次。附件提供评测报告和逐例 JSON；完整数据集、runner 与 schema 可在开源仓库中复现。",
            s["body"],
        ),
    ])
    metric_data = [
        [para(percent(EVALUATION["extraction"]["taskF1"]), s["metric"]), para(percent(EVALUATION["extraction"]["deliverableF1"]), s["metric"]), para(percent(EVALUATION["extraction"]["titleNormalizationAccuracy"]), s["metric"]), para(percent(EVALUATION["extraction"]["dueDateExactMatch"]), s["metric"])],
        [para("Task F1", s["metric_label"]), para("交付物 F1", s["metric_label"]), para("标题归一化", s["metric_label"]), para("日期精确匹配", s["metric_label"])],
        [para(percent(EVALUATION["learningMission"]["creationRate"]), s["metric"]), para(percent(EVALUATION["learningMission"]["deliverableGroundingRate"]), s["metric"]), para(percent(EVALUATION["learningMission"]["milestoneCheckpointSyncRate"]), s["metric"]), para(percent(EVALUATION["engineering"]["offlineSuccessRate"]), s["metric"])],
        [para("Mission 创建", s["metric_label"]), para("Mission 交付物保留", s["metric_label"]), para("检查点回写", s["metric_label"]), para("离线成功", s["metric_label"])],
    ]
    metrics = Table(metric_data, colWidths=[43.5 * mm] * 4)
    metrics.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN_PALE),
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([
        metrics,
        Spacer(1, 6 * mm),
        para("测试与构建证据", s["h2"]),
    ])
    test_rows = [
        [para("门禁", s["table_bold"]), para("结果", s["table_bold"]), para("范围", s["table_bold"])],
        [para("Desktop tests", s["table_bold"]), para("277 pass / 0 fail / 1 skip", s["table"]), para("共 278 项；抽取、Mission、证据/检查点、Store、语义规划、每日回顾、UI、API 与打包。", s["table"])],
        [para("Gateway tests", s["table_bold"]), para("6 pass / 0 fail", s["table"]), para("鉴权、限流、超时、上游错误、托管模型和日志边界。", s["table"])],
        [para("Product build", s["table_bold"]), para("通过", s["table"]), para("构建清单为 product/xiaotong；219 张动态帧、About 和完整许可资源通过校验。", s["table"])],
        [para("Windows package", s["table_bold"]), para("本机生成", s["table"]), para("NSIS 安装版和 portable；校验和以附件安装说明为准。", s["table"])],
        [para("站点/链接/密钥", s["table_bold"]), para("通过", s["table"]), para("站点引用、Markdown 相对链接、仓库 Key 模式扫描均无失败。", s["table"])],
    ]
    story.extend([
        styled_table(test_rows, [38 * mm, 45 * mm, 91 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE]),
        Spacer(1, 5 * mm),
        info_box(
            f"<b>结果边界：</b>标题归一化准确率为 {percent(EVALUATION['extraction']['titleNormalizationAccuracy'])}，交付物 F1 为 {percent(EVALUATION['extraction']['deliverableF1'])}。Mission 指标验证的是合成状态闭环，不代表学习成效或学术质量。真实模型、真实图片 OCR、长稳和置信区间仍未充分测量。",
            s["body"],
            CORAL_PALE,
            CORAL,
        ),
        PageBreak(),
    ])

    story.extend([
        section_title("05", "三分钟演示证明", s["h1"]),
        para("附件提供三组合成输入。明确任务的主链路使用本地规则即可完成，不依赖 API Key；DeepSeek 增强是可选项。演示同时覆盖缺失信息与来源冲突，避免只展示成功分支。", s["body"]),
    ])
    demo_rows = [
        [para("场景", s["table_bold"]), para("输入证据", s["table_bold"]), para("应观察到的行为", s["table_bold"])],
        [para("A 五项综合通知", s["table_bold"]), para("五类学习/申请任务、交付物、方式、偏好和一个条件变化。", s["table"]), para("明确任务直接整理；形成 TaskPlan/Mission，进入今日执行与每日回顾，不因非阻断信息先弹问。", s["table"])],
        [para("B 缺失截止", s["table_bold"]), para("启动材料含两个交付物，但没有截止时间。", s["table"]), para("只追问 dueAt；回答后恢复同一草稿并继续规划。", s["table"])],
        [para("C 来源冲突", s["table_bold"]), para("平台和群公告给出两个不同时间。", s["table"]), para("不静默覆盖；保留证据和选项，用户确认后继续。", s["table"])],
    ]
    story.extend([
        styled_table(demo_rows, [33 * mm, 61 * mm, 80 * mm], row_backgrounds=[WHITE, PAPER, WHITE]),
        Spacer(1, 7 * mm),
        para("推荐 180 秒节奏", s["h2"]),
    ])
    timeline_rows = [
        [para("0:00-0:20", s["table_bold"]), para("定位：不代写，解决课程要求到执行、证据与调整的断层。", s["table"])],
        [para("0:20-1:05", s["table_bold"]), para("导入场景 A，展示智能整理、来源、目标、交付物、完成标准和里程碑。", s["table"])],
        [para("1:05-1:35", s["table_bold"]), para("展示证据/检查点、今日执行的容量排程与结构化 Trace。", s["table"])],
        [para("1:35-2:05", s["table_bold"]), para("完成一个时间块并打开每日回顾，展示活动轨迹、总结、历史和顺延。", s["table"])],
        [para("2:05-2:42", s["table_bold"]), para("运行 B/C，证明只追问阻断项，冲突事实由用户裁决。", s["table"])],
        [para("2:42-3:00", s["table_bold"]), para("展示 benchmark、测试、仓库 commit、安装包与哈希。", s["table"])],
    ]
    story.extend([
        styled_table(timeline_rows, [31 * mm, 143 * mm], header=False, row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 7 * mm),
        info_box(
            "附件的 02_产品与Demo 含完整 180/60 秒脚本和三个合成输入文件。现场优先使用场景 A 的本地规则路径，避免网络或模型额度影响。",
            s["body"],
        ),
        PageBreak(),
    ])

    story.extend([
        section_title("06", "安全、开源与发布证明", s["h1"]),
    ])
    security_rows = [
        [para("边界", s["table_bold"]), para("已实现控制", s["table_bold"])],
        [para("不可信材料", s["table_bold"]), para("提示注入内容不能在本地规则路径创建任务或追问；React 按文本渲染。", s["table"])],
        [para("压缩文档", s["table_bold"]), para("DOCX/XLSX 预检魔数、中央目录、条目数、64 MiB 展开配额、200 倍压缩比、加密和路径穿越。", s["table"])],
        [para("模型输出", s["table_bold"]), para("只作为候选；日期、来源、字段、计划约束和状态变更均由本地验证。", s["table"])],
        [para("产出证据", s["table_bold"]), para("文件流式 SHA-256、512 MiB 上限与变更检测；状态不保存绝对路径/内容；HTTP API 不接受任意文件路径。", s["table"])],
        [para("数据与密钥", s["table_bold"]), para("任务、Mission、每日回顾和记忆默认本地保存；Key 使用系统安全存储；导出移除原文、路径和 Token。", s["table"])],
        [para("第三方素材", s["table_bold"]), para("赛事安装包使用 product/xiaotong：219 张动态帧、Apache-2.0、未修改附加条款、原仓库回链和两次交互内可达 About 一并交付；不声称商业授权。", s["table"])],
    ]
    story.extend([
        styled_table(
            security_rows,
            [42 * mm, 132 * mm],
            row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE],
            cell_padding=4,
        ),
        Spacer(1, 1 * mm),
        para("可运行产品", s["h2_compact"]),
        info_box(
            installer_summary(),
            s["body_compact"],
            PAPER,
            LINE,
        ),
        Spacer(1, 1 * mm),
        para(
            "本机包已完成 product/xiaotong 素材、ASAR、许可证、动态帧和解包冷启动检查；当前 Authenticode 状态为 NotSigned，Windows 可能显示 SmartScreen。macOS 产物只由 macOS runner 构建。",
            s["body_compact"],
        ),
        para("复现与核验", s["h2_compact"]),
        para(
            "附件的 03_工程与复现、04_评测与运行证据 提供方案、命令、核心源码、脱敏逐例结果、runner 与关键测试；完整源码、CI 和 Release 工作流在开源仓库中。",
            s["body_compact"],
        ),
        Spacer(1, 1 * mm),
        info_box(
            "<b>结论：</b>Chroni 已形成从材料理解、语义优先级规划、今日执行、证据反馈到 14 日趋势回顾和容量调整的可运行闭环，并提供失败分支、复现证据、低门槛模型入口与教育边界。真实授权用户研究、正式签名/公证、模型基准和真实 OCR 大样本仍属于后续工作。",
            s["body_compact"],
            GREEN_PALE,
            GREEN,
        ),
    ])
    return story


def main():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=21 * mm,
        title="Chroni GOAI 2026 更新版项目方案",
        author="Chroni contributors",
        subject="Chroni local-first learning execution Agent competition submission",
    )
    document.build(build_story(styles()), onFirstPage=draw_page, onLaterPages=draw_page)
    reader = PdfReader(str(OUTPUT))
    if len(reader.pages) < 9:
        raise RuntimeError(f"Unexpected evidence PDF page count: {len(reader.pages)}")
    print(f"Wrote {OUTPUT} ({len(reader.pages)} pages, {OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
