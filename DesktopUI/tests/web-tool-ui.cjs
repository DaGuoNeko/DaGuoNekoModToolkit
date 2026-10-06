const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");

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
      .getByRole("heading", { name: "皮肤拓展", exact: true })
      .waitFor();
    const sidebar = page.locator(".sidebar");
    const tools = ["3D 文字", "开发者工具箱", "MCStudio 项目", "存档全局配置"];
    async function expectTools(visible) {
      for (const name of tools)
        await sidebar
          .getByRole("button", { name, exact: true })
          .waitFor({ state: visible ? "visible" : "hidden" });
      assert.equal(
        await sidebar.getByText("工具", { exact: true }).count(),
        visible ? 1 : 0,
      );
    }
    async function toggleTools() {
      await sidebar.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("switch", { name: "显示模组开发者工具" }).click();
    }
    await expectTools(false);
    await toggleTools();
    await expectTools(true);
    await page.reload();
    await page
      .getByRole("heading", { name: "皮肤拓展", exact: true })
      .waitFor();
    await expectTools(true);
    await toggleTools();
    await expectTools(false);
    await page.reload();
    await page
      .getByRole("heading", { name: "皮肤拓展", exact: true })
      .waitFor();
    await expectTools(false);
    await toggleTools();
    await expectTools(true);
    await app.evaluate(({ shell }) => {
      globalThis.openedExternal = [];
      globalThis.failExternal = false;
      shell.openExternal = async (url) => {
        globalThis.openedExternal.push(url);
        if (globalThis.failExternal)
          throw new Error("test browser launch failure");
      };
    });
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "3D 文字", exact: true })
      .click();
    const open = page.getByRole("button", {
      name: "在浏览器中打开",
      exact: true,
    });
    await open.click();
    await open.waitFor();
    assert.deepEqual(await app.evaluate(() => globalThis.openedExternal), [
      "https://3dtext.easecation.net/",
    ]);
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
      "no internal web window",
    );
    await app.evaluate(() => {
      globalThis.failExternal = true;
    });
    await open.click();
    await page
      .getByRole("alert")
      .getByText(/无法启动系统浏览器/)
      .waitFor();
    await app.evaluate(() => {
      globalThis.failExternal = false;
    });
    await open.click();
    await open.waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    const rejected = await page.evaluate(async () => {
      try {
        await window.toolkit.call("web.open", {
          kind: "arbitrary",
          url: "file:///C:/example.exe",
        });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(rejected, true);
    assert.ok(
      (await app.evaluate(() => globalThis.openedExternal)).every(
        (url) => url === "https://3dtext.easecation.net/",
      ),
    );
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      1,
    );
    console.log(
      "PASS developer tools default hidden, toggle and reload persistence; system-browser dispatch, fixed URL, error/retry UI",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
