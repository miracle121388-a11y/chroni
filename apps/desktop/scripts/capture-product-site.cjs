const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const repositoryRoot = resolve(__dirname, "..", "..", "..");
const sitePath = join(repositoryRoot, "dist", "site", "index.html");
const outputDirectory = join(repositoryRoot, "output", "visual-checks");

async function capture(window, name) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 600));
  const image = await window.webContents.capturePage();
  writeFileSync(join(outputDirectory, name), image.toPNG());
}

app.whenReady().then(async () => {
  mkdirSync(outputDirectory, { recursive: true });
  const window = new BrowserWindow({ width: 1440, height: 1000, show: false, backgroundColor: "#f7f7f3" });
  await window.loadFile(sitePath);
  await capture(window, "site-hero-desktop.png");
  await window.webContents.executeJavaScript("document.querySelector('.hero-story').style.display='none'; document.querySelector('.release-bar').style.display='none'; document.querySelector('.clarity-story').style.display='none'; window.scrollTo(0,0); true");
  window.showInactive();
  await capture(window, "site-mission-desktop.png");
  window.hide();
  await window.loadFile(sitePath);
  window.setSize(390, 844);
  await window.webContents.executeJavaScript("window.scrollTo(0, 0); true");
  window.showInactive();
  await capture(window, "site-hero-mobile.png");
  window.destroy();
  console.log(`Product site screenshots written to ${outputDirectory}`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
