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
          items: [{ path: file, name: "退出测试", author: "测试作者" }],
        }),
      f.texture,
    );
    await page.reload();
    await page
      .getByRole("button", { name: "编辑 退出测试", exact: true })
      .waitFor();
    await app.evaluate(({ dialog, BrowserWindow }) => {
      // Enable the production confirmation path while keeping the test window hidden.
      delete process.env.MCNPC_HEADLESS;
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      globalThis.nativePrompts = 0;
      dialog.showMessageBox = async () => {
        globalThis.nativePrompts++;
        throw Error("Unexpected native prompt");
      };
    });
    const prompt = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "关闭工具箱", exact: true }),
    });
    for (const mode of ["Light", "Dark"]) {
      await page.evaluate(
        (AppearanceMode) =>
          window.toolkit.call("settings.update", { AppearanceMode }),
        mode,
      );
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        mode.toLowerCase(),
      );
      await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
      await prompt.waitFor();
      assert.equal(
        await prompt
          .getByRole("button", { name: "继续编辑", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.close();
        win.close();
      });
      assert.equal(await page.locator("dialog").count(), 1);
      await fs.mkdir("test-results", { recursive: true });
      await page.screenshot({
        path: `test-results/close-${mode.toLowerCase()}.png`,
      });
      if (mode === "Light") await page.keyboard.press("Escape");
      else
        await prompt
          .getByRole("button", { name: "继续编辑", exact: true })
          .click();
      await prompt.waitFor({ state: "hidden" });
      assert.equal(
        (await page.evaluate(() => window.toolkit.call("state"))).skins.length,
        1,
      );
    }
    // Native close requests while an editor is open must preserve its unsaved draft.
    await page
      .getByRole("button", { name: "编辑 退出测试", exact: true })
      .click();
    await page.getByLabel("人物名称", { exact: true }).fill("未保存草稿");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await prompt.waitFor();
    await prompt.getByRole("button", { name: "继续编辑", exact: true }).click();
    await prompt.waitFor({ state: "hidden" });
    assert.equal(
      await page.getByLabel("人物名称", { exact: true }).inputValue(),
      "未保存草稿",
    );
    await page.keyboard.press("Escape");
    // A canceled application quit must not shut down the C# backend.
    await app.evaluate(({ app }) => app.quit());
    await prompt.waitFor();
    await prompt.getByRole("button", { name: "继续编辑", exact: true }).click();
    await prompt.waitFor({ state: "hidden" });
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).skins.length,
      1,
    );
    // Hold one real IPC request to exercise the running-task branch deterministically.
    await app.evaluate(({ app }) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const { Backend } = load("./electron/backend.cjs");
      const original = Backend.prototype.call;
      Backend.prototype.call = function (method, args) {
        if (method === "state") {
          Backend.prototype.call = original;
          return new Promise((resolve) => {
            globalThis.releaseState = () =>
              resolve(original.call(this, method, args));
          });
        }
        return original.call(this, method, args);
      };
    });
    await page.evaluate(() => {
      window.pendingState = window.toolkit.call("state");
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await prompt
      .getByText("任务仍在运行，退出会中断当前操作。", { exact: true })
      .waitFor();
    await prompt.getByRole("button", { name: "继续编辑", exact: true }).click();
    await app.evaluate(() => globalThis.releaseState());
    assert.equal(
      (await page.evaluate(() => window.pendingState)).skins.length,
      1,
    );
    assert.equal(await app.evaluate(() => globalThis.nativePrompts), 0);
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await prompt.waitFor();
    await Promise.all([
      app.waitForEvent("close"),
      prompt
        .getByRole("button", { name: "退出", exact: true })
        .click()
        .catch((error) => {
          // Successful exit may destroy the renderer before Playwright receives the click reply.
          if (!page.isClosed() || !/has been closed/.test(error.message))
            throw error;
        }),
    ]);
    app = null;
    console.log(
      "PASS themed close dialog, safe default, Escape/cancel, repeated/native closes, draft retention, canceled quit, busy task and confirmed exit",
    );
  } finally {
    if (app) {
      await app
        .evaluate(() => {
          process.env.MCNPC_HEADLESS = "1";
        })
        .catch(() => {});
      await app.close();
    }
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
