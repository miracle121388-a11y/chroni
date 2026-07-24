const RELEASE_API = "https://api.github.com/repos/miracle121388-a11y/chroni/releases/latest";
const RELEASE_FALLBACK = "https://github.com/miracle121388-a11y/chroni/releases/latest";
const FALLBACK_RELEASE = {
  tag_name: "v0.1.4",
  published_at: "2026-07-15T12:38:41Z",
  assets: [
    {
      name: "Chroni-0.1.4-win-x64-setup.exe",
      size: 160635683,
      browser_download_url: "https://github.com/miracle121388-a11y/chroni/releases/download/v0.1.4/Chroni-0.1.4-win-x64-setup.exe",
    },
    {
      name: "Chroni-0.1.4-win-x64-portable.exe",
      size: 160364611,
      browser_download_url: "https://github.com/miracle121388-a11y/chroni/releases/download/v0.1.4/Chroni-0.1.4-win-x64-portable.exe",
    },
    {
      name: "Chroni-0.1.4-mac-universal.dmg",
      size: 262015294,
      browser_download_url: "https://github.com/miracle121388-a11y/chroni/releases/download/v0.1.4/Chroni-0.1.4-mac-universal.dmg",
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
      button: "下载 Windows 版",
      detected: "已匹配 Windows 10/11 x64",
    },
    macos: {
      button: "下载 macOS 版",
      detected: "已匹配 macOS 通用版本",
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
  } else {
    primary.href = "#download";
    final.href = "#download";
  }
  return { final, primary, target };
}

function applyRelease(release, platform, selected) {
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
    target.meta.textContent = `${release.tag_name} · ${formatBytes(asset.size)}`;
  }

  if (platform !== "other") {
    const selectedKey = platform === "macos" ? "macos" : "windowsSetup";
    const recommendedAsset = matchedAssets.get(selectedKey);
    const recommendedHref = recommendedAsset?.browser_download_url || RELEASE_FALLBACK;
    selected.primary.href = recommendedHref;
    selected.final.href = recommendedHref;
    const date = formatDate(release.published_at);
    const size = recommendedAsset ? formatBytes(recommendedAsset.size) : "";
    primaryMeta.textContent = [release.tag_name, size, date].filter(Boolean).join(" · ");
  } else {
    primaryMeta.textContent = `${release.tag_name} · Windows 与 macOS`;
  }

  releaseVersion.textContent = release.tag_name;
  releaseStatus.textContent = `${release.tag_name} 已发布，页面已为你匹配可直接运行的安装包。`;
}

async function loadLatestRelease() {
  const platform = detectPlatform();
  const selected = configurePlatform(platform);
  applyRelease(FALLBACK_RELEASE, platform, selected);

  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    applyRelease(await response.json(), platform, selected);
  } catch (error) {
    console.warn("Using bundled Chroni release metadata", error);
  }
}

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
loadLatestRelease();

const clamp = (value, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const rangeProgress = (progress, start, end) => clamp((progress - start) / (end - start));
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const desktopStoryQuery = window.matchMedia("(min-width: 901px)");

function setHeroProgress(progress) {
  const stage = document.querySelector(".hero-stage");
  if (!stage) return;

  const enter = rangeProgress(progress, 0, 0.15);
  const reading = rangeProgress(progress, 0.15, 0.32);
  const extracting = rangeProgress(progress, 0.32, 0.52);
  const planning = rangeProgress(progress, 0.52, 0.73);
  const reminding = rangeProgress(progress, 0.73, 0.9);
  const readingVisibility = clamp(reading - reminding);

  stage.style.setProperty("--notice-x", `${-44 * (1 - enter) + 135 * reading}px`);
  stage.style.setProperty("--notice-y", `${26 * reading}px`);
  stage.style.setProperty("--notice-scale", String(1 - reading * 0.24));
  stage.style.setProperty("--notice-opacity", String(1 - planning * 0.32));
  stage.style.setProperty("--highlight-opacity", String(reading * 0.78));
  stage.style.setProperty("--highlight-line", String(reading * 0.62));
  stage.style.setProperty("--extract-opacity", String(extracting));
  stage.style.setProperty("--extract-x", `${-48 * (1 - extracting) + 30 * planning}px`);
  stage.style.setProperty("--extract-y", `${20 * (1 - extracting) - 12 * planning}px`);
  stage.style.setProperty("--extract-scale", String(0.92 + extracting * 0.08 - planning * 0.04));
  stage.style.setProperty("--window-x", `${84 * (1 - planning)}px`);
  stage.style.setProperty("--window-y", `${34 * (1 - planning)}px`);
  stage.style.setProperty("--window-scale", String(0.84 + planning * 0.16));
  stage.style.setProperty("--window-opacity", String(0.58 + planning * 0.42));
  stage.style.setProperty("--insight-opacity", String(planning));
  stage.style.setProperty("--insight-y", `${10 * (1 - planning)}px`);
  stage.style.setProperty("--mascot-idle", String(1 - reading));
  stage.style.setProperty("--mascot-reading", String(readingVisibility));
  stage.style.setProperty("--mascot-reminding", String(reminding));
  stage.style.setProperty("--mascot-y", `${-5 * reading}px`);
  stage.style.setProperty("--progress-width", `${progress * 100}%`);

  const bubble = document.querySelector("#hero-bubble");
  if (!bubble) return;
  const nextText = progress < 0.15
    ? "把通知拖给我就好。"
    : progress < 0.32
      ? "正在找截止时间和提交要求…"
      : progress < 0.52
        ? "四项关键信息已经确认。"
        : progress < 0.73
          ? "我正在把步骤排进今天。"
          : "19:00 开始第一步，我会在桌面等你。";
  if (bubble.textContent !== nextText) bubble.textContent = nextText;
}

function updateScrollScenes() {
  const hero = document.querySelector(".hero-story");
  if (hero && desktopStoryQuery.matches && !reduceMotionQuery.matches) {
    const denominator = Math.max(1, hero.offsetHeight - window.innerHeight);
    setHeroProgress(clamp(-hero.getBoundingClientRect().top / denominator));
  }

  const clarity = document.querySelector(".clarity-story");
  const clarityStage = document.querySelector(".clarity-stage");
  if (!clarity || !clarityStage) return;
  if (!desktopStoryQuery.matches || reduceMotionQuery.matches) {
    clarityStage.dataset.step = "3";
    return;
  }
  const denominator = Math.max(1, clarity.offsetHeight - window.innerHeight);
  const progress = clamp(-clarity.getBoundingClientRect().top / denominator);
  clarityStage.dataset.step = progress < 0.12 ? "0" : progress < 0.36 ? "1" : progress < 0.68 ? "2" : "3";
}

function initializeScrollMotion() {
  document.body.classList.add("motion-ready");
  setHeroProgress(reduceMotionQuery.matches || !desktopStoryQuery.matches ? 1 : 0);
  let frameRequested = false;
  const requestUpdate = () => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      updateScrollScenes();
    });
  };
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  reduceMotionQuery.addEventListener?.("change", requestUpdate);
  desktopStoryQuery.addEventListener?.("change", requestUpdate);
  requestUpdate();
}

function initializeRevealScenes() {
  const elements = [...document.querySelectorAll("[data-reveal]")];
  if (!("IntersectionObserver" in window) || reduceMotionQuery.matches) {
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
    message: "我先看看这份通知里有哪些截止事项和提交要求。",
    title: "正在读取课程通知",
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
      timeline.style.width = `${((buttons.indexOf(button) + 1) / buttons.length) * 100}%`;
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

initializeScrollMotion();
initializeRevealScenes();
initializeMascotStage();

document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("page-hidden", document.hidden);
});
