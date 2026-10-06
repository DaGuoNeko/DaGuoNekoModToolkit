const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { fixture, removeFixture } = require("./fixtures.cjs");
const { atomicJson } = require("../electron/services.cjs");

(async () => {
  const f = await fixture();
  const profile = path.join(f.directory, "profile");
  await atomicJson(path.join(profile, "settings.json"), {
    FontFamilyName: "Microsoft Yi Baiti",
    AppearanceMode: "Light",
  });
  await fs.mkdir("test-results", { recursive: true });
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: [
        ...(process.env.MCNPC_TEST_EXE ? [] : ["."]),
        "--disable-features=CalculateNativeWinOcclusion",
      ],
      cwd: path.resolve("."),
      timeout: 60000,
      env: {
        ...process.env,
        MCNPC_DATA_DIR: profile,
        MCNPC_LOCAL_DATA: path.join(f.directory, "local"),
        MCNPC_ROAMING_DATA: path.join(f.directory, "roaming"),
        MCNPC_HEADLESS: "1",
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
    });
    async function screenshot(options) {
      if (!process.env.MCNPC_TEST_EXE) return page.screenshot(options);
      const image = await app.evaluate(async ({ BrowserWindow }) => {
        const bitmap =
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(
            undefined,
            { stayHidden: true, stayAwake: true },
          );
        return bitmap.toPNG().toString("base64");
      });
      await fs.writeFile(options.path, Buffer.from(image, "base64"));
    }
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ dialog }) => {
      globalThis.pickerQueue = [];
      dialog.showOpenDialog = async () => {
        if (!globalThis.pickerQueue.length)
          throw new Error("Unexpected native file dialog");
        const files = globalThis.pickerQueue.shift();
        return { canceled: files === null, filePaths: files || [] };
      };
    });
    const pick = (file) =>
      app.evaluate(
        (_, files) => {
          globalThis.pickerQueue.push(files);
        },
        file === null ? null : [file],
      );
    const nav = (name) =>
      page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
    await screenshot({ path: "test-results/electron-light-empty.png" });
    assert.match(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
      /Microsoft YaHei UI/,
    );
    await pick(f.texture);
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal.getByLabel("人物名称", { exact: true }).fill("森林守卫");
    await modal.getByLabel("作者", { exact: true }).fill("大果喵");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 森林守卫", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "编辑 森林守卫" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("人物名称", { exact: true })
      .fill("森林守卫 · 新版");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 森林守卫 · 新版", exact: true })
      .waitFor();
    await pick(f.directory);
    await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
    await page.getByRole("heading", { name: "拓展包已导出" }).waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    const skinZip = (await fs.readdir(f.directory)).find((x) =>
      /^s_.*\.zip$/.test(x),
    );
    assert.ok(skinZip);
    await pick(path.join(f.directory, skinZip));
    await page.getByRole("button", { name: "导入 ZIP", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByText("已导入", { exact: true }).waitFor();
    await nav("设置");
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.equal(
      await page.getByText("选择字体文件", { exact: true }).count(),
      0,
    );
    await nav("皮肤拓展");
    await page
      .getByRole("checkbox", { name: "选择 森林守卫 · 新版", exact: true })
      .waitFor();
    await screenshot({ path: "test-results/electron-dark-skins.png" });
    await nav("模型拓展");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal.getByLabel("显示名称 *", { exact: true }).fill("森林守卫");
    await modal
      .getByLabel("自定义名称 *", { exact: true })
      .fill("forest_guard");
    await pick(f.geo);
    await modal
      .getByRole("button", { name: "选择模型文件 *", exact: true })
      .click();
    await modal.getByRole("tab", { name: "贴图与皮肤", exact: true }).click();
    await pick(f.texture);
    await modal.getByRole("button", { name: "添加贴图", exact: true }).click();
    await modal.getByRole("tab", { name: "动画", exact: true }).click();
    await pick(f.animation);
    await modal.getByRole("button", { name: "添加文件", exact: true }).click();
    await modal.getByLabel("idle", { exact: true }).fill("animation.test.idle");
    await screenshot({ path: "test-results/electron-model-editor.png" });
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await page
      .getByText("customnpc:forest_guard_dlcnpc", { exact: true })
      .waitFor();
    await pick(f.directory);
    await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
    await page.getByRole("heading", { name: "拓展包已导出" }).waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    assert.ok(
      (await fs.readdir(f.directory)).some((x) => /^m_.*\.zip$/.test(x)),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 650),
    );
    await screenshot({ path: "test-results/electron-compact-models.png" });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no document-level horizontal overflow",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1240, 820),
    );
    for (const name of [
      "开发者工具箱",
      "MCStudio 项目",
      "存档全局配置",
      "3D 文字",
      "关于",
    ]) {
      await nav(name);
      await screenshot({ path: `test-results/page-${name}.png` });
    }
    await nav("设置");
    await screenshot({ path: "test-results/electron-settings.png" });
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await nav("皮肤拓展");
    await screenshot({ path: "test-results/electron-light-skins.png" });
    // Escape and native-picker cancellation leave the session intact.
    await pick(null);
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page
      .getByRole("button", { name: "预览 森林守卫 · 新版", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("checkbox", { name: "选择 森林守卫 · 新版", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS Electron UI: real backend add/edit/import/export, model resources, fixed font, themes, navigation, compact layout, modal cancellation",
    );
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      await page
        .screenshot({ path: "test-results/failure.png", timeout: 5000 })
        .catch(() => {});
      await fs.writeFile("test-results/failure.html", await page.content());
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
