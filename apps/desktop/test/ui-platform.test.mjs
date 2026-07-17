import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { configureControlWindowChrome, configureRendererZoom, controlCenterWindowOptions, rendererZoomFactor } from "../dist/window-options.js";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = resolve(desktopRoot, "dist", "renderer");

test("control center uses content sizing and removes the Windows menu only", () => {
  const windowsOptions = controlCenterWindowOptions("win32");
  const macOptions = controlCenterWindowOptions("darwin");
  assert.equal(windowsOptions.useContentSize, true);
  assert.equal(windowsOptions.show, false);
  assert.equal(windowsOptions.autoHideMenuBar, true);
  assert.equal(windowsOptions.minWidth, undefined);
  assert.equal(windowsOptions.minHeight, undefined);
  assert.equal(macOptions.autoHideMenuBar, undefined);
  const { autoHideMenuBar, ...windowsVisualOptions } = windowsOptions;
  assert.equal(autoHideMenuBar, true);
  assert.deepEqual(windowsVisualOptions, macOptions);

  let removals = 0;
  const fakeWindow = { removeMenu() { removals += 1; } };
  configureControlWindowChrome(fakeWindow, "darwin");
  assert.equal(removals, 0);
  configureControlWindowChrome(fakeWindow, "win32");
  assert.equal(removals, 1);
});

test("every renderer starts and finishes loading at the shared 100% zoom", () => {
  const factors = [];
  let didFinishLoad;
  configureRendererZoom({
    setZoomFactor(factor) { factors.push(factor); },
    on(event, listener) {
      assert.equal(event, "did-finish-load");
      didFinishLoad = listener;
    },
  });
  assert.equal(rendererZoomFactor, 1);
  assert.deepEqual(factors, [1]);
  assert.ok(didFinishLoad);
  didFinishLoad();
  assert.deepEqual(factors, [1, 1]);
});

test("Windows executables and development windows use the macOS hourglass artwork", async () => {
  const builderSource = await readFile(resolve(desktopRoot, "electron-builder.config.cjs"), "utf8");
  const windowsSource = await readFile(resolve(desktopRoot, "src", "windows.ts"), "utf8");
  const iconSource = await readFile(resolve(desktopRoot, "build", "icon-source.svg"), "utf8");
  const ico = await readFile(resolve(desktopRoot, "build", "icon.ico"));

  assert.match(iconSource, /M358 290C358 411 512 414 512 512/);
  assert.match(builderSource, /win:\s*\{[\s\S]*?icon:\s*"build\/icon\.ico"/);
  assert.match(builderSource, /\{ from: "build\/icon\.ico", to: "icon\.ico" \}/);
  assert.match(builderSource, /installerIcon:\s*"build\/icon\.ico"/);
  assert.match(builderSource, /uninstallerIcon:\s*"build\/icon\.ico"/);
  assert.match(windowsSource, /const icon = windowsAppIconPath\(\);/);
  assert.match(windowsSource, /app\.isPackaged[\s\S]*?process\.resourcesPath, "icon\.ico"/);
  assert.match(windowsSource, /app\.getAppPath\(\), "build", "icon\.ico"/);
  assert.match(windowsSource, /const windowsIconPath = windowsAppIconPath\(\);[\s\S]*?nativeImage\.createFromPath\(windowsIconPath\)/);

  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  const imageCount = ico.readUInt16LE(4);
  const sizes = Array.from({ length: imageCount }, (_, index) => ico[6 + index * 16] || 256);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});

test("renderer bundles local cross-platform fonts under the production CSP", async () => {
  const packageJson = JSON.parse(await readFile(resolve(desktopRoot, "package.json"), "utf8"));
  const stylesSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "styles.css"), "utf8");
  const rendererSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "main.tsx"), "utf8");
  const viteSource = await readFile(resolve(desktopRoot, "vite.config.ts"), "utf8");
  const dailyPlannerSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "components", "DailyPlanner.tsx"), "utf8");
  const agentWorkspaceSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "components", "AgentWorkspace.tsx"), "utf8");
  const uiDateTimeSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "components", "UiDateTimeField.tsx"), "utf8");
  const uiIconSource = await readFile(resolve(desktopRoot, "src", "renderer", "src", "components", "UiIcon.tsx"), "utf8");
  const windowsSource = await readFile(resolve(desktopRoot, "src", "windows.ts"), "utf8");
  const html = await readFile(resolve(rendererRoot, "index.html"), "utf8");
  const assetNames = await readdir(resolve(rendererRoot, "assets"));
  const cssName = assetNames.find((name) => name.endsWith(".css"));
  assert.ok(cssName, "renderer CSS asset is missing");
  const cssPath = resolve(rendererRoot, "assets", cssName);
  const css = await readFile(cssPath, "utf8");
  const compactCss = css.replace(/\s+/g, "");

  assert.match(html, /font-src 'self'/);
  assert.match(css, /font-family:\s*["']?Source Sans 3 Variable["']?/);
  assert.match(css, /font-family:\s*["']?Source Serif 4 Variable["']?/);
  assert.match(css, /font-family:\s*["']?Noto Sans SC Variable["']?/);
  assert.match(css, /font-family:\s*["']?Noto Serif SC Variable["']?/);
  for (const family of ["Source Sans 3 Variable", "Source Serif 4 Variable", "Noto Sans SC Variable", "Noto Serif SC Variable"]) {
    assert.match(css, new RegExp(`font-family:\\s*["']?${family.replaceAll(" ", "\\s+")}["']?`));
  }
  assert.match(css, /font-display:\s*swap/);
  assert.doesNotMatch(css, /url\(["']?https?:/);
  assert.doesNotMatch(css, /url\(["']?data:font/i);
  assert.equal(packageJson.dependencies?.["@fontsource-variable/source-sans-3"], undefined);
  assert.equal(packageJson.dependencies?.["@fontsource-variable/source-serif-4"], undefined);
  assert.equal(packageJson.dependencies?.["@fontsource-variable/noto-sans-sc"], undefined);
  assert.equal(packageJson.dependencies?.["@fontsource-variable/noto-serif-sc"], undefined);
  assert.equal(packageJson.devDependencies["@fontsource-variable/source-sans-3"], "5.2.9");
  assert.equal(packageJson.devDependencies["@fontsource-variable/source-serif-4"], "5.2.9");
  assert.equal(packageJson.devDependencies["@fontsource-variable/noto-sans-sc"], "5.2.10");
  assert.equal(packageJson.devDependencies["@fontsource-variable/noto-serif-sc"], "5.2.10");
  assert.match(stylesSource, /--font-ui:\s*"Source Sans 3 Variable",\s*"Noto Sans SC Variable"/);
  assert.match(stylesSource, /--font-display:\s*"Source Serif 4 Variable",\s*"Noto Serif SC Variable"/);
  assert.match(stylesSource, /--font-number-ui:\s*var\(--font-ui\)/);
  assert.match(stylesSource, /--font-number-display:\s*var\(--font-display\)/);
  assert.match(stylesSource, /--font-ui-adjust:\s*0\.543/);
  assert.match(stylesSource, /--font-display-adjust:\s*0\.514/);
  assert.match(stylesSource, /--text-caption:\s*13px/);
  assert.match(stylesSource, /--text-control:\s*14px/);
  assert.match(stylesSource, /\.agent-overview-metrics b,[\s\S]*?font-variant-numeric:\s*lining-nums tabular-nums/);
  assert.doesNotMatch(stylesSource, /agent-overview-metrics strong/);
  assert.match(stylesSource, /:root\s*\{[\s\S]*?font-family:\s*var\(--font-ui\);/);
  assert.match(stylesSource, /body\s*\{[\s\S]*?-webkit-font-smoothing:\s*antialiased;[\s\S]*?-moz-osx-font-smoothing:\s*grayscale/);
  assert.doesNotMatch(stylesSource, /html\[data-platform=/);
  assert.match(rendererSource, /document\.documentElement\.dataset\.platform = api\.platform/);
  assert.match(rendererSource, /document\.fonts\.load\(font, sample\)/);
  assert.match(rendererSource, /document\.documentElement\.dataset\.fonts = "ready"/);
  assert.match(stylesSource, /select\s*\{[\s\S]*?appearance:\s*none[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(stylesSource, /input:is\(\[type="date"\], \[type="datetime-local"\], \[type="time"\]\)::-webkit-calendar-picker-indicator/);
  assert.match(stylesSource, /\.ui-checkbox:checked\s*\{[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(stylesSource, /progress::-webkit-progress-value/);
  assert.match(uiDateTimeSource, /className="ui-date-time-text"[\s\S]*?type="text"/);
  assert.match(uiDateTimeSource, /picker\.showPicker\(\)/);
  assert.match(uiDateTimeSource, /return "YYYY-MM-DD HH:mm"/);
  assert.doesNotMatch(`${rendererSource}\n${dailyPlannerSource}\n${agentWorkspaceSource}`, /<input[^>]+type="(?:date|time|datetime-local)"/);
  assert.match(stylesSource, /\.ui-date-time-field > \.ui-date-time-text\s*\{[^}]*font-variant-numeric:\s*lining-nums tabular-nums/);
  assert.match(viteSource, /assetsInlineLimit:\s*0/);
  assert.doesNotMatch(`${rendererSource}\n${dailyPlannerSource}`, /↶|⏱|⌁/);
  assert.doesNotMatch(`${rendererSource}\n${agentWorkspaceSource}`, /<button[^>]*>\s*[×＋←↑↓‹›]\s*<\/button>/);
  assert.match(uiIconSource, /export function UiIcon/);
  assert.doesNotMatch(dailyPlannerSource, />[‹›＋×]</);
  assert.match(dailyPlannerSource, /function PlannerIcon/);
  assert.match(dailyPlannerSource, /className="daily-display-number"/);
  assert.doesNotMatch(dailyPlannerSource, /<article[^>]+role=\{interactive \? "button"/);
  assert.match(dailyPlannerSource, /className="daily-task-open"/);
  assert.doesNotMatch(compactCss, /\.control-shell\{[^}]*min-width:760px/);
  const controlShellRules = [...compactCss.matchAll(/\.control-shell\{([^}]*)\}/g)]
    .map((match) => match[1]);
  assert.ok(
    controlShellRules.some((rule) => rule.includes("min-width:0") && rule.includes("width:100%")),
    "control shell must fit its content width without a fixed minimum",
  );
  assert.match(stylesSource, /\.daily-workspace\.mode-day\s*\{[^}]*grid-template-columns:\s*218px minmax\(0, 1fr\)/);
  assert.match(stylesSource, /\.daily-hour\s*\{[^}]*transform:\s*translateY\(-50%\)/);
  assert.match(stylesSource, /\.daily-now\s*\{[^}]*height:\s*0/);
  assert.match(stylesSource, /\.mode-week \.daily-compact-days\s*\{[^}]*min-width:\s*700px[^}]*repeat\(7, minmax\(100px, 1fr\)\)/);
  assert.match(stylesSource, /\.daily-editor input,\s*\.daily-editor select\s*\{[^}]*height:\s*42px/);
  assert.match(stylesSource, /\.primary,\s*\.secondary,\s*\.danger,\s*\.agent-run\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/);
  assert.match(stylesSource, /\.agent-memory-grid input,\s*\.agent-memory-grid select\s*\{[^}]*height:\s*40px[^}]*font-size:\s*var\(--text-control\)/);
  assert.match(rendererSource, /className="settings-group companion-settings-group"/);
  assert.match(stylesSource, /\.companion-settings-group \.toggle\s*\{[^}]*min-height:\s*52px[^}]*padding:\s*0/);
  assert.match(stylesSource, /@media \(max-width: 850px\)\s*\{[\s\S]*?\.daily-toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(stylesSource, /@media \(max-width: 850px\)\s*\{[\s\S]*?\.daily-timeline-panel\s*\{\s*min-width:\s*0;\s*min-height:\s*0;/);
  assert.match(stylesSource, /\.content:has\(\.daily-planner\),\s*\.daily-workspace\.mode-day\s*\{\s*scrollbar-gutter:\s*auto;/);
  assert.match(stylesSource, /\.pet-body:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\)/);
  assert.match(stylesSource, /@media \(forced-colors: active\)\s*\{[\s\S]*?outline-color:\s*Highlight !important/);
  assert.match(stylesSource, /@media \(max-width: 850px\) and \(max-height: 600px\)\s*\{[\s\S]*?\.daily-timeline-panel\s*\{[\s\S]*?min-height:\s*240px/);
  assert.match(stylesSource, /html::?-webkit-scrollbar-thumb|html::-webkit-scrollbar-thumb/);
  assert.match(stylesSource, /@media \(forced-colors: none\)\s*\{[\s\S]*?::-webkit-scrollbar-button/);
  assert.match(windowsSource, /if \(control\.isMinimized\(\)\) control\.restore\(\);/);
  assert.match(windowsSource, /if \(schedule\.isMinimized\(\)\) schedule\.restore\(\);/);
  assert.match(windowsSource, /minimizable:\s*false/);
  assert.match(windowsSource, /function ensurePetWindow\(\): BrowserWindow \| undefined/);
  assert.match(windowsSource, /const companionNeedsPet = preferences\.companionEnabled && \(!windows\.pet \|\| windows\.pet\.isDestroyed\(\)\);/);
  assert.match(windowsSource, /autoUpdater\.once\("before-quit-for-update", markAppQuitting\);/);
  assert.match(windowsSource, /export function showControlCenter\(route\?: ControlCenterRoute\): void \{\s*if \(appQuitting\) return;/);
  assert.match(windowsSource, /zoomFactor:\s*rendererZoomFactor/);
  assert.match(windowsSource, /configureRendererZoom\(win\.webContents\)/);

  const fontUrls = [...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map((match) => match[1]);
  assert.ok(fontUrls.length >= 2, "expected both Latin and Simplified Chinese WOFF2 assets");
  for (const fontUrl of new Set(fontUrls)) {
    const fontPath = resolve(dirname(cssPath), decodeURIComponent(fontUrl));
    assert.ok((await stat(fontPath)).size > 0, `${fontUrl} is empty`);
  }
});
