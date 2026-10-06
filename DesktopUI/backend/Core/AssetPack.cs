using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal sealed class AssetEntry
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string CategoryId { get; set; } = "icons";
        public string CategoryName { get; set; } = "图标";
        public string Path { get; set; }
        public List<string> SearchTags { get; set; } = new List<string>();
        public double Volume { get; set; } = 1;
        public double Pitch { get; set; } = 1;
        public bool Stream { get; set; }
    }

    internal sealed class AssetPack
    {
        public string ProviderId { get; set; }
        public string Name { get; set; }
        public string Author { get; set; } = "";
        public string Version { get; set; } = "1.0.0";
        public string BehaviorUuid { get; set; } = Guid.NewGuid().ToString();
        public string ResourceUuid { get; set; } = Guid.NewGuid().ToString();
        public string BehaviorModuleUuid { get; set; } = Guid.NewGuid().ToString();
        public string ResourceModuleUuid { get; set; } = Guid.NewGuid().ToString();
        // Derive a stable, pack-specific filename from the persistent resource UUID.
        [JsonIgnore]
        public string ConfigFileName => "asset_" + Guid.Parse(ResourceUuid).ToString("N") + ".json";
        public List<AssetEntry> Entries { get; set; } = new List<AssetEntry>();

        public static AssetPack Create(string kind) => new AssetPack
        {
            ProviderId = (kind == "textures" ? "tex_" : "snd_") + Guid.NewGuid().ToString("N").Substring(0, 8),
            Name = kind == "textures" ? "我的贴图拓展包" : "我的音效拓展包"
        };

        public static void ValidateId(string value, string label)
        {
            if (value == null || !Regex.IsMatch(value, @"\A[a-z][a-z0-9_]*\z") || value.Length > 80)
                throw new InvalidDataException(label + "必须以小写字母开头，只含小写字母、数字、下划线，最多 80 字符");
        }

        public static void ValidateEntry(AssetEntry entry, string kind)
        {
            ValidateId(entry.Id, "资源 ID");
            ValidateId(entry.CategoryId, "分类 ID");
            if (string.IsNullOrWhiteSpace(entry.Name) || string.IsNullOrWhiteSpace(entry.CategoryName))
                throw new InvalidDataException("资源名称和分类名称不能为空");
            if (entry.SearchTags == null || entry.SearchTags.Any(t => t == null))
                throw new InvalidDataException("搜索关键词必须是字符串列表");
            if (!File.Exists(entry.Path)) throw new InvalidDataException("资源文件不存在: " + entry.Path);
            if (new FileInfo(entry.Path).Length > 64L * 1024 * 1024)
                throw new InvalidDataException("单个资源不能超过 64 MB: " + entry.Path);
            if (kind == "textures")
            {
                using (var stream = File.OpenRead(entry.Path))
                {
                    byte[] signature = new byte[8];
                    if (!entry.Path.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || stream.Read(signature, 0, 8) != 8 ||
                        !signature.SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
                        throw new InvalidDataException("贴图必须是有效 PNG: " + entry.Path);
                    stream.Position = 0;
                    using (var image = Image.FromStream(stream, false, true))
                    {
                        if (image.Width > 8192 || image.Height > 8192)
                            throw new InvalidDataException("贴图尺寸不能超过 8192×8192");
                        using (var bitmap = new Bitmap(image)) bitmap.GetPixel(0, 0);
                    }
                }
            }
            else
            {
                // Reject renamed MP3/Opus files before creating a NetEase package.
                using (var stream = File.OpenRead(entry.Path))
                {
                    byte[] header = new byte[4096];
                    int read = stream.Read(header, 0, header.Length);
                    string probe = Encoding.ASCII.GetString(header, 0, read);
                    if (!entry.Path.EndsWith(".ogg", StringComparison.OrdinalIgnoreCase) ||
                        !probe.StartsWith("OggS") || !probe.Contains("\x01vorbis"))
                        throw new InvalidDataException("音效必须是 OGG Vorbis，不能直接改 MP3/Opus 扩展名: " + entry.Path);
                }
                if (double.IsNaN(entry.Volume) || double.IsInfinity(entry.Volume) || entry.Volume < 0 || entry.Volume > 1 ||
                    double.IsNaN(entry.Pitch) || double.IsInfinity(entry.Pitch) || entry.Pitch <= 0 || entry.Pitch > 256)
                    throw new InvalidDataException("音量必须在 0–1，音调必须大于 0 且不超过 256");
            }
        }

        public void Validate(string kind)
        {
            ValidateId(ProviderId, "包标识");
            if (Version == null || !Regex.IsMatch(Version, @"\A\d+\.\d+\.\d+\z") ||
                Version.Split('.').Any(part => !int.TryParse(part, out _)))
                throw new InvalidDataException("包版本必须是三个非负整数，例如 1.0.0");
            if (string.IsNullOrWhiteSpace(Name)) throw new InvalidDataException("拓展包名称不能为空");
            var uuids = new[] { BehaviorUuid, ResourceUuid, BehaviorModuleUuid, ResourceModuleUuid };
            if (uuids.Any(id => !Guid.TryParse(id, out _)) || uuids.Distinct(StringComparer.OrdinalIgnoreCase).Count() != 4)
                throw new InvalidDataException("拓展包 UUID 无效或重复");
            if (Entries == null || Entries.Any(e => e == null)) throw new InvalidDataException("资源列表无效");
            var ids = new HashSet<string>();
            var categories = new Dictionary<string, string>();
            foreach (var entry in Entries)
            {
                ValidateEntry(entry, kind);
                if (!ids.Add(entry.Id)) throw new InvalidDataException("资源 ID 重复: " + entry.Id);
                if (categories.TryGetValue(entry.CategoryId, out string category) && category != entry.CategoryName)
                    throw new InvalidDataException("同一分类 ID 的名称必须一致: " + entry.CategoryId);
                categories[entry.CategoryId] = entry.CategoryName;
            }
        }
    }
}
