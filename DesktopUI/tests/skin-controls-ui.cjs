const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");

(async () => {
  const f = await fixture();
  const second = path.join(f.directory, "second.png");
  await fs.copyFile(f.texture, second);
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
    await app.evaluate(
      ({ dialog, BrowserWindow }, files) => {
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
          false,
        );
        globalThis.skinFiles = files;
        dialog.showOpenDialog = async (owner, options) => {
          globalThis.pickerOptions = options;
          return { canceled: false, filePaths: globalThis.skinFiles };
        };
      },
      [f.texture, second],
    );
    assert.equal(
      await page.getByRole("button", { name: "批量添加", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    assert.ok(
      (await app.evaluate(() => globalThis.pickerOptions.properties)).includes(
        "multiSelections",
      ),
    );
    const modal = page.getByRole("dialog");
    await modal.getByLabel("人物名称 1", { exact: true }).fill("第一张皮肤");
    await modal.getByLabel("人物名称 2", { exact: true }).fill("第二张皮肤");
    await modal.getByLabel("统一作者", { exact: true }).fill("测试作者");
    await modal
      .getByRole("button", { name: "添加 2 个皮肤", exact: true })
      .click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).skins.length,
      2,
    );
    const view = page
      .locator(".row-actions")
      .getByRole("button", { name: "查看 第一张皮肤", exact: true });
    await view.click();
    await modal.getByRole("tab", { name: "原始贴图", exact: true }).click();
    await modal.getByAltText("第一张皮肤", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "编辑 第一张皮肤", exact: true })
      .click();
    const target = modal.getByRole("combobox", {
      name: "目标模型",
      exact: true,
    });
    await target.click();
    const search = page.getByRole("searchbox", { name: "搜索选项" });
    await search.fill("找不到这个模型");
    await page.getByText("没有匹配的选项", { exact: true }).waitFor();
    await search.press("Enter");
    assert.equal(await target.getAttribute("aria-expanded"), "true");
    await search.press("Escape");
    assert.equal(await target.getAttribute("aria-expanded"), "false");
    await modal
      .getByRole("heading", { name: "编辑皮肤", exact: true })
      .waitFor();
    await target.click();
    assert.equal(await search.inputValue(), "");
    await search.fill("__custom");
    assert.equal(await page.getByRole("option").count(), 1);
    // Enter during IME composition must not choose an option or submit the editor.
    await search.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    assert.equal(await target.getAttribute("aria-expanded"), "true");
    await search.press("Enter");
    await modal.getByLabel("自定义模型 ID", { exact: true }).waitFor();
    await target.click();
    await search.fill("Steve");
    await search.press("Enter");
    assert.equal(await target.getAttribute("aria-expanded"), "false");
    await modal.getByRole("button", { name: "保存修改", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).skins[0]
        .TargetIdentifier,
      "",
    );
    await app.evaluate(
      (_, files) => {
        globalThis.skinFiles = files;
      },
      [f.texture],
    );
    await page.getByRole("button", { name: "添加皮肤", exact: true }).click();
    await modal.getByLabel("人物名称", { exact: true }).fill("第三张皮肤");
    await modal.getByLabel("作者", { exact: true }).fill("测试作者");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).skins.length,
      3,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS unified multi/single skin picker, row preview, searchable modal dropdown, no-match, Escape and IME handling",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
