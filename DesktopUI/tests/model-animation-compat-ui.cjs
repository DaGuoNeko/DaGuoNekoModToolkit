const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");

(async () => {
  const f = await fixture();
  const ids = [
    "animation.test.idle",
    "animation.test.walk",
    "animation.test.run",
  ];
  const pass = "animation.customnpc.default.pass";
  await fs.writeFile(
    f.animation,
    JSON.stringify({
      animations: Object.fromEntries(ids.map((id) => [id, { loop: true }])),
    }),
  );
  const extra = path.join(f.directory, "extra.animation.json");
  await fs.writeFile(
    extra,
    JSON.stringify({ animations: { "animation.test.extra": { loop: true } } }),
  );
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: [
        ...(process.env.MCNPC_TEST_EXE ? [] : ["."]),
        "--disable-features=CalculateNativeWinOcclusion",
      ],
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
    await app.evaluate(
      ({ BrowserWindow, dialog }, values) => {
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
          false,
        );
        globalThis.animationCompatPick = values.extra;
        dialog.showOpenDialog = async (_, options) => ({
          canceled: false,
          filePaths: [
            options.properties.includes("openDirectory")
              ? values.directory
              : globalThis.animationCompatPick,
          ],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: values.project,
        });
      },
      {
        extra,
        directory: f.directory,
        project: path.join(f.directory, "legacy.dgnproject"),
      },
    );
    const call = (method, args = {}) =>
      page.evaluate(({ method, args }) => window.toolkit.call(method, args), {
        method,
        args,
      });
    const model = {
      DisplayName: "旧模型",
      CustomName: "legacy_model",
      SourceLabel: "其他",
      GeoPath: f.geo,
      Textures: [{ Name: "默认", Path: f.texture }],
      AnimationFiles: [f.animation],
      AnimationList: [],
    };
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    async function load(list) {
      const state = await call("state");
      await call("models.save", {
        index: state.models.length ? 0 : -1,
        entry: { ...model, AnimationList: list },
      });
      await page.reload();
      await page
        .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
        .waitFor();
      await page
        .locator(".sidebar")
        .getByRole("button", { name: "NPC模型拓展", exact: true })
        .click();
      await page
        .getByRole("button", { name: "编辑 旧模型", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByRole("tab", { name: "动画", exact: true }).click();
      await modal.getByRole("listitem").last().waitFor();
      assert.equal(
        await modal
          .getByRole("checkbox", {
            name: "跟随动画文件更新可选列表",
            exact: true,
          })
          .isChecked(),
        false,
      );
      return modal;
    }
    // File order differs from the saved order; walk is intentionally omitted.
    const oldList = [ids[2], pass, ids[0]];
    for (const list of [oldList, [], [pass]]) {
      const modal = await load(list);
      await modal.getByRole("tab", { name: "基本信息", exact: true }).click();
      await modal.getByLabel("显示名称 *", { exact: true }).fill("修改显示名");
      await modal
        .getByRole("button", { name: "保存模型", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual(
        (await call("state")).models[0].AnimationList,
        list,
        "opening and saving must preserve the original list exactly",
      );
    }
    let modal = await load(oldList);
    await modal.getByRole("button", { name: "添加文件", exact: true }).click();
    await modal
      .getByRole("listitem")
      .filter({ hasText: "animation.test.extra" })
      .waitFor();
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(
      (await call("state")).models[0].AnimationList,
      oldList,
      "adding files without sync must preserve selected and built-in animations",
    );
    const project = path.join(f.directory, "legacy.dgnproject");
    await call("project.save");
    await app.evaluate((_, file) => {
      globalThis.animationCompatPick = file;
    }, project);
    assert.deepEqual(
      (await call("project.open")).state.models[0].AnimationList,
      oldList,
    );
    const exported = await call("export", { kind: "models" });
    assert.deepEqual(
      (await call("models.import", { path: exported.path })).state.models[0]
        .AnimationList,
      oldList,
    );
    // Explicit sync replaces the legacy selection; turning it off freezes the current list.
    await app.evaluate((_, file) => {
      globalThis.animationCompatPick = file;
    }, extra);
    modal = await load(oldList);
    const sync = modal.getByRole("checkbox", {
      name: "跟随动画文件更新可选列表",
      exact: true,
    });
    await sync.check();
    await sync.uncheck();
    await modal.getByRole("button", { name: "添加文件", exact: true }).click();
    await modal
      .getByRole("listitem")
      .filter({ hasText: "animation.test.extra" })
      .waitFor();
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual((await call("state")).models[0].AnimationList, ids);
    modal = await load(oldList);
    await modal
      .getByRole("checkbox", { name: "跟随动画文件更新可选列表", exact: true })
      .check();
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual((await call("state")).models[0].AnimationList, ids);
    model.Textures.push({ Name: "旧贴图2", Path: f.invalid });
    model.SkinList = [{ SkinId: 1, Name: "手工皮肤", By: "旧作者" }];
    modal = await load(oldList);
    await modal.getByRole("tab", { name: "贴图与皮肤", exact: true }).click();
    assert.equal(
      await modal.getByLabel("skinid", { exact: true }).count(),
      1,
      "opening preserves the old subset of skin variants",
    );
    await modal
      .getByRole("button", { name: "补齐贴图变体", exact: true })
      .click();
    assert.equal(await modal.getByLabel("skinid", { exact: true }).count(), 2);
    assert.equal(
      await modal
        .getByRole("button", { name: "补齐贴图变体", exact: true })
        .isDisabled(),
      true,
    );
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual((await call("state")).models[0].SkinList, [
      { SkinId: 1, Name: "手工皮肤", By: "旧作者" },
      { SkinId: 0, Name: "默认", By: "" },
    ]);
    assert.deepEqual(errors, []);
    console.log(
      "PASS legacy subsets/order/built-ins/empty lists survive edit, file additions, project and ZIP round-trips; explicit sync and freeze work",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
