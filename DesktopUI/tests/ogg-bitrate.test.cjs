const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");
const { makeSound } = require("./ogg-bitrate-fixtures.cjs");

async function setup(t) {
  const f = await fixture();
  const backend = new Backend(
    path.resolve("backend/bin/Release/net48/NpcSkinMaker.Backend.exe"),
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
async function item(f, filename, bytes, id = "sound") {
  const file = path.join(f.directory, filename);
  await fs.writeFile(file, bytes);
  return {
    Id: id,
    Name: "提示音",
    CategoryId: "ui",
    CategoryName: "界面音效",
    Path: file,
  };
}
const add = (backend, entry) => backend.call("sounds.add", { items: [entry] });

test("96 and exactly 128 kbps pass; unknown declarations still measure the audio", async (t) => {
  const { f, backend } = await setup(t);
  for (const [index, options] of [
    { nominal: 96000 },
    { nominal: 128000, upper: 128000 },
    { nominal: 0 },
    { nominal: -1, upper: -1, lower: -1 },
  ].entries())
    await add(
      backend,
      await item(
        f,
        `accepted-${index}.ogg`,
        makeSound(options),
        `sound_${index}`,
      ),
    );
  assert.equal((await backend.call("state")).sounds.length, 4);
});

test("declared nominal/upper/lower above 128 kbps reject with file path and preserve the list", async (t) => {
  const { f, backend } = await setup(t);
  const before = await backend.call("state");
  for (const options of [
    { nominal: 128001 },
    { nominal: 192000 },
    { upper: 160000 },
    { lower: 144000 },
  ]) {
    const entry = await item(f, "超标音效.ogg", makeSound(options));
    await assert.rejects(add(backend, entry), (error) => {
      assert.match(error.message, /超过网易限制/);
      assert.match(error.message, /128 kbps/);
      assert.ok(error.message.includes(entry.Path));
      return true;
    });
    assert.deepEqual(await backend.call("state"), before);
  }
});

test("actual audio average has an exact 128 kbps boundary and cannot hide behind a lower nominal rate", async (t) => {
  const { f, backend } = await setup(t);
  // The real fixture has 209 audio bytes: 209 * 8 * 32000 / 418 = 128000 exactly.
  await add(
    backend,
    await item(
      f,
      "exact-average.ogg",
      makeSound({ nominal: 0, sampleRate: 32000, granule: 418 }),
    ),
  );
  const before = await backend.call("state");
  for (const nominal of [0, 64000, 128000]) {
    const entry = await item(
      f,
      "VBR超标.ogg",
      makeSound({ nominal, sampleRate: 32000, granule: 417 }),
      "bad",
    );
    await assert.rejects(add(backend, entry), /音频平均码率 128\.307 kbps/);
    assert.deepEqual(await backend.call("state"), before);
  }
});

test("short sounds and large continued comment packets exclude header/container overhead", async (t) => {
  const { f, backend } = await setup(t);
  const entry = await item(
    f,
    "短提示音.ogg",
    makeSound({ commentPadding: 70000 }),
  );
  assert.ok(((await fs.stat(entry.Path)).size * 8) / 0.06 > 128000);
  await add(backend, entry);
  assert.equal((await backend.call("state")).sounds.length, 1);
});

test("each chained track is checked independently, including a high-rate second track", async (t) => {
  const { f, backend } = await setup(t);
  await add(
    backend,
    await item(
      f,
      "双段合规.ogg",
      Buffer.concat([
        makeSound({ serial: 1 }),
        makeSound({ serial: 2, nominal: 128000 }),
      ]),
    ),
  );
  const before = await backend.call("state");
  await assert.rejects(
    add(
      backend,
      await item(
        f,
        "双段超标.ogg",
        Buffer.concat([
          makeSound({ serial: 1, granule: 220500 }),
          makeSound({ serial: 2, nominal: 192000 }),
        ]),
        "bad",
      ),
    ),
    /标称码率 192 kbps/,
  );
  assert.deepEqual(await backend.call("state"), before);
});

test("renamed formats, Opus, corrupt CRC, truncated and missing endings fail explicitly", async (t) => {
  const { f, backend } = await setup(t);
  const corrupted = makeSound();
  corrupted[corrupted.length - 1] ^= 1;
  const unfinished = makeSound().subarray(0, 58);
  const before = await backend.call("state");
  for (const [name, bytes] of [
    ["renamed.ogg", Buffer.from("not an OGG")],
    ["renamed.wav", makeSound()],
    ["opus.ogg", makeSound({ opus: true })],
    ["corrupted.ogg", corrupted],
    ["truncated.ogg", makeSound().subarray(0, -1)],
    ["unfinished.ogg", unfinished],
  ]) {
    await assert.rejects(add(backend, await item(f, name, bytes)), /128 kbps/);
    assert.deepEqual(await backend.call("state"), before);
  }
});

test("edit/export/project-save revalidate replaced source files without overwriting projects or creating a ZIP", async (t) => {
  const { f, backend } = await setup(t);
  const entry = await item(f, "提示音.ogg", makeSound());
  await add(backend, entry);
  const project = path.join(f.directory, "original.dgnproject");
  await backend.call("project.save", { path: project });
  const saved = await fs.readFile(project),
    before = await backend.call("state");
  await fs.writeFile(entry.Path, makeSound({ nominal: 192000 }));
  await assert.rejects(
    backend.call("sounds.save", {
      index: 0,
      entry: { ...entry, Name: "编辑" },
    }),
    /192 kbps/,
  );
  await assert.rejects(
    backend.call("sounds.export", { directory: f.directory }),
    /192 kbps/,
  );
  await assert.rejects(
    backend.call("project.save", { path: project }),
    /192 kbps/,
  );
  assert.deepEqual(await fs.readFile(project), saved);
  assert.deepEqual(await backend.call("state"), before);
  assert.equal(
    (await fs.readdir(f.directory)).some((name) => /\.(zip|tmp)$/.test(name)),
    false,
  );
});

test("ZIP and portable-project imports reject over-limit audio and keep the current session intact", async (t) => {
  const { f, backend } = await setup(t);
  await add(backend, await item(f, "提示音.ogg", makeSound()));
  const zip = (await backend.call("sounds.export", { directory: f.directory }))
    .path;
  const project = path.join(f.directory, "original.dgnproject");
  await backend.call("project.save", { path: project });
  const high = path.join(f.directory, "high.ogg");
  await fs.writeFile(high, makeSound({ nominal: 192000 }));
  const before = await backend.call("state");
  for (const [source, method] of [
    [zip, "sounds.import"],
    [project, "project.open"],
  ]) {
    const target = path.join(f.directory, method + path.extname(source));
    const output = spawnSync(
      "python",
      [
        "-c",
        String.raw`import sys,zipfile
with open(sys.argv[3],'rb') as f: high=f.read()
with zipfile.ZipFile(sys.argv[1]) as source,zipfile.ZipFile(sys.argv[2],'w') as target:
 for info in source.infolist(): target.writestr(info, high if info.filename.endswith('.ogg') else source.read(info))
`,
        source,
        target,
        high,
      ],
      { encoding: "utf8" },
    );
    assert.equal(output.status, 0, output.stderr);
    await assert.rejects(backend.call(method, { path: target }), /192 kbps/);
    assert.deepEqual(await backend.call("state"), before);
  }
});
