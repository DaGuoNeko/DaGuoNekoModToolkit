const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { Backend } = require("../electron/backend.cjs");
const { fixture, removeFixture } = require("./fixtures.cjs");

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

test("animation catalog merges file IDs, deduplicates identical definitions and never mutates the session", async (t) => {
  const { f, backend } = await setup(t);
  const other = path.join(f.directory, "other.animations.json");
  const original = JSON.parse(await fs.readFile(f.animation, "utf8"));
  const ids = [
    "animation.test.idle",
    "animation.test.walk",
    "animation.test.run",
  ];
  await fs.writeFile(
    other,
    "\ufeff" +
      JSON.stringify({
        animations: {
          ...original.animations,
          [ids[1]]: { loop: true },
          [ids[2]]: { loop: true, animation_length: 2 },
        },
      }),
  );
  const before = await backend.call("state");
  const result = await backend.call("models.animations", {
    paths: [f.animation, other, f.animation],
  });
  assert.deepEqual(
    result.animations.map((a) => a.id),
    ids,
  );
  assert.deepEqual(
    result.animations.map((a) => a.file),
    [f.animation, other, other],
  );
  assert.deepEqual(await backend.call("state"), before);
  assert.deepEqual(
    (await backend.call("models.animations", { paths: [] })).animations,
    [],
  );
});

test("animation catalog rejects conflicting IDs, malformed JSON, missing files and unsupported encodings", async (t) => {
  const { f, backend } = await setup(t);
  const invalid = path.join(f.directory, "bad.animation.json");
  await fs.writeFile(
    invalid,
    JSON.stringify({ animations: { "animation.test.idle": { loop: false } } }),
  );
  await assert.rejects(
    backend.call("models.animations", { paths: [f.animation, invalid] }),
    /动画 ID 存在不同定义/,
  );
  for (const [content, expected] of [
    ["{}", /缺少 animations/],
    ["{", /解析|property|Unexpected|Error|reader/i],
    [JSON.stringify({ animations: { "animation.bad": [] } }), /动画定义无效/],
    [Buffer.from([0x81, 0x40]), /编码/],
  ]) {
    await fs.writeFile(invalid, content);
    await assert.rejects(
      backend.call("models.animations", { paths: [invalid] }),
      expected,
    );
  }
  await assert.rejects(
    backend.call("models.animations", {
      paths: [path.join(f.directory, "missing.json")],
    }),
  );
});

test("animation selectors provide explicit pass, defaults and preserve existing NPC animation mappings", async () => {
  const { animationOptions, PASS_ANIMATION, ENTITY_ANIMATIONS } =
    await import("../src/model-animation-options.mjs");
  const choices = animationOptions(
    [{ id: "animation.test.idle" }, { id: PASS_ANIMATION }],
    "animation.customnpc.default.death",
    "默认死亡动画",
  );
  assert.deepEqual(
    choices.map((c) => c.value),
    [
      "",
      PASS_ANIMATION,
      "animation.test.idle",
      "animation.customnpc.default.death",
    ],
  );
  assert.equal(choices[0].label, "默认死亡动画");
  assert.match(choices[1].label, /无动作/);
  assert.match(choices.at(-1).label, /已有配置/);
  assert.equal(
    ENTITY_ANIMATIONS.find((a) => a[0] === "WalkaAnimation")[1],
    "walka（跑步）",
  );
});
