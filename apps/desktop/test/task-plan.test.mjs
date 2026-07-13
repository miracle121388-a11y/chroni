import assert from "node:assert/strict";
import test from "node:test";

import { createRuleTaskPlan, generateTaskPlan } from "../dist/agent/task-plan-agent.js";
import { diffTaskPlans } from "../dist/agent/task-plan-diff.js";
import { validateTaskPlan } from "../dist/agent/task-plan-validator.js";

const task = {
  id: "task-1",
  title: "机器学习作业",
  importance: "medium",
  dueAt: "2026-07-20T18:00:00.000Z",
  sourceSummary: "7月20日提交机器学习作业",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  completed: false,
  estimatedMinutes: 180,
};

test("rule task planning creates a valid editable plan before the deadline", () => {
  const plan = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  assert.equal(plan.steps.length >= 3, true);
  assert.equal(plan.estimatedTotalMinutes, plan.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0));
  assert.doesNotThrow(() => validateTaskPlan(plan, task));
  assert.equal(plan.plannerSource, "rules");
});

test("task plan validation rejects cycles and inconsistent totals", () => {
  const plan = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  plan.steps[0].dependsOn = [plan.steps.at(-1).id];
  assert.throws(() => validateTaskPlan(plan, task), /循环依赖/);
  plan.steps[0].dependsOn = [];
  plan.estimatedTotalMinutes += 30;
  assert.throws(() => validateTaskPlan(plan, task), /总耗时/);
});

test("saved plan edits produce structured revisions", () => {
  const before = createRuleTaskPlan(task, [], new Date("2026-07-12T10:00:00.000Z"));
  const after = structuredClone(before);
  after.steps[1].estimatedMinutes += 15;
  after.bufferMinutes += 10;
  const changes = diffTaskPlans(before, after);
  assert.equal(changes.some((change) => change.type === "duration-changed"), true);
  assert.equal(changes.some((change) => change.type === "buffer-changed"), true);
});

test("task planning falls back to validated rules when the model fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const plan = await generateTaskPlan(task, [], { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" }, new Date("2026-07-12T10:00:00.000Z"));
    assert.equal(plan.plannerSource, "rules-fallback");
    assert.doesNotThrow(() => validateTaskPlan(plan, task));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM task planning receives grounded deliverables, submission method, and risks", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      goal: "完成并提交机器学习项目",
      taskType: "coursework",
      deliverables: ["源码压缩包", "README.md", "实验报告 PDF"],
      constraints: ["通过课程平台上传"],
      bufferMinutes: 60,
      summary: "按交付物拆解并预留最终检查。",
      uncertainties: ["需要说明 API 成本估算"],
      steps: [
        { clientId: "code", title: "整理并测试源码", description: "完成源码并验证运行。", estimatedMinutes: 120, dependsOn: [], completionCriteria: ["源码可运行"] },
        { clientId: "docs", title: "完成文档与报告", description: "完成 README 和实验报告。", estimatedMinutes: 120, dependsOn: ["code"], completionCriteria: ["报告已导出 PDF"] },
        { clientId: "submit", title: "截图并提交", description: "准备截图并上传全部文件。", estimatedMinutes: 45, dependsOn: ["docs"], completionCriteria: ["平台显示提交成功"] },
      ],
    }) } }] }), { status: 200 });
  };
  try {
    const detailedTask = {
      ...task,
      extraction: {
        contextExcerpt: "提交源码压缩包、README.md、实验报告 PDF，通过课程平台上传。",
        deliverables: ["源码压缩包", "README.md", "实验报告 PDF"],
        submissionMethod: "通过课程平台上传",
        constraints: [],
        risks: ["最终测试可能无法复现"],
        uncertainties: ["需要说明 API 成本估算"],
        reminderSuggestions: ["提前一天完成最终测试"],
      },
    };
    const plan = await generateTaskPlan(detailedTask, [], { enabled: true, provider: "openai-compatible", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash" }, new Date("2026-07-12T10:00:00.000Z"));
    const modelInput = JSON.parse(requestBody.messages.at(-1).content);

    assert.deepEqual(modelInput.task.extraction.deliverables, detailedTask.extraction.deliverables);
    assert.equal(modelInput.task.extraction.submissionMethod, "通过课程平台上传");
    assert.equal(plan.plannerSource, "llm");
    assert.deepEqual(plan.uncertainties, ["需要说明 API 成本估算"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
