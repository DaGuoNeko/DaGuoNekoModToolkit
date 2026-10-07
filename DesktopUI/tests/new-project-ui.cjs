const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

(async () => {
  const f = await fixture();
  const audio = path.join(f.directory, "sound.ogg");
  await fs.writeFile(audio, ogg());
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
    const call = (method, args = {}) =>
      page.evaluate(({ method, args }) => window.toolkit.call(method, args), {
        method,
        args,
      });
    await call("skins.add", {
      items: [{ path: f.texture, name: "旧皮肤", author: "作者" }],
    });
    await call("models.save", {
      index: -1,
      entry: {
        DisplayName: "旧模型",
        CustomName: "new_project_test",
        GeoPath: f.geo,
        Textures: [{ Name: "默认", Path: f.texture }],
      },
    });
    for (const kind of ["textures", "sounds"]) {
      await call(`${kind}.add`, {
        items: [
          {
            Id: "old_item",
            Name: "旧资源",
            CategoryId: "test",
            CategoryName: "测试",
            Path: kind === "textures" ? f.invalid : audio,
          },
        ],
      });
      await call(`${kind}.settings`, {
        name: "旧包",
        author: "旧作者",
        version: "3.2.1",
      });
    }
    await page.reload();
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setBackgroundThrottling(false);
      win.setSize(880, 650);
    });
    const modal = page.getByRole("dialog");
    for (const [kind, label, packKey] of [
      ["skins", "NPC皮肤拓展"],
      ["models", "NPC模型拓展"],
      ["textures", "贴图拓展", "texturePack"],
      ["sounds", "音效拓展", "soundPack"],
    ]) {
      await page
        .locator(".sidebar")
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.waitForFunction(
        (name) =>
          document.querySelector(".sidebar button.active")?.title === name &&
          !document.documentElement.dataset.pageAnimating,
        label,
      );
      const search = page.getByPlaceholder("搜索名称…");
      await search.fill("无匹配内容");
      const before = await call("state");
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
      await modal
        .getByRole("heading", { name: `新建${label}项目？`, exact: true })
        .waitFor();
      await modal.getByRole("button", { name: "取消", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual(await call("state"), before);
      assert.equal(await search.inputValue(), "无匹配内容");
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
      await modal.getByRole("button", { name: "确认", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      const after = await call("state");
      assert.deepEqual(after[kind], []);
      assert.equal(await search.inputValue(), "");
      assert.equal(
        await page
          .getByRole("button", { name: "导出 ZIP", exact: true })
          .isDisabled(),
        true,
      );
      for (const key of Object.keys(before))
        if (key !== kind && key !== packKey)
          assert.deepEqual(after[key], before[key]);
      if (packKey) {
        assert.notEqual(after[packKey].ProviderId, before[packKey].ProviderId);
        await page
          .getByRole("button", { name: "拓展包设置", exact: true })
          .click();
        assert.equal(
          await modal.getByLabel("包版本", { exact: true }).inputValue(),
          "1.0.0",
        );
        assert.equal(
          await modal.getByLabel("作者", { exact: true }).inputValue(),
          "",
        );
        await page.keyboard.press("Escape");
      }
      assert.ok(
        await page
          .locator("main")
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        `compact layout: ${label}`,
      );
    }
    console.log(
      "PASS four new-project buttons, cancellation, isolated reset, cleared search, reset pack settings and compact layout",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
