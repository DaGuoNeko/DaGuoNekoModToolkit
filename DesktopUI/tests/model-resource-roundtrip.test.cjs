const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

const oldId = "customnpc:roundtrip_old_dlcnpc";
const newId = "customnpc:roundtrip_new_dlcnpc";
const overlayColor = { r: 0.25, g: 0.5, b: 0.75, a: 0.8 };
const uvAnim = { offset: [0.25, 0.5], scale: [1, 1] };
const oldSound = {
  volume: 0.42,
  pitch: [0.9, 1.1],
  events: { ambient: "customnpc.ambient", hurt: "customnpc.roar" },
};

function archiveResources(sourcePath, destinationPath = "", reverseSkins = false) {
  const authored = { overlayColor, uvAnim, oldSound, reverseSkins };
  const result = spawnSync("python", ["-c", String.raw`
import json, sys, zipfile

source_path, destination_path, identifier, authored = sys.argv[1:]
authored = json.loads(authored)
with zipfile.ZipFile(source_path) as source:
    names = source.namelist()
    documents = {name: json.loads(source.read(name)) for name in names if name.endswith('.json')}
    config_path = next(name for name in documents if '/modconfigs/' in name)
    root = config_path.split('/modconfigs/')[0]
    config = documents[config_path]
    client_path, client = next(
        (name, body['minecraft:client_entity']['description'])
        for name, body in documents.items()
        if body.get('minecraft:client_entity', {}).get('description', {}).get('identifier') == identifier
    )
    behavior_path, behavior = next(
        (name, body['minecraft:entity']['description'])
        for name, body in documents.items()
        if body.get('minecraft:entity', {}).get('description', {}).get('identifier') == identifier
    )
    primary = next(reference for reference in client['render_controllers'] if isinstance(reference, str))
    render_path, controller = next(
        (name, body['render_controllers'][primary])
        for name, body in documents.items()
        if name.startswith(root + '/render_controllers/') and primary in body.get('render_controllers', {})
    )
    sounds_path = root + '/sounds.json'
    sounds = documents[sounds_path]['entity_sounds']['entities']
    red_property = behavior['properties']['customnpc:render_color_r']

    if destination_path:
        support = config.pop('online_animation_support', {})
        omitted = {root + '/' + name for name in support.get('generated_resources', [])}
        controller.update(overlay_color=authored['overlayColor'], uv_anim=authored['uvAnim'])
        if authored['reverseSkins']:
            controller['arrays']['textures']['Array.skinid'].reverse()
        client['materials']['default'] = 'entity_alphablend'
        client['materials']['probe_alias'] = 'entity_alphablend'
        controller['materials'].append({'probe_part': 'Material.probe_alias'})
        red_property['default'] = authored['overlayColor']['r']
        sounds[identifier] = authored['oldSound']
        changed = {config_path, client_path, behavior_path, render_path, sounds_path}
        with zipfile.ZipFile(destination_path, 'w') as target:
            for item in source.infolist():
                name = item.filename
                if name not in omitted:
                    data = json.dumps(documents[name]).encode('utf-8') if name in changed else source.read(item)
                    target.writestr(item, data)
    else:
        print(json.dumps(dict(controller=controller, materials=client['materials'],
                              red_property=red_property, sounds=sounds,
                              identifiers=[entry['identifier'] for entry in config['npcmodelslist']])))
`, sourcePath, destinationPath, oldId, JSON.stringify(authored)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return destinationPath ? undefined : JSON.parse(result.stdout);
}

async function setup(t, reverseSkins = false) {
  const f = await fixture();
  const backend = new Backend(path.resolve(
    process.env.MCNPC_TEST_BACKEND || "backend/bin/Release/net48/NpcSkinMaker.Backend.exe",
  ));
  t.after(async () => {
    if (backend.process.exitCode === null) {
      const exited = once(backend.process, "exit");
      backend.close();
      await exited;
    }
    await removeFixture(f.directory);
  });
  const add = (name, textures = [{ Name: "Default", Path: f.texture }]) => backend.call("models.save", {
    index: -1,
    entry: {
      DisplayName: name,
      CustomName: name,
      GeoPath: f.geo,
      Textures: textures,
    },
  });
  const exportPackage = () => backend.call("models.export", { directory: f.directory });
  await add("roundtrip_old", reverseSkins ? [
    { Name: "Original first", Path: f.texture },
    { Name: "Original second", Path: f.invalid },
  ] : undefined);
  const original = await exportPackage();
  const legacy = path.join(f.directory, "legacy.zip");
  archiveResources(original.path, legacy, reverseSkins);
  await backend.call("models.import", { path: legacy });
  return { f, add, exportPackage, backend };
}

test("re-exporting a legacy model package preserves authored color and render settings", async (t) => {
  const { exportPackage } = await setup(t);
  const exported = archiveResources((await exportPackage()).path);
  assert.deepEqual(exported.controller.overlay_color, overlayColor);
  assert.deepEqual(exported.controller.uv_anim, uvAnim);
  assert.equal(exported.red_property.default, overlayColor.r);
  assert.equal(exported.red_property.client_sync, true);
  assert.equal(exported.materials.default, "entity_alphablend");
  assert.equal(exported.materials.probe_alias, "entity_alphablend");
  assert.ok(exported.controller.materials.some((entry) =>
    entry.probe_part === "Material.probe_alias",
  ));
});

test("editing imported texture variants retains authored rendering and skin order", async (t) => {
  const { f, exportPackage, backend } = await setup(t, true);
  const modelNames = (state) => state.models[0].Textures.map(({ Name }) => Name);
  const originalOrder = ["Original second", "Original first"];
  const unchanged = await exportPackage();
  assert.deepEqual(
    modelNames((await backend.call("models.import", { path: unchanged.path })).state),
    originalOrder,
  );
  const entry = (await backend.call("state")).models[0];
  entry.Textures.push({ Name: "Added", Path: f.texture });
  await backend.call("models.save", { index: 0, entry });
  const resized = await exportPackage();
  const { controller } = archiveResources(resized.path);
  assert.deepEqual(controller.overlay_color, overlayColor);
  assert.deepEqual(controller.uv_anim, uvAnim);
  assert.deepEqual(controller.arrays.textures["Array.skinid"], [
    "Texture.default1", "Texture.default", "Texture.default2",
  ]);
  assert.match(controller.textures[0], /clamp\(query\.skin_id, 0, 2\)/);
  assert.deepEqual(
    modelNames((await backend.call("models.import", { path: resized.path })).state),
    [...originalOrder, "Added"],
  );
});

test("exporting imported and new models preserves their sound mappings in both orders", async (t) => {
  const { add, exportPackage, backend } = await setup(t);
  await add("roundtrip_new");
  const oldFirst = archiveResources((await exportPackage()).path);
  await backend.call("models.move", { index: 1, direction: -1 });
  const newFirst = archiveResources((await exportPackage()).path);

  assert.deepEqual(oldFirst.identifiers, [oldId, newId]);
  assert.deepEqual(newFirst.identifiers, [newId, oldId]);
  for (const [order, { sounds }] of Object.entries({ oldFirst, newFirst })) {
    assert.deepEqual(sounds[oldId], oldSound, order);
    assert.equal(sounds[newId]?.events?.hurt, "customnpc.hurt", order);
  }
});
