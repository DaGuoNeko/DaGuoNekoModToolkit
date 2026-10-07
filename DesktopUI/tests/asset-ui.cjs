const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

(async () => {
  const f = await fixture();
  f.sound = path.join(f.directory, "提示音.ogg");
  await fs.writeFile(f.sound, ogg());
  await fs.mkdir("test-results", { recursive: true });
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: process.env.MCNPC_TEST_EXE ? [] : ["."],
      cwd: path.resolve("."),
      timeout: 60000,
      env: {
        ...process.env,
        MCNPC_HEADLESS: "1",
        MCNPC_DATA_DIR: path.join(f.directory, "profile"),
      },
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow, dialog }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      globalThis.files = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: globalThis.files.shift() || [],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: globalThis.files.shift()?.[0],
      });
    });
    const pick = (paths) =>
      app.evaluate((_, value) => globalThis.files.push(value), paths);
    const nav = (label) =>
      page
        .locator(".sidebar")
        .getByRole("button", { name: label, exact: true })
        .click();
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    const exports = {};
    for (const [kind, label, file, name] of [
      ["textures", "贴图", f.invalid, "星星"],
      ["sounds", "音效", f.sound, "提示音"],
    ]) {
      await nav(`${label}拓展`);
      await pick([file, file]);
      await page
        .getByRole("button", { name: `添加${label} / 批量添加`, exact: true })
        .click();
      let modal = page.getByRole("dialog");
      await modal.getByLabel("资源名称 1", { exact: true }).fill(name);
      await modal.getByLabel("资源名称 2", { exact: true }).fill(name + "备用");
      await modal.getByRole("button", { name: "添加", exact: true }).click();
      await page
        .getByRole("checkbox", { name: `选择 ${name}`, exact: true })
        .waitFor();
      let state = await page.evaluate(() => window.toolkit.call("state"));
      assert.equal(state[kind].length, 2);
      await page
        .getByRole("button", { name: "拓展包设置", exact: true })
        .click();
      modal = page.getByRole("dialog");
      await modal
        .getByLabel("拓展包名称", { exact: true })
        .fill(`测试${label}包`);
      await modal.getByLabel("包版本", { exact: true }).fill("1.2.0");
      await modal.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .locator(".list-meta")
        .getByText(`测试${label}包 · 2 项`, { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: `编辑 ${name}`, exact: true })
        .click();
      modal = page.getByRole("dialog");
      await modal.getByLabel("资源名称", { exact: true }).fill(name + "新版");
      await modal.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .getByRole("checkbox", { name: `选择 ${name}新版`, exact: true })
        .waitFor();
      await page
        .getByRole("button", {
          name: `${kind === "textures" ? "预览" : "试听"} ${name}新版`,
          exact: true,
        })
        .click();
      modal = page.getByRole("dialog");
      if (kind === "textures") await modal.locator("img").waitFor();
      else {
        await modal.locator("audio").waitFor();
        await page.waitForFunction(
          () => {
            const audio = document.querySelector("audio");
            if (audio?.error)
              throw Error(`audio decode failed: ${audio.error.message}`);
            return audio?.readyState >= 2;
          },
          null,
          { timeout: 15000 },
        );
      }
      await page.keyboard.press("Escape");
      await pick([f.directory]);
      await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
      const exportedModal = page.getByRole("dialog");
      await exportedModal
        .getByRole("heading", { name: "拓展包已导出", exact: true })
        .waitFor();
      state = await page.evaluate(() => window.toolkit.call("state"));
      exports[kind] = (await fs.readdir(f.directory)).find(
        (file) =>
          file.startsWith(
            state[kind === "textures" ? "texturePack" : "soundPack"].ProviderId,
          ) && file.endsWith(".zip"),
      );
      assert.ok(exports[kind]);
      await exportedModal
        .getByRole("button", { name: "完成", exact: true })
        .click();
      await page
        .getByRole("button", { name: `删除 ${name}备用`, exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: `选择 ${name}备用`, exact: true })
        .waitFor({ state: "hidden" });
      await pick([path.join(f.directory, exports[kind])]);
      await page.getByRole("button", { name: "导入 ZIP", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: `选择 ${name}备用`, exact: true })
        .waitFor();
      await page.screenshot({ path: `test-results/asset-${kind}.png` });
    }
    const project = path.join(f.directory, "ui.dgnproject");
    await pick([project]);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "工程已保存" }).waitFor();
    await pick([project]);
    await page.getByRole("button", { name: "打开工程", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "工程已恢复" }).waitFor();
    const restored = await page.evaluate(() => window.toolkit.call("state"));
    assert.equal(restored.textures.length, 2);
    assert.equal(restored.sounds.length, 2);
    assert.deepEqual(errors, []);
    console.log(
      "PASS real Electron resource UI: batch add/edit, pack settings, PNG preview, Vorbis decode, ZIP roundtrip, project reopen",
    );
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      await page
        .screenshot({ path: "test-results/asset-failure.png" })
        .catch(() => {});
      await fs.writeFile(
        "test-results/asset-failure.html",
        await page.content(),
      );
    }
    throw error;
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
