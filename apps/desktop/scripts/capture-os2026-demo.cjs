// Runs the production main process and IPC in a fresh temporary profile.
// Captures actual renderer frames; no task extraction or planning results are mocked.
const { app, BrowserWindow } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const assert = require("node:assert/strict");

const root = resolve(__dirname, "../../..");
const desktop = resolve(__dirname, "..");
const output = join(root, "tmp/os2026");
const frames = join(output, "frames");
const screenshots = join(root, "docs/os2026/assets");
const qaScreenshots = join(output, "screenshots");
const profile = mkdtempSync(join(tmpdir(), "chroni-os2026-demo-"));
const probe = process.argv.includes("--probe");
const scenes = JSON.parse(readFileSync(join(root, "docs/os2026/demo-scenes.json"), "utf8"));
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
app.setPath("userData", profile);
app.setAppPath(desktop);
process.env.CHRONI_LLM_ENABLED = "false";
delete process.env.CHRONI_LLM_API_KEY;
app.commandLine.appendSwitch("force-device-scale-factor", "1");
mkdirSync(frames, { recursive: true });
mkdirSync(screenshots, { recursive: true });
mkdirSync(qaScreenshots, { recursive: true });
GlobalFonts.registerFromPath("/System/Library/Fonts/STHeiti Light.ttc", "ChroniCN");

let control;
let running = true;
let frameNo = 0;
let scene;
let cursor = null;
let viewport;
const timeline = [];
const canvas = createCanvas(1920, 1080);
const ctx = canvas.getContext("2d");
const js = source => control.webContents.executeJavaScript(source);
async function waitFor(predicate, description, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function click(selector, text) {
  const point = await js(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : "true"});
    if (!target) throw new Error('Missing click target');
    target.scrollIntoView({block:'nearest'});
    const r = target.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  cursor = point;
  control.webContents.sendInputEvent({type:"mouseMove",x:Math.round(point.x),y:Math.round(point.y)});
  await delay(probe ? 40 : 450);
  control.webContents.sendInputEvent({type:"mouseDown",button:"left",x:Math.round(point.x),y:Math.round(point.y),clickCount:1});
  control.webContents.sendInputEvent({type:"mouseUp",button:"left",x:Math.round(point.x),y:Math.round(point.y),clickCount:1});
  await delay(probe ? 180 : 700);
}
async function fill(selector, value) {
  await js(`(() => {
    const e=document.querySelector(${JSON.stringify(selector)});
    if (!e) throw new Error('Missing input '+${JSON.stringify(selector)});
    e.scrollIntoView({block:'nearest'}); e.focus();
    const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});
    e.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await delay(probe ? 80 : 900);
}
async function nav(text) { await click("nav button", text); }
async function scrollTo(selector) {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
  cursor = null;
  await delay(250);
}
async function screenshot(name) {
  if(name === "mission-overview") {
    await js(`(() => {window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;for(const e of document.querySelectorAll('*')) if(e instanceof HTMLElement && e.scrollHeight>e.clientHeight+2) e.scrollTop=0;})()`);
  }
  await control.webContents.executeJavaScript("document.fonts.ready");
  await delay(300);
  const picture = await control.webContents.capturePage();
  writeFileSync(join(name === "mission-overview" ? screenshots : qaScreenshots, name + ".png"), picture.toPNG());
}
async function recordLoop() {
  while (running) {
    if (!scene) { await delay(50); continue; }
    const started = Date.now();
    const picture = await control.webContents.capturePage();
    const image = await loadImage(picture.toPNG());
    ctx.fillStyle = "#eef2ef"; ctx.fillRect(0,0,1920,1080);
    ctx.fillStyle = "#203e38"; ctx.fillRect(0,0,1920,70);
    ctx.font = "bold 29px ChroniCN"; ctx.fillStyle = "#ffffff";
    ctx.fillText(scene.title,55,46);
    ctx.font = "20px ChroniCN"; ctx.fillStyle = "#d9e8e1";
    ctx.fillText("2026 上海开源软件应用创新大赛",1370,43);
    const scale = Math.min(1760/image.width,900/image.height);
    const x = (1920-image.width*scale)/2;
    ctx.drawImage(image,x,70,image.width*scale,image.height*scale);
    if(cursor) {
      const ratio=image.width/viewport.width;
      const cx=x+cursor.x*scale*ratio,cy=70+cursor.y*scale*ratio;
      ctx.fillStyle="rgba(235,139,85,0.26)";ctx.beginPath();ctx.arc(cx,cy,17,0,2*Math.PI);ctx.fill();
      ctx.strokeStyle="#d77841";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,8,0,2*Math.PI);ctx.stroke();
    }
    ctx.fillStyle="#203e38";ctx.fillRect(0,974,1920,106);
    ctx.fillStyle="#ffffff";ctx.font="28px ChroniCN";ctx.fillText(scene.caption,55,1014);
    ctx.fillStyle="#aec9bf";ctx.font="19px ChroniCN";
    ctx.fillText("真实产品操作录制 · 合成示例 · 独立临时数据目录 · 本地规则模式",55,1050);
    writeFileSync(join(frames,`${String(frameNo++).padStart(6,"0")}.jpg`),canvas.toBuffer("image/jpeg",82));
    await delay(Math.max(0,250-(Date.now()-started)));
  }
}
async function runScene(id, action) {
  scene = scenes.find(s => s.id === id);
  const first = frameNo;
  const started = Date.now();
  console.log(`Scene ${id}`);
  await action();
  if (!probe) await delay(Math.max(0,scene.seconds*1000-(Date.now()-started)));
  await screenshot(id);
  timeline.push({...scene,firstFrame:first,lastFrame:frameNo});
}

(async () => {
  let recorder;
  try {
    await import(pathToFileURL(join(desktop,"dist/main.js")).href);
    await app.whenReady();
    const windows = await import(pathToFileURL(join(desktop,"dist/windows.js")).href);
    await delay(800);
    windows.showControlCenter({tab:"daily"});
    await waitFor(async () => {
      control=BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("view=control"));
      return Boolean(control && await js("Boolean(document.querySelector('.control-shell'))"));
    },"control center");
    control.setContentSize(1600,900);control.webContents.setZoomFactor(1);control.show();
    await delay(500);
    viewport=await js("({width:window.innerWidth,height:window.innerHeight})");
    assert.equal((await js("window.chroni.getSnapshot()")).items.length,0,"Profile must start empty");
    await js("window.chroni.updatePreferences({remindersEnabled:false})");
    await js("window.chroni.updateAgentMemory({workdayStart:'08:00',workdayEnd:'23:59',useLlmPlanning:false,automaticInspectionEnabled:false})");
    if (!probe) recorder=recordLoop();
    await runScene("intro",async()=>{});
    await runScene("intake",async()=>{
      await nav("智能整理");
      await fill(".smart-intake input", "数据库课程项目明天18:00截止，提交PDF报告和SQL文件，报告包含关系模式设计、查询结果、实验截图和结论");
      await click(".smart-intake button","整理");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).items.length===1,"real intake creates task");
      const state=await js("window.chroni.getSnapshot()");
      assert(state.sources.length>0 && state.learningMissions.length===1,"Source and mission persisted");
      await click(".editor-actions button","编辑");
      await fill(".title-field input","数据库课程项目");
      await click(".save-edit","保存");
    });
    await runScene("mission",async()=>{
      await nav("学习任务");
      await waitFor(()=>js("Boolean(document.querySelector('.mission-detail'))"),"mission detail");
      await screenshot("mission-overview");
      await delay(probe?20:7500);
      await click(".mission-detail button","执行计划");
      await waitFor(()=>js("Boolean(document.querySelector('.plan-overview'))"),"task plan");
      await fill(".plan-overview > label input","完成数据库课程项目，提交PDF报告与SQL文件");
      await click(".plan-actions button","保存修改");
      await click(".plan-actions button","确认并启用");
      await screenshot("task-plan");
      await nav("学习任务");
      await screenshot("mission-overview");
    });
    await runScene("schedule",async()=>{
      await nav("今日执行");
      await click(".daily-agent-button","智能安排");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).dailyTasks.length>0,"scheduled blocks");
      await scrollTo(".daily-event");
    });
    await runScene("evidence",async()=>{
      await nav("学习任务");
      await scrollTo(".mission-note-form");
      await fill("[aria-label='证据名称']","关系模式设计记录");
      await fill("[aria-label='证据内容']","已完成三张数据表的实体关系设计，并核对主键、外键与查询需求。此记录为合成演示产出。");
      await click(".mission-note-form button","登记说明");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).learningMissions[0].evidence.length===1,"note evidence persisted");
      await scrollTo(".mission-evidence-list");
    });
    await runScene("checkpoint",async()=>{
      await scrollTo(".checkpoint-form");
      await click(".checkpoint-status button","完成阶段");
      await fill("[aria-label='本次进展']","已完成需求梳理与关系模式初稿，下一步验证核心SQL查询。");
      await fill(".checkpoint-fields input[type='number']","40");
      await click(".checkpoint-form button","记录检查点");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).learningMissions[0].checkpoints.length===1,"checkpoint persisted");
      await screenshot("checkpoint");
      await scrollTo(".mission-metrics");
    });
    await runScene("review",async()=>{
      await nav("今日执行");
      await waitFor(()=>js("Boolean(document.querySelector('.daily-check'))"),"daily completion control");
      await click(".daily-check");
      await nav("每日回顾");
      await waitFor(()=>js("Boolean(document.querySelector('.review-writing-panel textarea'))"),"daily review input");
      await fill(".review-writing-panel textarea:first-of-type","今天完成课程项目的需求梳理和关系模式初稿，已登记阶段产出与40分钟实际投入。明天继续验证SQL查询并整理报告截图。此内容为合成演示记录。");
      await click(".review-save-button","保存回顾");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).dailyReviews.length>0,"daily review saved");
    });
    await runScene("clarify",async()=>{
      await nav("智能整理");
      await fill(".smart-intake input","完成机器学习课程阅读报告，提交PDF阅读记录。");
      await click(".smart-intake button","整理");
      await waitFor(async()=> (await js("window.chroni.getSnapshot()")).clarifications.length>0,"missing deadline prompts clarification");
      await scrollTo(".clarification-row");
    });
    await runScene("outro",async()=>{
      await nav("学习任务");
      await control.webContents.reload();
      await waitFor(()=>js("Boolean(document.querySelector('.control-shell'))"),"reload");
      await nav("学习任务");
      const state=await js("window.chroni.getSnapshot()");
      assert.equal(state.learningMissions[0].evidence.length,1);
      assert.equal(state.learningMissions[0].checkpoints.length,1);
      assert(state.dailyReviews.length>0);
      writeFileSync(join(output,"verification.json"),JSON.stringify({synthetic:true,model:"local-rules",networkForCoreFlow:false,taskCount:state.items.length,evidence:1,checkpoints:1,dailyReviews:state.dailyReviews.length,clarifications:state.clarifications.length,reloadPersistence:true},null,2)+"\n");
    });
    running=false;if(recorder)await recorder;
    if(!probe) writeFileSync(join(output,"timeline.json"),JSON.stringify({fps:4,frameCount:frameNo,scenes:timeline},null,2)+"\n");
    console.log("OS2026 flow verified and captured.");
  } catch(error) {
    console.error(error); running=false;if(recorder)await recorder;
    if(control && !control.isDestroyed()){
      writeFileSync(join(output,"failed-ui.txt"),await js("document.body.innerText"));
      await screenshot("failed");
    }
    process.exitCode=1;
  } finally {
    for(const window of BrowserWindow.getAllWindows()) window.destroy();
    rmSync(profile,{recursive:true,force:true});
    app.exit(process.exitCode || 0);
  }
})();
