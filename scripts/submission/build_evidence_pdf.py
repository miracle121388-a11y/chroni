import hashlib
import json
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
OUTPUT = ROOT / "output" / "pdf" / "Chroni_GOAI_2026_参赛作品说明.pdf"
DAILY_SCREENSHOT = ROOT / "docs" / "assets" / "chroni-daily-planner-v0.1.4.png"
AGENT_SCREENSHOT = ROOT / "docs" / "assets" / "chroni-agent-workspace-v0.1.4.png"
MISSION_SCREENSHOT = ROOT / "docs" / "assets" / "chroni-learning-mission-v0.1.4.png"
EVALUATION = json.loads((ROOT / "benchmarks" / "goai-v1" / "reports" / "latest.json").read_text(encoding="utf-8"))
INSTALLER = ROOT / "apps" / "desktop" / "dist-electron" / "Chroni-0.1.4-win-x64-setup.exe"

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
        return "安装包尚未在本机生成；请先运行 pnpm run package:goai:windows。"
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
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="ChroniSans",
            fontSize=9.3,
            leading=15.5,
            textColor=INK,
            spaceAfter=7,
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


def styled_table(data, widths, header=True, row_backgrounds=None):
    table = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.55, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
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
    canvas.drawString(18 * mm, 9.5 * mm, "Chroni GOAI 2026 参赛作品说明")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"{page}")
    canvas.restoreState()


def build_story(s):
    story = []

    story.extend([
        Spacer(1, 31 * mm),
        para("GOAI 2026 · BOUNDLESS AGENTS · AI + 教育", s["cover_kicker"]),
        para("Chroni", s["cover_title"]),
        para("面向大学项目制学习的本地学习执行 Agent", s["cover_subtitle"]),
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
        [para("0.1.4", s["metric"]), para("复赛就绪", s["metric"]), para("2026-08-25", s["metric"])],
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
        [para("Agent 规划", s["table_bold"]), para("Ground → Plan → Act → Verify → Adapt；风险、容量、工具和结构化 Trace。", s["table"])],
        [para("每日时间轴", s["table_bold"]), para("日、多日、周、月视图；按真实时长显示，支持缩放、拖动、重排和历史回顾。", s["table"])],
        [para("可控记忆", s["table_bold"]), para("只从用户明确保存的计划差异学习；可停用、删除或清空。", s["table"])],
        [para("隔离演示", s["table_bold"]), para("三个无 Key 合成场景使用独立 Store，重置和退出不会污染真实数据。", s["table"])],
    ]
    story.extend([
        styled_table(capability_rows, [38 * mm, 136 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE]),
        PageBreak(),
    ])

    story.extend([
        section_title("02", "真实产品界面", s["h1"]),
        para("下列截图来自 Chroni 0.1.4 的真实控制中心，使用明确标注的隔离合成演示数据，不是概念效果图。", s["body"]),
        scaled_image(MISSION_SCREENSHOT, 166 * mm),
        para("Learning Mission 控制台：来源、目标、交付物、完成标准、里程碑、证据覆盖和阶段反馈处于同一任务档案。", s["caption"]),
        info_box(
            "<b>教育边界：</b>证据覆盖只说明交付物存在用户登记记录，不等同于学术质量评分；任务完成仍由用户确认。",
            s["body"],
            GOLD_PALE,
            GOLD,
        ),
        PageBreak(),
        section_title("02", "真实产品界面（执行层）", s["h1"]),
        scaled_image(DAILY_SCREENSHOT, 128 * mm),
        para("今日执行：任务按真实时长占据时间轴，可缩放、拖拽、重排并查看多日计划。", s["caption"]),
        scaled_image(AGENT_SCREENSHOT, 128 * mm),
        para("学习执行 Agent 工作台：展示下一步、今日工作块、高风险任务、覆盖率、规划来源和结构化 Trace。", s["caption"]),
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
        [para("主动追问", s["table_bold"]), para("可优化问题表达。", s["table"]), para("决定是否真正缺失；回答后恢复原流程。", s["table"])],
        [para("Plan", s["table_bold"]), para("提出步骤、耗时和不确定性。", s["table"]), para("版本化 TaskPlan；验证依赖、总耗时、交付物、完成标准和截止边界。", s["table"])],
        [para("Act", s["table_bold"]), para("可提出结构化分配建议。", s["table"]), para("风险、slack、容量、时间冲突、排程/提醒/持久化工具和规则回退。", s["table"])],
        [para("Verify / Adapt", s["table_bold"]), para("可辅助总结反馈，不得自行完成或评分。", s["table"]), para("证据 SHA-256、里程碑检查点、实际投入、阻塞回写、进度与下一步重算。", s["table"])],
        [para("记忆 / Trace", s["table_bold"]), para("只消费筛选后的结构化偏好。", s["table"]), para("偏好证据门槛、开关/删除、脱敏运行证据导出。", s["table"])],
    ]
    story.extend([
        styled_table(architecture_rows, [28 * mm, 64 * mm, 82 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 6 * mm),
        para("可复用能力模块", s["h2"]),
        para(
            "DeadlineExtraction · EvidenceValidation · MissingFieldClarification · TaskPlanGeneration · PlanConstraintValidation · LearningMissionSynthesis · EvidenceCheckpoint · DailyScheduling · ReminderDispatch · PlanningPreferenceLearning · RunTraceExport",
            s["body"],
        ),
        para("开源仓库中的核心实现", s["h2"]),
        para(
            "完整源码在开源仓库中提供。核心实现包括 intake.ts、learning-mission.ts、goai-demo.ts、deadline-agent.ts、agent-tools.ts、task-plan-agent.ts、evidence-report.ts、store.ts、api-server.ts，以及 LearningMission/Agent/DailyPlanner 前端组件和 CI/Release 工作流。",
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
        [para("Desktop tests", s["table_bold"]), para("247 pass / 0 fail / 1 skip", s["table"]), para("共 248 项；抽取、Mission、证据/检查点、Store、Agent、Demo、UI、API 与打包。", s["table"])],
        [para("Gateway tests", s["table_bold"]), para("4 pass / 0 fail", s["table"]), para("鉴权、限流、超时、上游错误和日志边界。", s["table"])],
        [para("GOAI build", s["table_bold"]), para("通过", s["table"]), para("Renderer 资源扫描无受限 XIAOTONG 路径或栅格素材。", s["table"])],
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
        para("GOAI 演示使用独立 userData/goai-demo Store；加载场景会重建合成状态，退出会删除演示目录并恢复主 Store。全程不需要 API Key。", s["body"]),
    ])
    demo_rows = [
        [para("场景", s["table_bold"]), para("输入证据", s["table_bold"]), para("应观察到的行为", s["table_bold"])],
        [para("A Learning Mission", s["table_bold"]), para("数据库课程项目；PDF + SQL；明确截止。", s["table"]), para("创建任务、TaskPlan、Mission、隔离合成证据与检查点，再进入今日执行和 Trace。", s["table"])],
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
        [para("0:20-1:05", s["table_bold"]), para("运行场景 A，展示来源、目标、交付物、完成标准和里程碑。", s["table"])],
        [para("1:05-1:35", s["table_bold"]), para("展示证据与检查点绑定里程碑，以及进度/下一步变化。", s["table"])],
        [para("1:35-2:05", s["table_bold"]), para("打开今日执行和 Agent Trace，展示容量排程与本地工具结果。", s["table"])],
        [para("2:05-2:42", s["table_bold"]), para("运行 B/C，证明只追问阻断项，冲突事实由用户裁决。", s["table"])],
        [para("2:42-3:00", s["table_bold"]), para("导出脱敏证据并退出 Demo，证明 Trace、完整性和 Store 隔离。", s["table"])],
    ]
    story.extend([
        styled_table(timeline_rows, [31 * mm, 143 * mm], header=False, row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE, PAPER]),
        Spacer(1, 7 * mm),
        info_box(
            "附件的 02_演示材料 含完整 180/60 秒脚本和三个原始合成输入文件。现场优先使用场景 A 的离线路径，避免网络或模型额度影响。",
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
        [para("数据与密钥", s["table_bold"]), para("本地优先；Key 使用系统安全存储；导出移除原文、路径、标题、证据/检查点正文和 Token。", s["table"])],
        [para("第三方素材", s["table_bold"]), para("GOAI/公开 Release 强制 original 模式，不打包 XIAOTONG 帧或捐赠码；字体与依赖声明随包。", s["table"])],
    ]
    story.extend([
        styled_table(security_rows, [42 * mm, 132 * mm], row_backgrounds=[WHITE, PAPER, WHITE, PAPER, WHITE]),
        Spacer(1, 7 * mm),
        para("可运行产品", s["h2"]),
        info_box(
            installer_summary(),
            s["body"],
            PAPER,
            LINE,
        ),
        Spacer(1, 4 * mm),
        para(
            "安装包已完成安全素材扫描、ASAR 路径检查、许可证随包检查和解包冷启动。当前 Authenticode 状态为 NotSigned，Windows 可能显示 SmartScreen；macOS universal workflow 已配置，但本 Windows 主机没有伪造 macOS 产物。",
            s["body"],
        ),
        para("复现与核验", s["h2"]),
        para(
            "附件的 03_技术与评测 提供技术方案、评测报告和原始逐例结果。完整源码、测试、评测 runner、数据 schema、CI 与 Release 工作流均在开源仓库中，可运行 pnpm run eval:goai 与 pnpm run check 复现。",
            s["body"],
        ),
        Spacer(1, 5 * mm),
        info_box(
            "<b>结论：</b>Chroni 已形成可运行、可演示、可复现、可回退并能解释教育边界的学习执行 Agent。真实授权用户研究、正式签名/公证、模型基准和真实 OCR 大样本仍属于后续工作。",
            s["body"],
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
        title="Chroni GOAI 2026 参赛作品说明",
        author="Chroni contributors",
        subject="Chroni local-first learning execution Agent competition submission",
    )
    document.build(build_story(styles()), onFirstPage=draw_page, onLaterPages=draw_page)
    reader = PdfReader(str(OUTPUT))
    if len(reader.pages) < 6:
        raise RuntimeError(f"Unexpected evidence PDF page count: {len(reader.pages)}")
    print(f"Wrote {OUTPUT} ({len(reader.pages)} pages, {OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
