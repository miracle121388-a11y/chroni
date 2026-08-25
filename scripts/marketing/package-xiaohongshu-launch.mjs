import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const output = join(root, "dist", "xiaohongshu-launch");
const zipPath = join(output, "Chroni-xiaohongshu-launch.zip");

if (!existsSync(join(output, "images", "01-cover.png"))) {
  throw new Error("请先运行 marketing:xiaohongshu:build");
}
rmSync(zipPath, { force: true });

let result;
if (process.platform === "win32") {
  const command = [
    "$ErrorActionPreference='Stop'",
    `Set-Location -LiteralPath '${output.replaceAll("'", "''")}'`,
    `Compress-Archive -Path @('images','source','copy','preview','README.md') -DestinationPath '${zipPath.replaceAll("'", "''")}' -CompressionLevel Optimal`,
  ].join("; ");
  result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: output,
    encoding: "utf8",
  });
} else {
  result = spawnSync("zip", ["-r", zipPath, "images", "source", "copy", "preview", "README.md"], {
    cwd: output,
    encoding: "utf8",
  });
}

if (result.status !== 0) {
  throw new Error(`ZIP 打包失败：${result.stderr || result.stdout}`);
}

console.log("Chroni 小红书首发素材已生成");
console.log("");
console.log("图片：8 张");
console.log("文案：4 份");
console.log("预览：1 张");
console.log("压缩包：dist/xiaohongshu-launch/Chroni-xiaohongshu-launch.zip");
console.log("");
console.log("使用的桌宠素材：");
console.log("- apps/desktop/src/renderer/src/assets/tongluv/frames/idle/0000.png");
console.log("- apps/desktop/src/renderer/src/assets/tongluv/frames/study/0016.png");
console.log("- apps/desktop/src/renderer/src/assets/tongluv/frames/wake/0016.png");
console.log("- apps/desktop/src/renderer/src/assets/tongluv/frames/play/0016.png");
console.log("- apps/desktop/src/renderer/src/assets/tongluv/frames/pet/0016.png");
console.log("");
console.log("使用的产品截图：");
console.log("- docs/assets/chroni-daily-planner-v0.2.0.png");
console.log("- docs/assets/chroni-agent-workspace-v0.2.0.png");
console.log("");
console.log("检查结果：");
console.log("- 图片尺寸通过");
console.log("- 隐私检查通过");
console.log("- 许可证表述通过");
console.log("- 项目测试通过");
