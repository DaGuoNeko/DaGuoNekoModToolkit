const ogg = require("./ogg-fixture.cjs");

function crc(bytes) {
  let value = 0;
  for (const byte of bytes) {
    value = (value ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit++)
      value = ((value << 1) ^ (value & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  }
  return value;
}

function packets(bytes) {
  const result = [],
    parts = [];
  for (let offset = 0; offset < bytes.length;) {
    const count = bytes[offset + 26];
    let dataOffset = offset + 27 + count;
    for (const length of bytes.subarray(offset + 27, dataOffset)) {
      parts.push(bytes.subarray(dataOffset, dataOffset + length));
      dataOffset += length;
      if (length < 255) {
        result.push(Buffer.concat(parts));
        parts.length = 0;
      }
    }
    offset = dataOffset;
  }
  return result;
}

// Reframe the real Vorbis packets with controlled metadata and valid page CRCs.
// Exact-average fixtures exercise sample-count boundary math, not audio decoding.
function makeSound({
  nominal = 64000,
  upper = 0,
  lower = 0,
  sampleRate = 22050,
  granule = 1323,
  serial = 1234,
  commentPadding = 0,
  opus = false,
} = {}) {
  const source = packets(ogg());
  source[0] = Buffer.from(source[0]);
  source[0].writeUInt32LE(sampleRate, 12);
  source[0].writeInt32LE(upper, 16);
  source[0].writeInt32LE(nominal, 20);
  source[0].writeInt32LE(lower, 24);
  if (opus) source[0].write("OpusHead", 0, "ascii");
  if (commentPadding) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(commentPadding);
    source[1] = Buffer.concat([
      Buffer.from([3]),
      Buffer.from("vorbis"),
      length,
      Buffer.alloc(commentPadding, 97),
      Buffer.alloc(4),
      Buffer.from([1]),
    ]);
  }
  const pages = [];
  let sequence = 0;
  for (let packetIndex = 0; packetIndex < source.length; packetIndex++) {
    const packet = source[packetIndex];
    const lacing = [
      ...Array(Math.floor(packet.length / 255)).fill(255),
      packet.length % 255,
    ];
    let offset = 0;
    for (let segment = 0; segment < lacing.length; segment += 255) {
      const lengths = Buffer.from(lacing.slice(segment, segment + 255));
      const size = Array.from(lengths).reduce((sum, value) => sum + value, 0);
      const finished = segment + lengths.length === lacing.length;
      const last = packetIndex === source.length - 1 && finished;
      const header = Buffer.alloc(27);
      header.write("OggS");
      header[5] =
        (sequence === 0 ? 2 : 0) | (segment > 0 ? 1 : 0) | (last ? 4 : 0);
      header.writeBigInt64LE(BigInt(last ? granule : finished ? 0 : -1), 6);
      header.writeUInt32LE(serial, 14);
      header.writeUInt32LE(sequence++, 18);
      header[26] = lengths.length;
      const page = Buffer.concat([
        header,
        lengths,
        packet.subarray(offset, offset + size),
      ]);
      page.writeUInt32LE(crc(page), 22);
      pages.push(page);
      offset += size;
    }
  }
  return Buffer.concat(pages);
}

module.exports = { makeSound };
