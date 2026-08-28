import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EMPTY_INTAKE_PROMPT,
  intakeProgressMessage,
  REPROCESS_PROGRESS_MESSAGE,
} from "../dist/shared/intake-copy.js";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("intake progress copy describes the actual input and operation", () => {
  assert.equal(intakeProgressMessage({ kind: "text", text: "明天开会" }), "正在理解日程…");
  assert.equal(intakeProgressMessage({ kind: "text", text: "明天开会" }, "preview"), "正在预览日程信息…");
  assert.equal(
    intakeProgressMessage({ kind: "files", files: [{ name: "课程表.xlsx" }, { name: "通知.pdf" }] }),
    "正在识别 2 个文件中的日程与任务…",
  );
  assert.equal(
    intakeProgressMessage({ kind: "files", files: [{ name: "课程表.xlsx" }] }, "preview"),
    "正在预览 1 个文件中的日程与任务…",
  );
  assert.equal(intakeProgressMessage({ kind: "files", files: [] }), "正在识别文件中的日程与任务…");
  assert.equal(REPROCESS_PROGRESS_MESSAGE, "正在重新识别日程与任务…");
  assert.equal(EMPTY_INTAKE_PROMPT, "把日程、课程要求、截图或项目材料拖给我。");
});

test("desktop intake surfaces do not regress to course-only, vague, or technical loading copy", async () => {
  const [main, renderer, intake, store, agentWorkspace] = await Promise.all([
    readFile(resolve(desktopRoot, "src", "main.ts"), "utf8"),
    readFile(resolve(desktopRoot, "src", "renderer", "src", "main.tsx"), "utf8"),
    readFile(resolve(desktopRoot, "src", "intake.ts"), "utf8"),
    readFile(resolve(desktopRoot, "src", "store.ts"), "utf8"),
    readFile(resolve(desktopRoot, "src", "renderer", "src", "components", "AgentWorkspace.tsx"), "utf8"),
  ]);
  const intakeSurfaces = `${main}\n${renderer}\n${intake}\n${store}`;

  assert.doesNotMatch(intakeSurfaces, /正在理解课程要求/);
  assert.doesNotMatch(intakeSurfaces, /正在识别 DDL/);
  assert.doesNotMatch(intakeSurfaces, /正在重新识别来源/);
  assert.doesNotMatch(intakeSurfaces, /没有识别到明确 DDL/);
  assert.doesNotMatch(renderer, /setBusyMessage\("正在识别\.\.\."\)/);
  assert.doesNotMatch(agentWorkspace, /busyId === item\.id \? "处理中/);
  assert.match(agentWorkspace, /busyAction === "reprocess" \? "重新识别中…"/);
});
