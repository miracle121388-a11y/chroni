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
