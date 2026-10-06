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
