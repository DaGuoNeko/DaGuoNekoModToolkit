const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

(async () => {
  const f = await fixture();
  const sound = path.join(f.directory, "sound.ogg"),
    project = path.join(f.directory, "drag.dgnproject");
  const unsupported = path.join(f.directory, "unsupported.txt"),
    secondGeo = path.join(f.directory, "second.geo.json");
  await fs.writeFile(sound, ogg());
  await fs.writeFile(unsupported, "not an asset");
  await fs.copyFile(f.geo, secondGeo);
  await fs.mkdir("test-results", { recursive: true });
  const badAnimation = path.join(f.directory, "bad.animation.json");
  await fs.writeFile(badAnimation, "{}");
  await fs.writeFile(
    f.animation,
    JSON.stringify({
      format_version: "1.8.0",
      animations: {
        "animation.test.idle": {
          loop: true,
          bones: { root: { rotation: [0, 0, 0] } },
        },
        "animation.test.walk": {
          loop: true,
          bones: { root: { rotation: [10, 0, 0] } },
        },
        "animation.test.run": {
          loop: true,
          bones: { root: { rotation: [20, 0, 0] } },
        },
      },
    }),
  );
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
      ({ BrowserWindow, dialog }, values) => {
        BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
          false,
        );
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [values.directory],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: values.project,
        });
      },
      { directory: f.directory, project },
    );
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.id = "drop-test-input";
      input.hidden = true;
      document.body.append(input);
    });
    const nav = async (name) => {
      await page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
      await page.waitForFunction(
        (label) =>
          document.querySelector(".sidebar button.active")?.title === label &&
          !document.documentElement.dataset.pageAnimating,
        name,
      );
    };
    const state = () => page.evaluate(() => window.toolkit.call("state"));
    const modal = page.getByRole("dialog");
    const cdp = await page.context().newCDPSession(page);
    async function drop(files, target = page.locator("main")) {
      // CDP attaches native files; Playwright's small-file payloads lose their OS paths.
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: "#drop-test-input",
      });
      await cdp.send("DOM.setFileInputFiles", { nodeId, files });
      await target.evaluate((element) => {
        const dataTransfer = new DataTransfer();
        for (const file of document.querySelector("#drop-test-input").files)
          dataTransfer.items.add(file);
        for (const type of ["dragenter", "dragover", "drop"])
          element.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            }),
          );
      });
    }
    await drop([f.texture, f.invalid]);
    await modal
      .getByRole("heading", { name: "批量添加皮肤", exact: true })
      .waitFor();
    // Cancel the batch because the second PNG is intentionally not a humanoid skin.
    await page.keyboard.press("Escape");
    assert.equal((await state()).skins.length, 0);
    await drop([f.texture]);
    await modal.getByLabel("作者", { exact: true }).fill("拖入作者");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal((await state()).skins.length, 1);
    await nav("贴图拓展");
    await drop([f.invalid]);
    await modal
      .getByRole("heading", { name: "添加贴图", exact: true })
      .waitFor();
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal((await state()).textures.length, 1);
    await nav("音效拓展");
    await drop([sound]);
    await modal
      .getByRole("heading", { name: "添加音效", exact: true })
      .waitFor();
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal((await state()).sounds.length, 1);
    await nav("NPC模型拓展");
    await drop([f.geo, f.texture, f.animation]);
    await modal
      .getByRole("heading", { name: "添加模型", exact: true })
      .waitFor();
    assert.equal(
      await modal.getByLabel("模型文件 *", { exact: true }).inputValue(),
      f.geo,
    );
    await modal.getByLabel("显示名称 *", { exact: true }).fill("拖入模型");
    await modal
      .getByLabel("自定义模型 ID *", { exact: true })
      .fill("dropped_model");
    await modal
      .getByRole("combobox", { name: "模型分类", exact: true })
      .click();
    assert.deepEqual(await page.getByRole("option").allTextContents(), [
      "原版",
      "其他",
      "功能性",
    ]);
    await page.getByRole("option", { name: "功能性", exact: true }).click();
    await modal.getByRole("tab", { name: "动画", exact: true }).click();
    const animationIds = [
      "animation.test.idle",
      "animation.test.walk",
      "animation.test.run",
    ];
    await modal.getByRole("listitem").last().waitFor();
    assert.equal(await modal.getByRole("listitem").count(), 3);
    for (const [label, id] of [
      ["idle（待机）", animationIds[0]],
      ["walk（行走）", animationIds[1]],
      ["walka（跑步）", animationIds[2]],
      ["attack（攻击）", "pass（无动作） · animation.customnpc.default.pass"],
    ]) {
      await modal.getByRole("combobox", { name: label, exact: true }).click();
      for (const animationId of animationIds)
        assert.equal(
          await page
            .getByRole("option", { name: animationId, exact: true })
            .count(),
          1,
        );
      await page.getByRole("option", { name: id, exact: true }).click();
    }
    await page.screenshot({
      path: "test-results/model-animation-selector.png",
    });
    await modal.getByRole("tab", { name: "基本信息", exact: true }).click();
    await drop([f.invalid], modal.locator(".modal-body"));
    await modal.getByRole("tab", { name: "贴图与皮肤", exact: true }).click();
    assert.equal(
      await modal.getByLabel("skinid", { exact: true }).count(),
      2,
      "each dragged texture creates a switchable skin",
    );
    await modal.getByLabel("贴图 0 名称", { exact: true }).fill("蓝机器人");
    await modal.getByLabel("贴图 1 名称", { exact: true }).fill("橙机器人");
    assert.equal(
      await modal.getByLabel("名称", { exact: true }).nth(1).inputValue(),
      "橙机器人",
    );
    await modal.getByLabel("作者", { exact: true }).nth(1).fill("测试作者");
    await modal
      .getByRole("combobox", { name: "默认贴图", exact: true })
      .click();
    await page
      .getByRole("option", { name: "1 · 橙机器人", exact: true })
      .click();
    assert.equal(
      await modal.getByLabel("贴图 0 名称", { exact: true }).inputValue(),
      "橙机器人",
    );
    assert.equal(
      await modal.getByLabel("skinid", { exact: true }).nth(1).inputValue(),
      "0",
    );
    await page.screenshot({ path: "test-results/model-default-texture.png" });
    await modal.getByRole("tab", { name: "基本信息", exact: true }).click();
    await drop(
      [f.texture],
      modal.getByLabel("预览图", { exact: true }).locator(".."),
    );
    await page.waitForFunction(
      (file) =>
        Array.from(document.querySelectorAll("input[readonly]")).some(
          (input) => input.value === file,
        ),
      f.texture,
    );
    assert.equal(await page.locator(".drag-active").count(), 0);
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    const model = (await state()).models[0];
    assert.equal(model.DisplayName, "拖入模型");
    assert.equal(model.Textures.length, 2);
    assert.equal(model.Textures[0].Path, f.invalid);
    assert.deepEqual(model.SkinList, [
      { SkinId: 1, Name: "蓝机器人", By: "" },
      { SkinId: 0, Name: "橙机器人", By: "测试作者" },
    ]);
    assert.equal(model.AnimationFiles.length, 1);
    assert.deepEqual(model.AnimationList, animationIds);
    assert.equal(model.SourceLabel, "功能性");
    assert.equal(model.IdleAnimation, animationIds[0]);
    assert.equal(model.WalkAnimation, animationIds[1]);
    assert.equal(model.WalkaAnimation, animationIds[2]);
    assert.equal(model.AttackAnimation, "animation.customnpc.default.pass");
    assert.equal(model.PreviewImagePath, f.texture);
    await page
      .getByRole("button", { name: "编辑 拖入模型", exact: true })
      .click();
    await modal.getByRole("tab", { name: "动画", exact: true }).click();
    await drop([badAnimation], modal.locator(".modal-body"));
    await modal.getByText(/动画 JSON 缺少 animations/).waitFor();
    assert.equal(
      await modal
        .getByRole("combobox", { name: "idle（待机）", exact: true })
        .isDisabled(),
      true,
    );
    await modal.getByRole("button", { name: "保存模型", exact: true }).click();
    assert.deepEqual(
      (await state()).models[0],
      model,
      "invalid animation catalog cannot overwrite a saved model",
    );
    await modal
      .getByRole("button", { name: "移除动画 1", exact: true })
      .click();
    await modal.getByRole("listitem").last().waitFor();
    await modal
      .getByRole("button", { name: "移除动画 0", exact: true })
      .click();
    await modal
      .getByText("尚未导入动画文件；实体动画可使用默认或 pass。", {
        exact: true,
      })
      .waitFor();
    await modal
      .getByRole("combobox", { name: "idle（待机）", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "pass（无动作） · animation.customnpc.default.pass",
        exact: true,
      })
      .click();
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual((await state()).models[0], model);
    await page.evaluate(() => window.toolkit.call("project.save"));
    const exports = {};
    for (const kind of ["skins", "models", "textures", "sounds"])
      exports[kind] = (
        await page.evaluate(
          (kind) => window.toolkit.call("export", { kind }),
          kind,
        )
      ).path;
    for (const [kind, label] of [
      ["skins", "NPC皮肤拓展"],
      ["models", "NPC模型拓展"],
      ["textures", "贴图拓展"],
      ["sounds", "音效拓展"],
    ]) {
      await nav(label);
      const before = await state();
      await drop([exports[kind]]);
      await modal.getByRole("button", { name: "取消", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual(await state(), before);
      await drop([exports[kind]]);
      await modal.getByRole("button", { name: "确认", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      assert.equal((await state())[kind].length, 1);
      if (kind === "models") {
        const imported = (await state()).models[0];
        assert.deepEqual(imported.AnimationList, animationIds);
        assert.equal(imported.SourceLabel, "功能性");
        assert.equal(imported.Textures[0].Name, "橙机器人");
        assert.deepEqual(imported.SkinList, model.SkinList);
        assert.equal(imported.WalkaAnimation, animationIds[2]);
        assert.equal(
          imported.AttackAnimation,
          "animation.customnpc.default.pass",
        );
      }
    }
    const beforeFailure = await state();
    await drop([f.texture]);
    await modal.getByText(/音效页面支持/).waitFor();
    await page.keyboard.press("Escape");
    await drop([exports.sounds, f.texture]);
    await modal.getByText(/每次只能拖入一个/).waitFor();
    await page.keyboard.press("Escape");
    await drop([unsupported, sound]);
    await modal.getByText(/不支持的拖入文件/).waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(await state(), beforeFailure);
    await drop([exports.textures]);
    await modal.getByRole("button", { name: "确认", exact: true }).click();
    await modal.getByText(/类型或版本不匹配/).waitFor();
    await page.keyboard.press("Escape");
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await state(), beforeFailure);
    await nav("NPC模型拓展");
    await drop([f.geo, secondGeo]);
    await modal.getByText(/一次只能添加一个模型 JSON/).waitFor();
    await page.keyboard.press("Escape");
    await nav("贴图拓展");
    const beforeProject = await state();
    await drop([project]);
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(await state(), beforeProject);
    await drop([project]);
    await modal.getByRole("button", { name: "确认", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    for (const kind of ["skins", "models", "textures", "sounds"])
      assert.equal((await state())[kind].length, 1);
    assert.deepEqual((await state()).models[0].AnimationList, animationIds);
    assert.equal((await state()).models[0].SourceLabel, "功能性");
    assert.equal((await state()).models[0].Textures[0].Name, "橙机器人");
    assert.deepEqual((await state()).models[0].SkinList, model.SkinList);
    assert.deepEqual(errors, []);
    console.log(
      "PASS actual file drops on all four pages, model resources and path fields, ZIP confirmation/roundtrip, project restore and non-destructive rejection",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
