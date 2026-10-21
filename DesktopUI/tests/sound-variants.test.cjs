const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");
const { makeSound } = require("./ogg-bitrate-fixtures.cjs");

function python(code, ...args) {
  const result = spawnSync("python", ["-X", "utf8", "-c", code, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function setup(t) {
  const f = await fixture(),
    sessions = [];
  f.a = path.join(f.directory, "僵尸叫声甲.ogg");
  f.b = path.join(f.directory, "僵尸叫声乙.ogg");
  await fs.writeFile(f.a, ogg());
  await fs.writeFile(f.b, ogg());
  const create = () => {
    const backend = new Backend(
      path.resolve("backend/bin/Release/net48/NpcSkinMaker.Backend.exe"),
    );
    sessions.push(backend);
    return backend;
  };
  t.after(async () => {
    for (const backend of sessions)
      if (backend.process.exitCode === null) {
        const exited = once(backend.process, "exit");
        backend.close();
        await exited;
      }
    await removeFixture(f.directory);
  });
  return { f, backend: create(), create };
}
const group = (f, SoundFiles = [f.a, f.b]) => ({
  Id: "zombie_say",
  Name: "僵尸叫声",
  Path: f.a,
  SoundFiles,
  CategoryId: "mobs",
  CategoryName: "生物音效",
  Stream: true,
  Volume: 0.6,
  Pitch: 1.1,
});
const add = (backend, entry) => backend.call("sounds.add", { items: [entry] });
function archive(file) {
  return JSON.parse(
    python(
      String.raw`import sys,zipfile,json,ast
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 if 'project.json' in names:
  doc=json.loads(z.read('project.json'));print(json.dumps({'document':doc,'assets':[n for n in names if n.startswith('assets/')]}))
 else:
  config=next(n for n in names if '/modconfigs/' in n and n.endswith('.json'))
  doc=json.loads(z.read(config));provider=doc['pack']['ProviderId']
  definitions=json.loads(z.read(provider+'R/sounds/sound_definitions.json'))['sound_definitions']
  registration=ast.literal_eval(ast.parse(z.read(provider+'B/'+provider+'Scripts/config.py').decode('utf-8')).body[-1].value)
  for name in names:
   if name.endswith(('.json','.py')):
    raw=z.read(name);assert not raw.startswith(b'\xef\xbb\xbf');raw.decode('utf-8')
  for entry in doc['pack']['Entries']:
   for source in entry.get('SoundFiles',[entry['Path']]): assert provider+'R/'+source in names
  assert z.testzip() is None
  print(json.dumps({'document':doc,'definitions':definitions,'registration':registration,'files':names}))
`,
      file,
    ),
  );
}

test("one sound ID exports ordered native candidates without colliding with neighboring IDs", async (t) => {
  const { f, backend } = await setup(t);
  await add(backend, group(f));
  await add(backend, {
    ...group(f),
    Id: "zombie_say_variant_1",
    SoundFiles: null,
  });
  const state = await backend.call("state");
  assert.equal(state.sounds.length, 2);
  assert.equal(state.sounds[0].Path, f.a);
  const exported = (
    await backend.call("sounds.export", { directory: f.directory })
  ).path;
  const result = archive(exported),
    provider = state.soundPack.ProviderId;
  assert.equal(result.document.version, 2);
  assert.deepEqual(
    result.definitions[`${provider}.zombie_say`].sounds,
    [1, 2].map((index) => ({
      name: `sounds/${provider}/zombie_say/variant_${index}`,
      stream: true,
      load_on_low_memory: true,
    })),
  );
  assert.equal(Object.keys(result.definitions).length, 2);
  assert.equal(result.registration.length, 2);
  assert.equal(result.registration[0].sound, `${provider}.zombie_say`);
  assert.equal(result.registration[0].volume, 0.6);
  assert.equal(
    result.document.pack.Entries[0].Path,
    result.document.pack.Entries[0].SoundFiles[0],
  );
  const reopened = (await backend.call("sounds.import", { path: exported }))
    .state;
  assert.equal(reopened.sounds[0].SoundFiles.length, 2);
  for (const file of reopened.sounds[0].SoundFiles)
    assert.deepEqual(await fs.readFile(file), ogg());
  assert.equal(reopened.soundPack.ProviderId, provider);
});

test("legacy single files retain old paths/schema and can expand then shrink without changing IDs", async (t) => {
  const { f, backend } = await setup(t);
  await add(backend, { ...group(f), SoundFiles: null });
  const state = await backend.call("state"),
    provider = state.soundPack.ProviderId;
  const oldZip = (
    await backend.call("sounds.export", { directory: f.directory })
  ).path;
  const legacy = archive(oldZip);
  assert.equal(legacy.document.version, 1);
  assert.equal(
    legacy.document.pack.Entries[0].Path,
    `sounds/${provider}/zombie_say.ogg`,
  );
  const oldProject = path.join(f.directory, "single.dgnproject");
  await backend.call("project.save", { path: oldProject });
  assert.equal(archive(oldProject).document.version, 2);
  await backend.call("sounds.import", { path: oldZip });
  await backend.call("sounds.save", { index: 0, entry: group(f) });
  const expanded = await backend.call("state");
  assert.equal(expanded.sounds[0].SoundFiles.length, 2);
  await backend.call("sounds.save", {
    index: 0,
    entry: { ...expanded.sounds[0], SoundFiles: [f.b] },
  });
  const shrunk = await backend.call("state");
  assert.equal(shrunk.sounds[0].Path, f.b);
  assert.equal(shrunk.sounds[0].Id, "zombie_say");
  assert.equal(shrunk.soundPack.ProviderId, provider);
  const final = archive(
    (await backend.call("sounds.export", { directory: f.directory })).path,
  );
  assert.equal(final.document.version, 1);
  assert.equal(final.definitions[`${provider}.zombie_say`].sounds.length, 1);
});

test("portable groups restore every slot after sources disappear, preserving equal-content slot multiplicity", async (t) => {
  const { f, backend, create } = await setup(t);
  await add(backend, group(f, [f.a, f.b, f.a]));
  const before = await backend.call("state"),
    project = path.join(f.directory, "group.dgnproject");
  await backend.call("project.save", { path: project });
  assert.deepEqual(await backend.call("state"), before);
  const saved = archive(project);
  assert.equal(saved.document.version, 3);
  assert.equal(
    saved.assets.length,
    1,
    "equal-content candidates share archive storage",
  );
  assert.equal(saved.document.soundPack.Entries[0].SoundFiles.length, 3);
  await fs.unlink(f.a);
  await fs.unlink(f.b);
  const restored = create();
  const state = (await restored.call("project.open", { path: project })).state;
  assert.equal(state.sounds[0].SoundFiles.length, 3);
  assert.equal(new Set(state.sounds[0].SoundFiles).size, 1);
  assert.equal(state.sounds[0].Path, state.sounds[0].SoundFiles[0]);
  const output = archive(
    (await restored.call("sounds.export", { directory: f.directory })).path,
  );
  assert.equal(
    output.definitions[`${before.soundPack.ProviderId}.zombie_say`].sounds
      .length,
    3,
  );
  assert.equal(output.registration.length, 1);
});

test("invalid secondary files, empty groups and excessive groups fail atomically", async (t) => {
  const { f, backend } = await setup(t);
  const high = path.join(f.directory, "高码率候选.ogg");
  await fs.writeFile(high, makeSound({ nominal: 192000 }));
  const before = await backend.call("state");
  for (const files of [
    [],
    [f.a, ""],
    [f.a, null],
    [f.a, high],
    [f.a, f.geo],
    [f.a, path.join(f.directory, "missing.ogg")],
    Array(1001).fill(f.a),
  ]) {
    await assert.rejects(add(backend, group(f, files)));
    assert.deepEqual(await backend.call("state"), before);
  }
  await assert.rejects(
    backend.call("textures.add", { items: [{ ...group(f), Path: f.invalid }] }),
    /贴图/,
  );
  assert.deepEqual(await backend.call("state"), before);
});

test("secondary source changes are rechecked before export or replacing a saved project", async (t) => {
  const { f, backend } = await setup(t);
  await add(backend, group(f));
  const project = path.join(f.directory, "original.dgnproject");
  await backend.call("project.save", { path: project });
  const original = await fs.readFile(project),
    before = await backend.call("state");
  await fs.writeFile(f.b, makeSound({ nominal: 192000 }));
  await assert.rejects(
    backend.call("sounds.export", { directory: f.directory }),
    /192 kbps/,
  );
  await assert.rejects(
    backend.call("project.save", { path: project }),
    /192 kbps/,
  );
  assert.deepEqual(await fs.readFile(project), original);
  assert.deepEqual(await backend.call("state"), before);
  assert.equal(
    (await fs.readdir(f.directory)).some((name) => /\.(zip|tmp)$/.test(name)),
    false,
  );
});

test("ZIP/project imports reject unsafe candidate paths and downgraded schemas without replacing data", async (t) => {
  const { f, backend } = await setup(t);
  await add(backend, group(f));
  const zip = (await backend.call("sounds.export", { directory: f.directory }))
    .path;
  const project = path.join(f.directory, "valid.dgnproject");
  await backend.call("project.save", { path: project });
  const before = await backend.call("state");
  for (const [source, method] of [
    [zip, "sounds.import"],
    [project, "project.open"],
  ]) {
    for (const mutation of ["traversal", "missing", "empty", "downgrade"]) {
      const target = path.join(
        f.directory,
        `${method}-${mutation}${path.extname(source)}`,
      );
      python(
        String.raw`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 for info in source.infolist():
  raw=source.read(info)
  if info.filename=='project.json' or '/modconfigs/' in info.filename and info.filename.endswith('.json'):
   doc=json.loads(raw);pack=doc.get('pack',doc.get('soundPack'));entry=pack['Entries'][0];mutation=sys.argv[3]
   if mutation=='downgrade': doc['version']=1 if 'pack' in doc else 2
   elif mutation=='empty': entry['SoundFiles']=[]
   else: entry['SoundFiles'][1]='../escape.ogg' if mutation=='traversal' else 'sounds/missing.ogg'
   raw=json.dumps(doc,ensure_ascii=False).encode('utf-8')
  target.writestr(info,raw)
`,
        source,
        target,
        mutation,
      );
      await assert.rejects(backend.call(method, { path: target }));
      assert.deepEqual(await backend.call("state"), before);
    }
  }
});
