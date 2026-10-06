const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

function python(code, ...args) {
  const result = spawnSync("python", ["-c", code, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function config(zip) {
  return JSON.parse(
    python(
      "import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n n=next(n for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json'));print(json.dumps(json.loads(z.read(n))))",
      zip,
    ),
  );
}
async function setup(t) {
  const f = await fixture();
  const backends = [];
  const create = () => {
    const backend = new Backend(
      path.resolve(
        process.env.MCNPC_TEST_BACKEND ||
          "backend/bin/Release/net48/NpcSkinMaker.Backend.exe",
      ),
    );
    backends.push(backend);
    return backend;
  };
  t.after(async () => {
    for (const backend of backends) {
      if (backend.process.exitCode !== null) continue;
      const exited = once(backend.process, "exit");
      backend.close();
      await exited;
    }
    await removeFixture(f.directory);
  });
  return { f, backend: create(), create };
}
function model(f, customName = "audit_model") {
  return {
    DisplayName: customName,
    CustomName: customName,
    GeoPath: f.geo,
    Textures: [{ Name: "默认", Path: f.texture }],
    AnimationFiles: [f.animation],
    AnimationList: ["animation.test.idle"],
    IdleAnimation: "animation.test.idle",
    SkinList: [{ SkinId: 0, Name: "默认", By: "作者" }],
  };
}
function skinZip(f, name, items) {
  const destination = path.join(f.directory, name);
  python(
    "import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('rp/modconfigs/a.json',json.dumps({'npcskinlist':json.loads(sys.argv[3])}));z.write(sys.argv[2],'rp/textures/entity/shared.png')",
    destination,
    f.texture,
    JSON.stringify(items),
  );
  return destination;
}

test("equal-content animation files round-trip and legacy duplicate project references recover", async (t) => {
  const { f, backend, create } = await setup(t);
  const duplicate = path.join(f.directory, "same-content.animation.json");
  await fs.copyFile(f.animation, duplicate);
  const entry = { ...model(f), AnimationFiles: [f.animation, duplicate] };
  await backend.call("models.save", { index: -1, entry });
  const project = path.join(f.directory, "animations.dgnproject");
  await backend.call("project.save", { path: project });
  const references = JSON.parse(
    python(
      "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps(json.loads(z.read('project.json'))['models'][0]['AnimationFiles']))",
      project,
    ),
  );
  assert.equal(
    references.length,
    1,
    "saved manifest contains one reference to the shared animation asset",
  );
  assert.equal(
    (await backend.call("state")).models[0].AnimationFiles.length,
    2,
    "saving does not mutate the current editing session",
  );
  const legacy = path.join(f.directory, "legacy-duplicates.dgnproject");
  python(
    String.raw`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2],'w') as target:
 for item in source.infolist():
  data=source.read(item.filename)
  if item.filename=='project.json':
   manifest=json.loads(data);files=manifest['models'][0]['AnimationFiles'];files.append(files[0]);data=json.dumps(manifest).encode('utf-8')
  target.writestr(item,data)`,
    project,
    legacy,
  );
  const exited = once(backend.process, "exit");
  backend.close();
  await exited;
  await Promise.all([f.animation, duplicate].map((file) => fs.unlink(file)));
  const restored = create();
  for (const archive of [project, legacy]) {
    const state = (await restored.call("project.open", { path: archive }))
      .state;
    assert.equal(state.models[0].AnimationFiles.length, 1);
    assert.equal(state.models[0].IdleAnimation, "animation.test.idle");
    const output = await restored.call("models.export", {
      directory: f.directory,
    });
    assert.ok((await fs.stat(output.path)).size > 0);
    await restored.call("project.save", {
      path: path.join(f.directory, "resaved.dgnproject"),
    });
    await restored.call("project.open", {
      path: path.join(f.directory, "resaved.dgnproject"),
    });
    assert.equal(
      (await restored.call("state")).models[0].AnimationFiles.length,
      1,
    );
  }
});

test("game ZIP text is strict UTF-8 without BOM; Unicode content and binary inputs remain intact", async (t) => {
  const { f, backend } = await setup(t);
  const inputs = [];
  const formats = [
    ["audit.lang", "utf-8-sig"],
    ["audit.fragment", "utf-16-be"],
    ["audit.vertex", "utf-16-le"],
    ["audit.material", "utf-32-le"],
    ["audit.txt", "utf-32-be"],
    ["audit.py", "utf-16-le"],
  ];
  for (const [name, encoding] of formats) {
    const file = path.join(f.directory, name);
    const text = name.endsWith(".py")
      ? "# coding: utf-16\nlabel = '中文😀'\n"
      : "编码保真：中文😀\n";
    python(
      String.raw`import sys
from pathlib import Path
boms={'utf-16-le':b'\xff\xfe','utf-16-be':b'\xfe\xff','utf-32-le':b'\xff\xfe\x00\x00','utf-32-be':b'\x00\x00\xfe\xff'}
Path(sys.argv[1]).write_bytes(boms.get(sys.argv[2],b'')+sys.argv[3].encode(sys.argv[2]))`,
      file,
      encoding,
      text,
    );
    inputs.push({ RelativePath: `audit/${name}`, Path: file });
  }
  // Exercise structured input reads, not only final ZIP normalization.
  const animation = JSON.parse(await fs.readFile(f.animation, "utf8"));
  animation.audit = "中文😀";
  python(
    String.raw`import sys,json
from pathlib import Path
Path(sys.argv[1]).write_bytes(b'\x00\x00\xfe\xff'+sys.argv[2].encode('utf-32-be'))`,
    f.animation,
    JSON.stringify(animation),
  );
  const binary = path.join(f.directory, "binary.ogg");
  await fs.writeFile(
    binary,
    Buffer.from([0x4f, 0x67, 0x67, 0x53, 0xff, 0xfe, 0x00, 0x80]),
  );
  inputs.push({ RelativePath: "audit/binary.ogg", Path: binary });
  const original = await Promise.all(
    inputs.map(async (r) => [r.Path, await fs.readFile(r.Path)]),
  );
  const entry = { ...model(f), AdditionalResources: inputs };
  await backend.call("models.save", { index: -1, entry });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  python(
    String.raw`import sys,zipfile,json
from pathlib import Path
text_exts={'.json','.py','.material','.lang','.txt','.fragment','.vertex'}
boms=(b'\xef\xbb\xbf',b'\xff\xfe',b'\xfe\xff',b'\x00\x00\xfe\xff')
with zipfile.ZipFile(sys.argv[1]) as z:
 count=0
 for n in z.namelist():
  raw=z.read(n)
  if Path(n).suffix.lower() in text_exts:
   count+=1;assert not raw.startswith(boms),n;text=raw.decode('utf-8');assert '\ufffd' not in text,n
   if '/audit/' in n:assert '中文😀' in text,n
   if n.endswith('/audit/audit.py'):assert text.startswith('# coding: utf-8\n'),text
 assert count>=24
 binary=next(n for n in z.namelist() if n.endswith('/audit/binary.ogg'));assert z.read(binary)==Path(sys.argv[2]).read_bytes()
 png=next(n for n in z.namelist() if n.endswith('/texture_0.png'));assert z.read(png)==Path(sys.argv[3]).read_bytes()
print('UTF-8/BOM/content/binary scan passed')`,
    output.path,
    binary,
    f.texture,
  );
  for (const [file, bytes] of original)
    assert.deepEqual(await fs.readFile(file), bytes);
  const project = path.join(f.directory, "unicode.dgnproject");
  await backend.call("project.save", { path: project });
  python(
    String.raw`import sys,zipfile
from pathlib import Path
with zipfile.ZipFile(sys.argv[1]) as z:
 assert not z.read('project.json').startswith(b'\xef\xbb\xbf')
 values={z.read(n) for n in z.namelist() if n.startswith('assets/')}
 assert Path(sys.argv[2]).read_bytes() in values
 assert Path(sys.argv[3]).read_bytes() in values`,
    project,
    inputs[0].Path,
    binary,
  );
});

test("invalid or unknown text encodings fail explicitly without corrupting state or creating ZIPs", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f) });
  const gbkAnimation = path.join(f.directory, "gbk.animation.json");
  const animation = await fs.readFile(f.animation);
  const json = animation
    .toString("utf8")
    .replace('"animations":', '"audit":"PLACEHOLDER","animations":');
  const parts = json.split("PLACEHOLDER");
  await fs.writeFile(
    gbkAnimation,
    Buffer.concat([
      Buffer.from(parts[0]),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      Buffer.from(parts[1]),
    ]),
  );
  await assert.rejects(
    backend.call("models.save", {
      index: 0,
      entry: { ...model(f), AnimationFiles: [gbkAnimation] },
    }),
    /gbk\.animation\.json/,
  );
  assert.deepEqual((await backend.call("state")).models[0].AnimationFiles, [
    f.animation,
  ]);
  const invalid = [
    ["gbk.fragment", [0xd6, 0xd0, 0xce, 0xc4]],
    ["truncated.lang", [0xef, 0xbb, 0xbf, 0xe4, 0xb8]],
    ["surrogate.txt", [0xff, 0xfe, 0x00, 0xd8]],
    ["scalar.txt", [0xff, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x11, 0x00]],
    ["no-bom.lang", [0x41, 0, 0x42, 0]],
    ["unsupported.txt", [0x2b, 0x2f, 0x76, 0x38, 0x2d]],
  ];
  for (const [name, bytes] of invalid) {
    const file = path.join(f.directory, name);
    await fs.writeFile(file, Buffer.from(bytes));
    await backend.call("models.save", {
      index: 0,
      entry: {
        ...model(f),
        AdditionalResources: [{ RelativePath: `audit/${name}`, Path: file }],
      },
    });
    await assert.rejects(
      backend.call("models.export", { directory: f.directory }),
      (error) => error.message.includes(name),
    );
    assert.equal(
      (await backend.call("state")).models[0].AdditionalResources[0].Path,
      file,
    );
    assert.equal(
      (await fs.readdir(f.directory)).filter((n) => n.endsWith(".zip")).length,
      0,
    );
  }
});

test("skin ZIP config BOMs convert safely and GBK config rejection preserves the session", async (t) => {
  const { f, backend } = await setup(t);
  const original = skinZip(f, "utf8.zip", [
    {
      ID: "encoding_skin",
      name: "中文皮肤",
      texture: "textures/entity/shared",
    },
  ]);
  const unicode = path.join(f.directory, "utf16.zip"),
    unknown = path.join(f.directory, "gbk.zip");
  python(
    String.raw`import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as source:
 for destination,encoding in [(sys.argv[2],'utf-16'),(sys.argv[3],'gbk')]:
  with zipfile.ZipFile(destination,'w') as target:
   for item in source.infolist():
    data=source.read(item.filename)
    if item.filename.endswith('.json'):data=json.dumps(json.loads(data),ensure_ascii=False).encode(encoding)
    target.writestr(item.filename,data)`,
    original,
    unicode,
    unknown,
  );
  const state = (await backend.call("skins.import", { path: unicode })).state;
  assert.equal(state.skins[0].Name, "中文皮肤");
  const output = await backend.call("skins.export", { directory: f.directory });
  assert.equal(config(output.path).npcskinlist[0].name, "中文皮肤");
  await assert.rejects(
    backend.call("skins.import", { path: unknown }),
    /rp\/modconfigs\/a\.json/,
  );
  assert.deepEqual((await backend.call("state")).skins, state.skins);
});

test("skin IDs remain stable across repeated exports and portable project reopening", async (t) => {
  const { f, backend, create } = await setup(t);
  const added = await backend.call("skins.add", {
    items: [{ path: f.texture, name: "守卫", author: "作者" }],
  });
  const id = added.state.skins[0].Id;
  assert.match(id, /^skin_[0-9A-F]{5}$/);
  const batch = await backend.call("skins.add", {
    items: Array.from({ length: 20 }, (_, i) => ({
      path: f.texture,
      name: `皮肤${i}`,
      author: "作者",
    })),
  });
  const ids = batch.state.skins.map((skin) => skin.Id);
  assert.equal(new Set(ids).size, ids.length);
  for (const generated of ids) assert.match(generated, /^skin_[0-9A-F]{5}$/);
  for (let i = 0; i < 2; i++) {
    const output = await backend.call("skins.export", {
      directory: f.directory,
    });
    assert.equal(config(output.path).npcskinlist[0].ID, id);
  }
  await backend.call("models.save", { index: -1, entry: model(f) });
  const project = path.join(f.directory, "test.dgnproject");
  await backend.call("project.save", { path: project });
  await backend.call("project.save", { path: project }); // atomic replacement
  const exited = once(backend.process, "exit");
  backend.close();
  await exited;
  await Promise.all(
    [f.texture, f.geo, f.animation].map((file) => fs.unlink(file)),
  );
  const restored = create();
  const state = (await restored.call("project.open", { path: project })).state;
  assert.equal(state.skins[0].Id, id);
  assert.equal(state.models[0].Identifier, "customnpc:audit_model_dlcnpc");
  assert.ok(
    (
      await fs.stat(
        (await restored.call("models.export", { directory: f.directory })).path,
      )
    ).size > 0,
  );
  const output = await restored.call("skins.export", {
    directory: f.directory,
  });
  assert.equal(config(output.path).npcskinlist[0].ID, id);
});

test("optional authors and shared skin textures round-trip; invalid imports preserve state", async (t) => {
  const { f, backend } = await setup(t);
  const shared = skinZip(f, "shared.zip", [
    { ID: "shared_a", name: "A", texture: "textures/entity/shared" },
    { ID: "shared_b", name: "B", texture: "textures/entity/shared" },
  ]);
  const state = (await backend.call("skins.import", { path: shared })).state;
  assert.equal(state.skins[0].Author, "NPC皮肤拓展");
  const output = await backend.call("skins.export", { directory: f.directory });
  assert.deepEqual(
    config(output.path).npcskinlist.map((s) => s.ID),
    ["shared_a", "shared_b"],
  );
  const invalid = skinZip(f, "invalid.zip", [
    { ID: "", name: "bad", texture: "textures/entity/shared" },
  ]);
  await assert.rejects(backend.call("skins.import", { path: invalid }), /非空/);
  assert.deepEqual((await backend.call("state")).skins, state.skins);
});

test("model validation rejects reserved names, missing/conflicting animations and truncated PNGs", async (t) => {
  const { f, backend } = await setup(t);
  await assert.rejects(
    backend.call("models.save", { index: -1, entry: model(f, "wolf") }),
    /内置/,
  );
  await assert.rejects(
    backend.call("models.save", {
      index: -1,
      entry: { ...model(f), IdleAnimation: "animation.missing" },
    }),
    /未找到/,
  );
  const truncated = path.join(f.directory, "truncated.png");
  await fs.writeFile(truncated, (await fs.readFile(f.texture)).subarray(0, 24));
  await assert.rejects(
    backend.call("models.save", {
      index: -1,
      entry: { ...model(f), Textures: [{ Path: truncated }] },
    }),
    /贴图/,
  );
  const conflict = path.join(f.directory, "conflict.animation.json");
  const data = JSON.parse(await fs.readFile(f.animation, "utf8"));
  data.animations["animation.test.idle"].bones.root.rotation = [10, 0, 0];
  await fs.writeFile(conflict, JSON.stringify(data));
  const duplicateDirectory = path.join(f.directory, "duplicate-name");
  await fs.mkdir(duplicateDirectory);
  const duplicateName = path.join(
    duplicateDirectory,
    path.basename(f.animation),
  );
  await fs.writeFile(duplicateName, JSON.stringify(data));
  await assert.rejects(
    backend.call("models.save", {
      index: -1,
      entry: { ...model(f), AnimationFiles: [f.animation, duplicateName] },
    }),
    /动画文件名重复/,
  );
  await backend.call("models.save", { index: -1, entry: model(f, "first") });
  await backend.call("models.save", {
    index: -1,
    entry: { ...model(f, "second"), AnimationFiles: [conflict] },
  });
  await assert.rejects(
    backend.call("models.export", { directory: f.directory }),
    /不同定义/,
  );
});

test("model ZIP round-trip preserves identifiers, resources and NPC render properties", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f, "first") });
  await backend.call("models.save", { index: -1, entry: model(f, "second") });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  const imported = (await backend.call("models.import", { path: output.path }))
    .state;
  assert.deepEqual(
    imported.models.map((m) => m.Identifier),
    ["customnpc:first_dlcnpc", "customnpc:second_dlcnpc"],
  );
  assert.equal(imported.models[0].Textures[0].Name, "默认");
  const again = await backend.call("models.export", { directory: f.directory });
  python(
    String.raw`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 for name in ['first','second']:
  entity=name+'_dlcnpc'
  b=json.loads(z.read(next(n for n in z.namelist() if n.endswith('/'+entity+'.json'))))['minecraft:entity']
  r=json.loads(z.read(next(n for n in z.namelist() if n.endswith('/'+entity+'.entity.json'))))['minecraft:client_entity']['description']
  assert b['description']['properties']['customnpc:outline_enabled']['client_sync']
  assert 'customnpc:render_effect_enabled' in b['description']['properties']
  assert r['materials']['default_customnpc_alpha']=='customnpc_tint_entity_alphatest'
  assert len(r['render_controllers'])==3
  for texture in r['textures'].values():
   if texture.startswith('textures/blocks/'):continue
   prefix=next(n.split('/entity/')[0] for n in z.namelist() if n.endswith('/'+entity+'.entity.json'))
   assert prefix+'/'+texture+'.png' in z.namelist()
 for n in z.namelist():
  if n.endswith(('.json','.py')):
   raw=z.read(n);assert not raw.startswith(b'\xef\xbb\xbf');raw.decode('utf-8')
print('render/resources/encoding passed')`,
    again.path,
  );
  await assert.rejects(backend.call("models.import", { path: f.texture }));
  assert.equal((await backend.call("state")).models.length, 2);
  await assert.rejects(backend.call("project.open", { path: f.texture }));
  assert.equal((await backend.call("state")).models.length, 2);
});

test("texture removal keeps variants attached to their original remaining texture", async () => {
  const { removeTexture, nextSkinId } =
    await import("../src/model-resources.mjs");
  const entry = {
    Textures: ["A", "B", "C"],
    SkinList: [{ SkinId: 1, Name: "B" }],
  };
  const next = removeTexture(entry, 0);
  assert.equal(next.Textures[next.SkinList[0].SkinId], "B");
  assert.equal(nextSkinId(next), 1);
  assert.deepEqual(removeTexture(next, 0).SkinList, []);
});

test("targeted model skins preserve actual IDs and target slots through ZIP and project round-trips", async (t) => {
  const { f, backend } = await setup(t);
  const targets = await backend.call("skin.targets");
  const wolf = targets.find(
    (item) => item.identifier === "customnpc:wolf_dlcnpc",
  );
  assert.ok(wolf.texture_slot);
  const added = await backend.call("skins.add", {
    items: [
      {
        path: f.invalid,
        name: "狼皮肤",
        author: "测试",
        targetIdentifier: wolf.identifier,
      },
      {
        path: f.invalid,
        name: "自定义模型皮肤",
        author: "测试",
        targetIdentifier: "customnpc:my_boss_dlcnpc",
        textureSlot: "wea",
      },
    ],
  });
  assert.equal(added.added, 2);
  assert.equal(added.state.skins[0].TextureSlot, wolf.texture_slot);
  const before = added.state.skins.map((skin) => skin.Id);
  const output = await backend.call("skins.export", { directory: f.directory });
  const records = config(output.path).npcskinlist;
  assert.equal(records[1].texture_slot, "wea");
  assert.deepEqual(
    records.map((skin) => skin.ID),
    before,
  );
  const imported = (await backend.call("skins.import", { path: output.path }))
    .state.skins;
  assert.equal(imported[1].TargetIdentifier, "customnpc:my_boss_dlcnpc");
  assert.equal(imported[1].OriginalId, before[1]);
  const project = path.join(f.directory, "targets.dgnproject");
  await backend.call("project.save", { path: project });
  await backend.call("project.open", { path: project });
  assert.equal((await backend.call("state")).skins[1].TextureSlot, "wea");
  await assert.rejects(
    backend.call("skins.update", {
      indices: [0],
      targetIdentifier: "",
      textureSlot: "skin_4",
      name: "人型",
      author: "测试",
    }),
    /皮肤尺寸/,
  );
  assert.equal((await backend.call("state")).skins[0].Name, "狼皮肤");
});

test("legacy identifiers and render-array skin order survive model import", async (t) => {
  const { f, backend } = await setup(t);
  const entry = model(f);
  entry.Textures.push({ Name: "另一张", Path: f.invalid });
  await backend.call("models.save", { index: -1, entry });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  const legacy = path.join(f.directory, "legacy.zip");
  python(
    String.raw`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 for n in source.namelist():
  data=source.read(n)
  if n.endswith('.json'):
   data=data.replace(b'customnpc:audit_model_dlcnpc',b'customnpc:wolf_dlcnpc')
   if n.endswith('audit_model_dlcnpc.render_controllers.json'):
    root=json.loads(data);c=root['render_controllers']['controller.render.audit_model_dlcnpc'];c['arrays']['textures']['Array.skinid'].reverse();data=json.dumps(root).encode()
  target.writestr(n,data)`,
    output.path,
    legacy,
  );
  const imported = (await backend.call("models.import", { path: legacy })).state
    .models[0];
  assert.equal(imported.Identifier, "customnpc:wolf_dlcnpc");
  assert.deepEqual(
    await fs.readFile(imported.Textures[0].Path),
    await fs.readFile(f.invalid),
  );
  const again = await backend.call("models.export", { directory: f.directory });
  assert.equal(
    config(again.path).npcmodelslist[0].identifier,
    "customnpc:wolf_dlcnpc",
  );
  const project = path.join(f.directory, "legacy.dgnproject");
  await backend.call("project.save", { path: project });
  await backend.call("project.open", { path: project });
  assert.equal(
    (await backend.call("state")).models[0].Identifier,
    "customnpc:wolf_dlcnpc",
  );
});
