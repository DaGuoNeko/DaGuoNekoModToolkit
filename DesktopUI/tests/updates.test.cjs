const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  REPOSITORY_URL,
  LATEST_RELEASE_API,
  WINDOWS_ASSET_NAME,
  hasNewerStableVersion,
  releaseResult,
  UpdateChecker,
} = require("../electron/updates.cjs");

function release(tag = "v3.1.0") {
  return {
    tag_name: tag,
    name: `正式版 ${tag}`,
    draft: false,
    prerelease: false,
    body: "改进模型导出\n修复中文名称",
    published_at: "2026-10-13T08:00:00Z",
    assets: [
      {
        name: WINDOWS_ASSET_NAME,
        state: "uploaded",
        browser_download_url: `${REPOSITORY_URL}/releases/download/${tag}/${WINDOWS_ASSET_NAME}`,
      },
    ],
  };
}
const response = (data, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});

test("stable version comparisons use numeric components and handle prerelease/build metadata", () => {
  assert.equal(hasNewerStableVersion("v3.10.0", "3.9.9"), true);
  assert.equal(hasNewerStableVersion("v4.0.0", "3.99.99"), true);
  assert.equal(hasNewerStableVersion("v3.0.1", "3.0.0"), true);
  assert.equal(hasNewerStableVersion("v3.0.0", "3.0.0"), false);
  assert.equal(hasNewerStableVersion("v3.0.0", "3.0.0-beta.2"), true);
  assert.equal(hasNewerStableVersion("v3.0.0+build.1", "3.0.0+build.2"), false);
  assert.equal(hasNewerStableVersion("v3.0.0", "3.1.0"), false);
  for (const invalid of [
    "latest",
    "v3.01.0",
    "3.0",
    "3.0.0-",
    "3.0.0-rc..1",
    "3.0.0-01",
    "3.0.0+",
    "3.0.0+.1",
  ])
    assert.throws(() => hasNewerStableVersion(invalid, "3.0.0"));
  assert.throws(
    () => hasNewerStableVersion("v3.1.0-beta.1", "3.0.0"),
    /不是正式版/,
  );
});

test("release results retain Unicode notes and select only our exact uploaded Windows package", () => {
  const data = release();
  data.assets.unshift({
    name: "BB_Test_Robot_Samples.zip",
    state: "uploaded",
    browser_download_url: "https://example.com/samples.zip",
  });
  const result = releaseResult(data, "3.0.0");
  assert.equal(result.status, "available");
  assert.equal(result.latestVersion, "3.1.0");
  assert.equal(result.notes, data.body);
  assert.equal(result.downloadUrl, data.assets[1].browser_download_url);
  assert.equal(releaseResult(release("v3.0.0"), "3.0.0").status, "current");
  for (const url of [
    "file:///C:/example.exe",
    "https://example.com/download.zip",
    `${REPOSITORY_URL}.example.com/releases/download/v3.1.0/${WINDOWS_ASSET_NAME}`,
  ]) {
    data.assets[1].browser_download_url = url;
    assert.equal(releaseResult(data, "3.0.0").downloadUrl, null);
  }
  data.assets = [];
  data.published_at = "invalid";
  assert.equal(releaseResult(data, "3.0.0").downloadUrl, null);
  assert.equal(releaseResult(data, "3.0.0").publishedAt, null);
  for (const patch of [
    { draft: true },
    { prerelease: true },
    { tag_name: null },
  ])
    assert.throws(() => releaseResult({ ...data, ...patch }, "3.0.0"));
});

test("concurrent checks share a request, then recheck instead of caching an old release", async () => {
  let complete,
    calls = 0;
  const checker = new UpdateChecker("3.0.0", async (url, options) => {
    assert.equal(url, LATEST_RELEASE_API);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers["User-Agent"], "DaGuoNekoModToolkit/3.0.0");
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  assert.throws(() => checker.downloadUrl(), /请先检查更新/);
  const first = checker.check(),
    second = checker.check();
  assert.equal(first, second);
  assert.equal(calls, 1);
  complete(response(release()));
  assert.equal((await first).status, "available");
  assert.match(checker.downloadUrl(), /v3\.1\.0/);
  const third = checker.check();
  assert.equal(calls, 2);
  assert.throws(() => checker.downloadUrl());
  complete(response(release("v3.0.0")));
  assert.equal((await third).status, "current");
  assert.throws(() => checker.downloadUrl());
});

test("no published release is distinct from network, rate-limit and server failures", async () => {
  const unpublished = new UpdateChecker("3.0.0", async () =>
    response(null, 404),
  );
  assert.equal((await unpublished.check()).status, "unpublished");
  for (const status of [403, 429, 500]) {
    const checker = new UpdateChecker("3.0.0", async () =>
      response(null, status),
    );
    await assert.rejects(
      checker.check(),
      status === 500 ? /HTTP 500/ : /访问次数受限/,
    );
    assert.throws(() => checker.downloadUrl());
  }
  const offline = new UpdateChecker("3.0.0", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(offline.check(), /无法连接 GitHub/);
});

test("timeouts abort requests and failed checks can be retried", async () => {
  let calls = 0,
    aborted = false;
  const checker = new UpdateChecker(
    "3.0.0",
    async (_, { signal }) => {
      if (++calls > 1) return response(release());
      return new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Aborted"));
          },
          { once: true },
        ),
      );
    },
    10,
  );
  await assert.rejects(checker.check(), /超时/);
  assert.equal(aborted, true);
  assert.equal((await checker.check()).status, "available");
});

test("invalid JSON and malformed release metadata report failures without a stale download", async () => {
  const invalidJson = new UpdateChecker("3.0.0", async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("bad JSON");
    },
  }));
  await assert.rejects(invalidJson.check(), /无法读取/);
  const invalidRelease = new UpdateChecker("3.0.0", async () =>
    response({ html_url: "https://example.com" }),
  );
  await assert.rejects(invalidRelease.check(), /发布记录无效/);
  assert.throws(() => invalidRelease.downloadUrl());
});

test("application shutdown cancels a pending check", async () => {
  const checker = new UpdateChecker(
    "3.0.0",
    async (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Aborted")), {
          once: true,
        }),
      ),
  );
  const pending = checker.check();
  checker.close();
  await assert.rejects(pending);
  assert.equal(checker.controller, null);
});
