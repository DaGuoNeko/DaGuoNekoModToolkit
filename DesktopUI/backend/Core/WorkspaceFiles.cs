using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace NpcSkinMaker
{
    internal static class WorkspaceFiles
    {
        private static void ValidateArchiveLimits(ZipArchive archive)
        {
            if (archive.Entries.Count > 20000)
                throw new InvalidDataException("资源包或工程的 ZIP 条目不能超过 20,000 个，请减少资源后重试。");
            if (archive.Entries.Sum(e => e.Length) > 512L * 1024 * 1024)
                throw new InvalidDataException("资源包或工程解压后的总大小不能超过 512 MiB（含配置文件），请减少资源后重试。");
        }

        public static string ResolveInside(string root, string relative)
        {
            relative = (relative ?? "").Replace('\\', '/');
            if (string.IsNullOrWhiteSpace(relative) || relative.StartsWith("/") ||
                relative.Contains(":") || relative.Split('/').Any(p => p == ".."))
                throw new InvalidDataException("资源路径无效: " + relative);
            string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string resolved = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!resolved.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("资源路径越界: " + relative);
            return resolved;
        }

        public static string Extract(string archivePath, string tempRoot)
        {
            string root = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            using (var archive = ZipFile.OpenRead(archivePath))
            {
                ValidateArchiveLimits(archive);
                var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var entry in archive.Entries)
                {
                    string path = ResolveInside(root, entry.FullName);
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) continue;
                    if (!paths.Add(path)) throw new InvalidDataException("ZIP 中存在重复路径: " + entry.FullName);
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    entry.ExtractToFile(path);
                }
            }
            return root;
        }

        public static void ValidateSkins(IEnumerable<SkinData> skins)
        {
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var skin in skins)
            {
                string id = skin.FromImport ? skin.OriginalId : skin.Id;
                if (string.IsNullOrWhiteSpace(id) || !ids.Add(id))
                    throw new InvalidDataException("皮肤 ID 为空或重复: " + id);
                skin.TargetIdentifier = SkinTargetPolicy.NormalizeIdentifier(skin.TargetIdentifier);
                skin.TextureSlot = SkinTargetPolicy.NormalizeSlot(skin.TargetIdentifier, skin.TextureSlot);
                if (!SkinTargetPolicy.ValidateTexture(skin.TexturePath, skin.TargetIdentifier, out string error))
                    throw new InvalidDataException(error);
                if (skin.FromImport) ResolveInside(Path.GetTempPath(), skin.OriginalTexture + ".png");
            }
        }

        public static void ValidateModels(IEnumerable<ModelEntry> models)
        {
            var manager = new ModelManager();
            foreach (var model in models) manager.AddModel(model);
            NpcCompatibility.ValidateAnimations(models);
        }

        public static void SaveProject(string path, List<SkinData> skins, List<ModelEntry> models, AssetPack textures, AssetPack sounds)
        {
            ValidateSkins(skins);
            ValidateModels(models);
            textures.Validate("textures");
            sounds.Validate("sounds");
            if (textures.ProviderId == sounds.ProviderId) throw new InvalidDataException("两个资源拓展包的标识不能相同");
            var manifest = new JObject(new JProperty("format", "DaGuoNekoModToolkit"),
                new JProperty("version", 2), new JProperty("skins", JArray.FromObject(skins)),
                new JProperty("models", JArray.FromObject(models)),
                new JProperty("texturePack", JObject.FromObject(textures)),
                new JProperty("soundPack", JObject.FromObject(sounds)));
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var archive = ZipFile.Open(temporary, ZipArchiveMode.Create))
                {
                    var assets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    Func<string, string> store = source =>
                    {
                        if (string.IsNullOrEmpty(source)) return "";
                        string digest;
                        using (var hash = SHA256.Create())
                        using (var stream = File.OpenRead(source))
                            digest = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                        string name = "assets/" + digest + Path.GetExtension(source).ToLowerInvariant();
                        if (assets.Add(name)) archive.CreateEntryFromFile(source, name);
                        return name;
                    };
                    MapPaths(manifest, store);
                    using (var writer = new StreamWriter(archive.CreateEntry("project.json").Open(), new UTF8Encoding(false, true)))
                        writer.Write(manifest.ToString());
                }
                // Check the finished archive before replacing an existing project. This
                // counts deduplicated assets and the actual UTF-8 manifest exactly as load does.
                using (var archive = ZipFile.OpenRead(temporary)) ValidateArchiveLimits(archive);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        public static void LoadProject(string path, string tempRoot, out List<SkinData> skins, out List<ModelEntry> models,
            out AssetPack textures, out AssetPack sounds)
        {
            string root = Extract(path, tempRoot);
            var manifest = JObject.Parse(ExportText.Read(Path.Combine(root, "project.json")));
            int? version = (int?)manifest["version"];
            if ((string)manifest["format"] != "DaGuoNekoModToolkit" || (version != 1 && version != 2) ||
                !(manifest["skins"] is JArray) || !(manifest["models"] is JArray))
                throw new InvalidDataException("工程格式或版本不支持");
            if (((JArray)manifest["skins"]).Count > 1000 || ((JArray)manifest["models"]).Count > 500)
                throw new InvalidDataException("工程条目数量超过限制");
            if (version == 2 && (!(manifest["texturePack"] is JObject) || !(manifest["soundPack"] is JObject)))
                throw new InvalidDataException("工程资源拓展配置缺失");
            MapPaths(manifest, relative => string.IsNullOrEmpty(relative) ? "" : ResolveInside(root, relative));
            skins = manifest["skins"].ToObject<List<SkinData>>();
            models = manifest["models"].ToObject<List<ModelEntry>>();
            ValidateSkins(skins);
            ValidateModels(models);
            textures = version == 1 ? AssetPack.Create("textures") : manifest["texturePack"].ToObject<AssetPack>();
            sounds = version == 1 ? AssetPack.Create("sounds") : manifest["soundPack"].ToObject<AssetPack>();
            textures.Validate("textures");
            sounds.Validate("sounds");
            if (textures.ProviderId == sounds.ProviderId) throw new InvalidDataException("两个资源拓展包的标识不能相同");
        }

        private static void MapPaths(JObject manifest, Func<string, string> map)
        {
            foreach (string key in new[] { "texturePack", "soundPack" })
                foreach (JObject entry in manifest[key]?["Entries"] ?? new JArray())
                    entry["Path"] = map((string)entry["Path"]);
            foreach (JObject skin in manifest["skins"]) skin["TexturePath"] = map((string)skin["TexturePath"]);
            foreach (JObject model in manifest["models"])
            {
                foreach (string key in new[] { "GeoPath", "PreviewImagePath", "ImportedBehaviorPath", "ImportedClientEntityPath" })
                    model[key] = map((string)model[key]);
                foreach (JObject texture in model["Textures"]) texture["Path"] = map((string)texture["Path"]);
                // Mapping may collapse equal-content files to one asset. Normalize on
                // both save and load so older projects with repeated references reopen.
                model["AnimationFiles"] = new JArray(model["AnimationFiles"].Values<string>()
                    .Select(map).Distinct(StringComparer.OrdinalIgnoreCase));
                foreach (JObject resource in model["AdditionalResources"] ?? new JArray())
                    resource["Path"] = map((string)resource["Path"]);
            }
        }
    }
}
