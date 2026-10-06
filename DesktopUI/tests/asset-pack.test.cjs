const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");
const ogg = require("./ogg-fixture.cjs");

function python(code, ...args) {
  const result = spawnSync("python", ["-c", code, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function setup(t) {
  const f = await fixture(),
    sessions = [];
  f.sound = path.join(f.directory, "提示音.ogg");
  await fs.writeFile(f.sound, ogg());
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
const texture = (f, Id = "star") => ({
  Id,
  Name: "星星图标",
  CategoryId: "icons",
  CategoryName: "公共图标",
  Path: f.invalid,
  SearchTags: ["星星", "装饰"],
});
const sound = (f) => ({
  Id: "toast",
  Name: "提示音",
  CategoryId: "ui",
  CategoryName: "界面音效",
  Path: f.sound,
  Volume: 0.4,
  Pitch: 1.2,
  Stream: true,
});

test("resource exports contain both packs, stable UUIDs, Python registration and valid sound definitions", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("textures.add", { items: [texture(f)] }); // arbitrary 1×1 PNG, not a humanoid skin
  await backend.call("sounds.add", { items: [sound(f)] });
  await backend.call("textures.settings", {
    name: "测试贴图拓展",
    author: "大果喵",
    version: "1.2.3",
  });
  const state = await backend.call("state");
  const tx = await backend.call("textures.export", { directory: f.directory });
  const tx2 = await backend.call("textures.export", { directory: f.directory });
  const sx = await backend.call("sounds.export", { directory: f.directory });
  python(
    String.raw`import sys,json,zipfile,ast,re
archives=[zipfile.ZipFile(p) for p in sys.argv[1:4]]
for i,z in enumerate(archives):
 names=z.namelist();configs=[n for n in names if '/modconfigs/' in n and n.endswith('.json')];assert len(configs)==1
 assert re.fullmatch(r'asset_[0-9a-f]{32}\.json',configs[0].split('/')[-1]),configs
 data=json.loads(z.read(configs[0]));pack=data['pack'];provider=pack['ProviderId'];kind=data['kind']
 assert set(n.split('/')[0] for n in names)=={provider+'B',provider+'R'},names
 assert provider+'B/entities/' in names,'behavior entities directory missing'
 assert any(n.startswith(provider+'R/textures/') for n in names),'resource textures directory missing'
 if kind=='sounds':assert provider+'R/textures/' in names,'empty textures directory missing'
 assert not any(n.endswith('.txt') for n in names),'instructions must not be included'
 bp=json.loads(z.read(provider+'B/manifest.json'));rp=json.loads(z.read(provider+'R/manifest.json'))
 assert bp['modules'][0]['type']=='data' and rp['modules'][0]['type']=='resources'
 assert bp['dependencies'][0]['uuid']==rp['header']['uuid']==pack['ResourceUuid']
 assert bp['header']['version']==rp['header']['version']==([1,2,3] if i<2 else [1,0,0])
 config=z.read(provider+'B/'+provider+'Scripts/config.py').decode('utf-8')
 assets=ast.literal_eval(ast.parse(config).body[-1].value)
 assert assets[0]['name']==('星星图标' if i<2 else '提示音')
 assert assets[0]['type']==('texture' if i<2 else 'sound')
 item=pack['Entries'][0];assert configs[0].split('/')[0]+'/'+item['Path'] in names
 if kind=='sounds':
  definitions=json.loads(z.read(provider+'R/sounds/sound_definitions.json'))['sound_definitions']
  event=definitions[provider+'.toast'];assert event['sounds'][0]['stream']
  assert event['sounds'][0]['name']==item['Path'][:-4]
  assert assets[0]['sound']==provider+'.toast' and assets[0]['volume']==0.4 and assets[0]['pitch']==1.2
 for name in names:
  if name.endswith(('.json','.py','.txt')):
   raw=z.read(name);assert not raw.startswith(b'\xef\xbb\xbf');raw.decode('utf-8')
  if name.endswith('.py'):assert b'u"' not in z.read(name) and b"u'" not in z.read(name)
assert json.loads(archives[0].read(next(n for n in archives[0].namelist() if n.endswith('/manifest.json'))))==json.loads(archives[1].read(next(n for n in archives[1].namelist() if n.endswith('/manifest.json'))))
config_names=[next(n.split('/')[-1] for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json')) for z in archives]
assert config_names[0]==config_names[1] and config_names[0]!=config_names[2]
`,
    tx.path,
    tx2.path,
    sx.path,
  );
  const imported = (await backend.call("textures.import", { path: tx.path }))
    .state;
  assert.equal(imported.texturePack.ProviderId, state.texturePack.ProviderId);
  assert.equal(
    imported.texturePack.BehaviorUuid,
    state.texturePack.BehaviorUuid,
  );
  assert.equal(imported.textures[0].Id, "star");
  assert.deepEqual(
    await fs.readFile(imported.textures[0].Path),
    await fs.readFile(f.invalid),
  );
  const sounds = (await backend.call("sounds.import", { path: sx.path })).state;
  assert.deepEqual(await fs.readFile(sounds.sounds[0].Path), ogg());
  assert.equal(sounds.sounds[0].Volume, 0.4);
});

test("metadata import is identified by format, supports legacy names, and rejects ambiguous configs", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("textures.add", { items: [texture(f)] });
  const before = await backend.call("state");
  const exported = await backend.call("textures.export", { directory: f.directory });
  const legacy = path.join(f.directory, "legacy-assets.zip");
  const ambiguous = path.join(f.directory, "ambiguous-assets.zip");
  python(String.raw`import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as source:
 configs=[n for n in source.namelist() if '/modconfigs/' in n and n.endswith('.json')]
 assert len(configs)==1
 original=configs[0];directory=original.rsplit('/',1)[0]
 with zipfile.ZipFile(sys.argv[2],'w') as target:
  for name in source.namelist():target.writestr(directory+'/assets.json' if name==original else name,source.read(name))
  target.writestr(directory+'/unrelated.json',json.dumps({'format':{'another':'tool'}}))
  target.writestr(directory+'/other.json','[]')
 with zipfile.ZipFile(sys.argv[3],'w') as target:
  for name in source.namelist():target.writestr(name,source.read(name))
  target.writestr(directory+'/duplicate.json',source.read(original))
`, exported.path, legacy, ambiguous);
  const restored = (await backend.call("textures.import", { path: legacy })).state;
  assert.equal(restored.texturePack.ResourceUuid, before.texturePack.ResourceUuid);
  assert.equal(restored.texturePack.ProviderId, before.texturePack.ProviderId);
  const reexported = await backend.call("textures.export", { directory: f.directory });
  python(String.raw`import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as first,zipfile.ZipFile(sys.argv[2]) as second:
 configs=lambda z:[n for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json')]
 assert configs(first)==configs(second)
 assert not any(n.endswith('/assets.json') for n in second.namelist())
`, exported.path, reexported.path);
  await assert.rejects(backend.call("textures.import", { path: ambiguous }), /包含一份/);
  assert.deepEqual(await backend.call("state"), restored);
});

test("invalid resource edits, ZIPs and project data do not replace current lists", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("textures.add", { items: [texture(f)] });
  await backend.call("sounds.add", { items: [sound(f)] });
  const before = await backend.call("state");
  for (const args of [
    { items: [texture(f)] },
    { items: [texture(f, "../escape")] },
    { items: [texture(f, "first"), { ...texture(f, "second"), Path: f.geo }] },
  ])
    await assert.rejects(backend.call("textures.add", args));
  await assert.rejects(
    backend.call("textures.settings", {
      providerId: before.soundPack.ProviderId,
    }),
  );
  await assert.rejects(
    backend.call("textures.settings", { version: "-1.0.0" }),
  );
  await assert.rejects(
    backend.call("sounds.save", {
      index: 0,
      entry: { ...sound(f), Volume: 2 },
    }),
  );
  const bogus = path.join(f.directory, "renamed.ogg");
  await fs.writeFile(bogus, "not ogg");
  await assert.rejects(
    backend.call("sounds.add", {
      items: [{ ...sound(f), Id: "bad", Path: bogus }],
    }),
    /OGG Vorbis/,
  );
  const exported = await backend.call("textures.export", {
    directory: f.directory,
  });
  await assert.rejects(
    backend.call("sounds.import", { path: exported.path }),
    /不匹配/,
  );
  const broken = path.join(f.directory, "broken.zip");
  python(
    String.raw`import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 for name in source.namelist():
  data=source.read(name)
  if '/modconfigs/' in name and name.endswith('.json'):
   doc=json.loads(data);doc['pack']['Entries'][0]['Path']='../escape.png';data=json.dumps(doc).encode()
  target.writestr(name,data)`,
    exported.path,
    broken,
  );
  await assert.rejects(
    backend.call("textures.import", { path: broken }),
    /资源路径/,
  );
  assert.deepEqual(await backend.call("state"), before);
});

test("portable projects restore all four lists and keep resource IDs after source files disappear; v1 still opens", async (t) => {
  const { f, backend, create } = await setup(t);
  await backend.call("textures.add", { items: [texture(f)] });
  await backend.call("sounds.add", { items: [sound(f)] });
  const before = await backend.call("state");
  const project = path.join(f.directory, "assets.dgnproject");
  await backend.call("project.save", { path: project });
  await backend.call("project.save", { path: project });
  const exited = once(backend.process, "exit");
  backend.close();
  await exited;
  await fs.unlink(f.invalid);
  await fs.unlink(f.sound);
  const restored = create(),
    reopened = (await restored.call("project.open", { path: project })).state;
  assert.equal(reopened.texturePack.ProviderId, before.texturePack.ProviderId);
  assert.equal(reopened.soundPack.ResourceUuid, before.soundPack.ResourceUuid);
  assert.deepEqual(await fs.readFile(reopened.sounds[0].Path), ogg());
  assert.ok(
    (
      await fs.stat(
        (await restored.call("textures.export", { directory: f.directory }))
          .path,
      )
    ).size,
  );
  assert.ok(
    (
      await fs.stat(
        (await restored.call("sounds.export", { directory: f.directory })).path,
      )
    ).size,
  );
  const legacy = path.join(f.directory, "legacy.dgnproject");
  python(
    String.raw`import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('project.json',json.dumps({'format':'DaGuoNekoModToolkit','version':1,'skins':[],'models':[]}))`,
    legacy,
  );
  const old = (await restored.call("project.open", { path: legacy })).state;
  for (const kind of ["skins", "models", "textures", "sounds"])
    assert.equal(old[kind].length, 0);
});

test("project size includes metadata: exactly 512 MiB reopens, one byte over preserves the old project", async (t) => {
  const { f, backend } = await setup(t);
  const limit = 512 * 1024 * 1024;
  const resourceLimit = 64 * 1024 * 1024;
  const items = [];
  // Small distinct fixtures establish the manifest size. Padding exercises archive
  // storage limits only, not audio decoding; no large buffers are held in memory.
  for (let i = 0; i < 8; i++) {
    const file = path.join(f.directory, `boundary-${i}.ogg`);
    await fs.writeFile(file, Buffer.concat([ogg(), Buffer.from([i])]));
    items.push({ ...sound(f), Id: `sound_${i}`, Path: file });
  }
  await backend.call("sounds.add", { items });
  const project = path.join(f.directory, "boundary.dgnproject");
  await backend.call("project.save", { path: project });
  function archiveStats(file) {
    return JSON.parse(python(
      "import sys,zipfile,json\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps({'total':sum(i.file_size for i in z.infolist()),'manifest':z.getinfo('project.json').file_size}))",
      file,
    ));
  }
  const metadataBytes = archiveStats(project).manifest;
  for (let i = 0; i < items.length; i++)
    await fs.truncate(items[i].Path, resourceLimit - (i === 7 ? metadataBytes : 0));
  await backend.call("project.save", { path: project });
  assert.equal(archiveStats(project).total, limit);
  const saved = await fs.readFile(project);
  const state = await backend.call("state");
  await fs.truncate(items[7].Path, resourceLimit - metadataBytes + 1);
  await assert.rejects(backend.call("project.save", { path: project }), /512 MiB/);
  assert.deepEqual(await fs.readFile(project), saved);
  assert.deepEqual(await backend.call("state"), state);
  const newProject = path.join(f.directory, "too-large.dgnproject");
  await assert.rejects(backend.call("project.save", { path: newProject }), /512 MiB/);
  await assert.rejects(fs.access(newProject), { code: "ENOENT" });
  assert.equal((await fs.readdir(f.directory)).some((name) => name.endsWith(".tmp")), false);
  const restored = (await backend.call("project.open", { path: project })).state;
  assert.equal(restored.sounds.length, 8);
  let restoredSize = metadataBytes;
  for (const item of restored.sounds) restoredSize += (await fs.stat(item.Path)).size;
  assert.equal(restoredSize, limit);
});

test("project size counts shared resource content once, even at different source paths", async (t) => {
  const { f, backend } = await setup(t);
  await fs.truncate(f.sound, 64 * 1024 * 1024);
  const copy = path.join(f.directory, "same-content.ogg");
  await fs.copyFile(f.sound, copy);
  await backend.call("sounds.add", {
    items: Array.from({ length: 9 }, (_, i) => ({
      ...sound(f), Id: `shared_${i}`, Path: i % 2 ? copy : f.sound,
    })),
  });
  const project = path.join(f.directory, "shared.dgnproject");
  await backend.call("project.save", { path: project });
  const restored = (await backend.call("project.open", { path: project })).state;
  assert.equal(restored.sounds.length, 9);
  assert.equal(new Set(restored.sounds.map((item) => item.Path)).size, 1);
});

test("generated Python 2.7 data registers against the real prerequisite registry and cleans listeners", async (t) => {
  const python2 = process.env.MCNPC_PYTHON2 || "C:\\Python27\\python.exe";
  const registry =
    process.env.DGN_ASSET_REGISTRY ||
    "C:\\Users\\cat\\Desktop\\DAGUOMIAO_API_MOD\\DAGUOMIAO_API_MOD\\DAGUOMIAO_API_MODB\\DAGUOMIAO_API_MODScripts\\DAGUOMIAO_API_MODClientSystem\\asset_registry.py";
  try {
    await fs.access(python2);
    await fs.access(registry);
  } catch {
    t.skip(
      "Requires Python 2.7 and the prerequisite asset_registry.py (override via environment)",
    );
    return;
  }
  const { f, backend } = await setup(t);
  await backend.call("textures.add", { items: [texture(f)] });
  await backend.call("sounds.add", { items: [sound(f)] });
  await backend.call("textures.save", {
    index: 0,
    entry: {
      ...texture(f),
      Name: '中文\n"引号"\u2028分隔',
      SearchTags: ["\\u2028", "\0", "\u0085"],
    },
  });
  const packages = await Promise.all(
    ["textures", "sounds"].map((kind) =>
      backend.call(`${kind}.export`, { directory: f.directory }),
    ),
  );
  const result = spawnSync(
    python2,
    [
      "-c",
      String.raw`import sys,zipfile,types,os,json
namespace={};exec(compile(open(sys.argv[1],'rb').read(),sys.argv[1],'exec'),namespace)
registry=namespace['AssetRegistry']()
class Api(object):
 def API_RegisterAssetProvider(self,*args):return registry.RegisterProvider(*args)
 def API_UnregisterAssetProvider(self,*args):return registry.UnregisterProvider(*args)
api=Api();current=[None]
class Base(object):
 def __init__(self,*args):self.events=[]
 def ListenForEvent(self,*args):self.events.append(args)
 def UnListenForEvent(self,*args):self.events.remove(args)
mod=types.ModuleType('mod');client=types.ModuleType('mod.client');extra=types.ModuleType('mod.client.extraClientApi')
extra.GetClientSystemCls=lambda:Base;extra.GetSystem=lambda *args:current[0];extra.GetEngineNamespace=lambda:'Minecraft';extra.GetEngineSystemName=lambda:'Engine'
mod.client=client;client.extraClientApi=extra
for name,value in [('mod',mod),('mod.client',client),('mod.client.extraClientApi',extra)]:sys.modules[name]=value
for package in sys.argv[2:]:
 with zipfile.ZipFile(package) as z:
  config=next(n for n in z.namelist() if n.endswith('/config.py'));moduleName=config.split('/')[-2]
  module=types.ModuleType(moduleName);module.__path__=[];sys.modules[moduleName]=module
  data=types.ModuleType(moduleName+'.config');exec(compile(z.read(config),config,'exec'),data.__dict__);sys.modules[moduleName+'.config']=data
  metadata=json.loads(z.read(next(n for n in z.namelist() if '/modconfigs/' in n and n.endswith('.json'))))['pack']['Entries']
  for source,item in zip(metadata,data.ASSETS):
   assert source['Name'].encode('utf-8')==item['name']
   assert [tag.encode('utf-8') for tag in source['SearchTags']]==item['search_tags']
  assert isinstance(data.PROVIDER_NAME,str)
  for item in data.ASSETS:
   assert isinstance(item['name'],str) and isinstance(item['category_name'],str)
  clientName=next(n for n in z.namelist() if n.endswith('/client.py'))
  scope={};exec(compile(z.read(clientName),clientName,'exec'),scope)
  system=scope['AssetClientSystem']('test','test');assert len(system.events)==2
  current[0]=None;system.OnScriptsReady({});current[0]=api;system.OnRegisterRequest({})
  item=data.ASSETS[0];full='%s:%s:%s:%s'%(data.PROVIDER_ID,item['type'],item['category_id'],item['id'])
  resolved=registry.ResolveAsset(full,item['type']);assert resolved['name']==item['name']
  assert registry.ResolveAsset(data.PROVIDER_ID+':'+item['id'],item['type'])['full_id']==full
  system.OnRegisterRequest({});assert len(registry.GetAssets())==1
  system.Destroy();assert len(system.events)==0 and registry.GetAssets()==[]
print('Python 2.7 generated strings, listeners and actual registry passed')`,
      registry,
      ...packages.map((p) => p.path),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
