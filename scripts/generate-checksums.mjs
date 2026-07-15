import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const inputDirectory = resolve(process.argv[2] || "apps/desktop/dist-electron");
const outputFile = resolve(process.argv[3] || `${inputDirectory}/SHA256SUMS.txt`);
const supportedArtifact = /\.(?:exe|dmg|zip|yml|blockmap)$/i;

const files = readdirSync(inputDirectory)
  .map((entry) => resolve(inputDirectory, entry))
  .filter((file) => statSync(file).isFile())
  .filter((file) => supportedArtifact.test(file) && !/^builder-/i.test(basename(file)))
  .sort((left, right) => relative(inputDirectory, left).localeCompare(relative(inputDirectory, right)));
if (!files.length) throw new Error(`No release artifacts found in ${inputDirectory}`);

const lines = files.map((file) => {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  return `${digest}  ${basename(file)}`;
});
writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${files.length} checksums to ${outputFile}`);
