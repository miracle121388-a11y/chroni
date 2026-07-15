import assert from "node:assert/strict";
import test from "node:test";

import { ChroniUpdater, initialUpdateStatus } from "../dist/updater.js";

test("update status distinguishes development, unsupported, and packaged desktop builds", () => {
  assert.deepEqual(initialUpdateStatus("0.1.0", false, "win32"), {
    currentVersion: "0.1.0",
    phase: "unsupported",
    message: "开发模式不会连接更新服务。",
  });
  assert.equal(initialUpdateStatus("0.1.0", true, "linux").phase, "unsupported");
  assert.equal(initialUpdateStatus("0.1.0", true, "win32").phase, "idle");
  assert.equal(initialUpdateStatus("0.1.0", true, "darwin").phase, "idle");
});

test("updater exposes cloned state without contacting the release service before start", () => {
  const published = [];
  const updater = new ChroniUpdater({
    currentVersion: "1.2.3",
    packaged: false,
    platform: "win32",
    onStatus: (status) => published.push(status),
  });
  const status = updater.status();
  status.message = "mutated";
  assert.equal(updater.status().message, "开发模式不会连接更新服务。");
  updater.start(0);
  assert.equal(published.length, 1);
  assert.equal(published[0].phase, "unsupported");
  updater.dispose();
});
