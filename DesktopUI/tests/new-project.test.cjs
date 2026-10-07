const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

test("new projects reset only the selected workspace and regenerate pack identities, including empty or missing-source projects", async (t) => {
  const f = await fixture();
  const audio = path.join(f.directory, "sound.ogg");
  await fs.writeFile(audio, ogg());
  const backend = new Backend(
    path.resolve("backend/bin/Release/net48/NpcSkinMaker.Backend.exe"),
  );
  t.after(async () => {
    const exited = once(backend.process, "exit");
    backend.close();
    await exited;
    await removeFixture(f.directory);
  });
  const skin = { path: f.texture, name: "旧皮肤", author: "作者" };
  const model = {
    DisplayName: "旧模型",
    CustomName: "reset_test",
    GeoPath: f.geo,
    Textures: [{ Name: "默认", Path: f.texture }],
  };
  const resource = (kind) => ({
    Id: "old_id",
    Name: "旧资源",
    CategoryId: "test",
    CategoryName: "测试",
    Path: kind === "textures" ? f.invalid : audio,
  });
  await backend.call("skins.add", { items: [skin] });
  await backend.call("models.save", { index: -1, entry: model });
  for (const kind of ["textures", "sounds"]) {
    await backend.call(`${kind}.add`, { items: [resource(kind)] });
    await backend.call(`${kind}.settings`, {
      name: "旧包",
      author: "旧作者",
      version: "9.8.7",
      providerId: `legacy_${kind}`,
    });
  }
  const original = await backend.call("state");
  const savedProject = path.join(f.directory, "old.dgnproject");
  await backend.call("project.save", { path: savedProject });
  const savedBytes = await fs.readFile(savedProject);
  for (const kind of [undefined, "all", "invalid"])
    await assert.rejects(
      backend.call("project.new", { kind }),
      /不支持的项目类型/,
    );
  assert.deepEqual(await backend.call("state"), original);

  function manifestIds(archive) {
    const result = spawnSync(
      "python",
      [
        "-c",
        "import sys,zipfile,json\nwith zipfile.ZipFile(sys.argv[1]) as z:\n docs=[json.loads(z.read(n)) for n in z.namelist() if n.endswith('/manifest.json')]\n print(json.dumps([v for d in docs for v in [d['header']['uuid']]+[m['uuid'] for m in d['modules']]]))",
        archive,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  for (const kind of ["skins", "models"]) {
    const before = await backend.call("state");
    const oldIds = manifestIds(
      (await backend.call(`${kind}.export`, { directory: f.directory })).path,
    );
    const result = (await backend.call("project.new", { kind })).state;
    assert.deepEqual(result[kind], []);
    for (const key of Object.keys(before))
      if (key !== kind) assert.deepEqual(result[key], before[key]);
    if (kind === "skins") {
      await backend.call("skins.add", { items: [skin] });
      const current = (await backend.call("state")).skins[0];
      assert.match(current.Id, /^skin_[A-F0-9]{5}$/);
      assert.equal(current.FromImport, false);
    } else await backend.call("models.save", { index: -1, entry: model });
    const newIds = manifestIds(
      (await backend.call(`${kind}.export`, { directory: f.directory })).path,
    );
    for (const id of newIds) assert.ok(!oldIds.includes(id));
  }
  for (const [kind, key] of [
    ["textures", "texturePack"],
    ["sounds", "soundPack"],
  ]) {
    // Clearing remains useful when editing the same pack; new-project is a different operation.
    const beforeClear = await backend.call("state");
    await backend.call(`${kind}.clear`);
    assert.equal(
      (await backend.call("state"))[key].ProviderId,
      beforeClear[key].ProviderId,
    );
    await backend.call(`${kind}.add`, { items: [resource(kind)] });
    const before = await backend.call("state");
    const source = resource(kind).Path;
    await fs.rename(source, source + ".held");
    const result = (await backend.call("project.new", { kind })).state;
    await fs.rename(source + ".held", source);
    assert.deepEqual(result[kind], []);
    for (const field of [
      "ProviderId",
      "BehaviorUuid",
      "ResourceUuid",
      "BehaviorModuleUuid",
      "ResourceModuleUuid",
    ])
      assert.notEqual(result[key][field], before[key][field]);
    assert.equal(
      result[key].Name,
      kind === "textures" ? "我的贴图拓展包" : "我的音效拓展包",
    );
    assert.equal(result[key].Author, "");
    assert.equal(result[key].Version, "1.0.0");
    for (const field of Object.keys(before))
      if (field !== kind && field !== key)
        assert.deepEqual(result[field], before[field]);
    const again = (await backend.call("project.new", { kind })).state;
    assert.notEqual(again[key].ProviderId, result[key].ProviderId);
    assert.notEqual(again[key].ResourceUuid, result[key].ResourceUuid);
    await backend.call(`${kind}.add`, {
      items: [{ ...resource(kind), Id: "" }],
    });
    assert.notEqual((await backend.call("state"))[kind][0].Id, "old_id");
  }
  assert.deepEqual(await fs.readFile(savedProject), savedBytes);
  await fs.access(f.texture);
  await fs.access(f.invalid);
  await fs.access(f.geo);
  await fs.access(audio);
  const reopened = (await backend.call("project.open", { path: savedProject }))
    .state;
  assert.equal(reopened.skins[0].Id, original.skins[0].Id);
  assert.equal(reopened.texturePack.ProviderId, "legacy_textures");
  assert.equal(
    reopened.soundPack.ResourceUuid,
    original.soundPack.ResourceUuid,
  );
});
