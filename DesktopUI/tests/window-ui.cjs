const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture, removeFixture } = require("./fixtures.cjs");
const { atomicJson } = require("../electron/services.cjs");

(async () => {
  const f = await fixture();
  await atomicJson(path.join(f.directory, "profile/settings.json"), {
    AppearanceMode: "Light",
  });
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
      },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "NPC皮肤拓展", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      ),
    );
    assert.equal(
      await page.evaluate(() => navigator.windowControlsOverlay.visible),
      false,
      "native overlay removed",
    );
    assert.equal(await page.locator(".window-controls button").count(), 3);
    assert.equal(
      await page
        .locator(".app-bar")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("app-region")),
      "drag",
    );
    assert.equal(
      await page
        .locator(".window-controls")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("app-region")),
      "no-drag",
    );

    // Verify the full IPC/event path without showing, minimizing or maximizing a test window on the user's desktop.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const originals = {};
      for (const key of [
        "minimize",
        "maximize",
        "unmaximize",
        "isMaximized",
        "close",
      ])
        originals[key] = win[key].bind(win);
      globalThis.windowCalls = [];
      let maximized = false;
      win.isMaximized = () => maximized;
      win.minimize = () => globalThis.windowCalls.push("minimize");
      win.maximize = () => {
        globalThis.windowCalls.push("maximize");
        maximized = true;
        win.emit("maximize");
      };
      win.unmaximize = () => {
        globalThis.windowCalls.push("unmaximize");
        maximized = false;
        win.emit("unmaximize");
      };
      win.close = () => globalThis.windowCalls.push("close");
      globalThis.restoreWindowMethods = () => Object.assign(win, originals);
    });
    await page.getByRole("button", { name: "最小化窗口", exact: true }).click();
    await page.getByRole("button", { name: "最大化窗口", exact: true }).click();
    await page.getByRole("button", { name: "还原窗口", exact: true }).click();
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    assert.deepEqual(await app.evaluate(() => globalThis.windowCalls), [
      "minimize",
      "maximize",
      "unmaximize",
      "close",
    ]);
    const invalid = await page.evaluate(async () => {
      try {
        await window.toolkit.call("window.control", { action: "unsupported" });
        return "";
      } catch (error) {
        return error.message;
      }
    });
    assert.match(invalid, /不支持的窗口操作/);
    await app.evaluate(() => globalThis.restoreWindowMethods());

    await page
      .locator(".sidebar")
      .getByRole("button", { name: "NPC模型拓展", exact: true })
      .click();
    for (const mode of ["Light", "Dark"]) {
      await page.evaluate(
        (mode) =>
          window.toolkit.call("settings.update", { AppearanceMode: mode }),
        mode,
      );
      await page.waitForFunction(
        (mode) => document.documentElement.dataset.theme === mode.toLowerCase(),
        mode,
      );
      await page.getByRole("button", { name: "添加模型", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForFunction(() =>
        document.querySelector("dialog")?.matches(":modal"),
      );
      assert.equal(
        await page.evaluate(() => {
          const close = document.querySelector(".window-close");
          close.focus();
          return document.activeElement === close;
        }),
        false,
        "caption cannot receive focus behind modal",
      );
      assert.equal(
        await page.evaluate(
          () =>
            !!document
              .elementFromPoint(innerWidth - 20, 20)
              ?.closest(".window-controls"),
        ),
        false,
        "backdrop intercepts caption pointer hits",
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const capture = await app.evaluate(async ({ BrowserWindow }) => {
        const image =
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(
            undefined,
            { stayHidden: true, stayAwake: true },
          );
        const size = image.getSize(1),
          bitmap = image.toBitmap({ scaleFactor: 1 });
        const at = (x, y) => [
          ...bitmap.subarray(
            (y * size.width + x) * 4,
            (y * size.width + x) * 4 + 3,
          ),
        ];
        return {
          png: image.toPNG().toString("base64"),
          caption: at(size.width - 7, 20),
          nearby: at(size.width - 155, 20),
          width: size.width,
          height: size.height,
          bytes: bitmap.length,
        };
      });
      assert.equal(capture.bytes, capture.width * capture.height * 4);
      assert.ok(
        capture.caption.every(
          (value, i) => Math.abs(value - capture.nearby[i]) <= 3,
        ),
        `${mode}: caption and adjacent title bar share backdrop color`,
      );
      if (mode === "Light")
        assert.ok(
          capture.caption.every((value) => value < 190),
          "no white caption block",
        );
      await fs.mkdir("test-results", { recursive: true });
      await fs.writeFile(
        `test-results/window-modal-${mode.toLowerCase()}.png`,
        Buffer.from(capture.png, "base64"),
      );
      await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
      await page
        .getByRole("button", { name: "关闭窗口", exact: true })
        .waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS native overlay removed, caption IPC and maximize state, light/dark modal coverage and hit testing, drag regions",
    );
  } finally {
    if (app) await app.close();
    await removeFixture(f.directory);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
