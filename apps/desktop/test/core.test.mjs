import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureOcrCachePath, ensureTaskPlan, extractDdlItemsFromText, extractPayload, itemFromLlmCandidate, isReliableOcrResult, mergeModelAndRuleItems, processIntake, recognizeImageWithTesseract, reprocessSource, workbookText } from "../dist/intake.js";
import { lightweightScheduleItems, scheduleBucket, shouldRemindItem, snoozeUntil, visibleScheduleSummary } from "../dist/shared/schedule.js";
import { companionStateForItems, ChroniStore } from "../dist/store.js";

function localIso(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  const store = new ChroniStore(dir);
  try {
    return await fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testSecretCodec() {
  return {
    encrypt(value) {
      return Buffer.from(`chroni:${value}`, "utf8").toString("base64");
    },
    decrypt(value) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (!decoded.startsWith("chroni:")) throw new Error("Invalid test secret");
      return decoded.slice("chroni:".length);
    },
  };
}

test("workbook text includes every sheet from read-excel-file v9", () => {
  const text = workbookText([
    { sheet: "Tasks", data: [["Report", new Date("2026-07-20T10:00:00.000Z")]] },
    { sheet: "Notes", data: [["Bring charts", true, 3]] },
  ]);

  assert.match(text, /\[工作表: Tasks\]/);
  assert.match(text, /2026-07-20T10:00:00.000Z/);
  assert.match(text, /\[工作表: Notes\]/);
  assert.match(text, /Bring charts, true, 3/);
});

test("empty workbook sheets cannot create task text from sheet names", () => {
  const text = workbookText([
    { sheet: "7月20日提交报告", data: [] },
    { sheet: "23:59 截止", data: [[null, "  "]] },
  ]);

  assert.equal(text, "");
});

test("OCR cache selection skips invalid paths and falls back to a writable directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-ocr-cache-test-"));
  try {
    const blockingFile = join(dir, "not-a-directory");
    writeFileSync(blockingFile, "blocked", "utf8");
    const fallback = join(dir, "fallback");

    assert.equal(ensureOcrCachePath(["relative-cache", join(blockingFile, "ocr"), fallback]), fallback);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Tesseract adapter supports the package default export", async () => {
  let receivedLanguages;
  let receivedOptions;
  const result = await recognizeImageWithTesseract(Buffer.from("image"), {
    default: {
      recognize: async (_image, languages, options) => {
        receivedLanguages = languages;
        receivedOptions = options;
        return { data: { text: "Report due 2026-07-20", confidence: 88 } };
      },
    },
  }, "D:\\Chroni\\ocr-cache");

  assert.equal(receivedLanguages, "chi_sim+eng");
  assert.deepEqual(receivedOptions, { cachePath: "D:\\Chroni\\ocr-cache" });
  assert.deepEqual(result, { text: "Report due 2026-07-20", confidence: 88 });
});

test("model and local deadlines reconcile timezone-only differences", () => {
  const base = {
    id: "model",
    title: "机器学习报告截止",
    importance: "medium",
    sourceSummary: "deadline.txt: Machine learning report due 2026-07-20 18:00.",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    completed: false,
  };
  const result = mergeModelAndRuleItems(
    [{ ...base, dueAt: "2026-07-20T18:00:00.000Z" }],
    [{ ...base, id: "rule", title: "Machine learning", dueAt: "2026-07-20T10:00:00.000Z" }],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].title, "机器学习报告截止");
  assert.equal(result[0].dueAt, "2026-07-20T10:00:00.000Z");
});

test("English at-time syntax keeps the explicit clock time", () => {
  const [item] = extractDdlItemsFromText(
    "Prepare the quarterly anomaly analysis. The final submission deadline is 2026-07-25 at 17:45.",
    "直接文本",
  );

  assert.ok(item);
  assert.equal(item.dueAt, new Date(2026, 6, 25, 17, 45).toISOString());
});

test("model and local items merge when their source evidence overlaps", () => {
  const dueAt = new Date(2026, 6, 25, 17, 45).toISOString();
  const base = {
    id: "model-overlap",
    importance: "medium",
    dueAt,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    completed: false,
  };
  const result = mergeModelAndRuleItems(
    [{ ...base, title: "季度异常分析报告提交", sourceSummary: "直接文本: The final submission deadline is 2026-07-25 at 17:45." }],
    [{ ...base, id: "rule-overlap", title: "Prepare the quar", sourceSummary: "直接文本: Prepare the quarterly anomaly analysis. The final submission deadline is 2026-07-25 at 17:45." }],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].title, "季度异常分析报告提交");
});

test("records incomplete task-like intake as a pending local source", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "请提醒我提交课程报告" }, store);

    assert.equal(result.ok, false);
    assert.equal(result.snapshot.sources[0].sourceName, "直接文本");
    assert.equal(result.snapshot.sources[0].extractionStatus, "pending");
    assert.match(result.snapshot.sources[0].lastError ?? "", /截止时间/);
  });
});

test("records duplicate intake without creating another schedule item", async () => {
  await withStore(async (store) => {
    const text = "7月12日 23:59 提交课程报告";
    const first = await processIntake({ kind: "text", text }, store);
    const sourceId = first.snapshot.sources[0].id;
    const itemCountAfterFirst = first.snapshot.items.length;
    const second = await processIntake({ kind: "text", text }, store);

    assert.equal(second.snapshot.items.length, itemCountAfterFirst);
    assert.equal(second.snapshot.sources.length, 1);
    assert.equal(second.snapshot.sources[0].id, sourceId);
    assert.equal(second.snapshot.items[0].sourceId, sourceId);
    assert.equal(second.snapshot.sources[0].extractionStatus, "duplicate");
    assert.equal(second.snapshot.sources[0].itemIds.length, 1);
    assert.match(second.message, /已经存在/);
  });
});

test("an ambiguous task does not block explicit tasks from the same source", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "7月20日 18:00 提交课程报告。下周完成机器学习作业。" }, store);

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.items.length, 1);
    assert.match(result.snapshot.items[0].title, /课程报告/);
    assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending" && item.required).length, 0);
    assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending" && !item.required).length, 1);
    assert.notEqual(result.snapshot.companion.state, "needs_clarification");
  });
});

test("a pasted absolute file path is loaded as a file instead of task text", async () => {
  const fileDir = mkdtempSync(join(tmpdir(), "chroni-pasted-path-"));
  const filePath = join(fileDir, "notice.md");
  writeFileSync(filePath, "2026年7月20日 23:59 前提交课程报告", "utf8");
  try {
    await withStore(async (store) => {
      const result = await processIntake({ kind: "text", text: filePath }, store);

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.items.length, 1);
      assert.equal(result.snapshot.sources[0].sourceName, "notice.md");
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 0);
    });
  } finally {
    rmSync(fileDir, { recursive: true, force: true });
  }
});

test("startup removes historical clarifications created from a pasted file path", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-path-migration-"));
  const filePath = join(dir, "notice.md");
  writeFileSync(filePath, "2026年7月20日 23:59 前提交课程报告", "utf8");
  try {
    const store = new ChroniStore(dir);
    const now = new Date().toISOString();
    const draftId = "draft-pasted-path";
    store.saveIntakeDraft({
      id: draftId,
      sourceName: "直接文本",
      sourceType: "text",
      candidate: {},
      confidence: { title: 0, dueAt: 0 },
      pendingClarificationIds: ["clarification-path-title", "clarification-path-due"],
      status: "needs-clarification",
      createdAt: now,
      updatedAt: now,
    }, [
      { id: "clarification-path-title", draftId, field: "title", question: "这项任务应该叫什么？", reason: "缺少标题", options: [], allowFreeText: true, required: true, status: "pending", createdAt: now, resumeToken: "path-title" },
      { id: "clarification-path-due", draftId, field: "dueAt", question: "这个任务什么时候截止？", reason: "缺少截止时间", options: [], allowFreeText: true, required: true, status: "pending", createdAt: now, resumeToken: "path-due" },
    ], { sourceName: "直接文本", sourceType: "text", text: filePath });
    assert.equal(store.snapshot().clarifications.filter((item) => item.status === "pending").length, 2);

    const reopened = new ChroniStore(dir);
    assert.equal(reopened.snapshot().clarifications.filter((item) => item.status === "pending").length, 0);
    assert.equal(reopened.snapshot().intakeDrafts.find((item) => item.id === draftId)?.status, "cancelled");
    assert.equal(reopened.snapshot().sources.some((source) => source.text === filePath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the comprehensive notice creates five plans before exposing optional refinements", async () => {
  await withStore(async (store) => {
    const noticePath = join(process.cwd(), "..", "..", "ddl_agent_test_notice.md");
    const text = readFileSync(noticePath, "utf8");
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-chat" } });
    store.updateAgentMemory({ useLlmPlanning: false });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: [
          { title: "机器学习期末项目提交", dueAt: localIso(2026, 7, 20, 23, 59), importance: "high", sourceSummary: "机器学习导论课程期末项目需要在 2026 年 7 月 20 日 23:59 前 提交至课程平台", deliverables: ["项目源码压缩包", "README.md", "项目运行截图不少于 3 张", "一份 1500 字左右的实验报告 PDF"] },
          { title: "数据库作业五提交", dueAt: localIso(2026, 7, 16, 22, 0), importance: "high", sourceSummary: "数据库系统作业五已经发布。请在 2026-07-16 22:00 前提交" },
          { title: "创新创业路演材料提交", dueAt: localIso(2026, 7, 17, 18, 0), importance: "high", sourceSummary: "材料请在 2026 年 7 月 17 日 18:00 前 发给项目负责人汇总" },
          { title: "创新创业预路演", dueAt: localIso(2026, 7, 18, 10, 0), importance: "medium", sourceSummary: "创新创业项目组将于 2026 年 7 月 18 日上午 10:00 进行线上预路演" },
          { title: "实习申请材料提交", dueAt: localIso(2026, 7, 25, 12, 0), importance: "high", sourceSummary: "请在 2026/07/25 12:00 前将以下材料发送给 HR" },
        ],
        pendingItems: [
          { title: "英语展示活动", importance: "medium", sourceSummary: "展示日期：2026 年 7 月 22 日下午第二节课", question: "下午第二节课具体几点？", reason: "课次无法安全换算为精确钟点。" },
          { title: "数据库作业五可能提前", importance: "high", sourceSummary: "数据库作业五可能改为 2026-07-15 23:59 前 邮件提交。最终以明天上午通知为准", question: "是否已确认提前？", reason: "候选时间仍以通知为准。" },
          { title: "英语展示PPT提交时间", importance: "medium", sourceSummary: "缺失信息：具体提交平台和最晚提交时间不明确", question: "提交平台和最晚时间是什么？", reason: "提交信息尚未明确。" },
        ],
      }) } }],
    }), { status: 200 });
    try {
      const result = await processIntake({ kind: "text", text }, store);

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.items.length, 5);
      assert.equal(result.snapshot.taskPlans.length, 5);
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending" && item.required).length, 0);
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending" && !item.required).length, 3);
      assert.equal(result.snapshot.items.find((item) => item.title.includes("数据库"))?.extraction?.uncertainties.some((item) => item.includes("可能改为")), true);
      assert.doesNotMatch(result.message, /等待确认|需要确认/);
      assert.notEqual(result.snapshot.companion.state, "needs_clarification");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("bulk intake uses DeepSeek planning for every extracted task when enabled", async () => {
  await withStore(async (store) => {
    const text = "2026年7月20日20:00提交课程报告。2026年7月21日21:00提交实验报告。";
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-chat" } });
    const originalFetch = globalThis.fetch;
    let extractionCalls = 0;
    let planningCalls = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const systemPrompt = request.messages[0].content;
      const content = systemPrompt.includes("DDL 信息抽取器")
        ? JSON.stringify({
            items: [
              { title: "课程报告", dueAt: localIso(2026, 7, 20, 20, 0), importance: "medium", sourceSummary: "2026年7月20日20:00提交课程报告" },
              { title: "实验报告", dueAt: localIso(2026, 7, 21, 21, 0), importance: "medium", sourceSummary: "2026年7月21日21:00提交实验报告" },
            ],
            pendingItems: [],
          })
        : JSON.stringify({
            goal: "完成并提交任务",
            taskType: "coursework",
            deliverables: [],
            constraints: [],
            bufferMinutes: 30,
            summary: "已生成任务执行计划。",
            uncertainties: [],
            steps: [{ clientId: "complete", title: "完成并检查", description: "完成任务并核对提交要求。", estimatedMinutes: 60, dependsOn: [], completionCriteria: ["任务已完成并核对"] }],
          });
      if (systemPrompt.includes("DDL 信息抽取器")) extractionCalls += 1;
      else planningCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
    try {
      const result = await processIntake({ kind: "text", text }, store);

      assert.equal(result.ok, true);
      assert.equal(extractionCalls, 1);
      assert.equal(planningCalls, 2);
      assert.deepEqual(result.snapshot.taskPlans.map((plan) => plan.plannerSource), ["llm", "llm"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("disabling Agent LLM planning keeps extraction enabled but uses a local task plan", async () => {
  await withStore(async (store) => {
    const timestamp = "2026-07-20T18:00:00.000Z";
    store.addItems([{ id: "local-plan", title: "课程作业", dueAt: timestamp, importance: "medium", sourceSummary: "test", createdAt: timestamp, updatedAt: timestamp, completed: false }]);
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    store.updateAgentMemory({ useLlmPlanning: false });
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("planning should remain local"); };
    try {
      const plan = await ensureTaskPlan("local-plan", store);
      assert.equal(plan.plannerSource, "rules");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("reprocessing preserves matching task identity and leaves no orphan plans", async () => {
  await withStore(async (store) => {
    const initial = await processIntake({ kind: "text", text: "7月20日 23:59 提交课程报告" }, store);
    const source = initial.snapshot.sources[0];
    const taskId = initial.snapshot.items[0].id;
    const initialPlan = store.taskPlanByTaskId(taskId);
    store.activateTaskPlan(taskId, initialPlan.id);
    store.updateSourceText(source.id, "7月20日 23:59 提交课程报告\n请使用 PDF 格式");

    const result = await reprocessSource(source.id, store);
    const taskIds = new Set(result.snapshot.items.map((item) => item.id));
    assert.equal(result.snapshot.items[0].id, taskId);
    assert.equal(result.snapshot.taskPlans.every((plan) => taskIds.has(plan.taskId)), true);
    assert.equal(result.snapshot.taskPlans.some((plan) => plan.taskId === taskId && plan.status === "active"), true);
    assert.equal(result.snapshot.taskPlans.some((plan) => plan.taskId === taskId && plan.status === "draft"), true);
  });
});

test("reprocess failure keeps previous source items and records the failure", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 18:00 交实验报告" }, store);
    const source = created.snapshot.sources[0];
    const itemIdsBefore = [...source.itemIds];

    store.updateSourceText(source.id, "请提醒我交实验报告");
    const result = await reprocessSource(source.id, store);

    assert.equal(result.ok, false);
    const updatedSource = result.snapshot.sources.find((candidate) => candidate.id === source.id);
    assert.deepEqual(updatedSource?.itemIds, itemIdsBefore);
    assert.equal(updatedSource?.extractionStatus, "failed");
    assert.match(updatedSource?.lastError ?? "", /截止时间/);
  });
});

test("reprocess preserves pending model clarifications on the original source", async () => {
  await withStore(async (store) => {
    const initial = await processIntake({
      kind: "files",
      files: [{ name: "notice.md", contentBase64: Buffer.from("7月20日 23:59 提交课程报告").toString("base64") }],
    }, store);
    const source = initial.snapshot.sources[0];
    const sourceText = "7月20日 23:59 提交课程报告 PDF。英语展示在 7月22日下午第二节课，具体钟点未说明。";
    store.updateSourceText(source.id, sourceText);
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: [{
          title: "课程报告提交",
          dueAt: localIso(2026, 7, 20, 23, 59),
          importance: "high",
          sourceSummary: "7月20日 23:59 提交课程报告 PDF",
          contextExcerpt: "7月20日 23:59 提交课程报告 PDF",
          deliverables: ["课程报告 PDF"],
        }],
        pendingItems: [{
          title: "英语展示",
          importance: "medium",
          sourceSummary: "英语展示在 7月22日下午第二节课，具体钟点未说明",
          contextExcerpt: "英语展示在 7月22日下午第二节课，具体钟点未说明",
          deliverables: [],
          question: "下午第二节课具体几点开始？",
          reason: "课次无法安全换算为精确钟点。",
        }],
      }) } }],
    }), { status: 200 });
    try {
      const result = await reprocessSource(source.id, store);

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.sources.length, 1);
      assert.equal(result.snapshot.sources[0].id, source.id);
      assert.equal(result.snapshot.sources[0].extractionStatus, "success");
      assert.equal(result.snapshot.items.length, 1);
      assert.equal(result.snapshot.items[0].sourceId, source.id);
      assert.match(result.snapshot.items[0].sourceSummary, /^notice\.md:/);
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 1);
      assert.equal(result.snapshot.clarifications[0].sourceId, source.id);
      assert.equal(result.snapshot.intakeDrafts[0].sourceName, "notice.md");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("parses common compact and next-week deadline expressions", () => {
  const compact = extractDdlItemsFromText("7.12 23:59 提交课程报告");
  const nextWeek = extractDdlItemsFromText("下周五 18:00 小组汇报");

  assert.equal(compact.length, 1);
  assert.equal(new Date(compact[0].dueAt).getHours(), 23);
  assert.equal(new Date(compact[0].dueAt).getMinutes(), 59);
  assert.equal(nextWeek.length, 1);
  assert.equal(new Date(nextWeek[0].dueAt).getHours(), 18);
});

test("relative deadlines use the explicit time rather than unrelated numbers", () => {
  const items = extractDdlItemsFromText("阅读第2章，明天 18:00 提交读书笔记");

  assert.equal(items.length, 1);
  assert.equal(new Date(items[0].dueAt).getHours(), 18);
  assert.equal(new Date(items[0].dueAt).getMinutes(), 0);
});

test("Chinese numeral clock times create a schedule item without clarification", async () => {
  const text = "今天晚上八点提交课程项目";
  const items = extractDdlItemsFromText(text, "日程安排.txt");
  const halfPast = extractDdlItemsFromText("明天下午三点半完成课程报告");

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "课程项目");
  assert.equal(new Date(items[0].dueAt).getHours(), 20);
  assert.equal(halfPast[0].title, "课程报告");
  assert.equal(new Date(halfPast[0].dueAt).getHours(), 15);
  assert.equal(new Date(halfPast[0].dueAt).getMinutes(), 30);

  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [{ name: "日程安排.txt", contentBase64: Buffer.from(text).toString("base64") }],
    }, store);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.items.length, 1);
    assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 0);
  });
});

test("common Chinese aliases, comma-separated tasks, and contextual titles stay accurate", () => {
  const tonight = extractDdlItemsFromText("今晚八点提交课程项目");
  const tomorrowNight = extractDdlItemsFromText("明晚8点提交课程报告");
  const tomorrowMorning = extractDdlItemsFromText("明早九点参加答辩");
  const numberedDate = extractDdlItemsFromText("7月20号晚上八点提交报告");
  const multiple = extractDdlItemsFromText("明天八点交报告，后天九点交作业");
  const contextual = extractDdlItemsFromText("数据库系统作业五已经发布。请在 2026-07-16 22:00 前提交。");

  assert.equal(new Date(tonight[0].dueAt).getHours(), 20);
  assert.equal(new Date(tomorrowNight[0].dueAt).getHours(), 20);
  assert.equal(new Date(tomorrowMorning[0].dueAt).getHours(), 9);
  assert.equal(tomorrowMorning[0].title, "答辩");
  assert.equal(numberedDate[0].title, "报告");
  assert.deepEqual(multiple.map((item) => item.title), ["报告", "作业"]);
  assert.equal(contextual[0].title, "数据库系统作业五");
});

test("a deadline without a task name asks only for the missing title", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "明天八点提交" }, store);

    assert.equal(result.ok, false);
    assert.deepEqual(result.snapshot.clarifications.filter((item) => item.status === "pending").map((item) => item.field), ["title"]);
  });
});

test("conditional deadlines remain pending instead of becoming formal schedule items", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "如果老师同意，明天八点提交报告，以通知为准" }, store);

    assert.equal(result.ok, false);
    assert.equal(result.snapshot.items.length, 0);
    assert.equal(result.snapshot.intakeDrafts[0].candidate.title, "报告");
    assert.equal(result.snapshot.clarifications[0].field, "dueAt");
    assert.match(result.snapshot.clarifications[0].reason, /条件|通知/);
  });
});

test("one document with multiple incomplete tasks creates independent drafts on one source", async () => {
  await withStore(async (store) => {
    const result = await processIntake({ kind: "text", text: "下周完成机器学习作业。今天晚上提交课程报告。" }, store);
    const pending = result.snapshot.clarifications.filter((item) => item.status === "pending");

    assert.equal(result.ok, false);
    assert.equal(result.snapshot.sources.length, 1);
    assert.equal(result.snapshot.intakeDrafts.length, 2);
    assert.deepEqual(new Set(result.snapshot.intakeDrafts.map((draft) => draft.sourceId)).size, 1);
    assert.deepEqual(result.snapshot.intakeDrafts.map((draft) => draft.candidate.title).sort(), ["机器学习作业", "课程报告"]);
    assert.equal(pending.length, 2);
  });
});

test("a model cannot downgrade a locally explicit deadline to pending confirmation", async () => {
  await withStore(async (store) => {
    const text = "今天晚上八点提交课程项目";
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    store.updateAgentMemory({ useLlmPlanning: false });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: [],
        pendingItems: [{
          title: "课程项目",
          importance: "medium",
          sourceSummary: text,
          contextExcerpt: text,
          deliverables: [],
          question: "这项任务叫什么，截止时间是什么？",
          reason: "模型没有确定标题和时间。",
        }],
      }) } }],
    }), { status: 200 });
    try {
      const result = await processIntake({ kind: "text", text }, store);
      assert.equal(result.ok, true);
      assert.equal(result.snapshot.items.length, 1);
      assert.equal(result.snapshot.items[0].title, "课程项目");
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("reprocessing a corrected source closes its stale clarification draft", async () => {
  await withStore(async (store) => {
    const initial = await processIntake({ kind: "text", text: "今天晚上提交课程项目" }, store);
    assert.equal(initial.ok, false);
    assert.equal(initial.snapshot.clarifications.filter((item) => item.status === "pending").length, 1);

    const source = initial.snapshot.sources[0];
    store.updateSourceText(source.id, "今天晚上八点提交课程项目");
    const result = await reprocessSource(source.id, store);

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.items.length, 1);
    assert.equal(result.snapshot.items[0].title, "课程项目");
    assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 0);
    assert.equal(result.snapshot.intakeDrafts[0].status, "cancelled");
  });
});

test("pending reprocessing preserves the old task and updates it after confirmation", async () => {
  await withStore(async (store) => {
    const initial = await processIntake({ kind: "text", text: "7月20日 20:00 提交课程报告" }, store);
    const taskId = initial.snapshot.items[0].id;
    const sourceId = initial.snapshot.sources[0].id;
    const revisedText = "课程报告改为7月22日下午第二节课提交，具体钟点未说明";
    store.updateSourceText(sourceId, revisedText);
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        items: [],
        pendingItems: [{
          title: "课程报告",
          importance: "medium",
          sourceSummary: revisedText,
          contextExcerpt: revisedText,
          deliverables: [],
          question: "下午第二节课具体几点？",
          reason: "课次不能安全换算为钟点。",
        }],
      }) } }],
    }), { status: 200 });
    try {
      const pendingResult = await reprocessSource(sourceId, store);
      assert.equal(pendingResult.ok, true);
      assert.equal(pendingResult.snapshot.items.length, 1);
      assert.equal(pendingResult.snapshot.items[0].id, taskId);
      assert.equal(pendingResult.snapshot.clarifications.filter((item) => item.status === "pending").length, 1);
      assert.equal(pendingResult.snapshot.intakeDrafts[0].replacesTaskId, taskId);

      const clarification = pendingResult.snapshot.clarifications.find((item) => item.status === "pending");
      const answered = store.answerClarification(clarification.id, { value: "2026-07-22T14:00:00+08:00" });
      assert.equal(answered.snapshot.items.length, 1);
      assert.equal(answered.snapshot.items[0].id, taskId);
      assert.equal(answered.snapshot.items[0].dueAt, "2026-07-22T06:00:00.000Z");
      assert.deepEqual(answered.snapshot.sources[0].itemIds, [taskId]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("invalid calendar dates are not rolled into a different date", () => {
  const items = extractDdlItemsFromText("2月31日 23:59 提交课程报告");

  assert.equal(items.length, 0);
});

test("plain schedule dates without task intent are not converted to DDL", () => {
  const items = extractDdlItemsFromText("课程安排：7月12日 第一讲 导论；7月19日 第二讲 阅读方法");

  assert.equal(items.length, 0);
});

test("coursework dates with task intent are still converted to DDL", () => {
  const items = extractDdlItemsFromText("7月12日 23:59 课程报告");

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "课程报告");
});

test("new stores without existing state do not share mutated default data", async () => {
  const firstDir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  const secondDir = mkdtempSync(join(tmpdir(), "chroni-test-"));
  try {
    const first = new ChroniStore(firstDir);
    await processIntake({ kind: "text", text: "明天 20:00 交第一份报告" }, first);

    const second = new ChroniStore(secondDir);

    assert.equal(second.snapshot().sources.length, 0);
    assert.equal(second.snapshot().items.length, 0);
    assert.match(second.snapshot().companion.bubble, /拖给我/);
  } finally {
    rmSync(firstDir, { recursive: true, force: true });
    rmSync(secondDir, { recursive: true, force: true });
  }
});

test("invalid item due date patches do not corrupt stored items", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 20:00 提交课程报告" }, store);
    const before = created.snapshot.items[0];
    const snapshot = store.updateItem(before.id, { dueAt: "not-a-date" });
    const after = snapshot.items.find((item) => item.id === before.id);

    assert.equal(after?.dueAt, before.dueAt);
    assert.equal(snapshot.companion.state, "confused");
    assert.match(snapshot.companion.bubble, /截止时间/);
  });
});

test("schedule popover summary excludes currently snoozed items", () => {
  const now = new Date("2026-07-09T10:00:00.000Z");
  const base = {
    id: "ddl-1",
    title: "课程报告",
    importance: "medium",
    dueAt: "2026-07-09T12:00:00.000Z",
    sourceSummary: "测试",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completed: false,
  };
  const summary = visibleScheduleSummary([
    { ...base, id: "visible" },
    { ...base, id: "snoozed", snoozedUntil: "2026-07-09T13:00:00.000Z" },
    { ...base, id: "completed", completed: true },
  ], now);

  assert.deepEqual(summary, { active: 1, completed: 1, overdue: 0, today: 1, upcoming: 0 });
});

test("lightweight schedule shows one nearest later item instead of a misleading empty state", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const base = {
    importance: "medium",
    sourceSummary: "测试",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completed: false,
  };
  const items = [
    { ...base, id: "later", title: "两周后的报告", dueAt: "2026-07-24T12:00:00.000Z" },
    { ...base, id: "nearest", title: "下周后的报告", dueAt: "2026-07-19T12:00:00.000Z" },
  ];

  assert.deepEqual(lightweightScheduleItems(items, now).map((item) => item.id), ["nearest"]);
  assert.equal(scheduleBucket(items[1], now), "later");
});

test("snooze presets produce predictable reminder times", () => {
  const now = new Date(2026, 6, 10, 15, 30, 0, 0);
  assert.equal(snoozeUntil("two-hours", now).getTime() - now.getTime(), 2 * 3_600_000);
  assert.equal(snoozeUntil("one-day", now).getDate(), 11);
  const tomorrowMorning = snoozeUntil("tomorrow-morning", now);
  assert.equal(tomorrowMorning.getDate(), 11);
  assert.equal(tomorrowMorning.getHours(), 9);
  assert.equal(tomorrowMorning.getMinutes(), 0);
});

test("an expired snooze triggers once even when the deadline is more than 24 hours away", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const item = {
    completed: false,
    dueAt: "2026-07-15T10:00:00.000Z",
    snoozedUntil: "2026-07-10T09:59:00.000Z",
    lastRemindedAt: "2026-07-10T07:00:00.000Z",
  };

  assert.equal(shouldRemindItem(item, now), true);
  assert.equal(shouldRemindItem({ ...item, lastRemindedAt: now.toISOString() }, now), false);
  assert.equal(shouldRemindItem({ ...item, snoozedUntil: "2026-07-10T11:00:00.000Z" }, now), false);
});

test("schedule summary buckets do not double-count an overdue item from today", () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const summary = visibleScheduleSummary([{
    id: "overdue-today",
    title: "今日已逾期",
    importance: "high",
    dueAt: "2026-07-10T09:00:00.000Z",
    sourceSummary: "测试",
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    completed: false,
  }], now);

  assert.equal(summary.overdue, 1);
  assert.equal(summary.today, 0);
  assert.equal(summary.upcoming, 0);
});

test("snoozed items do not keep the companion in an urgent state", () => {
  const now = new Date();
  const overdue = {
    id: "overdue",
    title: "已稍后提醒的报告",
    importance: "high",
    dueAt: new Date(now.getTime() - 3_600_000).toISOString(),
    sourceSummary: "测试",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completed: false,
    snoozedUntil: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
  };

  assert.deepEqual(companionStateForItems([overdue]), {
    state: "idle",
    bubble: "稍后提醒的事项会按时回来。",
  });
});

test("item updates preserve completion feedback and immediately refresh after snoozing", async () => {
  await withStore(async (store) => {
    const created = await processIntake({ kind: "text", text: "明天 20:00 提交课程报告" }, store);
    const item = created.snapshot.items[0];

    const completed = store.updateItem(item.id, { completed: true });
    assert.equal(completed.companion.state, "celebrating");
    assert.match(completed.companion.bubble, /完成/);

    store.updateItem(item.id, { completed: false });
    const snoozed = store.updateItem(item.id, { snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(snoozed.companion.state, "idle");
    assert.match(snoozed.companion.bubble, /稍后提醒/);
  });
});

test("completing one task does not hide another overdue task behind celebration", async () => {
  await withStore((store) => {
    const now = new Date();
    const item = (id, title, dueAt) => ({
      id,
      title,
      importance: "high",
      dueAt,
      sourceSummary: "测试",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completed: false,
    });
    store.addItems([
      item("finished", "刚刚完成的任务", new Date(now.getTime() + 3_600_000).toISOString()),
      item("overdue", "仍然逾期的任务", new Date(now.getTime() - 3_600_000).toISOString()),
    ]);

    const snapshot = store.updateItem("finished", { completed: true });
    assert.equal(snapshot.companion.state, "overdue");
    assert.match(snapshot.companion.bubble, /仍然逾期/);
  });
});

test("showing a disabled companion restores its schedule state before wake", async () => {
  await withStore((store) => {
    assert.equal(store.updatePreferences({ companionEnabled: false }).companion.state, "sleeping");
    const shown = store.updatePreferences({ companionEnabled: true });
    assert.equal(shown.preferences.companionEnabled, true);
    assert.equal(shown.companion.state, "idle");
  });
});


test("empty local text files fail with a specific source record", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [{ name: "empty.txt", contentBase64: Buffer.from("   \n").toString("base64") }],
    }, store);

    assert.equal(result.ok, false);
    assert.match(result.reason, /没有可读取文本/);
    assert.equal(result.snapshot.sources[0].sourceName, "empty.txt");
    assert.equal(result.snapshot.sources[0].extractionStatus, "failed");
    assert.match(result.snapshot.sources[0].lastError ?? "", /没有可读取文本/);
  });
});

test("garbled text files fail instead of creating schedules from unreliable text", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [{ name: "garbled.txt", contentBase64: Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0xff, 0xfe]).toString("base64") }],
    }, store);

    assert.equal(result.ok, false);
    assert.match(result.reason, /无法可靠解析|没有可读取文本/);
    assert.equal(result.snapshot.sources[0].sourceName, "garbled.txt");
    assert.equal(result.snapshot.sources[0].extractionStatus, "failed");
  });
});

test("ocr text must be readable and confident enough before schedule extraction", () => {
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 82), true);
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 69), true);
  assert.equal(isReliableOcrResult("明天 18:00 提交课程报告", 32), false);
  assert.equal(isReliableOcrResult("����\u0000??", 91), false);
});

test("llm candidates must still look like real deadline tasks", () => {
  assert.equal(itemFromLlmCandidate({
    title: "第一讲导论",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "课程安排：7月12日 第一讲 导论",
  }), null);

  assert.equal(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-02-31T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "2月31日 23:59 提交课程报告",
  }), null);

  assert.notEqual(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: localIso(2026, 7, 12, 23, 59),
    importance: "medium",
    sourceSummary: "7月12日 23:59 提交课程报告",
  }, "", "", new Date(2026, 6, 1, 10, 0)), null);
});

test("llm candidates must be grounded in the extracted source text", () => {
  const sourceText = "课程通知：7月12日 23:59 提交课程报告。";
  assert.equal(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: "2026-07-12T23:59:00.000Z",
    importance: "medium",
    sourceSummary: "老师提醒月底还有一个课程展示",
  }, sourceText), null);

  assert.notEqual(itemFromLlmCandidate({
    title: "课程报告",
    dueAt: localIso(2026, 7, 12, 23, 59),
    importance: "medium",
    sourceSummary: "7月12日 23:59 提交课程报告",
  }, sourceText, "", new Date(2026, 6, 1, 10, 0)), null);
});

test("markdown formatting differences do not reject grounded model details", () => {
  const sourceText = [
    "机器学习项目需要在 **2026 年 7 月 20 日 23:59 前** 提交。",
    "提交内容包括：项目源码压缩包；`README.md`；实验报告 PDF。",
    "提交方式：课程平台期末项目入口上传。",
  ].join("\n");
  const item = itemFromLlmCandidate({
    title: "机器学习期末项目",
    dueAt: localIso(2026, 7, 20, 23, 59),
    importance: "high",
    sourceSummary: "机器学习项目需要在 2026 年 7 月 20 日 23:59 前提交。",
    contextExcerpt: "机器学习项目需要在 2026 年 7 月 20 日 23:59 前提交。提交内容包括：项目源码压缩包；README.md；实验报告 PDF。提交方式：课程平台期末项目入口上传。",
    deliverables: ["项目源码压缩包", "README.md", "实验报告 PDF"],
    submissionMethod: "课程平台期末项目入口上传",
    risks: [],
    uncertainties: [],
    reminderSuggestions: ["提前一天完成最终测试"],
  }, sourceText, "notice.md");

  assert.ok(item);
  assert.deepEqual(item.extraction.deliverables, ["项目源码压缩包", "README.md", "实验报告 PDF"]);
  assert.equal(item.extraction.submissionMethod, "课程平台期末项目入口上传");
});

test("local fallback merges repeated evidence and does not invent a time for vague mornings", () => {
  const repeated = extractDdlItemsFromText([
    "数据库系统作业五已经发布。请在 **2026-07-16 22:00** 前提交。",
    "请在 **2026-07-16 22:00** 前提交",
  ].join("\n"), "notice.md");
  const vague = extractDdlItemsFromText("请系统提醒我明天上午确认数据库作业截止时间。", "notice.md");
  const event = extractDdlItemsFromText("项目组将于 2026 年 7 月 18 日上午 10:00 进行线上预路演。", "notice.md");
  const classPeriod = extractDdlItemsFromText("英语展示日期：2026 年 7 月 22 日下午第二节课。", "notice.md");
  const numberedRequirement = extractDdlItemsFromText("1. 5 页以内的路演 PPT；", "notice.md");

  assert.equal(repeated.length, 1);
  assert.equal(vague.length, 0);
  assert.equal(event.length, 1);
  assert.equal(classPeriod.length, 0);
  assert.equal(numberedRequirement.length, 0);
});

test("DeepSeek can return a resumable task when the exact deadline is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      items: [{
        title: "英语小组展示",
        dueAt: "2026-07-22T14:00:00+08:00",
        importance: "medium",
        sourceSummary: "展示日期：2026 年 7 月 22 日下午第二节课",
        deliverables: ["英文 PPT", "小组成员分工表"],
      }],
      pendingItems: [],
    }) } }],
  }), { status: 200 });
  try {
    const result = await extractPayload({ kind: "text", text: "英语小组展示：展示日期：**2026 年 7 月 22 日下午第二节课**。需要准备英文 PPT 和小组成员分工表，具体钟点未说明。" }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 0);
    assert.equal(result.pendingItems.length, 1);
    assert.equal(result.pendingItems[0].title, "英语小组展示");
    assert.match(result.pendingItems[0].reason, /无法安全换算/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conditional rule deadlines are suppressed when the model requests confirmation", () => {
  const base = {
    id: "model-db",
    title: "数据库作业五提交",
    importance: "high",
    dueAt: "2026-07-16T14:00:00.000Z",
    sourceSummary: "notice.md: 数据库系统作业五请在 2026-07-16 22:00 前提交",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    completed: false,
  };
  const pending = {
    sourceName: "notice.md",
    sourceType: "md",
    title: "数据库作业五可能提前",
    importance: "high",
    sourceSummary: "notice.md: 数据库作业五可能改为 2026-07-15 23:59 前邮件提交。最终以明天上午通知为准。",
    extraction: { contextExcerpt: "数据库作业五可能改为 2026-07-15 23:59 前邮件提交。最终以明天上午通知为准。", deliverables: [], constraints: [], risks: [], uncertainties: [], reminderSuggestions: [] },
    question: "最终截止时间是否提前？",
    reason: "最终通知尚未发布。",
  };
  const result = mergeModelAndRuleItems([base], [{
    ...base,
    id: "rule-db",
    title: "数据库作业五可能改为",
    dueAt: "2026-07-15T15:59:00.000Z",
    sourceSummary: "notice.md: 如果平台未恢复，数据库作业五可能改为 2026-07-15 23:59 前邮件提交。最终以明天上午通知为准。",
  }], [pending]);

  assert.deepEqual(result.map((item) => item.id), ["model-db"]);
});

test("intake persists model tasks, detailed plans, and pending clarifications together", async () => {
  await withStore(async (store) => {
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const planning = body.messages[0].content.includes("单任务拆解 Agent");
      const content = planning
        ? {
          goal: "完成课程报告",
          taskType: "coursework",
          deliverables: ["课程报告 PDF"],
          constraints: ["课程平台上传"],
          bufferMinutes: 30,
          summary: "按报告撰写和提交拆解。",
          uncertainties: [],
          steps: [{ clientId: "report", title: "完成并提交课程报告", description: "撰写、检查并上传。", estimatedMinutes: 90, dependsOn: [], completionCriteria: ["平台显示提交成功"] }],
        }
        : {
          items: [{
            title: "课程报告提交",
            dueAt: localIso(2026, 7, 20, 23, 59),
            importance: "high",
            sourceSummary: "7月20日 23:59 提交课程报告",
            contextExcerpt: "7月20日 23:59 提交课程报告，提交课程报告 PDF 到课程平台。",
            deliverables: ["课程报告 PDF"],
            submissionMethod: "课程平台",
          }],
          pendingItems: [{
            title: "英语展示",
            importance: "medium",
            sourceSummary: "英语展示日期：7月22日下午第二节课",
            contextExcerpt: "英语展示日期：7月22日下午第二节课",
            deliverables: ["英文 PPT"],
            question: "下午第二节课具体几点开始？",
            reason: "课次无法换算为精确钟点。",
          }],
        };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    };
    try {
      const result = await processIntake({ kind: "text", text: "7月20日 23:59 提交课程报告，提交课程报告 PDF 到课程平台。\n英语展示日期：7月22日下午第二节课，需要英文 PPT。" }, store);

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.items.length, 1);
      assert.equal(result.snapshot.taskPlans[0].plannerSource, "llm");
      assert.deepEqual(result.snapshot.taskPlans[0].deliverables, ["课程报告 PDF"]);
      assert.equal(result.snapshot.clarifications.filter((item) => item.status === "pending").length, 1);
      assert.equal(result.snapshot.sources[0].extractionStatus, "success");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("invalid quiet hour preference patches are rejected", async () => {
  await withStore((store) => {
    const before = store.snapshot().preferences;
    const snapshot = store.updatePreferences({ quietHoursStart: "25:99" });

    assert.equal(snapshot.preferences.quietHoursStart, before.quietHoursStart);
    assert.equal(snapshot.companion.state, "confused");
    assert.match(snapshot.companion.bubble, /勿扰时间/);
  });
});

test("mixed file intake keeps valid schedules and records failed files", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [
        { name: "course.txt", contentBase64: Buffer.from("明天 20:00 提交课程报告").toString("base64") },
        { name: "archive.zip", contentBase64: Buffer.from("ignored").toString("base64") },
      ],
    }, store);

    assert.equal(result.ok, true);
    assert.equal(result.created.length, 1);
    const sources = result.snapshot.sources;
    assert.equal(sources.some((source) => source.sourceName === "course.txt" && source.extractionStatus === "success"), true);
    assert.equal(sources.some((source) => source.sourceName === "archive.zip" && source.extractionStatus === "failed" && /文件类型不支持/.test(source.lastError ?? "")), true);
  });
});

test("multi-file intake links each created item to the matching source text", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [
        { name: "course-a.txt", contentBase64: Buffer.from("7月12日 23:59 提交课程报告").toString("base64") },
        { name: "course-b.txt", contentBase64: Buffer.from("7月15日 18:00 提交实验报告").toString("base64") },
      ],
    }, store);

    assert.equal(result.ok, true);
    const sourceA = result.snapshot.sources.find((source) => source.sourceName === "course-a.txt");
    const sourceB = result.snapshot.sources.find((source) => source.sourceName === "course-b.txt");
    assert.equal(sourceA?.itemIds.length, 1);
    assert.equal(sourceB?.itemIds.length, 1);
    assert.notEqual(sourceA?.itemIds[0], sourceB?.itemIds[0]);
  });
});

test("files with the same name keep distinct sources and correct item links", async () => {
  await withStore(async (store) => {
    const result = await processIntake({
      kind: "files",
      files: [
        { name: "notice.txt", contentBase64: Buffer.from("明天 20:00 提交课程报告").toString("base64") },
        { name: "notice.txt", contentBase64: Buffer.from("后天 21:00 提交实验作业").toString("base64") },
      ],
    }, store);

    assert.equal(result.ok, true);
    assert.equal(result.snapshot.sources.length, 2);
    assert.equal(result.snapshot.items.length, 2);
    for (const item of result.snapshot.items) {
      const source = result.snapshot.sources.find((candidate) => candidate.id === item.sourceId);
      assert.ok(source);
      assert.equal(source.text.includes(item.title), true);
    }
  });
});

test("pending tasks from same-named files stay attached to their own source", async () => {
  await withStore(async (store) => {
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const sourceText = String(body.messages.at(-1).content);
      const report = sourceText.includes("课程报告");
      const evidence = report ? "本周提交课程报告，具体时间未通知" : "下周完成实验作业，具体日期未通知";
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          items: [],
          pendingItems: [{
            title: report ? "课程报告" : "实验作业",
            importance: "medium",
            sourceSummary: evidence,
            contextExcerpt: evidence,
            deliverables: [],
            question: report ? "课程报告何时截止？" : "实验作业何时截止？",
            reason: "原文没有精确日期和时间。",
          }],
        }) } }],
      }), { status: 200 });
    };
    try {
      const result = await processIntake({
        kind: "files",
        files: [
          { name: "notice.txt", contentBase64: Buffer.from("本周提交课程报告，具体时间未通知").toString("base64") },
          { name: "notice.txt", contentBase64: Buffer.from("下周完成实验作业，具体日期未通知").toString("base64") },
        ],
      }, store);

      assert.equal(result.ok, true);
      assert.equal(result.snapshot.sources.length, 2);
      assert.equal(result.snapshot.intakeDrafts.length, 2);
      for (const draft of result.snapshot.intakeDrafts) {
        const source = result.snapshot.sources.find((candidate) => candidate.id === draft.sourceId);
        assert.ok(source);
        assert.equal(source.text.includes(draft.candidate.title), true);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("source linking can match llm evidence snippets without source-name prefixes", async () => {
  await withStore((store) => {
    const now = new Date().toISOString();
    const snapshot = store.addItems([
      {
        id: "ddl-a",
        title: "课程报告",
        importance: "medium",
        dueAt: "2026-07-12T23:59:00.000Z",
        sourceSummary: "7月12日 23:59 提交课程报告",
        createdAt: now,
        updatedAt: now,
        completed: false,
      },
      {
        id: "ddl-b",
        title: "实验报告",
        importance: "medium",
        dueAt: "2026-07-15T18:00:00.000Z",
        sourceSummary: "7月15日 18:00 提交实验报告",
        createdAt: now,
        updatedAt: now,
        completed: false,
      },
    ], "已加入 2 条日程。", [
      { sourceName: "course-a.txt", sourceType: "txt", text: "7月12日 23:59 提交课程报告" },
      { sourceName: "course-b.txt", sourceType: "txt", text: "7月15日 18:00 提交实验报告" },
    ]);

    const sourceA = snapshot.sources.find((source) => source.sourceName === "course-a.txt");
    const sourceB = snapshot.sources.find((source) => source.sourceName === "course-b.txt");
    assert.deepEqual(sourceA?.itemIds, ["ddl-a"]);
    assert.deepEqual(sourceB?.itemIds, ["ddl-b"]);
  });
});

test("LLM keys are encrypted at rest and reload through the secret codec", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-secret-test-"));
  try {
    const store = new ChroniStore(dir, testSecretCodec());
    store.updatePreferences({ llm: { apiKey: "test-private-key-value" } });

    const raw = readFileSync(store.filePath, "utf8");
    assert.equal(raw.includes("test-private-key-value"), false);
    assert.match(raw, /apiKeyProtected/);

    const reloaded = new ChroniStore(dir, testSecretCodec());
    assert.equal(reloaded.snapshot().preferences.llm.apiKey, "");
    assert.equal(reloaded.llmSettings().apiKey, "test-private-key-value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pet placement persists privately without changing the public snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-placement-test-"));
  try {
    const store = new ChroniStore(dir);
    const placement = { displayId: 9, xRatio: 0.25, yRatio: 0.75 };

    store.updatePetPlacement(placement);

    assert.deepEqual(store.petPlacement(), placement);
    assert.equal("petPlacement" in store.snapshot(), false);
    assert.deepEqual(new ChroniStore(dir).petPlacement(), placement);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enabled model failures are reported when local rules provide a fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const result = await extractPayload(
      { kind: "text", text: "明天 18:00 提交课程报告" },
      {
        llm: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "sk-test-only",
          model: "deepseek-v4-flash",
        },
      },
    );

    assert.equal(result.ok, true);
    assert.match(result.message, /模型.*不可用/);
    assert.match(result.message, /本地规则/);
    assert.equal(result.items.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek extraction processes every source independently", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const prompt = body.messages.at(-1).content;
    const isCourse = prompt.includes("course-a.txt");
    const item = isCourse
      ? { title: "课程报告", dueAt: localIso(2026, 7, 20, 23, 59), importance: "medium", sourceSummary: "7月20日 23:59 提交课程报告" }
      : { title: "实验报告", dueAt: localIso(2026, 7, 22, 18, 0), importance: "high", sourceSummary: "7月22日 18:00 提交实验报告" };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [item] }) }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const result = await extractPayload({
      kind: "files",
      files: [
        { name: "course-a.txt", contentBase64: Buffer.from("通知：7月20日 23:59 提交课程报告。", "utf8").toString("base64") },
        { name: "lab-b.txt", contentBase64: Buffer.from("通知：7月22日 18:00 提交实验报告。", "utf8").toString("base64") },
      ],
    }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test-only", model: "deepseek-v4-flash" },
    });

    assert.equal(result.ok, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].messages.at(-1).content.includes("lab-b.txt"), false);
    assert.equal(requests[1].messages.at(-1).content.includes("course-a.txt"), false);
    assert.match(requests[0].messages.at(-1).content, /用户时区：\S+/);
    assert.match(requests[0].messages[0].content, /未写明时区.*用户时区/);
    assert.deepEqual(result.items.map((item) => item.title).sort(), ["实验报告", "课程报告"]);
    assert.match(result.items.find((item) => item.title === "课程报告").sourceSummary, /^course-a\.txt:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local rules fill deadlines that the model missed within the same source", async () => {
  const originalFetch = globalThis.fetch;
  const firstDeadline = new Date(2026, 6, 20, 23, 59, 0, 0).toISOString();
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      items: [{
        title: "课程报告",
        dueAt: firstDeadline,
        importance: "high",
        sourceSummary: "7月20日 23:59 提交课程报告",
      }],
    }) } }],
  }), { status: 200 });
  try {
    const result = await extractPayload({
      kind: "files",
      files: [{
        name: "two-deadlines.txt",
        contentBase64: Buffer.from("7月20日 23:59 提交课程报告\n7月22日 18:00 提交实验报告", "utf8").toString("base64"),
      }],
    }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test-only", model: "deepseek-v4-flash" },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.items.map((item) => item.title).sort(), ["实验报告", "课程报告"]);
    assert.equal(result.items.filter((item) => item.dueAt === firstDeadline).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek extraction chunks long sources without dropping the end", async () => {
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    const items = prompt.includes("7月30日 20:00 提交最终报告")
      ? [{ title: "最终报告", dueAt: localIso(2026, 7, 30, 20, 0), importance: "high", sourceSummary: "7月30日 20:00 提交最终报告" }]
      : [];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const longText = `${"课程背景材料。".repeat(10_000)}\n7月30日 20:00 提交最终报告`;
    const result = await extractPayload({ kind: "text", text: longText }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test-only", model: "deepseek-v4-flash" },
    });

    assert.equal(result.ok, true);
    assert.ok(prompts.length > 1);
    assert.ok(prompts.some((prompt) => prompt.includes("7月30日 20:00 提交最终报告")));
    assert.equal(result.items.some((item) => item.title === "最终报告"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GBK and GB18030 text files are decoded before extraction", async () => {
  const result = await extractPayload({
    kind: "files",
    files: [{ name: "gbk.txt", contentBase64: "w/fM7CAxODowMCDM4b27v86zzLGouOY=" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.extracted[0].text, "明天 18:00 提交课程报告");
  assert.equal(result.items.length, 1);
});

test("empty or rejected DeepSeek output is visible when local rules are used", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ items: [] }) }, finish_reason: "stop" }],
  }), { status: 200 });
  try {
    const result = await extractPayload({ kind: "text", text: "明天 18:00 提交课程报告" }, {
      llm: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test-only", model: "deepseek-v4-flash" },
    });

    assert.equal(result.ok, true);
    assert.match(result.message, /模型.*未返回有效日程/);
    assert.match(result.message, /本地规则/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an ambiguous relative deadline cannot be bypassed by an LLM guess", async () => {
  await withStore(async (store) => {
    store.updatePreferences({ llm: { enabled: true, baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const isClarification = body.messages[0].content.includes("信息补全 Agent");
      const content = isClarification
        ? { missingFields: [{ field: "dueAt", question: "下周具体哪天截止？", reason: "日期不唯一", options: [] }] }
        : { items: [{ title: "机器学习作业", dueAt: "2026-07-17T23:59:00+08:00", importance: "medium", sourceSummary: "下周完成机器学习作业" }] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    };
    try {
      const result = await processIntake({ kind: "text", text: "下周完成机器学习作业。" }, store);
      assert.equal(result.ok, false);
      assert.equal(result.snapshot.items.length, 0);
      assert.equal(result.snapshot.clarifications[0].status, "pending");
      assert.match(result.reason, /需要确认/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("legacy plaintext LLM keys migrate to protected storage", () => {
  const dir = mkdtempSync(join(tmpdir(), "chroni-secret-migration-test-"));
  try {
    const statePath = join(dir, "chroni-state.json");
    writeFileSync(statePath, JSON.stringify({
      items: [],
      sources: [],
      preferences: {
        llm: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "sk-legacy-private",
          model: "deepseek-v4-flash",
        },
      },
      companion: { state: "idle", bubble: "ready" },
    }), "utf8");

    const store = new ChroniStore(dir, testSecretCodec());
    const migrated = readFileSync(store.filePath, "utf8");

    assert.equal(store.snapshot().preferences.llm.apiKey, "");
    assert.equal(store.llmSettings().apiKey, "sk-legacy-private");
    assert.equal(migrated.includes("sk-legacy-private"), false);
    assert.match(migrated, /apiKeyProtected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
