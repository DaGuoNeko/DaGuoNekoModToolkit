const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");

(async () => {
  const f = await fixture();
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: process.env.MCNPC_TEST_EXE ? [] : ["."],
      env: {
        ...process.env,
        MCNPC_HEADLESS: "1",
        MCNPC_DATA_DIR: path.join(f.directory, "profile"),
        MCNPC_LOCAL_DATA: path.join(f.directory, "local"),
        MCNPC_ROAMING_DATA: path.join(f.directory, "roaming"),
      },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await page.evaluate(
      (file) =>
        window.toolkit.call("skins.add", {
          items: [{ path: file, name: "切页保留", author: "测试" }],
        }),
      f.texture,
    );
    await page.reload();
    await page
      .getByRole("button", { name: "查看 切页保留", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      ),
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      window.transitionCalls = 0;
      document.startViewTransition = (update) => {
        window.transitionCalls++;
        return (window.latestPageTransition = start(update));
      };
    });
    const nav = (name) =>
      page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
    const finish = () =>
      page.evaluate(() => window.latestPageTransition?.finished);
    await nav("NPC模型拓展");
    await page.evaluate(() => window.latestPageTransition.ready);
    const forward = await page.evaluate(() => ({
      direction: document.documentElement.dataset.pageDirection,
      animations: document
        .getAnimations()
        .map((a) => a.animationName)
        .filter((name) => name?.startsWith("page-")),
    }));
    assert.equal(forward.direction, "forward");
    assert.deepEqual(forward.animations.sort(), ["page-in-up", "page-out-up"]);
    await finish();
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.locator(".window-background").count(), 0);
    await nav("关于");
    await finish();
    await nav("NPC皮肤拓展");
    await page.evaluate(() =>
      window.latestPageTransition.ready.then(() => {
        window.slideAnimations = document
          .getAnimations()
          .filter((a) => a.animationName?.startsWith("page-"));
        for (const animation of window.slideAnimations) {
          animation.pause();
          animation.currentTime = 100;
        }
      }),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.pageDirection),
      "backward",
    );
    assert.deepEqual(
      (
        await page.evaluate(() =>
          window.slideAnimations.map((a) => a.animationName),
        )
      ).sort(),
      ["page-in-down", "page-out-down"],
    );
    await fs.mkdir("test-results", { recursive: true });
    const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    await fs.writeFile(
      "test-results/page-transition.png",
      Buffer.from(screenshot, "base64"),
    );
    await page.evaluate(() =>
      window.slideAnimations.forEach((animation) => animation.play()),
    );
    await finish();
    await page
      .getByRole("button", { name: "查看 切页保留", exact: true })
      .waitFor();
    await page.getByPlaceholder("搜索名称…").fill("切页保留");
    const calls = await page.evaluate(() => window.transitionCalls);
    await nav("NPC皮肤拓展");
    assert.equal(await page.evaluate(() => window.transitionCalls), calls);
    assert.equal(
      await page.getByPlaceholder("搜索名称…").inputValue(),
      "切页保留",
    );
    // Multiple clicks in one frame must not commit callbacks from skipped transitions.
    await page.evaluate(() => {
      for (const name of [
        "NPC模型拓展",
        "贴图拓展",
        "设置",
        "关于",
        "音效拓展",
      ])
        Array.from(document.querySelectorAll(".sidebar button"))
          .find((button) => button.title === name)
          .click();
    });
    await page
      .getByRole("heading", { name: "音效拓展", exact: true })
      .waitFor();
    await finish();
    assert.equal(
      await page.locator(".breadcrumb strong").textContent(),
      "音效拓展",
    );
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.hasAttribute("data-page-animating"),
      ),
      false,
    );
    assert.equal(await page.locator("main").count(), 1);
    await nav("设置");
    await finish();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await nav("关于");
    await finish();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const beforeReduced = await page.evaluate(() => window.transitionCalls);
    await nav("NPC皮肤拓展");
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.transitionCalls),
      beforeReduced,
    );
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).skins.length,
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS ordered up/down page transitions, actual snapshot animations, rapid navigation, same-page no-op, state retention, dark theme and reduced motion",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
