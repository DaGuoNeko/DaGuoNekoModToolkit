const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

(async () => {
  const f = await fixture();
  const sound = path.join(f.directory, "sound.ogg");
  await fs.writeFile(sound, ogg());
  await fs.mkdir("test-results", { recursive: true });
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
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ dialog, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      globalThis.validationFiles = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: globalThis.validationFiles,
      });
    });
    const pick = (files) =>
      app.evaluate((_, value) => {
        globalThis.validationFiles = value;
      }, files);
    const nav = (name) =>
      page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
    const modal = page.getByRole("dialog");
    const field = (name) => modal.getByLabel(name, { exact: true });
    async function invalid(control) {
      const handle = await control.elementHandle();
      await page.waitForFunction(
        (element) => element.getAttribute("aria-invalid") === "true",
        handle,
      );
      await page.waitForFunction((element) => {
        const hint = element.closest(".field").querySelector(".field-error");
        return (
          hint &&
          getComputedStyle(element).borderTopColor ===
            getComputedStyle(hint).color
        );
      }, handle);
    }
    async function valid(control) {
      await page.waitForFunction(
        (element) => !element.hasAttribute("aria-invalid"),
        await control.elementHandle(),
      );
    }

    await nav("NPC模型拓展");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    assert.equal(
      await modal.locator('[aria-invalid="true"]').count(),
      0,
      "pristine fields are neutral",
    );
    await field("自定义模型 ID *").fill("Bad Name");
    await invalid(field("自定义模型 ID *"));
    await field("自定义模型 ID *").fill("forest_guard");
    await valid(field("自定义模型 ID *"));
    await field("碰撞箱宽度").fill("0");
    await invalid(field("碰撞箱宽度"));
    await field("碰撞箱宽度").fill("0.005");
    await valid(field("碰撞箱宽度"));
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await invalid(field("显示名称 *"));
    await invalid(field("模型文件 *"));
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).models.length,
      0,
    );
    await page.screenshot({ path: "test-results/validation-model.png" });
    await page.keyboard.press("Escape");

    await nav("NPC皮肤拓展");
    await pick([f.texture]);
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await invalid(field("作者"));
    await field("作者").fill("测试作者");
    await valid(field("作者"));
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });

    await nav("贴图拓展");
    await pick([f.invalid]);
    await page
      .getByRole("button", { name: "添加贴图 / 批量添加", exact: true })
      .click();
    await field("资源 ID").fill("bad-id");
    await invalid(field("资源 ID"));
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).textures.length,
      0,
    );
    await field("资源 ID").fill("");
    await valid(field("资源 ID"));
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    const state = await page.evaluate(() => window.toolkit.call("state"));
    assert.equal(state.textures.length, 1, "blank new ID still auto-generates");
    await page
      .getByRole("button", { name: "添加贴图 / 批量添加", exact: true })
      .click();
    await field("资源 ID").fill(state.textures[0].Id);
    await invalid(field("资源 ID"));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "拓展包设置", exact: true }).click();
    await field("包版本").fill("1.2");
    await invalid(field("包版本"));
    for (const [mode, name] of [
      ["Light", "light"],
      ["Dark", "dark"],
    ]) {
      await page.evaluate(
        (AppearanceMode) =>
          window.toolkit.call("settings.update", { AppearanceMode }),
        mode,
      );
      await page.waitForFunction(
        (value) => document.documentElement.dataset.theme === value,
        name,
      );
      await field("包版本").focus();
      await invalid(field("包版本"));
      await page.screenshot({ path: `test-results/validation-${name}.png` });
    }
    await field("包版本").fill("1.2.3");
    await valid(field("包版本"));
    await field("包标识").fill(state.soundPack.ProviderId);
    await invalid(field("包标识"));
    await field("包标识").fill(state.texturePack.ProviderId);
    await valid(field("包标识"));
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await modal.waitFor({ state: "hidden" });

    await nav("音效拓展");
    await pick([sound]);
    await page
      .getByRole("button", { name: "添加音效 / 批量添加", exact: true })
      .click();
    await field("音量（0–1）").fill("2");
    await invalid(field("音量（0–1）"));
    await field("音量（0–1）").fill("0.25");
    await valid(field("音量（0–1）"));
    await field("音调（大于0）").fill("0");
    await invalid(field("音调（大于0）"));
    await field("音调（大于0）").fill("0.005");
    await valid(field("音调（大于0）"));
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    const saved = await page.evaluate(() => window.toolkit.call("state"));
    assert.equal(saved.sounds[0].Volume, 0.25);
    assert.equal(saved.sounds[0].Pitch, 0.005);
    await nav("设置");
    await page.getByRole("switch", { name: "显示模组开发者工具" }).click();
    await nav("开发者工具箱");
    const modName = page.getByLabel("模组名称", { exact: true });
    await modName.fill("bad-name");
    await invalid(modName);
    await modName.fill("custom_example");
    await valid(modName);
    const end = page.getByLabel("结束序号", { exact: true });
    await end.fill("-1");
    await invalid(end);
    await end.fill("5");
    await valid(end);
    await page
      .getByRole("button", { name: "生成物品模板", exact: true })
      .click();
    await invalid(page.getByLabel("命名空间", { exact: true }));
    assert.deepEqual(errors, []);
    console.log(
      "PASS invalid borders in both themes, correction, required fields, duplicate IDs, versions, numeric bounds and valid saves",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
