const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

test("generated Python addon registers and retires against the real NPC registry on both sides", async (t) => {
  const npcRoot = process.env.MCNPC_MAIN_NPC_ROOT ||
    path.resolve(__dirname, "../../../../customNPC/customNPC");
  const python = process.env.MCNPC_PYTHON27 || "C:/Python27/python.exe";
  if (!fs.existsSync(path.join(npcRoot, "customNPCB/customNPCScripts/NpcAnimationModelRegistry.py")) || !fs.existsSync(python)) {
    t.skip("Requires the NPC main source checkout and Python 2.7");
    return;
  }
  const f = await fixture();
  const backend = new Backend(path.resolve(process.env.MCNPC_TEST_BACKEND || "backend/bin/Release/net48/NpcSkinMaker.Backend.exe"));
  t.after(async () => {
    if (backend.process.exitCode === null) {
      const exited = once(backend.process, "exit");
      backend.close();
      await exited;
    }
    await removeFixture(f.directory);
  });
  await backend.call("models.save", { index: -1, entry: {
    DisplayName: "在线动画注册测试", CustomName: "onltest", GeoPath: f.geo,
    Textures: [{ Name: "默认", Path: f.texture }],
    AnimationFiles: [f.animation], AnimationList: ["animation.test.idle"],
    IdleAnimation: "animation.test.idle",
  }});
  const output = await backend.call("models.export", { directory: f.directory });
  const result = spawnSync(python, ["-B", "-c", String.raw`
import os, sys, json, zipfile, types, importlib, runpy
zip_path, npc_root, temp = sys.argv[1:]
destination = os.path.join(temp, 'script-check')
os.mkdir(destination)
with zipfile.ZipFile(zip_path) as archive:
    for name in archive.namelist():
        assert not name.startswith(('/', '\\')) and '..' not in name.replace('\\', '/').split('/')
        if name.endswith(('.json', '.py')):
            content = archive.read(name)
            assert not content.startswith('\xef\xbb\xbf'), name
            content.decode('utf-8')
            if name.endswith('.py'):
                compile(content, name, 'exec')
    archive.extractall(destination)
packs = [os.path.join(destination, n) for n in os.listdir(destination)]
bp = next(p for p in packs if os.path.isdir(os.path.join(p, 'entities')))
rp = next(p for p in packs if os.path.isdir(os.path.join(p, 'modconfigs')))
configs = os.listdir(os.path.join(rp, 'modconfigs'))
assert len(configs) == 1 and len(configs[0]) <= 10
with open(os.path.join(rp, 'modconfigs', configs[0]), 'rb') as f:
    config = json.load(f)
owner = config['online_animation_support']['owner_id']
module = next(n for n in os.listdir(bp) if n.endswith('_npcdlcmodels_Scripts'))
sys.path[:0] = [os.path.join(npc_root, 'customNPCB'), bp]
from customNPCScripts import NpcAnimationModelRegistry as Registry
from customNPCScripts.NpcAnimationBones import MODEL_PROFILES
from customNPCScripts import NpcAnimationData as Data, NpcBoneIndex
initial = dict(MODEL_PROFILES)
class Host(object):
    def __init__(self):
        self.NpcDlcModelsConfigNameList = set()
        self.removed = []
    def API_RegisterAnimationModels(self, owner, manifest):
        return Registry.Register(self, owner, manifest)
    def API_UnregisterAnimationModels(self, owner):
        return Registry.Unregister(self, owner)
    def _OnAnimationModelsUnregistered(self, models):
        self.removed.append(tuple(models))
class BaseSystem(object):
    def __init__(self, namespace, name):
        self.listeners = []
    def ListenForEvent(self, *args):
        self.listeners.append(args)
    def UnListenForEvent(self, *args):
        self.listeners = [entry for entry in self.listeners if entry[:5] != args[:5]]
hosts = {'Client': Host(), 'Server': Host()}
for package in ('mod', 'mod.client', 'mod.server'):
    obj = types.ModuleType(package)
    obj.__path__ = []
    sys.modules[package] = obj
    if '.' in package:
        parent, child = package.rsplit('.', 1)
        setattr(sys.modules[parent], child, obj)
def api_for(side):
    api = types.ModuleType('mod.' + side.lower() + '.extra' + side + 'Api')
    setattr(api, 'Get' + side + 'SystemCls', lambda: BaseSystem)
    api.GetEngineNamespace = lambda: 'engine'
    api.GetEngineSystemName = lambda: 'engine'
    api.GetSystem = lambda namespace, name: hosts[side]
    sys.modules[api.__name__] = api
    setattr(sys.modules['mod.' + side.lower()], 'extra' + side + 'Api', api)
api_for('Client'); api_for('Server')
manifest = importlib.import_module(module + '.animation_models').ANIMATION_MANIFEST
assert manifest['schema_version'] == 1
model = next(iter(manifest['models']))
assert model not in MODEL_PROFILES
profile = manifest['models'][model]
for field in ('id', 'prefix', 'world_animation', 'ui_animation', 'preview_identifier'):
    assert type(profile[field]) is str, (field, type(profile[field]))
client_cls = importlib.import_module(module + '.init_modnpcmodelsClientSystem').init_modnpcmodelsClientSystem
server_cls = importlib.import_module(module + '.init_modnpcmodelsServerSystem').init_modnpcmodelsServerSystem
client, server = client_cls('test', 'client'), server_cls('test', 'server')
client.OnScriptsReady({})
assert configs[0] in hosts['Client'].NpcDlcModelsConfigNameList
assert Data.GetProfile(model) is MODEL_PROFILES[model]
assert NpcBoneIndex.MODEL_BONES[model] == tuple(b.lower() for b in profile['bones'])
client.OnScriptsReady({})
server.OnScriptsReady({})
client.Destroy()
assert model in MODEL_PROFILES, 'client cleanup must not remove server reference'
assert not hosts['Client'].removed and not hosts['Server'].removed
server.Destroy()
assert model not in MODEL_PROFILES and model not in NpcBoneIndex.MODEL_BONES
assert hosts['Client'].removed and hosts['Server'].removed
assert MODEL_PROFILES == initial
assert not client.listeners and not server.listeners
Registry.Release(hosts['Client']); Registry.Release(hosts['Server'])
class Legacy(object):
    def __init__(self):
        self.NpcDlcModelsConfigNameList = set()
hosts['Client'] = Legacy()
old = client_cls('test', 'legacy')
old.OnScriptsReady({})
assert configs[0] in hosts['Client'].NpcDlcModelsConfigNameList
assert old._animation_unregister is None
old.Destroy()
print('generated addon + real two-side registry lifecycle passed')
`, output.path, npcRoot, f.directory], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /two-side registry lifecycle passed/);
});
