const RELEASE_API = "https://api.github.com/repos/miracle121388-a11y/chroni/releases/latest";
const CURRENT_VERSION = "__CHRONI_VERSION__";
const DIRECT_DOWNLOAD_ROOT = "https://github.com/miracle121388-a11y/chroni/releases/latest/download";
const directDownloadUrl = (name) => `${DIRECT_DOWNLOAD_ROOT}/${name}`;
const FALLBACK_RELEASE = {
  tag_name: `v${CURRENT_VERSION}`,
  published_at: "",
  assets: [
    {
      name: "Chroni-win-x64-setup.exe",
      browser_download_url: directDownloadUrl("Chroni-win-x64-setup.exe"),
      size: 0,
    },
    {
      name: "Chroni-win-x64-portable.exe",
      browser_download_url: directDownloadUrl("Chroni-win-x64-portable.exe"),
      size: 0,
    },
    {
      name: "Chroni-mac-universal.dmg",
      browser_download_url: directDownloadUrl("Chroni-mac-universal.dmg"),
      size: 0,
    },
  ],
};

const targets = {
  windowsSetup: {
    card: document.querySelector("#windows-setup-card"),
    link: document.querySelector("#windows-setup"),
    meta: document.querySelector("#windows-setup-meta"),
    matches: (name) => /win-x64-setup\.exe$/i.test(name),
  },
  windowsPortable: {
    card: document.querySelector("#windows-portable-card"),
    link: document.querySelector("#windows-portable"),
    meta: document.querySelector("#windows-portable-meta"),
    matches: (name) => /win-x64-portable\.exe$/i.test(name),
  },
  macos: {
    card: document.querySelector("#macos-card"),
    link: document.querySelector("#macos-dmg"),
    meta: document.querySelector("#macos-dmg-meta"),
    matches: (name) => /mac-universal\.dmg$/i.test(name),
  },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function detectPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) return "other";
  if (/windows|win32|win64/i.test(`${platform} ${userAgent}`)) return "windows";
  if (/macintosh|mac os x|macintel/i.test(`${platform} ${userAgent}`)) return "macos";
  return "other";
}

function configurePlatform(platform) {
  const primary = document.querySelector("#primary-download");
  const primaryLabel = document.querySelector("#primary-download-label");
  const final = document.querySelector("#final-download");
  const finalLabel = document.querySelector("#final-download-label");
  const detectedLabel = document.querySelector("#detected-platform");
  const target = platform === "macos" ? targets.macos : platform === "windows" ? targets.windowsSetup : null;

  const copy = {
    windows: {
      button: "直接下载 Windows 版",
      detected: "已匹配 Windows 10/11 x64 · 点击直接下载",
    },
    macos: {
      button: "直接下载 macOS 版",
      detected: "已匹配 macOS 通用版 · 点击直接下载",
    },
    other: {
      button: "查看电脑版本",
      detected: "请在 Windows 或 macOS 电脑下载",
    },
  }[platform];

  primaryLabel.textContent = copy.button;
  finalLabel.textContent = copy.button;
  detectedLabel.textContent = copy.detected;

  if (platform !== "other") {
    target.card?.classList.add("detected");
    const platformLabel = platform === "macos" ? "macOS" : "Windows";
    primary.dataset.downloadPlatform = platformLabel;
    final.dataset.downloadPlatform = platformLabel;
  } else {
    primary.href = "#download";
    final.href = "#download";
    delete primary.dataset.downloadPlatform;
    delete final.dataset.downloadPlatform;
  }
  return { final, primary, target };
}

function applyRelease(release, platform, selected, fallback = false) {
  const primaryMeta = document.querySelector("#primary-download-meta");
  const releaseStatus = document.querySelector("#release-status");
  const releaseVersion = document.querySelector("#release-version");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const matchedAssets = new Map();

  for (const [key, target] of Object.entries(targets)) {
    const asset = assets.find((candidate) => target.matches(candidate.name));
    if (!asset) continue;
    matchedAssets.set(key, asset);
    target.link.href = asset.browser_download_url;
    target.meta.textContent = [release.tag_name, formatBytes(asset.size), "点击直接下载"].filter(Boolean).join(" · ");
  }

  if (platform !== "other") {
    const selectedKey = platform === "macos" ? "macos" : "windowsSetup";
    const recommendedAsset = matchedAssets.get(selectedKey);
    const recommendedHref = recommendedAsset?.browser_download_url || selected.target?.link.href || "#download";
    selected.primary.href = recommendedHref;
    selected.final.href = recommendedHref;
    const date = formatDate(release.published_at);
    const size = recommendedAsset ? formatBytes(recommendedAsset.size) : "";
    primaryMeta.textContent = [release.tag_name, size, date, "点击直接下载"].filter(Boolean).join(" · ");
  } else {
    primaryMeta.textContent = `${release.tag_name} · Windows 与 macOS`;
  }

  releaseVersion.textContent = release.tag_name;
  releaseStatus.textContent = fallback
    ? `${release.tag_name} 安装包已就绪，点击对应平台即可直接下载。`
    : `${release.tag_name} 已发布，页面已为你匹配最新安装包。`;
}

async function loadLatestRelease() {
  const platform = detectPlatform();
  const selected = configurePlatform(platform);
  applyRelease(FALLBACK_RELEASE, platform, selected, true);

  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    applyRelease(await response.json(), platform, selected);
  } catch (error) {
    document.querySelector("#release-status").textContent = `${FALLBACK_RELEASE.tag_name} 安装包已就绪，当前使用稳定直达下载通道。`;
    console.info("Using stable Chroni download links", error instanceof Error ? error.message : "release metadata unavailable");
  }
}

function initializeDirectDownloadFeedback() {
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[data-direct-download]") : null;
    if (!link || !link.href.startsWith("https://github.com/")) return;
    const platform = link.dataset.downloadPlatform || "对应平台";
    document.querySelector("#release-status").textContent = `正在连接 ${platform} 安装包，下载将立即开始…`;
    link.classList.add("download-started");
    window.setTimeout(() => link.classList.remove("download-started"), 1800);
  });
}

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
loadLatestRelease();
initializeDirectDownloadFeedback();

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const motionLite = Boolean(
  connection?.saveData
  || (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4)
  || (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4)
);

function initializeMotion() {
  document.body.classList.add("motion-ready");
  document.body.classList.toggle("motion-lite", motionLite || reduceMotionQuery.matches);
}

function initializeRevealScenes() {
  const elements = [...document.querySelectorAll("[data-reveal]")];
  if (!("IntersectionObserver" in window) || reduceMotionQuery.matches || motionLite) {
    elements.forEach((element) => element.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.18 });
  elements.forEach((element) => observer.observe(element));
}

const mascotStates = {
  idle: {
    label: "待机",
    image: "./assets/pet-idle.png",
    alt: "Chroni 桌宠待机状态",
    message: "今天的安排已经准备好，需要时点我就可以打开日程。",
    title: "今日 3 项安排",
    meta: "19:00 开始第一项",
  },
  reading: {
    label: "阅读",
    image: "./assets/pet-study.png",
    alt: "Chroni 桌宠阅读材料状态",
    message: "我先从材料里确认学习目标、交付物和验收标准。",
    title: "正在理解日程与任务",
    meta: "已找到 4 项关键信息",
  },
  planning: {
    label: "规划",
    image: "./assets/pet-study.png",
    alt: "Chroni 桌宠规划状态",
    message: "今晚时间比较完整，我先把最紧急的任务放在这里。",
    title: "数据库作业",
    meta: "19:00–20:30 · Agent 规划",
  },
  reminder: {
    label: "提醒",
    image: "./assets/pet-wake.png",
    alt: "Chroni 桌宠提醒状态",
    message: "还有 10 分钟开始数据库作业，材料和步骤已经准备好了。",
    title: "即将开始",
    meta: "19:00 · 数据库作业",
  },
  done: {
    label: "完成",
    image: "./assets/pet-play.png",
    alt: "Chroni 桌宠庆祝完成状态",
    message: "今天 4 项任务已经完成 3 项，剩下的一项已排到明晚。",
    title: "今日进度 75%",
    meta: "已完成 3 项 · 延后 1 项",
  },
  rest: {
    label: "休息",
    image: "./assets/pet-sleep.png",
    alt: "Chroni 桌宠休息状态",
    message: "今天的记录已经整理好。休息吧，明天的计划我会记得。",
    title: "日终手账已生成",
    meta: "明日 2 项安排",
  },
};

const voiceExamples = {
  create: {
    command: "“明天下午三点写项目报告，安排一个小时。”",
    mode: "修改日程 · 等待确认",
    title: "添加“写项目报告”",
    detail: "明天 15:00–16:00 · 保存到每日任务",
    action: "确认后执行",
  },
  schedule: {
    command: "“我今天下午还有什么安排？”",
    mode: "查询日程 · 直接回答",
    title: "今天还有 2 项安排",
    detail: "15:30 组会 · 19:00 数据库作业",
    action: "只读取，不修改",
  },
  summary: {
    command: "“总结一下我今天完成了什么。”",
    mode: "每日总结 · 读取记录",
    title: "完成 3 项 · 专注 4 小时 10 分",
    detail: "已整理成果、阻塞原因与明日建议",
    action: "打开今日手账",
  },
};

function initializeVoiceDemo() {
  const demo = document.querySelector("[data-voice-demo]");
  if (!demo) return;
  const buttons = [...demo.querySelectorAll("[data-voice-example]")];
  const command = demo.querySelector("#voice-demo-command");
  const mode = demo.querySelector("#voice-demo-mode");
  const title = demo.querySelector("#voice-demo-title");
  const detail = demo.querySelector("#voice-demo-detail");
  const action = demo.querySelector("#voice-demo-action");
  let activeIndex = 0;
  let transitionTimer;

  const selectExample = (button) => {
    const example = voiceExamples[button.dataset.voiceExample];
    if (!example) return;
    activeIndex = buttons.indexOf(button);
    buttons.forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
    window.clearTimeout(transitionTimer);
    demo.classList.add("is-speaking");
    command.textContent = example.command;
    mode.textContent = example.mode;
    title.textContent = example.title;
    detail.textContent = example.detail;
    action.textContent = example.action;
    transitionTimer = window.setTimeout(() => demo.classList.remove("is-speaking"), reduceMotionQuery.matches ? 0 : 520);
  };

  buttons.forEach((button) => button.addEventListener("click", () => selectExample(button)));
  demo.querySelector("[data-voice-next]")?.addEventListener("click", () => {
    selectExample(buttons[(activeIndex + 1) % buttons.length]);
  });
}

function initializeMascotStage() {
  const stage = document.querySelector("[data-mascot-stage]");
  if (!stage) return;
  const buttons = [...stage.querySelectorAll("[data-state]")];
  const mascot = stage.querySelector(".state-mascot");
  const image = stage.querySelector("#state-mascot-image");
  const label = stage.querySelector(".state-name");
  const message = stage.querySelector("#state-message");
  const title = stage.querySelector("#state-preview-title");
  const meta = stage.querySelector("#state-preview-meta");
  const timeline = stage.querySelector(".state-timeline i");

  Object.values(mascotStates).forEach((state) => {
    const preload = new Image();
    preload.src = state.image;
  });

  const selectState = (button) => {
    const state = mascotStates[button.dataset.state];
    if (!state || button.getAttribute("aria-selected") === "true") return;
    buttons.forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
    mascot.classList.add("changing");
    window.setTimeout(() => {
      image.src = state.image;
      image.alt = state.alt;
      label.textContent = state.label;
      message.textContent = state.message;
      title.textContent = state.title;
      meta.textContent = state.meta;
      timeline.style.transform = `scaleX(${(buttons.indexOf(button) + 1) / buttons.length})`;
      mascot.classList.remove("changing");
    }, reduceMotionQuery.matches ? 0 : 130);
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => selectState(button));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
      event.preventDefault();
      const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
      const next = buttons[(buttons.indexOf(button) + direction + buttons.length) % buttons.length];
      next.focus();
      selectState(next);
    });
  });
}

initializeMotion();
initializeRevealScenes();
initializeVoiceDemo();
initializeMascotStage();

document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("page-hidden", document.hidden);
});
