const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

test("texture additions create variants without changing existing selections; names follow until customized", async () => {
  const { addTextures, renameTexture, fillSkinVariants } =
    await import("../src/model-resources.mjs");
  const old = { Textures: [{ Name: "旧贴图", Path: "old.png" }], SkinList: [] };
  let entry = addTextures(old, [
    { Name: "Blue", Path: "blue.png" },
    { Name: "Orange", Path: "orange.png" },
  ]);
  assert.deepEqual(
    entry.SkinList.map((s) => s.SkinId),
    [1, 2],
  );
  entry = renameTexture(entry, 1, "蓝机器人");
  assert.equal(entry.SkinList[0].Name, "蓝机器人");
  entry.SkinList[0].Name = "手工名称";
  entry.SkinList[0].By = "作者";
  entry = renameTexture(entry, 1, "蓝色贴图");
  assert.equal(entry.SkinList[0].Name, "手工名称");
  const filled = fillSkinVariants(entry);
  assert.deepEqual(
    filled.SkinList.map((s) => s.SkinId),
    [1, 2, 0],
  );
  assert.deepEqual(filled.SkinList[0], entry.SkinList[0]);
  assert.deepEqual(fillSkinVariants(filled), filled);
  assert.deepEqual(
    old.SkinList,
    [],
    "adding variants never mutates the original entry",
  );
  assert.throws(
    () => addTextures({ Textures: Array(64).fill({}), SkinList: [] }, [{}]),
    /最多支持 64/,
  );
});

test("changing default reorders textures and variant references together; deletion keeps matching authors", async () => {
  const { setDefaultTexture, removeTexture } =
    await import("../src/model-resources.mjs");
  const entry = {
    Textures: ["A", "B", "C"],
    SkinList: [0, 1, 2].map((i) => ({
      SkinId: i,
      Name: "ABC"[i],
      By: "author" + i,
    })),
  };
  const selected = setDefaultTexture(entry, 2);
  assert.deepEqual(selected.Textures, ["C", "A", "B"]);
  for (const skin of selected.SkinList)
    assert.equal(selected.Textures[skin.SkinId], skin.Name);
  assert.deepEqual(
    selected.SkinList.map((s) => s.By),
    entry.SkinList.map((s) => s.By),
  );
  assert.deepEqual(entry.Textures, ["A", "B", "C"]);
  assert.equal(setDefaultTexture(entry, 0), entry);
  assert.throws(() => setDefaultTexture(entry, 3), /编号无效/);
  const invalidRows = [{ SkinId: "" }, { SkinId: -1 }, { SkinId: 4 }];
  assert.deepEqual(
    setDefaultTexture({ ...entry, SkinList: invalidRows }, 2).SkinList,
    invalidRows,
    "reordering must not turn invalid manual input into a valid ID",
  );
  const removed = removeTexture(selected, 0);
  assert.deepEqual(removed.Textures, ["A", "B"]);
  for (const skin of removed.SkinList)
    assert.equal(removed.Textures[skin.SkinId], skin.Name);
});

test("selected default and automatically generated variants survive real backend ZIP and project round-trips", async (t) => {
  const { addTextures, setDefaultTexture } =
    await import("../src/model-resources.mjs");
  const f = await fixture();
  const backend = new Backend(
    path.resolve(
      process.env.MCNPC_TEST_BACKEND ||
        "backend/bin/Release/net48/NpcSkinMaker.Backend.exe",
    ),
  );
  t.after(async () => {
    if (backend.process.exitCode === null) {
      const exited = once(backend.process, "exit");
      backend.close();
      await exited;
    }
    await removeFixture(f.directory);
  });
  const entry = setDefaultTexture(
    addTextures(
      {
        DisplayName: "机器人",
        CustomName: "default_robot",
        GeoPath: f.geo,
        Textures: [],
        SkinList: [],
      },
      [
        { Name: "Blue", Path: f.texture },
        { Name: "Orange", Path: f.invalid },
      ],
    ),
    1,
  );
  entry.SkinList[1].By = "作者";
  await backend.call("models.save", { index: -1, entry });
  const expected = entry.SkinList;
  const project = path.join(f.directory, "default.dgnproject");
  await backend.call("project.save", { path: project });
  const restored = (await backend.call("project.open", { path: project })).state
    .models[0];
  assert.equal(restored.Textures[0].Name, "Orange");
  assert.deepEqual(restored.SkinList, expected);
  const result = await backend.call("models.export", {
    directory: f.directory,
  });
  const inspect = spawnSync(
    "python",
    [
      "-c",
      String.raw`import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 config=json.loads(z.read(next(n for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json'))))['npcmodelslist'][0]
 assert config['skin_list']==json.loads(sys.argv[3])
 texture=next(n for n in z.namelist() if n.endswith('/default_robot_dlcnpc/texture_0.png'))
 assert z.read(texture)==open(sys.argv[2],'rb').read()
 preview=next(n for n in z.namelist() if n.endswith('/textures/ui/dlcnpc_models/default_robot_dlcnpc.png'))
 assert z.read(preview)==open(sys.argv[2],'rb').read()
`,
      result.path,
      f.invalid,
      JSON.stringify(
        expected.map((s) => ({ skinid: s.SkinId, name: s.Name, by: s.By })),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(inspect.status, 0, inspect.stderr);
  const imported = (await backend.call("models.import", { path: result.path }))
    .state.models[0];
  assert.equal(imported.Textures[0].Name, "Orange");
  assert.deepEqual(imported.SkinList, expected);
});
