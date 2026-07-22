const RELEASE_API = "https://api.github.com/repos/miracle121388-a11y/chroni/releases/latest";
const RELEASE_FALLBACK = "https://github.com/miracle121388-a11y/chroni/releases/latest";

const downloadTargets = {
  windowsSetup: {
    link: document.querySelector("#windows-setup"),
    meta: document.querySelector("#windows-setup-meta"),
    matches: (name) => /win-x64-setup\.exe$/i.test(name),
  },
  windowsPortable: {
    link: document.querySelector("#windows-portable"),
    meta: document.querySelector("#windows-portable-meta"),
    matches: (name) => /win-x64-portable\.exe$/i.test(name),
  },
  macos: {
    link: document.querySelector("#macos-dmg"),
    meta: document.querySelector("#macos-dmg-meta"),
    matches: (name) => /mac-universal\.dmg$/i.test(name),
  },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function detectPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  return "other";
}

function setDetectedPlatform(platform) {
  const primary = document.querySelector("#primary-download");
  const final = document.querySelector("#final-download");
  const target = platform === "macos" ? downloadTargets.macos : downloadTargets.windowsSetup;
  const label = platform === "macos" ? "下载 macOS 版" : platform === "windows" ? "下载 Windows 版" : "获取最新版";

  if (primary) primary.textContent = label;
  if (final) final.textContent = label;

  if (platform !== "other") {
    target.link?.closest(".download-card")?.classList.add("is-detected");
  }

  return { final, primary, target };
}

async function loadLatestRelease() {
  const platform = detectPlatform();
  const detected = setDetectedPlatform(platform);
  const status = document.querySelector("#release-status");
  const version = document.querySelector("#release-version");

  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];

    for (const target of Object.values(downloadTargets)) {
      const asset = assets.find((candidate) => target.matches(candidate.name));
      if (!asset) continue;
      target.link.href = asset.browser_download_url;
      target.meta.textContent = `${release.tag_name} · ${formatBytes(asset.size)}`;
    }

    const recommendedHref = detected.target.link?.href || RELEASE_FALLBACK;
    if (detected.primary) detected.primary.href = recommendedHref;
    if (detected.final) detected.final.href = recommendedHref;
    if (version) version.textContent = `${release.tag_name} 最新版`;
    if (status) status.textContent = `${release.tag_name} 已发布，官网已为你匹配可直接运行的安装包。`;
  } catch (error) {
    if (detected.primary) detected.primary.href = RELEASE_FALLBACK;
    if (detected.final) detected.final.href = RELEASE_FALLBACK;
    if (version) version.textContent = "前往最新版";
    if (status) status.textContent = "暂时无法读取版本信息，下载按钮将打开最新版发布页。";
    console.warn("Unable to load the latest Chroni release", error);
  }
}

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
loadLatestRelease();
