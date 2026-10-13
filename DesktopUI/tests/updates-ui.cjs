const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const currentVersion = require("../package.json").version;
const [major, minor] = currentVersion.split(".").map(Number);
const newVersion = `${major}.${minor + 1}.0`;

(async () => {
  const f = await fixture();
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: process.env.MCNPC_TEST_EXE ? [] : ["."],
      cwd: path.resolve("."),
      env: {
        ...process.env,
        MCNPC_HEADLESS: "1",
        MCNPC_DATA_DIR: path.join(f.directory, "profile"),
      },
    });
    const page = await app.firstWindow();
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("bootstrap"))).version,
      currentVersion,
    );
    if (process.env.MCNPC_TEST_LIVE_UPDATE) {
      const live = await page.evaluate(() =>
        window.toolkit.call("updates.check"),
      );
      assert.ok(["current", "available", "unpublished"].includes(live.status));
      console.log(
        "LIVE update check:",
        JSON.stringify({
          status: live.status,
          currentVersion: live.currentVersion,
          latestVersion: live.latestVersion,
          hasWindowsPackage: !!live.downloadUrl,
        }),
      );
    }
    await app.evaluate(
      ({ shell }, { currentVersion, newVersion }) => {
        const fetch = globalThis.fetch;
        globalThis.updateMode = "new";
        globalThis.updateRequests = 0;
        globalThis.openedUpdateUrls = [];
        globalThis.failUpdateBrowser = false;
        shell.openExternal = async (url) => {
          if (globalThis.failUpdateBrowser)
            throw new Error("test browser failure");
          globalThis.openedUpdateUrls.push(url);
        };
        globalThis.fetch = async (url, options) => {
          if (
            url !==
            "https://api.github.com/repos/DaGuoNeko/DaGuoNekoModToolkit/releases/latest"
          )
            return fetch(url, options);
          globalThis.updateRequests++;
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (globalThis.updateMode === "offline")
            throw new Error("test offline");
          if (globalThis.updateMode === "unpublished")
            return new Response("{}", { status: 404 });
          if (globalThis.updateMode === "limited")
            return new Response("{}", { status: 403 });
          const tag = `v${globalThis.updateMode === "current" ? currentVersion : newVersion}`;
          return new Response(
            JSON.stringify({
              tag_name: tag,
              name: `工具箱 ${tag}`,
              draft: false,
              prerelease: false,
              body: "修复中文名称\n<script>window.untrustedUpdate = true</script>",
              published_at: "2026-10-13T08:00:00Z",
              assets:
                globalThis.updateMode === "no-asset"
                  ? []
                  : [
                      {
                        name: "DaGuoNeko-Mod-Toolkit-win-x64.zip",
                        state: "uploaded",
                        browser_download_url: `https://github.com/DaGuoNeko/DaGuoNekoModToolkit/releases/download/${tag}/DaGuoNeko-Mod-Toolkit-win-x64.zip`,
                      },
                    ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        };
      },
      { currentVersion, newVersion },
    );
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "关于", exact: true })
      .click();
    const check = page.getByRole("button", { name: "检查更新", exact: true });
    await check.click();
    await page
      .getByRole("button", { name: "正在检查…", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "正在检查…", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("status")
      .filter({ hasText: `发现新版本 ${newVersion}` })
      .waitFor();
    assert.equal(await app.evaluate(() => globalThis.updateRequests), 1);
    assert.equal(await page.evaluate(() => window.untrustedUpdate), undefined);
    assert.match(await page.locator(".update-notes").innerText(), /<script>/);
    const download = page.getByRole("button", {
      name: "下载 Windows 新版",
      exact: true,
    });
    await download.click();
    await page
      .getByRole("button", { name: "打开发布页面", exact: true })
      .click();
    assert.deepEqual(await app.evaluate(() => globalThis.openedUpdateUrls), [
      `https://github.com/DaGuoNeko/DaGuoNekoModToolkit/releases/download/v${newVersion}/DaGuoNeko-Mod-Toolkit-win-x64.zip`,
      "https://github.com/DaGuoNeko/DaGuoNekoModToolkit/releases",
    ]);
    await app.evaluate(() => {
      globalThis.failUpdateBrowser = true;
    });
    await download.click();
    await page
      .getByRole("alert")
      .filter({ hasText: "无法打开浏览器" })
      .waitFor();
    await app.evaluate(() => {
      globalThis.failUpdateBrowser = false;
    });
    for (const [mode, expected] of [
      ["offline", "无法连接 GitHub"],
      ["limited", "访问次数受限"],
      ["unpublished", "尚未找到正式发布版本"],
      ["current", "当前版本无需更新"],
      ["no-asset", `发现新版本 ${newVersion}`],
      ["new", `发现新版本 ${newVersion}`],
    ]) {
      await app.evaluate((_, mode) => {
        globalThis.updateMode = mode;
      }, mode);
      await check.click();
      await page.getByText(expected, { exact: false }).waitFor();
      await check.waitFor();
      assert.equal(await download.count(), mode === "new" ? 1 : 0);
      if (!["offline", "limited"].includes(mode))
        assert.equal(await page.getByRole("alert").count(), 0);
    }
    const rejection = await page.evaluate(async () => {
      try {
        await window.toolkit.call("web.open", {
          kind: "arbitrary-update",
          url: "file:///C:/example.exe",
        });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(rejection, true);
    console.log(
      "PASS update button, loading state, version results, safe notes, download/release URLs, error/retry and browser failure",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
