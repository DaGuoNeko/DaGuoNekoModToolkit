const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

test("real C# skin/model packaging, transactional import and UTF-8 contract", async (t) => {
  const f = await fixture(),
    backend = new Backend(
      path.resolve("backend/bin/Release/net48/NpcSkinMaker.Backend.exe"),
    );
  t.after(async () => {
    const exited = once(backend.process, "exit");
    backend.close();
    await exited;
    await removeFixture(f.directory);
  });
  assert.deepEqual(await backend.call("state"), { skins: [], models: [] });
  const add = await backend.call("skins.add", {
    items: [
      { path: f.texture, name: "森林守卫", author: "测试作者" },
      { path: f.invalid, name: "错误皮肤", author: "测试" },
    ],
  });
  assert.equal(add.added, 1);
  assert.equal(add.errors.length, 1);
  assert.equal(add.state.skins[0].Name, "森林守卫");
  const output = await backend.call("skins.export", { directory: f.directory });
  assert.ok((await fs.stat(output.path)).size > 0);
  const imported = await backend.call("skins.import", { path: output.path });
  assert.equal(imported.state.skins[0].Name, "森林守卫");
  assert.equal(imported.state.skins[0].FromImport, true);
  const oldId = imported.state.skins[0].OriginalId;
  await assert.rejects(backend.call("skins.import", { path: f.texture }));
  assert.equal(
    (await backend.call("state")).skins[0].OriginalId,
    oldId,
    "failed import preserves session",
  );
  const model = {
    DisplayName: "测试模型",
    CustomName: "test_model",
    GeoPath: f.geo,
    Textures: [{ Name: "默认", Path: f.texture }],
    AnimationFiles: [f.animation],
    AnimationList: ["animation.test.idle"],
    IdleAnimation: "animation.test.idle",
    SkinList: [{ SkinId: 0, Name: "默认", By: "测试作者" }],
  };
  const saved = await backend.call("models.save", { index: -1, entry: model });
  assert.equal(saved.state.models[0].Identifier, "customnpc:test_model_dlcnpc");
  await assert.rejects(
    backend.call("models.save", { index: -1, entry: model }),
    /重复/,
  );
  const modelOutput = await backend.call("models.export", {
    directory: f.directory,
  });
  const roundTrip = await backend.call("skins.export", {
    directory: f.directory,
  });
  const check = spawnSync(
    "python",
    [
      "-c",
      String.raw`
import sys,zipfile,json
for p in sys.argv[1:]:
 with zipfile.ZipFile(p) as z:
  configs=[n for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json')]
  assert len(configs)==1
  assert len(configs[0].split('/')[-1])<=10
  cfg=json.loads(z.read(configs[0]))
  for n in z.namelist():
   if n.endswith(('.json','.py')):
    data=z.read(n);assert not data.startswith(b'\xef\xbb\xbf'),n;data.decode('utf-8')
  if 'npcmodelslist' in cfg:
   assert any(n.endswith('test.animation.json') for n in z.namelist())
   assert any(n.endswith('test_model_dlcnpc.render_controllers.json') for n in z.namelist())
  else:
   assert cfg['npcskinlist'][0]['name']=='森林守卫'
print('ZIP contracts passed')
`,
      output.path,
      modelOutput.path,
      roundTrip.path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
  const state = await backend.call("state");
  assert.equal(state.skins[0].OriginalId, oldId);
});
