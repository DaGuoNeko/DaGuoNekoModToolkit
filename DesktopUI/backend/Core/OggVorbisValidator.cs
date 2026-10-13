using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace NpcSkinMaker
{
    internal static class OggVorbisValidator
    {
        private const int MaxBitrate = 128000;
        private static readonly uint[] CrcTable = CreateCrcTable();

        private sealed class Track
        {
            public uint Serial, NextSequence, SampleRate;
            public long LastGranule, AudioBytes, PacketBytes;
            public int Packets, PrefixLength;
            public readonly byte[] Prefix = new byte[30];
        }

        // Read bounded Ogg pages, not the whole file. Validate each chained track
        // independently so a quiet/long track cannot hide an over-limit track.
        public static void Validate(string path)
        {
            if (!path.EndsWith(".ogg", StringComparison.OrdinalIgnoreCase))
                throw Invalid(path, "音效必须是 .ogg 格式的 OGG Vorbis，不能只修改扩展名");
            try
            {
                using (var input = new BinaryReader(File.OpenRead(path)))
                {
                    Track track = null;
                    var serials = new HashSet<uint>();
                    int completed = 0;
                    while (input.BaseStream.Position < input.BaseStream.Length)
                    {
                        byte[] header = ReadExactly(input, 27);
                        if (header[0] != 'O' || header[1] != 'g' || header[2] != 'g' || header[3] != 'S' ||
                            header[4] != 0 || (header[5] & ~7) != 0)
                            throw Invalid(path, "音效必须是有效的 OGG Vorbis，不能直接改 MP3/Opus 扩展名");
                        int flags = header[5];
                        long granule = BitConverter.ToInt64(header, 6);
                        uint serial = BitConverter.ToUInt32(header, 14), sequence = BitConverter.ToUInt32(header, 18);
                        if (track == null)
                        {
                            if ((flags & 2) == 0 || sequence != 0 || !serials.Add(serial))
                                throw Invalid(path, "OGG 音轨起始信息无效，无法可靠检查码率");
                            track = new Track { Serial = serial };
                        }
                        else if ((flags & 2) != 0 || serial != track.Serial)
                            throw Invalid(path, "不支持交错的多音轨 OGG，请转换为单音轨 OGG Vorbis");
                        if (sequence != track.NextSequence++ || ((flags & 1) != 0) != (track.PacketBytes > 0))
                            throw Invalid(path, "OGG 音效不完整或页面顺序无效，无法可靠检查码率");

                        byte[] lacing = ReadExactly(input, header[26]);
                        int payloadLength = 0;
                        foreach (byte length in lacing) payloadLength += length;
                        byte[] payload = ReadExactly(input, payloadLength);
                        uint expectedCrc = BitConverter.ToUInt32(header, 22);
                        Array.Clear(header, 22, 4);
                        if (Crc(Crc(Crc(0, header), lacing), payload) != expectedCrc)
                            throw Invalid(path, "OGG 页面校验失败，文件内容可能已损坏");

                        int offset = 0;
                        foreach (byte length in lacing)
                        {
                            int capture = Math.Min(length, track.Prefix.Length - track.PrefixLength);
                            Array.Copy(payload, offset, track.Prefix, track.PrefixLength, capture);
                            track.PrefixLength += capture;
                            track.PacketBytes += length;
                            if (track.Packets >= 3) track.AudioBytes += length;
                            offset += length;
                            if (length < 255) FinishPacket(track, path);
                        }
                        if (granule < -1 || (granule >= 0 && granule < track.LastGranule))
                            throw Invalid(path, "OGG 音效时长信息无效，无法可靠检查码率");
                        if (granule >= 0) track.LastGranule = granule;
                        if ((flags & 4) != 0)
                        {
                            if (track.Packets <= 3 || track.PacketBytes != 0 || granule <= 0 || track.SampleRate == 0)
                                throw Invalid(path, "OGG 音效缺少完整音频或有效时长，无法可靠检查码率");
                            // Ogg granules count sample frames, independent of channel count.
                            // Exclude container bytes and all three Vorbis headers: short
                            // sounds can otherwise look much larger than 128 kbps.
                            decimal average = (decimal)track.AudioBytes * 8 * track.SampleRate / granule;
                            CheckBitrate(path, average, "音频平均码率");
                            completed++;
                            track = null;
                        }
                    }
                    if (completed == 0 || track != null)
                        throw Invalid(path, "OGG 音效未完整结束，无法可靠检查码率");
                }
            }
            catch (EndOfStreamException)
            {
                throw Invalid(path, "OGG 音效被截断，无法可靠检查码率");
            }
        }

        private static void FinishPacket(Track track, string path)
        {
            if (track.Packets < 3)
            {
                byte[] prefix = track.Prefix;
                if (track.PrefixLength < 7 || prefix[0] != (track.Packets * 2 + 1) ||
                    prefix[1] != 'v' || prefix[2] != 'o' || prefix[3] != 'r' ||
                    prefix[4] != 'b' || prefix[5] != 'i' || prefix[6] != 's')
                    throw Invalid(path, "音效必须是 OGG Vorbis，不能使用 OGG Opus 或伪装的音效文件");
                if (track.Packets == 0)
                {
                    if (track.PacketBytes != 30 || BitConverter.ToUInt32(prefix, 7) != 0 || prefix[11] == 0 ||
                        (prefix[29] & 1) == 0 || (prefix[28] & 15) < 6 || (prefix[28] >> 4) > 13 ||
                        (prefix[28] & 15) > (prefix[28] >> 4))
                        throw Invalid(path, "Vorbis 音效头信息无效，无法可靠检查码率");
                    track.SampleRate = BitConverter.ToUInt32(prefix, 12);
                    if (track.SampleRate == 0) throw Invalid(path, "Vorbis 采样率无效，无法可靠检查码率");
                    // Non-positive advisory values mean unspecified, not zero bitrate.
                    CheckBitrate(path, BitConverter.ToInt32(prefix, 20), "标称码率");
                    CheckBitrate(path, BitConverter.ToInt32(prefix, 16), "声明的码率上限");
                    CheckBitrate(path, BitConverter.ToInt32(prefix, 24), "声明的码率下限");
                }
            }
            else if (track.PacketBytes == 0 || (track.Prefix[0] & 1) != 0)
                throw Invalid(path, "Vorbis 音频包无效，无法可靠检查码率");
            track.Packets++;
            track.PacketBytes = 0;
            track.PrefixLength = 0;
        }

        private static void CheckBitrate(string path, decimal bitrate, string label)
        {
            if (bitrate <= MaxBitrate) return;
            string kbps = (Math.Ceiling(bitrate) / 1000).ToString("0.###", CultureInfo.InvariantCulture);
            throw new InvalidDataException("音效码率超过网易限制：" + Path.GetFileName(path) + "（" + label + " " + kbps +
                " kbps）。要求 OGG Vorbis 码率不大于 128 kbps，请重新转换后再导入；建议设置码率上限 128 kbps。\n文件路径：" + path);
        }

        private static InvalidDataException Invalid(string path, string reason) =>
            new InvalidDataException(reason + "。请转换为码率不大于 128 kbps 的 OGG Vorbis 后重试。\n文件路径：" + path);

        private static byte[] ReadExactly(BinaryReader input, int count)
        {
            byte[] bytes = input.ReadBytes(count);
            if (bytes.Length != count) throw new EndOfStreamException();
            return bytes;
        }

        private static uint[] CreateCrcTable()
        {
            var table = new uint[256];
            for (uint i = 0; i < table.Length; i++)
            {
                uint value = i << 24;
                for (int bit = 0; bit < 8; bit++)
                    value = (value << 1) ^ ((value & 0x80000000) != 0 ? 0x04c11db7u : 0);
                table[i] = value;
            }
            return table;
        }

        private static uint Crc(uint value, byte[] bytes)
        {
            foreach (byte octet in bytes) value = (value << 8) ^ CrcTable[(value >> 24) ^ octet];
            return value;
        }
    }
}
