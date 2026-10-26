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

async function setup(t) {
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
  return { f, backend };
}

function model(f, name = "online_model") {
  return {
    DisplayName: "在线动画模型",
    CustomName: name,
    GeoPath: f.geo,
    Textures: [{ Name: "默认", Path: f.texture }],
    AnimationFiles: [f.animation],
    AnimationList: ["animation.test.idle"],
    IdleAnimation: "animation.test.idle",
  };
}

function inspect(zip) {
  return JSON.parse(
    python(
      String.raw`import ast,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 config_name=next(n for n in names if '/modconfigs/' in n and n.endswith('.json'))
 resource_root=config_name.split('/modconfigs/')[0]
 config=json.loads(z.read(config_name))
 metadata_name=next(n for n in names if n.endswith('/animation_models.py'))
 tree=ast.parse(z.read(metadata_name).decode('utf-8'))
 assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='ANIMATION_MANIFEST' for t in n.targets))
 data={'names':names,'config':config,'metadata':ast.literal_eval(assignment.value),'resource_root':resource_root,'json':{},'scripts':{}}
 for n in names:
  if n.endswith(('.json','.py')):
   raw=z.read(n)
   assert not raw.startswith(b'\xef\xbb\xbf'),n
   text=raw.decode('utf-8')
   if n.endswith('.json'):
    parsed=json.loads(text)
    assert '_customnpc_online_animation' not in parsed,n
    data['json'][n]=parsed
   elif 'init_modnpcmodels' in n:data['scripts'][n]=text
 print(json.dumps(data))`,
      zip,
    ),
  );
}

function mutate(source, destination, operation, value = null) {
  python(
    String.raw`import json,sys,zipfile
operation=sys.argv[3];value=json.loads(sys.argv[4])
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 names=source.namelist()
 config_name=next(n for n in names if '/modconfigs/' in n and n.endswith('.json'))
 resource_root=config_name.split('/modconfigs/')[0]
 config=json.loads(source.read(config_name));support=config.get('online_animation_support')
 omitted=set()
 referenced=operation in ('referenced_controller','legacy_referenced_controller')
 if referenced:
  world_name=next(n for n in names if n.startswith(resource_root+'/entity/ex_dlcnpc/') and n.endswith('.json'))
  world=json.loads(source.read(world_name));description=world['minecraft:client_entity']['description']
  primary=next(c for c in description['render_controllers'] if isinstance(c,str))
  original=next(json.loads(source.read(n))['render_controllers'][primary] for n in names if n.startswith(resource_root+'/render_controllers/') and n.endswith('.json') and primary in json.loads(source.read(n)).get('render_controllers',{}))
  user_controller=json.loads(json.dumps(original));user_controller['uv_anim']={'offset':[0.25,0.5],'scale':[1.0,1.0]}
  description['render_controllers']=['controller.render.user_authored' if c==primary else c for c in description['render_controllers']]
 if operation in ('legacy','legacy_referenced_controller'):
  omitted={resource_root+'/'+p for p in support['generated_resources']}
  del config['online_animation_support']
 elif operation=='invalid':
  if value=='duplicate':support['generated_resources'].append(support['generated_resources'][0])
  elif value=='traversal':support['generated_resources'].append('../outside.json')
  elif value=='source':support['generated_resources'].append(next(n[len(resource_root)+1:] for n in names if n.startswith(resource_root+'/entity/ex_dlcnpc/')))
  elif value=='unknown_version':support['schema_version']=2
  elif value=='missing':support['generated_resources'].append('entity/customnpc_online_preview/'+support['owner_id']+'_000000000000.entity.json')
  elif value=='non_string':support['generated_resources'].append(0)
  elif value=='bad_owner':support['owner_id']='../unowned'
  else:raise ValueError(value)
 for item in source.infolist():
  if item.filename in omitted:continue
  data=source.read(item.filename)
  if item.filename==config_name:data=json.dumps(config).encode('utf-8')
  if referenced and item.filename==world_name:data=json.dumps(world).encode('utf-8')
  target.writestr(item,data)
 if referenced:
  target.writestr(resource_root+'/render_controllers/customnpc_online_dlc/user_authored.render_controllers.json',json.dumps({'format_version':'1.8.0','render_controllers':{'controller.render.user_authored':user_controller}}))
 if operation in ('user_resources','legacy'):
  target.writestr(resource_root+'/animations/customnpc_online_dlc/user_authored.animation.json',json.dumps({'format_version':'1.8.0','animations':{'animation.user_authored.idle':{'loop':True,'bones':{'root':{'rotation':[0,0,0]}}}}}))
  target.writestr(resource_root+'/render_controllers/customnpc_online_dlc/user_authored.render_controllers.json',json.dumps({'format_version':'1.8.0','render_controllers':{'controller.render.user_authored':{'geometry':'Geometry.default','materials':[{'*':'Material.default'}],'textures':['Texture.default']}}}))`,
    source,
    destination,
    operation,
    JSON.stringify(value),
  );
}

async function exportFinalResources(f, zip, variant) {
  const extracted = path.join(f.directory, `referenced-${variant}`);
  const resources = JSON.parse(
    python(
      String.raw`import json,os,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])
root=sys.argv[2]
config_path=next(os.path.join(p,n) for p,ds,ns in os.walk(root) if os.path.basename(p)=='modconfigs' for n in ns if n.endswith('.json'))
config=json.load(open(config_path,encoding='utf-8'));resource_root=os.path.dirname(os.path.dirname(config_path))
for relative in config.get('online_animation_support',{}).get('generated_resources',[]):os.remove(os.path.join(resource_root,relative))
metadata=next(os.path.join(p,n) for p,ds,ns in os.walk(root) for n in ns if n=='animation_models.py')
behavior_root=os.path.dirname(os.path.dirname(metadata))
print(json.dumps({'config':config_path,'resource_root':resource_root,'behavior_root':behavior_root,'identifier':config['npcmodelslist'][0]['identifier']}))`,
      zip,
      extracted,
    ),
  );
  const runner = path.join(f.directory, "export-final-resources.ps1");
  await fs.writeFile(
    runner,
    String.raw`param([string]$backendPath,[string]$behaviorRoot,[string]$resourceRoot,[string]$configPath,[string]$identifier)
$ErrorActionPreference = 'Stop'
[void][Reflection.Assembly]::LoadFrom((Join-Path (Split-Path $backendPath) 'Newtonsoft.Json.dll'))
$assembly = [Reflection.Assembly]::LoadFrom($backendPath)
$method = $assembly.GetType('NpcSkinMaker.ModelAnimationExporter').GetMethod('Export')
$arguments = New-Object object[] 5
$arguments[0] = $behaviorRoot
$arguments[1] = $resourceRoot
$arguments[2] = 'm_reference_regression'
$arguments[3] = [string[]]@($identifier)
$arguments[4] = $configPath
[void]$method.Invoke($null, $arguments)
`,
  );
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      runner,
      path.resolve(
        process.env.MCNPC_TEST_BACKEND ||
          "backend/bin/Release/net48/NpcSkinMaker.Backend.exe",
      ),
      resources.behavior_root,
      resources.resource_root,
      resources.config,
      resources.identifier,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return resources;
}

test("model exports include owned online animation metadata, two drivers and an isolated preview for every model without BOM", async (t) => {
  const { f, backend } = await setup(t);
  const geo = JSON.parse(await fs.readFile(f.geo, "utf8"));
  geo["minecraft:geometry"][0].bones.push({
    name: "Head",
    parent: "root",
    pivot: [0, 16, 0],
    rotation: [5, 10, 15],
  });
  await fs.writeFile(f.geo, JSON.stringify(geo));
  await backend.call("models.save", { index: -1, entry: model(f) });
  await backend.call("models.save", {
    index: -1,
    entry: {
      ...model(f, "no_authored_animation"),
      AnimationFiles: [],
      AnimationList: [],
      IdleAnimation: "",
    },
  });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  const data = inspect(output.path);
  const support = data.config.online_animation_support;
  assert.equal(support.schema_version, 1);
  assert.match(support.owner_id, /^[a-z][a-z0-9_]*$/);
  assert.equal(support.generated_resources.length, 4);
  assert.equal(new Set(support.generated_resources).size, 4);
  for (const relative of support.generated_resources) {
    assert.ok(
      data.names.includes(`${data.resource_root}/${relative}`),
      relative,
    );
    assert.match(relative, /^(animations|entity|render_controllers)\//);
  }
  const bank =
    data.json[
      `${data.resource_root}/animations/customnpc_online_dlc/${support.owner_id}.animation.json`
    ].animations;
  const controllers =
    data.json[
      `${data.resource_root}/render_controllers/customnpc_online_dlc/${support.owner_id}.render_controllers.json`
    ].render_controllers;
  assert.equal(Object.keys(bank).length, 4);
  assert.equal(data.metadata.schema_version, 1);
  assert.deepEqual(Object.keys(data.metadata.models).sort(), [
    "customnpc:no_authored_animation_dlcnpc",
    "customnpc:online_model_dlcnpc",
  ]);
  for (const [identifier, profile] of Object.entries(data.metadata.models)) {
    assert.deepEqual(profile.bones, ["root", "Head"]);
    assert.deepEqual(profile.bone_info.Head, { rotation: [5, 10, 15] });
    assert.deepEqual(profile.channel_conflicts, {});
    assert.ok(profile.id.includes(support.owner_id));
    assert.ok(profile.prefix.includes(support.owner_id));
    assert.match(JSON.stringify(bank[profile.world_animation]), /query\.mod\./);
    assert.doesNotMatch(
      JSON.stringify(bank[profile.world_animation]),
      /variable\.cnpc_dlc_/,
    );
    assert.match(
      JSON.stringify(bank[profile.ui_animation]),
      /variable\.cnpc_dlc_/,
    );
    assert.doesNotMatch(
      JSON.stringify(bank[profile.ui_animation]),
      /query\.mod\./,
    );
    assert.deepEqual(
      Object.keys(bank[profile.world_animation].bones),
      profile.bones,
    );
    const preview = Object.values(data.json)
      .map((entry) => entry["minecraft:client_entity"]?.description)
      .find((entry) => entry?.identifier === profile.preview_identifier);
    assert.ok(preview, "profile resolves to a generated client-only preview");
    for (const entry of preview.render_controllers) {
      const names = typeof entry === "string" ? [entry] : Object.keys(entry);
      for (const name of names) {
        assert.ok(controllers[name], name);
        assert.ok(name.includes(support.owner_id));
      }
    }
    assert.doesNotMatch(
      JSON.stringify(preview),
      /(?:query|q)\.(?:property|has_property)\(/,
    );
    const source = Object.values(data.json)
      .map((entry) => entry["minecraft:client_entity"]?.description)
      .find((entry) => entry?.identifier === identifier);
    assert.ok(source);
    assert.doesNotMatch(JSON.stringify(source), /animation\.customnpc_dlc\./);
  }
  assert.equal(Object.keys(data.scripts).length, 2);
  for (const script of Object.values(data.scripts)) {
    assert.match(script, /API_RegisterAnimationModels/);
    assert.match(script, /API_UnregisterAnimationModels/);
    assert.ok(script.includes(`OWNER_ID = '${support.owner_id}'`));
  }
});

test("online model ZIP reimport excludes only owned generated resources and reexport uses a fresh owner", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f) });
  const first = await backend.call("models.export", { directory: f.directory });
  const before = inspect(first.path);
  const edited = path.join(f.directory, "with-user-resources.zip");
  mutate(first.path, edited, "user_resources");
  const imported = (await backend.call("models.import", { path: edited })).state
    .models[0];
  const authoredFiles = before.names.filter(
    (name) =>
      name.startsWith(`${before.resource_root}/animations/`) &&
      name.endsWith(".json") &&
      !before.config.online_animation_support.generated_resources.some(
        (relative) => name === `${before.resource_root}/${relative}`,
      ),
  );
  assert.equal(imported.AnimationFiles.length, authoredFiles.length + 1);
  const catalog = (
    await backend.call("models.animations", { paths: imported.AnimationFiles })
  ).animations.map((item) => item.id);
  assert.ok(catalog.includes("animation.test.idle"));
  assert.ok(catalog.includes("animation.user_authored.idle"));
  assert.ok(
    !catalog.some((id) =>
      id.includes(before.config.online_animation_support.owner_id),
    ),
  );
  assert.ok(
    imported.ImportedClientEntityPath.replaceAll("\\", "/").includes(
      "/entity/ex_dlcnpc/",
    ),
  );
  assert.ok(
    imported.AdditionalResources.some(
      (item) =>
        item.RelativePath ===
        "render_controllers/customnpc_online_dlc/user_authored.render_controllers.json",
    ),
  );
  for (const item of imported.AdditionalResources) {
    assert.ok(
      !before.config.online_animation_support.generated_resources.includes(
        item.RelativePath,
      ),
    );
  }
  const second = await backend.call("models.export", {
    directory: f.directory,
  });
  const after = inspect(second.path);
  assert.notEqual(
    after.config.online_animation_support.owner_id,
    before.config.online_animation_support.owner_id,
  );
  const oldOwner = before.config.online_animation_support.owner_id;
  for (const name of after.names) {
    assert.ok(!name.includes(oldOwner), name);
    if (after.json[name])
      assert.ok(!JSON.stringify(after.json[name]).includes(oldOwner), name);
  }
  assert.ok(
    after.names.includes(
      `${after.resource_root}/render_controllers/customnpc_online_dlc/user_authored.render_controllers.json`,
    ),
  );
  assert.ok(
    after.names.some((name) => name.endsWith("/user_authored.animation.json")),
  );
  assert.equal(
    after.names.filter((name) => name.endsWith("/animation_models.py")).length,
    1,
  );
});

test("legacy ZIP without online metadata retains user assets in the generated-resource directories", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f) });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  const original = inspect(output.path);
  const legacy = path.join(f.directory, "legacy-no-online-metadata.zip");
  mutate(output.path, legacy, "legacy");
  const imported = (await backend.call("models.import", { path: legacy })).state
    .models[0];
  assert.ok(
    imported.AnimationFiles.some(
      (file) => path.basename(file) === "user_authored.animation.json",
    ),
  );
  assert.ok(
    !imported.AnimationFiles.some(
      (file) =>
        path.basename(file) ===
        `${original.config.online_animation_support.owner_id}.animation.json`,
    ),
  );
  assert.ok(
    imported.AdditionalResources.some(
      (item) =>
        item.RelativePath ===
        "render_controllers/customnpc_online_dlc/user_authored.render_controllers.json",
    ),
  );
});

test("referenced user controllers in online directories remain usable for import, reexport and final preview generation", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f) });
  const source = await backend.call("models.export", {
    directory: f.directory,
  });
  for (const variant of [
    "referenced_controller",
    "legacy_referenced_controller",
  ]) {
    const archive = path.join(f.directory, `${variant}.zip`);
    mutate(source.path, archive, variant);
    const imported = (await backend.call("models.import", { path: archive }))
      .state.models[0];
    const userResource = imported.AdditionalResources.find(
      (item) =>
        item.RelativePath ===
        "render_controllers/customnpc_online_dlc/user_authored.render_controllers.json",
    );
    assert.ok(userResource, variant);
    const world = JSON.parse(
      await fs.readFile(imported.ImportedClientEntityPath, "utf8"),
    )["minecraft:client_entity"].description;
    assert.ok(
      world.render_controllers.includes("controller.render.user_authored"),
      variant,
    );
    const authored = JSON.parse(await fs.readFile(userResource.Path, "utf8"))
      .render_controllers["controller.render.user_authored"];
    assert.deepEqual(authored.uv_anim.offset, [0.25, 0.5]);

    // The normal builder intentionally rebuilds its primary controller. Also
    // exercise the final-resource exporter directly so that its preview must
    // actually resolve the user's referenced controller, not an unused asset.
    const final = await exportFinalResources(f, archive, variant);
    const config = JSON.parse(await fs.readFile(final.config, "utf8"));
    const controllerFile =
      config.online_animation_support.generated_resources.find((relative) =>
        relative.startsWith("render_controllers/"),
      );
    const controllers = JSON.parse(
      await fs.readFile(path.join(final.resource_root, controllerFile), "utf8"),
    ).render_controllers;
    const previewFile =
      config.online_animation_support.generated_resources.find((relative) =>
        relative.startsWith("entity/"),
      );
    const preview = JSON.parse(
      await fs.readFile(path.join(final.resource_root, previewFile), "utf8"),
    )["minecraft:client_entity"].description;
    const referenced = preview.render_controllers.filter(
      (entry) => typeof entry === "string",
    );
    assert.equal(referenced.length, 1);
    assert.ok(controllers[referenced[0]], variant);
    assert.deepEqual(
      controllers[referenced[0]].uv_anim,
      authored.uv_anim,
      variant,
    );

    const rebuilt = await backend.call("models.export", {
      directory: f.directory,
    });
    const rebuiltData = inspect(rebuilt.path);
    assert.ok(
      rebuiltData.names.includes(
        `${rebuiltData.resource_root}/${userResource.RelativePath}`,
      ),
      variant,
    );
  }
});

test("invalid online generated-resource metadata rejects import without changing the current project", async (t) => {
  const { f, backend } = await setup(t);
  await backend.call("models.save", { index: -1, entry: model(f) });
  const output = await backend.call("models.export", {
    directory: f.directory,
  });
  const before = await backend.call("state");
  for (const invalid of [
    "duplicate",
    "traversal",
    "source",
    "unknown_version",
    "missing",
    "non_string",
    "bad_owner",
  ]) {
    const malformed = path.join(f.directory, `invalid-${invalid}.zip`);
    mutate(output.path, malformed, "invalid", invalid);
    await assert.rejects(
      backend.call("models.import", { path: malformed }),
      /在线动画|资源路径/,
    );
    assert.deepEqual(await backend.call("state"), before, invalid);
  }
});

test("model pages explain automatic online support independently of the legacy resource animation list", async () => {
  const main = await fs.readFile(path.resolve("src/main.jsx"), "utf8");
  const editor = await fs.readFile(path.resolve("src/editors.jsx"), "utf8");
  assert.match(main, /导出的模型包默认支持在线动画编辑与播放/);
  assert.match(main, /新版自定义NPC主包/);
  assert.match(editor, /在线动画编辑与播放支持会在导出时自动生成/);
  assert.match(editor, /此列表不是在线动画库/);
});
