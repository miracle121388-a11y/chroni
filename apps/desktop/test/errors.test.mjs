import assert from "node:assert/strict";
import test from "node:test";

import { formatOperationError } from "../dist/shared/errors.js";

test("formatOperationError keeps useful error details", () => {
  assert.equal(formatOperationError(new Error("文件读取失败"), "上传失败"), "上传失败：文件读取失败");
});

test("formatOperationError falls back for unknown rejection values", () => {
  assert.equal(formatOperationError({}, "上传失败"), "上传失败");
  assert.equal(formatOperationError("网络中断", "上传失败"), "上传失败：网络中断");
});
