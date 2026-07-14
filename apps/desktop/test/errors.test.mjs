import assert from "node:assert/strict";
import test from "node:test";

import { formatOperationError, formatUserFacingMessage } from "../dist/shared/errors.js";

test("formatOperationError keeps useful error details", () => {
  assert.equal(formatOperationError(new Error("文件读取失败"), "上传失败"), "上传失败：文件读取失败");
});

test("formatOperationError falls back for unknown rejection values", () => {
  assert.equal(formatOperationError({}, "上传失败"), "上传失败");
  assert.equal(formatOperationError("网络中断", "上传失败"), "上传失败：网络中断");
});

test("formatOperationError removes Electron IPC boilerplate", () => {
  assert.equal(
    formatOperationError("Error invoking remote method 'chroni:intake': Error: 文件内容为空。", "识别失败"),
    "识别失败：文件内容为空。",
  );
  assert.equal(
    formatOperationError(new Error("Error: Error invoking remote method 'chroni:item-update': Error: 标题不能为空。"), "保存失败"),
    "保存失败：标题不能为空。",
  );
});

test("formatOperationError localizes common runtime failures", () => {
  assert.equal(
    formatOperationError(new Error("connect ECONNREFUSED 127.0.0.1:3000"), "连接失败"),
    "连接失败：网络连接失败，请检查网络和服务地址后重试。",
  );
  assert.equal(
    formatOperationError(new Error("ENOSPC: no space left on device, write '/private/user/state.json'"), "保存失败"),
    "保存失败：本地存储空间不足，请清理空间后重试。",
  );
  assert.equal(
    formatOperationError(new Error("ENOENT: no such file or directory, open '/private/user/a.pdf'"), "读取失败"),
    "读取失败：相关文件不存在或已被移动，请重新选择文件。",
  );
});

test("formatOperationError hides unknown technical details and avoids duplicate prefixes", () => {
  assert.equal(formatOperationError(new Error("Cannot read properties of undefined"), "保存失败"), "保存失败");
  assert.equal(formatOperationError(new Error("保存失败：文件已被移除。"), "保存失败"), "保存失败：文件已被移除。");
  assert.equal(formatOperationError(new Error("文件已被移除。"), "保存暂时不可用，请重试。"), "保存暂时不可用，请重试：文件已被移除。");
});

test("formatUserFacingMessage sanitizes provider and persisted messages without adding a prefix", () => {
  assert.equal(formatUserFacingMessage("请补充准确截止时间。", "需要补充信息。"), "请补充准确截止时间。");
  assert.equal(formatUserFacingMessage("provider returned invalid tool payload", "需要补充信息。"), "需要补充信息。");
  assert.equal(formatUserFacingMessage("connect ECONNREFUSED 127.0.0.1", "连接不可用。"), "网络连接失败，请检查网络和服务地址后重试。");
  assert.equal(formatUserFacingMessage("读取失败：/Users/alice/course/private.pdf，请重新选择。", "文件读取失败。"), "读取失败：相关文件，请重新选择。");
  assert.equal(formatUserFacingMessage("服务拒绝 API Key=sk-secret12345678。", "模型服务暂时不可用。"), "服务拒绝 API Key=[已隐藏]。");
  assert.equal(formatUserFacingMessage("处理失败：TypeError at parse (/Users/alice/app.js:1:1)", "处理暂时不可用。"), "处理暂时不可用。");
});
