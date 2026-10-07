const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const { atomicJson } = require("../electron/services.cjs");

(async () => {
  const f = await fixture();
  const local = path.join(f.directory, "local"),
    roaming = path.join(f.directory, "roaming"),
    download = path.join(f.directory, "download");
  await atomicJson(path.join(f.directory, "profile", "settings.json"), {
    AppearanceMode: "Light",
    ShowModDeveloperTools: true,
  });
  await atomicJson(path.join(local, "Netease/MCStudio/config/app/app.conf"), {
    X64EditorPath: path.join(download, "MCX64Editor/editor.exe"),
  });
  const accounts = [
    ...Array.from(
      { length: 24 },
      (_, i) => `creator${String(i + 1).padStart(2, "0")}@example.com`,
    ),
    "zeta@example.com",
  ];
  for (const account of accounts)
    await atomicJson(
      path.join(download, "work", account, "Cpp/AddOn/project/work.mcscfg"),
      { Name: `项目 ${account}`, UID: account },
    );
  for (const channel of ["MinecraftPC_Netease_PB", "MinecraftPE_Netease"]) {
    for (const player of ["player-01", "player-02"])
      await atomicJson(
        path.join(
          roaming,
          channel,
          "storge/stream/users",
          player,
          "config",
          `${player}.json`,
        ),
        { test: true },
      );
  }
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.MCNPC_TEST_EXE || undefined,
      args: [
        ...(process.env.MCNPC_TEST_EXE ? [] : ["."]),
        "--disable-features=CalculateNativeWinOcclusion",
      ],
      cwd: path.resolve("."),
      env: {
        ...process.env,
        MCNPC_HEADLESS: "1",
        MCNPC_DATA_DIR: path.join(f.directory, "profile"),
        MCNPC_LOCAL_DATA: local,
        MCNPC_ROAMING_DATA: roaming,
      },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      ),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    const nav = (name) =>
      page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
    const menu = page.getByRole("listbox");
    async function capture(name) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const bounds = await page.evaluate(() => {
        const trigger = document
          .querySelector('[role="combobox"][aria-expanded="true"]')
          .getBoundingClientRect();
        const popup = document
          .querySelector(".select-menu:popover-open")
          .getBoundingClientRect();
        const x = Math.max(
            0,
            Math.floor(Math.min(trigger.left, popup.left) - 8),
          ),
          y = Math.max(0, Math.floor(Math.min(trigger.top, popup.top) - 8));
        return {
          x,
          y,
          width: Math.ceil(Math.max(trigger.right, popup.right) - x + 8),
          height: Math.ceil(Math.max(trigger.bottom, popup.bottom) - y + 8),
        };
      });
      const image = await app.evaluate(
        async ({ BrowserWindow }, bounds) =>
          (
            await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              bounds,
              { stayHidden: true, stayAwake: true },
            )
          )
            .toPNG()
            .toString("base64"),
        bounds,
      );
      await fs.mkdir("test-results", { recursive: true });
      await fs.writeFile(
        `test-results/${name}.png`,
        Buffer.from(image, "base64"),
      );
    }
    await nav("MCStudio 项目");
    const account = page.getByRole("combobox", { name: "MCStudio 账号" });
    await page
      .getByRole("heading", { name: `项目 ${accounts[0]}`, exact: true })
      .waitFor();
    assert.equal(await page.locator("select").count(), 0);
    await account.click();
    await menu.waitFor();
    assert.equal(await menu.getByRole("option").count(), accounts.length + 1);
    const searchOptions = page.getByRole("searchbox", { name: "搜索选项" });
    await searchOptions.fill(accounts[1].toUpperCase());
    assert.equal(await menu.getByRole("option").count(), 1);
    await menu
      .getByRole("option", { name: accounts[1], exact: true })
      .waitFor();
    await searchOptions.fill("no-matching-account");
    await page.getByText("没有匹配的选项", { exact: true }).waitFor();
    await searchOptions.press("Enter");
    assert.equal(await account.getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: "清空选项搜索" }).click();
    assert.equal(await menu.getByRole("option").count(), accounts.length + 1);
    await capture("select-light");
    await menu.getByRole("option", { name: accounts[1], exact: true }).click();
    await page
      .getByRole("heading", { name: `项目 ${accounts[1]}`, exact: true })
      .waitFor();
    assert.equal(await account.getAttribute("aria-expanded"), "false");
    await account.press("ArrowDown");
    await account.press("End");
    await account.press("Enter");
    await page
      .getByRole("heading", { name: "项目 zeta@example.com", exact: true })
      .waitFor();
    await account.click();
    assert.ok(await menu.evaluate((element) => element.scrollTop > 0));
    await account.press("Escape");
    assert.equal(await menu.count(), 0);
    await account.click();
    await page
      .getByRole("heading", { name: "MCStudio 项目", exact: true })
      .click();
    assert.equal(await account.getAttribute("aria-expanded"), "false");
    await account.focus();
    await account.press("ArrowDown");
    await account.press("Home");
    await account.press("ArrowDown");
    await account.press("Enter");
    await page
      .getByRole("heading", { name: `项目 ${accounts[0]}`, exact: true })
      .waitFor();
    await account.press("z");
    await page
      .getByRole("heading", { name: "项目 zeta@example.com", exact: true })
      .waitFor();
    await account.press("ArrowDown");
    await account.press("Tab");
    assert.equal(await menu.count(), 0);
    assert.equal(
      await page
        .getByRole("textbox", { name: "搜索项目…" })
        .evaluate((element) => element === document.activeElement),
      true,
    );

    await nav("设置");
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await nav("MCStudio 项目");
    await page
      .getByRole("heading", { name: `项目 ${accounts[0]}`, exact: true })
      .waitFor();
    await account.click();
    await capture("select-dark");
    await account.press("Escape");

    await nav("存档全局配置");
    await page
      .getByRole("cell", { name: "player-01.json", exact: true })
      .waitFor();
    const channel = page.getByRole("combobox", { name: "游戏端" });
    await channel.click();
    await searchOptions.fill("测试");
    assert.equal(await menu.getByRole("option").count(), 1);
    await menu.getByRole("option", { name: "测试端", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".location-line")
        ?.textContent.includes("MinecraftPE_Netease"),
    );
    const player = page.getByRole("combobox", { name: "玩家", exact: true });
    await player.click();
    await menu.getByRole("option", { name: "player-02", exact: true }).click();
    await page
      .getByRole("cell", { name: "player-02.json", exact: true })
      .waitFor();

    await nav("开发者工具箱");
    const type = page.getByRole("combobox", { name: "类型", exact: true });
    await type.click();
    await searchOptions.fill("2");
    assert.equal(await menu.getByRole("option").count(), 1);
    await menu.getByRole("option", { name: "武器", exact: true }).click();
    await page.getByRole("spinbutton", { name: "耐久", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("spinbutton", { name: "堆叠数量", exact: true })
        .count(),
      0,
    );
    await type.press("ArrowDown");
    await type.press("End");
    await type.press("Enter");
    await page
      .getByRole("spinbutton", { name: "挖掘等级", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 650),
    );
    await type.scrollIntoViewIfNeeded();
    await type.evaluate((element) => {
      const main = element.closest("main");
      main.scrollTop +=
        element.getBoundingClientRect().bottom - (innerHeight - 20);
    });
    await type.click();
    const triggerRect = await type.boundingBox(),
      menuRect = await menu.boundingBox();
    assert.ok(
      menuRect.y + menuRect.height <= triggerRect.y,
      "menu flips upward near viewport edge",
    );
    assert.ok(menuRect.y >= 0 && menuRect.x >= 0, "menu stays on screen");
    await type.press("Escape");
    assert.deepEqual(errors, []);
    console.log(
      "PASS custom dropdown themes, pointer/keyboard selection, account/player routing, numeric item types, typeahead, scroll, outside/Escape/Tab dismissal and viewport placement",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
