const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width = 64, height = 64) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 4 + 1) + 1 + x * 4;
      pixels[i] = 80 + Math.floor(x / 8) * 12;
      pixels[i + 1] = 100 + Math.floor(y / 8) * 10;
      pixels[i + 2] = 150;
      pixels[i + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcnpc-test-"));
  const texture = path.join(directory, "森林守卫.png"),
    invalid = path.join(directory, "invalid.png"),
    geo = path.join(directory, "test.geo.json"),
    animation = path.join(directory, "test.animation.json");
  await fs.writeFile(texture, png());
  await fs.writeFile(invalid, png(1, 1));
  await fs.writeFile(
    geo,
    JSON.stringify({
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: "geometry.test",
            texture_width: 64,
            texture_height: 64,
          },
          bones: [
            {
              name: "root",
              pivot: [0, 0, 0],
              cubes: [{ origin: [-4, 0, -4], size: [8, 16, 8], uv: [0, 0] }],
            },
          ],
        },
      ],
    }),
  );
  await fs.writeFile(
    animation,
    JSON.stringify({
      format_version: "1.8.0",
      animations: {
        "animation.test.idle": {
          loop: true,
          bones: { root: { rotation: [0, 0, 0] } },
        },
      },
    }),
  );
  return { directory, texture, invalid, geo, animation };
}
async function removeFixture(directory) {
  const resolved = path.resolve(directory),
    parent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith("mcnpc-test-")
  )
    throw new Error("Invalid cleanup target");
  await fs.rm(resolved, { recursive: true, force: true });
}
module.exports = { fixture, removeFixture };
