const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");
const { makeSound, crc } = require("./ogg-bitrate-fixtures.cjs");

// Change only Ogg stream serials/CRCs so candidates remain browser-decodable,
// while distinct hashes prove all restored paths receive audition permission.
function candidate(serial) {
  const bytes = ogg();
  for (let offset = 0; offset < bytes.length;) {
    const count = bytes[offset + 26];
    const payload = Array.from(
      bytes.subarray(offset + 27, offset + 27 + count),
    ).reduce((sum, n) => sum + n, 0);
    const length = 27 + count + payload;
    bytes.writeUInt32LE(serial, offset + 14);
    bytes.fill(0, offset + 22, offset + 26);
    bytes.writeUInt32LE(
      crc(bytes.subarray(offset, offset + length)),
      offset + 22,
    );
    offset += length;
  }
  return bytes;
}

(async () => {
  const f = await fixture();
  const a = path.join(f.directory, "叫声甲.ogg"),
    b = path.join(f.directory, "叫声乙.ogg"),
    c = path.join(f.directory, "叫声丙.ogg");
  const high = path.join(f.directory, "超标192.ogg"),
    denied = path.join(f.directory, "未选择.ogg");
  const project = path.join(f.directory, "随机音效工程.dgnproject");
  const second = candidate(2222),
    third = candidate(3333);
  await fs.writeFile(a, ogg());
  await fs.writeFile(b, second);
  await fs.writeFile(c, third);
  await fs.writeFile(high, makeSound({ nominal: 192000 }));
  await fs.writeFile(denied, ogg());
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow, dialog }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      globalThis.soundPicks = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: globalThis.soundPicks.shift() || [],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: globalThis.soundPicks.shift()?.[0],
      });
    });
    const pick = (paths) =>
      app.evaluate((_, value) => globalThis.soundPicks.push(value), paths);
    const state = () => page.evaluate(() => window.toolkit.call("state"));
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "音效拓展", exact: true })
      .click();
    await pick([a, b]);
    await page
      .getByRole("button", { name: "添加音效 / 批量添加", exact: true })
      .click();
    let modal = page.getByRole("dialog");
    assert.equal(
      await modal.getByLabel("资源名称 1", { exact: true }).inputValue(),
      "叫声甲",
    );
    assert.equal(
      await modal.getByLabel("资源名称 2", { exact: true }).inputValue(),
      "叫声乙",
    );
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await pick([a, b]);
    await page
      .getByRole("button", { name: "添加随机音效组", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal.locator(".sound-candidate-row").nth(1).waitFor();
    assert.equal(await modal.locator(".sound-candidate-row").count(), 2);
    await modal.getByLabel("资源名称", { exact: true }).fill("僵尸随机叫声");
    await modal.getByLabel("资源 ID", { exact: true }).fill("zombie_say");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 僵尸随机叫声", exact: true })
      .waitFor();
    let current = await state();
    assert.equal(current.sounds.length, 1);
    assert.deepEqual(current.sounds[0].SoundFiles, [a, b]);
    await page.getByText("2 个候选音频 · 随机播放", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "编辑 僵尸随机叫声", exact: true })
      .click();
    await pick([c]);
    await modal
      .getByRole("button", { name: "追加候选音频", exact: true })
      .click();
    await modal.locator(".sound-candidate-row").nth(2).waitFor();
    assert.equal(await modal.locator(".sound-candidate-row").count(), 3);
    if (process.env.MCNPC_CAPTURE_VARIANTS)
      await page.screenshot({ path: "test-results/sound-variants-editor.png" });
    await pick([b]);
    await modal
      .getByRole("button", { name: "替换候选音频 1", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "移除候选音频 2", exact: true })
      .click();
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    current = await state();
    assert.equal(current.sounds[0].Id, "zombie_say");
    assert.equal(current.sounds[0].Path, b);
    assert.deepEqual(current.sounds[0].SoundFiles, [b, c]);
    const before = current;
    await pick([project]);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "工程已保存" }).waitFor();
    await pick([f.directory]);
    await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
    await modal
      .getByRole("heading", { name: "拓展包已导出", exact: true })
      .waitFor();
    await modal.getByRole("button", { name: "完成", exact: true }).click();
    const zip = path.join(
      f.directory,
      (await fs.readdir(f.directory)).find((name) => name.endsWith(".zip")),
    );
    await pick([zip]);
    await page.getByRole("button", { name: "导入 ZIP", exact: true }).click();
    await modal.getByRole("button", { name: "确认", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal((await state()).sounds[0].SoundFiles.length, 2);
    await fs.unlink(a);
    await fs.unlink(b);
    await fs.unlink(c);
    await pick([project]);
    await page.getByRole("button", { name: "打开工程", exact: true }).click();
    await modal.getByRole("button", { name: "确认", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    current = await state();
    assert.equal(current.sounds.length, 1);
    assert.equal(current.sounds[0].Id, "zombie_say");
    assert.equal(current.soundPack.ProviderId, before.soundPack.ProviderId);
    assert.equal(current.sounds[0].SoundFiles.length, 2);
    const urls = await page.evaluate(
      async (paths) =>
        Promise.all(
          paths.map((path) => window.toolkit.call("audio.read", { path })),
        ),
      current.sounds[0].SoundFiles,
    );
    assert.deepEqual(Buffer.from(urls[0].split(",")[1], "base64"), second);
    assert.deepEqual(Buffer.from(urls[1].split(",")[1], "base64"), third);
    assert.equal(
      await page.evaluate(async (path) => {
        try {
          await window.toolkit.call("audio.read", { path });
          return false;
        } catch {
          return true;
        }
      }, denied),
      true,
    );
    await page
      .getByRole("button", { name: "试听 僵尸随机叫声", exact: true })
      .click();
    const select = modal.getByRole("combobox", {
      name: "试听候选音频",
      exact: true,
    });
    for (let index = 0; index < 2; index++) {
      await select.click();
      await page
        .getByRole("option", {
          name: `${index + 1}. ${path.basename(current.sounds[0].SoundFiles[index])}`,
          exact: true,
        })
        .click();
      await page.waitForFunction(() => {
        const audio = document.querySelector("audio");
        if (audio?.error) throw Error(audio.error.message);
        return audio?.readyState >= 2;
      });
      assert.equal(await modal.locator("audio").getAttribute("autoplay"), null);
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "编辑 僵尸随机叫声", exact: true })
      .click();
    await pick([high]);
    await modal
      .getByRole("button", { name: "追加候选音频", exact: true })
      .click();
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "192 kbps" }).waitFor();
    assert.deepEqual(await state(), current);
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑 僵尸随机叫声", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "移除候选音频 1", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "移除候选音频 1", exact: true })
      .click();
    await modal.getByRole("button", { name: "保存", exact: true }).click();
    await modal.getByText("至少添加一个候选音频", { exact: true }).waitFor();
    assert.deepEqual(await state(), current);
    assert.deepEqual(errors, []);
    console.log(
      "PASS sound groups, append/replace/remove, native ZIP roundtrip, portable restore, every-candidate audition/permissions and bitrate/empty rejection",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
