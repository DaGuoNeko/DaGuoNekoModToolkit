const REPOSITORY_URL = "https://github.com/DaGuoNeko/DaGuoNekoModToolkit";
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const LATEST_RELEASE_API =
  "https://api.github.com/repos/DaGuoNeko/DaGuoNekoModToolkit/releases/latest";
const WINDOWS_ASSET_NAME = "DaGuoNeko-Mod-Toolkit-win-x64.zip";

function parseVersion(value) {
  const match =
    typeof value === "string" &&
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      value,
    );
  if (!match) throw new Error("版本号格式无法识别，请到发布页面查看更新。");
  const numbers = match.slice(1, 4).map(Number);
  if (
    numbers.some((number) => !Number.isSafeInteger(number)) ||
    [match[4], match[5]].some(
      (suffix) => suffix && suffix.split(".").some((part) => !part),
    ) ||
    (match[4] && match[4].split(".").some((part) => /^0\d+$/.test(part)))
  )
    throw new Error("版本号格式无法识别，请到发布页面查看更新。");
  return { numbers, prerelease: match[4] || "" };
}

// Only stable releases are offered; an equal stable version upgrades its prerelease.
function hasNewerStableVersion(latest, current) {
  const release = parseVersion(latest),
    installed = parseVersion(current);
  if (release.prerelease)
    throw new Error("发布记录不是正式版，请到发布页面查看更新。");
  for (let i = 0; i < release.numbers.length; i++) {
    if (release.numbers[i] !== installed.numbers[i])
      return release.numbers[i] > installed.numbers[i];
  }
  return !!installed.prerelease;
}

function releaseResult(data, currentVersion) {
  if (
    !data ||
    typeof data !== "object" ||
    data.draft !== false ||
    data.prerelease !== false ||
    typeof data.tag_name !== "string"
  )
    throw new Error("GitHub 发布记录无效，请稍后重试或打开发布页面。");
  const available = hasNewerStableVersion(data.tag_name, currentVersion);
  const releaseUrl = `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(data.tag_name)}`;
  const expectedDownload = `${REPOSITORY_URL}/releases/download/${encodeURIComponent(data.tag_name)}/${WINDOWS_ASSET_NAME}`;
  const asset =
    Array.isArray(data.assets) &&
    data.assets.find(
      (item) =>
        item &&
        item.name === WINDOWS_ASSET_NAME &&
        item.state === "uploaded" &&
        item.browser_download_url === expectedDownload,
    );
  return {
    status: available ? "available" : "current",
    currentVersion,
    latestVersion: data.tag_name.replace(/^v/, ""),
    title:
      typeof data.name === "string" && data.name ? data.name : data.tag_name,
    notes: typeof data.body === "string" ? data.body : "",
    publishedAt:
      typeof data.published_at === "string" &&
      Number.isFinite(Date.parse(data.published_at))
        ? data.published_at
        : null,
    releaseUrl,
    downloadUrl: asset ? expectedDownload : null,
  };
}

class UpdateChecker {
  constructor(currentVersion, fetchRelease, timeoutMs = 15000) {
    this.currentVersion = currentVersion;
    this.fetchRelease = fetchRelease;
    this.timeoutMs = timeoutMs;
    this.pending = null;
    this.controller = null;
    this.lastResult = null;
  }

  // Share in-flight work across page switches and repeated IPC calls.
  check() {
    if (!this.pending) {
      this.lastResult = null;
      this.pending = this.request()
        .then((result) => {
          this.lastResult = result;
          return result;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }

  async request() {
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response;
      try {
        response = await this.fetchRelease(LATEST_RELEASE_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `DaGuoNekoModToolkit/${this.currentVersion}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error("无法连接 GitHub，请检查网络后重试，或打开发布页面。", {
          cause: error,
        });
      }
      if (response.status === 404) {
        return { status: "unpublished", currentVersion: this.currentVersion };
      }
      if (response.status === 403 || response.status === 429)
        throw new Error(
          "GitHub 暂时拒绝请求或访问次数受限，请稍后重试，或打开发布页面。",
        );
      if (!response.ok)
        throw new Error(
          `检查更新失败（HTTP ${response.status}），请稍后重试，或打开发布页面。`,
        );
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error("GitHub 返回的发布信息无法读取，请稍后重试。", {
          cause: error,
        });
      }
      return releaseResult(data, this.currentVersion);
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error("检查更新超时，请检查网络后重试，或打开发布页面。", {
          cause: error,
        });
      throw error;
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
  }

  // URLs are approved from our fixed release source, never from renderer input.
  downloadUrl() {
    if (this.lastResult?.status !== "available" || !this.lastResult.downloadUrl)
      throw new Error("请先检查更新；若没有 Windows 下载包，请打开发布页面。");
    return this.lastResult.downloadUrl;
  }

  close() {
    this.controller?.abort();
  }
}

module.exports = {
  REPOSITORY_URL,
  RELEASES_URL,
  LATEST_RELEASE_API,
  WINDOWS_ASSET_NAME,
  hasNewerStableVersion,
  releaseResult,
  UpdateChecker,
};
