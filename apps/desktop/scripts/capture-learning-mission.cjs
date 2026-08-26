const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const desktopRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(desktopRoot, "..", "..");
const outputPath = join(repositoryRoot, "docs", "assets", "chroni-learning-mission-v0.2.0.png");
const dailyOutputPath = join(repositoryRoot, "docs", "assets", "chroni-daily-planner-v0.2.0.png");
const agentOutputPath = join(repositoryRoot, "docs", "assets", "chroni-agent-workspace-v0.2.0.png");
const narrowOutputPath = join(repositoryRoot, "output", "visual-checks", "chroni-learning-mission-narrow.png");
const compactOutputPath = join(repositoryRoot, "output", "visual-checks", "chroni-learning-mission-compact.png");

app.whenReady().then(async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "chroni-mission-capture-"));
  try {
    const [{ ChroniStore }, { createRuleTaskPlan }, { DeadlineAgent }, { createAgentTools }] = await Promise.all([
      import(pathToFileURL(join(desktopRoot, "dist", "store.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "task-plan-agent.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "deadline-agent.js")).href),
      import(pathToFileURL(join(desktopRoot, "dist", "agent", "agent-tools.js")).href),
    ]);
    const store = new ChroniStore(fixtureRoot);
    const now = new Date();
    const dueAt = new Date(now.getTime() + 5 * 86_400_000);
    store.addItems([{
      id: "capture-database-project",
      title: "数据库系统课程项目",
      importance: "high",
      dueAt: dueAt.toISOString(),
      sourceSummary: "数据库课程项目说明：提交 PDF 报告与 SQL 文件",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completed: false,
      progressPercent: 18,
      estimatedMinutes: 330,
      extraction: {
        contextExcerpt: "请在课程平台提交 PDF 报告和 SQL 文件。报告包含关系模式设计、查询结果、实验截图与结论。",
        deliverables: ["PDF 报告", "SQL 文件"],
        submissionMethod: "课程平台",
        constraints: ["报告包含关系模式设计、查询结果、实验截图与结论"],
        risks: ["实验截图依赖 SQL 查询验证完成"],
        uncertainties: [],
        reminderSuggestions: ["提交前核对两个交付物"],
      },
    }], "演示学习任务已建立", [{
      sourceName: "数据库课程项目说明.pdf",
      sourceType: "application/pdf",
      text: "请在课程平台提交 PDF 报告和 SQL 文件。报告包含关系模式设计、查询结果、实验截图与结论。",
    }]);
    const item = store.snapshot().items[0];
    const generated = store.saveGeneratedTaskPlan(createRuleTaskPlan(item, [], now));
    store.activateTaskPlan(item.id, generated.plan.id);
    let mission = store.snapshot().learningMissions[0];
    store.addLearningMissionEvidence(mission.id, {
      kind: "note",
      title: "需求核对记录",
      note: "已确认两个交付物和课程平台提交要求。",
      linkedDeliverable: "PDF 报告",
    });
    store.recordLearningMissionCheckpoint(mission.id, {
      status: "completed",
      summary: "完成要求理解与关系模式初稿",
      milestoneId: mission.milestones[0]?.id,
      actualMinutes: 40,
      reflection: "先验证核心查询，再集中整理实验截图。",
    });
    mission = store.snapshot().learningMissions[0];
    store.recordLearningMissionCheckpoint(mission.id, {
      status: "on-track",
      summary: "正在验证 SQL 查询与边界数据",
      milestoneId: mission.milestones.find((milestone) => milestone.status === "pending")?.id,
      actualMinutes: 55,
    });

    ipcMain.handle("chroni:snapshot", () => store.snapshot());
    const window = new BrowserWindow({
      width: 1440,
      height: 1000,
      show: false,
      backgroundColor: "#f5f5f1",
      webPreferences: {
        preload: join(desktopRoot, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await window.loadFile(join(desktopRoot, "dist", "renderer", "index.html"), { query: { view: "control" } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    const image = await window.webContents.capturePage();
    mkdirSync(resolve(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, image.toPNG());

    const captureNow = new Date();
    captureNow.setHours(9, 0, 0, 0);
    const taskFixtures = [
      ["capture-query-validation", "完成核心 SQL 查询验证", 1, 105, "high"],
      ["capture-results", "整理实验截图与查询结果", 2, 90, "medium"],
      ["capture-discussion", "撰写报告讨论与结论", 3, 75, "medium"],
    ].map(([id, title, dueOffset, estimatedMinutes, importance]) => ({
      id,
      title,
      importance,
      dueAt: new Date(captureNow.getTime() + Number(dueOffset) * 86_400_000).toISOString(),
      sourceSummary: "数据库课程项目拆解",
      createdAt: captureNow.toISOString(),
      updatedAt: captureNow.toISOString(),
      completed: false,
      estimatedMinutes,
      extraction: {
        contextExcerpt: "数据库课程项目需要完成查询验证、实验截图、结果分析与报告结论。",
        deliverables: ["PDF 报告", "SQL 文件"],
        submissionMethod: "课程平台",
        constraints: ["结果必须能由 SQL 查询复现"],
        risks: [],
        uncertainties: [],
        reminderSuggestions: [],
      },
    }));
    store.addItems(taskFixtures, "演示执行步骤已建立", [{
      sourceName: "数据库课程项目拆解.md",
      sourceType: "text/markdown",
      text: "数据库课程项目需要完成查询验证、实验截图、结果分析与报告结论。",
    }]);
    const tools = createAgentTools({
      readTasks: () => store.snapshot().items,
      readTaskPlans: () => store.snapshot().taskPlans,
      intakeText: async () => { throw new Error("截图夹具不执行 intake"); },
      writeIcs: () => "",
      sendReminder: async () => ({ sent: false, reason: "disabled" }),
      persistPlan: () => undefined,
      now: () => captureNow,
    });
    const agent = new DeadlineAgent({
      tools,
      getMemory: () => store.snapshot().agent.memory,
      saveRun: (result) => store.saveAgentRun(result),
      now: () => captureNow,
      createId: () => "capture-agent-run",
    });
    await agent.run("manual");
    window.webContents.send("chroni:snapshot-updated", store.snapshot());
    window.showInactive();
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));

    await selectNavigation(window, "今日执行");
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    const dailyScroll = await window.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.daily-timeline-panel');
      if (!(panel instanceof HTMLElement)) return false;
      const before = panel.scrollTop;
      panel.scrollTop = 620;
      return { before, after: panel.scrollTop, height: panel.clientHeight, scrollHeight: panel.scrollHeight };
    })()`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const dailyVisible = await window.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.daily-timeline-panel');
      if (!(panel instanceof HTMLElement)) return false;
      panel.scrollTop = 620;
      const bounds = panel.getBoundingClientRect();
      return {
        scrollTop: panel.scrollTop,
        taskCount: panel.querySelectorAll('.daily-timeline-task-wrap').length,
        labels: [...panel.querySelectorAll('.daily-hour time')]
          .filter((label) => { const rect = label.getBoundingClientRect(); return rect.bottom >= bounds.top && rect.top <= bounds.bottom; })
          .map((label) => label.textContent),
      };
    })()`);
    if (!dailyVisible || !dailyVisible.labels.includes("08:00") || dailyVisible.taskCount < 3) {
      throw new Error(`Daily execution capture is not framed around the planned blocks: ${JSON.stringify(dailyVisible)}`);
    }
    console.log(`Daily capture viewport: ${JSON.stringify(dailyScroll)}`);
    console.log(`Daily capture visible labels: ${JSON.stringify(dailyVisible)}`);
    writeFileSync(dailyOutputPath, (await window.webContents.capturePage()).toPNG());
    await selectNavigation(window, "智能整理");
    writeFileSync(agentOutputPath, (await window.webContents.capturePage()).toPNG());

    await selectNavigation(window, "学习任务");
    window.setSize(900, 800);
    window.showInactive();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    const narrowImage = await window.webContents.capturePage();
    mkdirSync(resolve(narrowOutputPath, ".."), { recursive: true });
    writeFileSync(narrowOutputPath, narrowImage.toPNG());
    window.setSize(700, 900);
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const compactImage = await window.webContents.capturePage();
    writeFileSync(compactOutputPath, compactImage.toPNG());
    window.destroy();
    console.log(`Learning Mission screenshot written to ${outputPath}`);
    console.log(`Daily execution screenshot written to ${dailyOutputPath}`);
    console.log(`Smart organization workspace screenshot written to ${agentOutputPath}`);
    console.log(`Narrow layout screenshot written to ${narrowOutputPath}`);
    console.log(`Compact layout screenshot written to ${compactOutputPath}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function selectNavigation(window, label) {
  const selected = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('nav button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!selected) throw new Error(`Unable to select capture navigation: ${label}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
}
