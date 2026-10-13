const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const { makeSound } = require("./ogg-bitrate-fixtures.cjs");

(async () => {
  const f = await fixture();
  const valid = path.join(f.directory, "合规128.ogg"),
    high = path.join(f.directory, "超标192.ogg");
  await fs.writeFile(valid, makeSound({ nominal: 128000 }));
  await fs.writeFile(high, makeSound({ nominal: 192000 }));
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
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow, dialog }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      globalThis.audioPicks = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: globalThis.audioPicks.shift() || [],
      });
    });
    const pick = (files) =>
      app.evaluate((_, paths) => globalThis.audioPicks.push(paths), files);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "音效拓展", exact: true })
      .click();
    assert.match(
      await page.locator(".sound-format-hint").innerText(),
      /128\s*kbps/,
    );
    const add = page.getByRole("button", {
      name: "添加音效 / 批量添加",
      exact: true,
    });
    await pick([high]);
    await add.click();
    let modal = page.getByRole("dialog");
    assert.match(
      await modal.locator(".sound-format-hint").innerText(),
      /128\s*kbps/,
    );
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "192 kbps" }).waitFor();
    assert.ok((await modal.getByRole("alert").innerText()).includes(high));
    assert.equal(
      (await page.evaluate(() => window.toolkit.call("state"))).sounds.length,
      0,
    );
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await pick([valid]);
    await add.click();
    modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "选择 合规128", exact: true })
      .waitFor();
    const before = await page.evaluate(() => window.toolkit.call("state"));
    assert.equal(before.sounds.length, 1);
    assert.match(
      await page.locator(".sound-format-hint").innerText(),
      /128\s*kbps/,
    );
    await pick([valid, high]);
    await add.click();
    modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "添加", exact: true }).click();
    await modal.getByRole("alert").filter({ hasText: "192 kbps" }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.toolkit.call("state")),
      before,
    );
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await fs.writeFile(valid, makeSound({ nominal: 192000 }));
    await pick([f.directory]);
    await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("heading", { name: "操作提示", exact: true })
      .waitFor();
    assert.match(await modal.locator(".notice-text").innerText(), /192 kbps/);
    assert.equal(
      (await fs.readdir(f.directory)).some((name) => name.endsWith(".zip")),
      false,
    );
    assert.deepEqual(
      await page.evaluate(() => window.toolkit.call("state")),
      before,
    );
    console.log(
      "PASS 128 kbps guidance, high-rate add/batch rejection, exact-limit add and replaced-source export rejection in Electron UI",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
