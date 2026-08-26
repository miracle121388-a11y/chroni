const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

app.commandLine.appendSwitch("force-device-scale-factor", "1");

const desktopRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(desktopRoot, "..", "..");
const outputDirectory = join(repositoryRoot, "docs", "store", "assets", "screenshots", "zh-CN");
const screenshotSize = { width: 1440, height: 900 };
const fixtureRoot = mkdtempSync(join(tmpdir(), "chroni-store-capture-"));
const capturePartition = `chroni-store-capture-${process.pid}`;

app.whenReady().then(async () => {
  let controlWindow;
  let petWindow;
  try {
    const [{ ChroniStore }, { createRuleTaskPlan }, { DeadlineAgent }, { createAgentTools }] = await Promise.all([
      import(pathToFileURL(join(desktopRoot, "dist", "store.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "task-plan-agent.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "deadline-agent.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "agent-tools.js")).href),
    ]);
    const store = new ChroniStore(fixtureRoot);
    const captureNow = new Date();
    captureNow.setHours(7, 45, 0, 0);

    ipcMain.handle("chroni:snapshot", () => store.snapshot());
    ipcMain.handle("chroni:update-status", () => ({
      state: "idle",
      currentVersion: app.getVersion(),
      managedByStore: true,
      message: "当前版本由系统应用商店负责更新。",
    }));
    ipcMain.handle("chroni:sample-data-status", () => ({ active: false, namespace: "sample-data", synthetic: true, noKeyRequired: true }));

    mkdirSync(outputDirectory, { recursive: true });
    controlWindow = createCaptureWindow();
    await controlWindow.loadFile(join(desktopRoot, "dist", "renderer", "index.html"), { query: { view: "control" } });
    await waitForSelector(controlWindow, ".control-shell");
    controlWindow.showInactive();
    await waitForStableFrame(controlWindow);
    await capture(controlWindow, "00-first-run.png", ".daily-first-run");
    const firstRunActions = await controlWindow.webContents.executeJavaScript(`(() => ({
      title: document.querySelector('.daily-first-run h3')?.textContent?.trim(),
      actions: [...document.querySelectorAll('.daily-first-run button')].map((button) => button.textContent?.trim()),
      zoom: document.querySelector('.daily-timeline-zoom output')?.textContent?.trim(),
    }))()`);
    assert(firstRunActions.title === "安排今天的第一件事", "First-run title is missing from the empty product state.");
    assert(firstRunActions.actions.includes("导入任务") && firstRunActions.actions.includes("新建日程"), "First-run actions are incomplete.");
    assert(firstRunActions.zoom === "125%", `First-run timeline zoom is not deterministic: ${firstRunActions.zoom}`);
    const emptyTimelineState = await controlWindow.webContents.executeJavaScript(`(() => {
      const empty = document.querySelector('.daily-timeline-empty');
      const calendar = document.querySelector('.daily-calendar-grid');
      if (!(empty instanceof HTMLElement) || !(calendar instanceof HTMLElement)) return null;
      const emptyRect = empty.getBoundingClientRect();
      const calendarRect = calendar.getBoundingClientRect();
      return {
        text: empty.textContent?.replace(/\\s+/g, ' ').trim(),
        emptyTop: emptyRect.top,
        emptyBottom: emptyRect.bottom,
        visibleTop: calendarRect.top + 64,
        visibleBottom: calendarRect.bottom,
      };
    })()`);
    assert(
      emptyTimelineState
        && emptyTimelineState.text.includes("还没有时间安排")
        && emptyTimelineState.emptyTop >= emptyTimelineState.visibleTop
        && emptyTimelineState.emptyBottom <= emptyTimelineState.visibleBottom,
      `First-run empty timeline state is outside the visible calendar viewport: ${JSON.stringify(emptyTimelineState)}`,
    );

    seedStore(store, createRuleTaskPlan, captureNow);
    await seedAgent(store, DeadlineAgent, createAgentTools, captureNow);
    seedDailyTasks(store, captureNow);
    await controlWindow.loadFile(join(desktopRoot, "dist", "renderer", "index.html"), { query: { view: "control" } });
    await waitForSelector(controlWindow, ".control-shell");
    await waitForStableFrame(controlWindow);

    await selectNavigation(controlWindow, "今日执行");
    await waitForStableFrame(controlWindow);
    await resetScrollPositions(controlWindow);
    await capture(controlWindow, "01-today.png", ".daily-planner");

    await selectNavigation(controlWindow, "学习任务");
    await controlWindow.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('.mission-list-item')]
        .find((candidate) => candidate.textContent?.includes('数据库系统课程项目'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await waitForStableFrame(controlWindow);
    await resetScrollPositions(controlWindow);
    await capture(controlWindow, "02-learning-mission.png", ".mission-workspace");

    await selectNavigation(controlWindow, "执行 Agent");
    await capture(controlWindow, "03-agent.png", ".agent-pane");

    await selectNavigation(controlWindow, "任务来源");
    await capture(controlWindow, "04-sources.png", ".upload-box");

    petWindow = new BrowserWindow({
      width: 360,
      height: 360,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: captureWebPreferences(),
    });
    await petWindow.loadFile(join(desktopRoot, "dist", "renderer", "index.html"), { query: { view: "pet" } });
    await waitForSelector(petWindow, ".pet-art");
    petWindow.showInactive();
    await waitForStableFrame(petWindow);
    const petImage = await petWindow.webContents.capturePage();
    const petSize = petImage.getSize();
    assert(!petImage.isEmpty() && petSize.width === 360 && petSize.height === 360, "Desktop companion capture is unexpectedly empty.");
    const petPng = petImage.toPNG();
    assert(petPng.length > 1_000, "Desktop companion PNG has no visible content.");
    await compositeCompanion(
      join(outputDirectory, "01-today.png"),
      petPng,
      join(outputDirectory, "05-companion.png"),
    );

    console.log(`Chroni Store screenshots written to ${outputDirectory}`);
  } finally {
    petWindow?.destroy();
    controlWindow?.destroy();
    rmSync(fixtureRoot, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

function seedStore(store, createRuleTaskPlan, now) {
  const taskFixtures = [
    createTask(now, {
      id: "store-database-project",
      title: "数据库系统课程项目",
      dueOffsetDays: 4,
      estimatedMinutes: 360,
      progressPercent: 32,
      sourceName: "数据库课程项目说明.pdf",
      sourceType: "application/pdf",
      sourceText: "提交 PDF 报告与 SQL 文件。报告需要包含关系模式设计、查询结果、实验截图和结论。",
      deliverables: ["PDF 报告", "SQL 文件"],
    }),
    createTask(now, {
      id: "store-presentation-review",
      title: "人机交互展示稿完善",
      dueOffsetDays: 2,
      estimatedMinutes: 150,
      progressPercent: 55,
      sourceName: "课程展示反馈.md",
      sourceType: "text/markdown",
      sourceText: "根据反馈补充可用性测试结果，并在周五展示前完成讲稿排练。",
      deliverables: ["展示稿", "讲稿"],
    }),
    createTask(now, {
      id: "store-reading-notes",
      title: "机器学习论文阅读记录",
      dueOffsetDays: 7,
      estimatedMinutes: 120,
      progressPercent: 15,
      sourceName: "阅读清单.xlsx",
      sourceType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceText: "阅读两篇课程论文，整理方法、实验设计与可复现性问题。",
      deliverables: ["阅读记录"],
    }),
  ];
  store.addItems(
    taskFixtures.map((fixture) => fixture.item),
    "示例学习任务已建立",
    taskFixtures.map((fixture) => fixture.source),
  );

  for (const item of store.snapshot().items) {
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(item, [], now));
    store.activateTaskPlan(item.id, generated.plan.id);
  }

  let mission = store.snapshot().learningMissions.find((candidate) => candidate.taskId === "store-database-project");
  assert(mission, "Primary Learning Mission fixture was not created.");
  store.addLearningMissionEvidence(mission.id, {
    kind: "note",
    title: "需求核对记录",
    note: "已确认 PDF 报告与 SQL 文件两个交付物，并核对课程平台提交要求。",
    linkedDeliverable: "PDF 报告",
  });
  mission = store.snapshot().learningMissions.find((candidate) => candidate.id === mission.id);
  store.recordLearningMissionCheckpoint(mission.id, {
    status: "completed",
    summary: "完成要求理解与关系模式初稿",
    milestoneId: mission.milestones[0]?.id,
    actualMinutes: 45,
    reflection: "先验证核心查询，再集中整理实验截图。",
  });
}

async function seedAgent(store, DeadlineAgent, createAgentTools, now) {
  const tools = createAgentTools({
    readTasks: () => store.snapshot().items,
    readTaskPlans: () => store.snapshot().taskPlans,
    intakeText: async () => { throw new Error("Store screenshot fixture does not run intake."); },
    writeIcs: () => "",
    sendReminder: async () => ({ sent: false, reason: "disabled" }),
    persistPlan: () => undefined,
    now: () => now,
  });
  const agent = new DeadlineAgent({
    tools,
    getMemory: () => store.snapshot().agent.memory,
    saveRun: (result) => store.saveAgentRun(result),
    now: () => now,
    createId: () => "store-agent-run",
  });
  await agent.run("manual");
}

function seedDailyTasks(store, now) {
  const at = (hours, minutes) => {
    const value = new Date(now);
    value.setHours(hours, minutes, 0, 0);
    return value.toISOString();
  };
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  store.createDailyTask({
    title: "提交前核对两个交付物",
    notes: "确认 PDF 报告与 SQL 文件命名、内容和提交入口。",
    color: "gold",
    allDay: true,
    scheduledStartAt: at(0, 0),
  });
  store.createDailyTask({
    title: "梳理课程项目要求",
    notes: "核对完成标准并标记风险。",
    color: "teal",
    scheduledStartAt: at(8, 10),
    scheduledEndAt: at(8, 50),
  });
  store.createDailyTask({
    title: "验证核心 SQL 查询",
    notes: "覆盖边界数据并保留查询结果。",
    color: "coral",
    scheduledStartAt: at(9, 0),
    scheduledEndAt: at(10, 30),
    subtasks: [
      { id: "store-subtask-query", title: "运行核心查询", completed: true },
      { id: "store-subtask-edge", title: "补充边界数据", completed: false },
    ],
  });
  store.createDailyTask({
    title: "展示稿反馈同步",
    notes: "将可用性测试结论补入展示稿。",
    color: "blue",
    scheduledStartAt: at(9, 35),
    scheduledEndAt: at(10, 20),
  });
  store.createDailyTask({
    title: "整理实验截图与结果",
    notes: "按报告章节组织查询结果。",
    color: "gold",
    scheduledStartAt: at(10, 40),
    scheduledEndAt: at(12, 10),
  });
  const completed = store.snapshot().dailyTasks.find((task) => task.title === "梳理课程项目要求");
  if (completed) store.updateDailyTask(completed.id, { completedDates: [todayKey] });
}

function createTask(now, fixture) {
  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + fixture.dueOffsetDays);
  dueAt.setHours(20, 0, 0, 0);
  return {
    item: {
      id: fixture.id,
      title: fixture.title,
      importance: fixture.dueOffsetDays <= 2 ? "high" : "medium",
      dueAt: dueAt.toISOString(),
      sourceSummary: `${fixture.sourceName}: ${fixture.sourceText}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completed: false,
      estimatedMinutes: fixture.estimatedMinutes,
      progressPercent: fixture.progressPercent,
      extraction: {
        contextExcerpt: fixture.sourceText,
        deliverables: fixture.deliverables,
        submissionMethod: "课程平台",
        constraints: ["提交前完成内容与文件核对"],
        risks: ["后续整理依赖核心内容先完成"],
        uncertainties: [],
        reminderSuggestions: ["截止前一天完成最终核对"],
      },
    },
    source: { sourceName: fixture.sourceName, sourceType: fixture.sourceType, text: fixture.sourceText },
  };
}

function createCaptureWindow() {
  return new BrowserWindow({
    ...screenshotSize,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: "#f7f7f3",
    webPreferences: captureWebPreferences(),
  });
}

function captureWebPreferences() {
  return {
    preload: join(desktopRoot, "preload.cjs"),
    partition: capturePartition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

async function selectNavigation(window, label) {
  const selected = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('nav button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(selected, `Unable to select Store screenshot navigation: ${label}`);
  await waitForStableFrame(window);
  await resetScrollPositions(window);
}

async function resetScrollPositions(window) {
  await window.webContents.executeJavaScript(`(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    for (const element of document.querySelectorAll('*')) {
      if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 2) element.scrollTop = 0;
    }
    return true;
  })()`);
  await delay(120);
}

async function capture(window, name, requiredSelector) {
  await waitForSelector(window, requiredSelector);
  await waitForStableFrame(window);
  if (name !== "00-first-run.png") await resetScrollPositions(window);
  if (name === "01-today.png") await frameDailyCalendar(window);
  const dimensions = await window.webContents.executeJavaScript("({ width: window.innerWidth, height: window.innerHeight })");
  assert(dimensions.width === screenshotSize.width && dimensions.height === screenshotSize.height, `${name} viewport is ${dimensions.width}x${dimensions.height}.`);
  const png = (await window.webContents.capturePage()).toPNG();
  assert(png.length > 50_000, `${name} is unexpectedly empty.`);
  writeFileSync(join(outputDirectory, name), png);
}

async function frameDailyCalendar(window) {
  const result = await window.webContents.executeJavaScript(`(() => {
    const candidates = [...document.querySelectorAll('*')]
      .filter((element) => element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 20)
      .map((element) => ({
        element,
        label: element.className || element.tagName,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
    const calendarScroller = candidates.find((candidate) => candidate.element.querySelector?.('.daily-calendar-body'));
    if (!calendarScroller) return { candidates: candidates.map(({ label, clientHeight, scrollHeight }) => ({ label, clientHeight, scrollHeight })) };
    const target = Math.min(Math.max(0, calendarScroller.scrollHeight - calendarScroller.clientHeight), 560);
    calendarScroller.element.scrollTop = target;
    return { scrollTop: calendarScroller.element.scrollTop, clientHeight: calendarScroller.clientHeight, scrollHeight: calendarScroller.scrollHeight };
  })()`);
  assert(result && result.scrollTop > 300, `Daily calendar could not be framed around the morning tasks: ${JSON.stringify(result)}`);
  await delay(150);
}

async function compositeCompanion(basePath, petPng, outputPath) {
  const [base, pet] = await Promise.all([loadImage(readFileSync(basePath)), loadImage(petPng)]);
  const probe = createCanvas(pet.width, pet.height);
  const probeContext = probe.getContext("2d");
  probeContext.drawImage(pet, 0, 0);
  const pixels = probeContext.getImageData(0, 0, pet.width, pet.height).data;
  let visiblePixels = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 8) visiblePixels += 1;
  assert(visiblePixels > 2_000, `Desktop companion render contains only ${visiblePixels} visible pixels.`);
  const canvas = createCanvas(screenshotSize.width, screenshotSize.height);
  const context = canvas.getContext("2d");
  context.drawImage(base, 0, 0, screenshotSize.width, screenshotSize.height);
  context.save();
  context.shadowColor = "rgba(20, 42, 36, 0.16)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 8;
  context.drawImage(pet, 1080, 535, 320, 320);
  context.restore();
  writeFileSync(outputPath, canvas.toBuffer("image/png"));
}

async function waitForSelector(window, selector, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${selector}.`);
}

async function waitForStableFrame(window) {
  await window.webContents.executeJavaScript("document.fonts?.ready ?? Promise.resolve()");
  await delay(500);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
