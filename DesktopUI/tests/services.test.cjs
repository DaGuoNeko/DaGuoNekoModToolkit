const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  Settings,
  Studio,
  globalConfigs,
  atomicJson,
  readJson,
  runPython,
} = require("../electron/services.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

test("legacy preferences migrate without custom fonts; queued updates preserve unrelated settings", async (t) => {
  const f = await fixture();
  t.after(() => removeFixture(f.directory));
  await atomicJson(path.join(f.directory, "settings.json"), {
    FontFamilyName: "Microsoft Yi Baiti",
    AppearanceMode: "Dark",
    ThemeHue: 210,
    LastOutputDir: "C:\\example",
  });
  const settings = new Settings(f.directory);
  await settings.load();
  assert.equal(settings.value.AppearanceMode, "Dark");
  assert.equal(settings.value.LastOutputDir, "C:\\example");
  assert.equal(settings.value.FontFamilyName, undefined);
  assert.equal(settings.value.ShowModDeveloperTools, false);
  assert.equal(settings.value.BgImageOpacity, 0.06);
  assert.equal(settings.value.BgImageBlur, 0);
  assert.equal(settings.value.BgImageScale, 1);
  await Promise.all([
    settings.update({ ThemeHue: 140 }),
    settings.update({ SidebarCollapsed: true }),
    settings.update({ ShowModDeveloperTools: true }),
  ]);
  assert.equal(settings.value.ThemeHue, 140);
  assert.equal(settings.value.SidebarCollapsed, true);
  const saved = await readJson(settings.file);
  assert.equal(saved.FontFamilyName, undefined);
  assert.equal(
    (await new Settings(f.directory).load()).ShowModDeveloperTools,
    true,
  );
  await assert.rejects(settings.update({ ShowModDeveloperTools: "false" }));
  await settings.update({ ShowModDeveloperTools: false });
  assert.equal(
    (await new Settings(f.directory).load()).ShowModDeveloperTools,
    false,
  );
  await assert.rejects(settings.update({ FontFamilyName: "Arial" }));
  await settings.update({ AppearanceMode: "Light" });
  assert.equal(settings.value.AppearanceMode, "Light");
  await settings.update({ BgImageOpacity: 0 });
  assert.equal((await new Settings(f.directory).load()).BgImageOpacity, 0);
  await settings.update({ BgImageOpacity: 1 });
  assert.equal((await new Settings(f.directory).load()).BgImageOpacity, 1);
  for (const BgImageOpacity of [-1, 1.01, NaN, Infinity, "0.5"])
    await assert.rejects(settings.update({ BgImageOpacity }));
  assert.equal((await new Settings(f.directory).load()).BgImageOpacity, 1);
  await atomicJson(settings.file, { BgImageOpacity: 200 });
  assert.equal((await new Settings(f.directory).load()).BgImageOpacity, 0.06);
  for (const [key, min, max] of [
    ["BgImageBlur", 0, 30],
    ["BgImageScale", 1, 2],
  ]) {
    for (const value of [min, max]) {
      await settings.update({ [key]: value });
      assert.equal((await new Settings(f.directory).load())[key], value);
    }
    for (const value of [min - 1, max + 1, NaN, Infinity, "1"])
      await assert.rejects(settings.update({ [key]: value }));
    assert.equal((await new Settings(f.directory).load())[key], max);
    await atomicJson(settings.file, { [key]: max + 1 });
    assert.equal((await new Settings(f.directory).load())[key], min);
  }
});
test("external Python tool preserves Unicode stdin and drains both output streams", async (t) => {
  const f = await fixture();
  t.after(() => removeFixture(f.directory));
  const script = path.join(f.directory, "tool.py");
  await fs.writeFile(
    script,
    'import sys\nvalue=sys.stdin.read()\nprint(value)\nsys.stdout.write("x"*100000)\nsys.stderr.write("y"*100000)\n',
    "utf8",
  );
  const result = await runPython(script, f.directory, ["测试名称", "y", "n"]);
  assert.match(result.output, /测试名称/);
  assert.equal(result.warnings.length, 100000);
  await fs.writeFile(
    script,
    'import sys\nprint("failure",file=sys.stderr)\nsys.exit(2)\n',
  );
  await assert.rejects(runPython(script, f.directory, []), /failure/);
});
test("project/save/config operations keep unrelated fields and create recoverable backups", async (t) => {
  const f = await fixture();
  t.after(() => removeFixture(f.directory));
  const local = path.join(f.directory, "local"),
    roaming = path.join(f.directory, "roaming"),
    download = path.join(f.directory, "download");
  await atomicJson(
    path.join(local, "Netease", "MCStudio", "config", "app", "app.conf"),
    { X64EditorPath: path.join(download, "MCX64Editor", "editor.exe") },
  );
  const projectFile = path.join(
    download,
    "work",
    "account",
    "Cpp",
    "AddOn",
    "project",
    "work.mcscfg",
  );
  await atomicJson(projectFile, {
    Name: "示例项目",
    UID: "sample-uid",
    CustomWorkDir: "old",
    Preserve: { value: 42 },
  });
  const saveFile = path.join(
    download,
    "game",
    "config",
    "account",
    "Cpp",
    "MC_GAME",
    "save.json",
  );
  await atomicJson(saveFile, {
    MainComponentId: "sample-uid",
    version: "1.0",
    world_info: { level_id: "level1" },
    Preserve: true,
  });
  const studio = new Studio(local, roaming),
    projects = await studio.list();
  assert.equal(projects.entries.length, 1);
  await studio.changePath("project", f.directory);
  assert.deepEqual((await readJson(projectFile)).Preserve, { value: 42 });
  assert.equal(
    (await readJson(projectFile + ".mcnpc.bak")).CustomWorkDir,
    "old",
  );
  const saves = await studio.testSaves("project");
  assert.equal(saves.entries.length, 1);
  await studio.changeVersion(saveFile, "2.0");
  assert.equal((await readJson(saveFile)).Preserve, true);
  assert.equal((await readJson(saveFile + ".mcnpc.bak")).version, "1.0");
  await assert.rejects(studio.changeVersion(projectFile, "3.0"));
  const config = path.join(
    roaming,
    "MinecraftPC_Netease_PB",
    "storge",
    "stream",
    "users",
    "player",
    "config",
    "example.json",
  );
  await atomicJson(config, { money: 10 });
  const files = await globalConfigs(roaming, "正式端", "player");
  assert.equal(files.entries.length, 1);
  assert.equal(files.player, "player");
});

test("global configs include direct config folders alongside player folders on both channels", async (t) => {
  const f = await fixture();
  t.after(() => removeFixture(f.directory));
  for (const [channel, folder] of [
    ["正式端", "MinecraftPC_Netease_PB"],
    ["测试端", "MinecraftPE_Netease"],
  ]) {
    const root = path.join(f.directory, folder, "storge/stream/users");
    const direct = path.join(root, "config", "direct.json");
    await atomicJson(direct, { direct: true });
    let result = await globalConfigs(f.directory, channel, "");
    assert.equal(result.player, "config");
    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      [direct],
    );
    await atomicJson(path.join(root, "config", "nested", "ignored.json"), {});
    const personal = path.join(root, "player-01", "config", "player.json");
    await atomicJson(personal, { player: true });
    await fs.mkdir(path.join(root, "not-a-player"));
    result = await globalConfigs(f.directory, channel, "");
    assert.deepEqual(result.players, ["player-01", "config"]);
    assert.equal(result.player, "player-01");
    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      [personal],
    );
    result = await globalConfigs(f.directory, channel, "config");
    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      [direct],
    );
    assert.equal(result.player, "config");
    assert.equal(
      (await globalConfigs(f.directory, channel, "../../")).player,
      "player-01",
    );
    await fs.unlink(direct);
    assert.deepEqual(
      (await globalConfigs(f.directory, channel, "config")).entries,
      [],
    );
  }
});
