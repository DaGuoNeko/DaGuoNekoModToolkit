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
    ShowModDeveloperTools: true,
  });
  await fs.mkdir("test-results", { recursive: true });
  let app;
  let originalClipboard;
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
    originalClipboard = await app.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
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
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ dialog }) => {
      globalThis.pickerQueue = [];
      dialog.showOpenDialog = async () => {
        if (!globalThis.pickerQueue.length)
          throw new Error("Unexpected native file dialog");
        const files = globalThis.pickerQueue.shift();
        return { canceled: files === null, filePaths: files || [] };
      };
      dialog.showSaveDialog = async () => {
        if (!globalThis.pickerQueue.length)
          throw new Error("Unexpected save dialog");
        const files = globalThis.pickerQueue.shift();
        return { canceled: files === null, filePath: files?.[0] };
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
    const actualId = await page
      .locator(".skin-id-cell span")
      .first()
      .textContent();
    assert.match(actualId, /^skin_[0-9A-F]{5}$/);
    await page
      .getByRole("button", { name: `复制 ${actualId}`, exact: true })
      .click();
    assert.equal(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      actualId,
    );
    const search = page.getByPlaceholder("搜索名称…");
    await search.fill(actualId);
    assert.equal(await page.locator("tbody tr").count(), 1);
    await search.fill("");
    await page
      .getByRole("button", { name: "预览 森林守卫", exact: true })
      .click();
    await page.locator(".skin-3d-host[data-ready='true']").waitFor();
    assert.ok(
      await page.evaluate(() => {
        const source = document.querySelector(".skin-3d-host canvas");
        const probe = document.createElement("canvas");
        probe.width = source.width;
        probe.height = source.height;
        const context = probe.getContext("2d");
        context.drawImage(source, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          probe.width,
          probe.height,
        ).data;
        return pixels.some((value, i) => i % 4 === 3 && value > 0);
      }),
      "3D preview contains rendered model pixels",
    );
    await screenshot({ path: "test-results/skin-3d-preview.png" });
    await page
      .getByRole("combobox", { name: "预览手臂模型", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Alex（细手臂）", exact: true })
      .click();
    await page.locator(".skin-3d-host[data-ready='true']").waitFor();
    const canvas = page.getByLabel("皮肤 3D 预览", { exact: true });
    const bounds = await canvas.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 50,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await page.getByRole("tab", { name: "原始贴图", exact: true }).click();
    await page.getByAltText("森林守卫", { exact: true }).waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
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
    await pick(f.invalid);
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("combobox", { name: "目标模型", exact: true })
      .click();
    await modal
      .getByRole("option")
      .filter({ hasText: "customnpc:wolf_dlcnpc" })
      .click();
    await modal.getByLabel("人物名称", { exact: true }).fill("狼拓展皮肤");
    await modal.getByLabel("作者", { exact: true }).fill("测试");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 狼拓展皮肤", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "预览 狼拓展皮肤", exact: true })
      .click();
    assert.equal(await page.locator(".skin-3d-host").count(), 0);
    await page.getByAltText("狼拓展皮肤", { exact: true }).waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await pick(f.invalid);
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("combobox", { name: "目标模型", exact: true })
      .click();
    await modal
      .getByRole("option", { name: "填写自定义模型 ID…", exact: true })
      .click();
    await modal
      .getByLabel("自定义模型 ID", { exact: true })
      .fill("customnpc:my_boss_dlcnpc");
    await modal.getByLabel("人物名称", { exact: true }).fill("自定义模型皮肤");
    await modal.getByLabel("作者", { exact: true }).fill("测试");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 自定义模型皮肤", exact: true })
      .waitFor();
    await nav("设置");
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.equal(
      await page.getByText("选择字体文件", { exact: true }).count(),
      0,
    );
    await nav("NPC皮肤拓展");
    await page
      .getByRole("checkbox", { name: "选择 森林守卫 · 新版", exact: true })
      .waitFor();
    await screenshot({ path: "test-results/electron-dark-skins.png" });
    await nav("NPC模型拓展");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal.getByLabel("显示名称 *", { exact: true }).fill("森林守卫");
    await modal
      .getByLabel("自定义模型 ID *", { exact: true })
      .fill("forest_guard");
    await pick(f.geo);
    await modal
      .getByRole("button", { name: "选择模型文件 *", exact: true })
      .click();
    await modal.getByRole("tab", { name: "贴图与皮肤", exact: true }).click();
    await pick(f.texture);
    await modal.getByRole("button", { name: "添加贴图", exact: true }).click();
    await modal.getByLabel("skinid", { exact: true }).waitFor();
    await modal.getByRole("tab", { name: "动画", exact: true }).click();
    await pick(f.animation);
    await modal.getByRole("button", { name: "添加文件", exact: true }).click();
    await modal
      .getByRole("combobox", { name: "idle（待机）", exact: true })
      .click();
    await page
      .getByRole("option", { name: "animation.test.idle", exact: true })
      .click();
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
    const modelZip = (await fs.readdir(f.directory)).find((x) =>
      /^m_.*\.zip$/.test(x),
    );
    await pick(path.join(f.directory, modelZip));
    await page.getByRole("button", { name: "导入 ZIP", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByText("NPC模型拓展包已导入", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "编辑 森林守卫", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal.getByRole("tab", { name: "贴图与皮肤", exact: true }).click();
    await pick(f.texture);
    await modal.getByRole("button", { name: "添加贴图", exact: true }).click();
    await modal.getByLabel("skinid", { exact: true }).nth(1).waitFor();
    assert.equal(await modal.getByLabel("skinid", { exact: true }).count(), 2);
    await modal.getByLabel("名称", { exact: true }).nth(1).fill("第二张贴图");
    await modal
      .getByRole("button", { name: "移除贴图 0", exact: true })
      .click();
    assert.equal(
      await modal.getByLabel("skinid", { exact: true }).inputValue(),
      "0",
    );
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    await page
      .getByText("customnpc:forest_guard_dlcnpc", { exact: true })
      .waitFor();
    const projectFile = path.join(f.directory, "ui.dgnproject");
    await pick(projectFile);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    await page
      .getByText("工程已保存，列表和资源可在下次打开时恢复", { exact: true })
      .waitFor();
    assert.ok((await fs.stat(projectFile)).size > 0);
    await page.getByRole("button", { name: "清空列表", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page
      .getByText("customnpc:forest_guard_dlcnpc", { exact: true })
      .waitFor({ state: "hidden" });
    await pick(projectFile);
    await page.getByRole("button", { name: "打开工程", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page
      .getByText("customnpc:forest_guard_dlcnpc", { exact: true })
      .waitFor();
    await page.getByText("工程已恢复", { exact: true }).waitFor();
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
    await nav("NPC皮肤拓展");
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
      "PASS Electron UI: skin/model import/export, project save/open, texture index remap, real backend, themes, navigation, compact layout, cancellation",
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
    if (app) {
      if (originalClipboard !== undefined)
        await app.evaluate(
          ({ clipboard }, text) => clipboard.writeText(text),
          originalClipboard,
        );
      await app.close();
    }
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
